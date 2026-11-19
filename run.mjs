// Well Tested run action: post the suite hook, poll the batch, set outputs
// and upsert one PR comment. Node 20+, no dependencies.
import { appendFileSync, readFileSync } from "node:fs"

import { buildCommentBody, MARKER } from "./comment.mjs"

const PREFLIGHT_CODES = new Set(["TARGET_UNREACHABLE", "TUNNEL_OFFLINE", "TARGET_HTTP_ERROR"])

const env = (name, fallback = "") => (process.env[name] ?? fallback).trim()
const truthy = (value) => /^(1|true|yes|on)$/i.test(value)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT
  const text = String(value ?? "")
  if (!file) {
    console.log(`${name}=${text}`)
    return
  }
  const delimiter = `wt_${Math.random().toString(36).slice(2)}`
  appendFileSync(file, `${name}<<${delimiter}\n${text}\n${delimiter}\n`)
}

function readEvent() {
  try {
    return process.env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")) : {}
  } catch {
    return {}
  }
}

async function postHook({ hookUrl, token, commitSha, ref }) {
  const response = await fetch(hookUrl, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ commitSha, ref }),
  })
  const body = await response.json().catch(() => ({}))
  return { status: response.status, ok: response.ok, body }
}

async function pollStatus({ statusUrl, token, timeoutMs, intervalMs }) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    const response = await fetch(statusUrl, { headers: { authorization: `Bearer ${token}` } })
    if (response.ok) {
      last = await response.json()
      const summary = (last.tests ?? []).map((t) => `${t.verdict}\t${t.name}\t${t.proofUrl ?? "pending"}`).join("\n")
      if (summary) console.log(summary)
      if (last.batch?.terminal) return last
    } else if (response.status !== 429 && response.status < 500) {
      throw new Error(`Status request failed with HTTP ${response.status}`)
    }
    await sleep(intervalMs)
  }
  return last
}

async function upsertPrComment({ githubToken, body }) {
  const event = readEvent()
  const prNumber = event.pull_request?.number
  const repo = process.env.GITHUB_REPOSITORY
  if (!prNumber || !repo || !githubToken) return "skipped"
  const api = (process.env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/$/, "")
  const headers = {
    authorization: `Bearer ${githubToken}`,
    accept: "application/vnd.github+json",
    "content-type": "application/json",
  }
  let existingId = null
  for (let page = 1; page <= 10 && !existingId; page += 1) {
    const response = await fetch(`${api}/repos/${repo}/issues/${prNumber}/comments?per_page=100&page=${page}`, { headers })
    if (!response.ok) break
    const comments = await response.json()
    existingId = comments.find((c) => typeof c.body === "string" && c.body.includes(MARKER))?.id ?? null
    if (comments.length < 100) break
  }
  const url = existingId
    ? `${api}/repos/${repo}/issues/comments/${existingId}`
    : `${api}/repos/${repo}/issues/${prNumber}/comments`
  const response = await fetch(url, { method: existingId ? "PATCH" : "POST", headers, body: JSON.stringify({ body }) })
  return response.ok ? (existingId ? "updated" : "created") : `failed_${response.status}`
}

async function main() {
  const hookUrl = env("WT_HOOK_URL")
  const token = env("WT_TOKEN")
  if (!hookUrl || !token) throw new Error("hook-url and token are required")
  const event = readEvent()
  const commitSha = event.pull_request?.head?.sha || env("GITHUB_SHA")
  const ref = event.pull_request?.head?.ref || env("GITHUB_REF_NAME") || env("GITHUB_REF")
  const failOn = new Set(env("WT_FAIL_ON", "failed").split(",").map((v) => v.trim()).filter(Boolean))
  const commentOnPr = truthy(env("WT_COMMENT_ON_PR", "true"))

  const wait = truthy(env("WT_WAIT", "true"))
  const intervalMs = Number(env("WT_POLL_INTERVAL_SECONDS", "15")) * 1000
  let hook = await postHook({ hookUrl, token, commitSha, ref })
  // 202: an identical delivery is still starting the run. Ask once more for its address.
  if (wait && hook.ok && !hook.body?.statusUrl) {
    console.log("Well Tested accepted the delivery but sent no status address yet. Asking again once.")
    await sleep(Math.min(intervalMs, 10_000))
    hook = await postHook({ hookUrl, token, commitSha, ref })
  }
  let verdict = "pending"
  let status = null
  let message = null
  const merged = Boolean(hook.body?.merged)

  if (!hook.ok) {
    const code = hook.body?.error?.code
    if (hook.status === 422 && PREFLIGHT_CODES.has(code)) {
      verdict = "blocked"
      message = hook.body.error.message ?? null
    } else {
      const text = typeof hook.body?.error === "string" ? hook.body.error : hook.body?.error?.message ?? `HTTP ${hook.status}`
      throw new Error(`Well Tested hook refused the run: ${text}`)
    }
  } else {
    setOutput("batch-id", hook.body.batchId ?? "")
    setOutput("status-url", hook.body.statusUrl ?? "")
    console.log(`Well Tested batch ${hook.body.batchId ?? "(merging)"}${merged ? " (merged)" : ""}`)
    if (!wait || !hook.body.statusUrl) {
      setOutput("verdict", "pending")
      setOutput("proof-urls", "")
      if (wait) {
        console.error(
          `Well Tested accepted the run but sent no status address, so this action could not follow the run. ` +
            `Find it under Runs at ${new URL(hookUrl).origin}/app/runs.`,
        )
        process.exitCode = 1
      }
      return
    }
    status = await pollStatus({
      statusUrl: hook.body.statusUrl,
      token,
      timeoutMs: Number(env("WT_TIMEOUT_SECONDS", "1800")) * 1000,
      intervalMs,
    })
    verdict = status?.batch?.terminal ? status.batch.verdict : "pending"
  }

  setOutput("verdict", verdict)
  setOutput("proof-urls", (status?.proofUrls ?? []).join("\n"))

  if (verdict === "pending") {
    console.log("Timed out waiting for the Well Tested verdict.")
    process.exitCode = 1
    return
  }
  if (commentOnPr && status?.prCommentAllowed !== false) {
    const outcome = await upsertPrComment({
      githubToken: env("WT_GITHUB_TOKEN"),
      body: buildCommentBody({ verdict, commitSha, merged, message, status }),
    })
    console.log(`PR comment: ${outcome}`)
  }
  console.log(`Well Tested verdict: ${verdict}`)
  if (failOn.has(verdict)) process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
