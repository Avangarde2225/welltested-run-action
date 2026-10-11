// PR comment body for the Well Tested run action (pure, unit-tested from
// lib/ci/run-action-comment.test.ts). One comment per PR, found by MARKER
// and updated in place, for EVERY terminal outcome (AD-PRICE-007):
// passed, failed, blocked, not counted.

export const MARKER = "<!-- well-tested-evidence -->"

const HEADLINES = {
  passed: "✅ Passed",
  failed: "❌ Failed",
  blocked: "⏸️ Blocked: your site could not be reached (not counted)",
  not_counted: "⚠️ Finished without a verdict (not counted)",
  pending: "⏳ Still running",
}

const TEST_LABELS = {
  passed: "passed",
  failed: "failed",
  blocked: "blocked",
  not_counted: "not counted",
  pending: "pending",
}

function escapeCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").slice(0, 200)
}

/**
 * @param {{
 *   verdict: "passed" | "failed" | "blocked" | "not_counted" | "pending",
 *   commitSha?: string | null,
 *   merged?: boolean,
 *   message?: string | null,
 *   status?: { tests?: Array<{ name: string, target?: string, verdict: string, proofUrl?: string | null, error?: string | null }>, links?: { batchUrl?: string } } | null,
 * }} input
 * @returns {string}
 */
export function buildCommentBody(input) {
  const verdict = HEADLINES[input.verdict] ? input.verdict : "not_counted"
  const lines = [MARKER, `### Well Tested: ${HEADLINES[verdict]}`, ""]
  const sha = input.commitSha ? `\`${String(input.commitSha).slice(0, 7)}\`` : null
  if (sha) lines.push(`Commit ${sha}${input.merged ? " (merged with an identical event from the last 10 minutes)" : ""}`, "")
  if (input.message) lines.push(String(input.message), "")

  const tests = input.status?.tests ?? []
  if (tests.length > 0) {
    lines.push("| Test | Browser | Result | Proof |", "|---|---|---|---|")
    for (const test of tests) {
      const proof = test.proofUrl ? `[proof](${test.proofUrl})` : "—"
      lines.push(`| ${escapeCell(test.name)} | ${escapeCell(test.target ?? "")} | ${TEST_LABELS[test.verdict] ?? escapeCell(test.verdict)} | ${proof} |`)
    }
    lines.push("")
  }
  if (verdict === "blocked") {
    lines.push("Nothing was charged. Bring the site back (or restart your tunnel) and push again.")
  } else if (verdict === "not_counted") {
    lines.push("These runs were not counted against your plan.")
  }
  if (input.status?.links?.batchUrl) lines.push(`[Open the full run in Well Tested](${input.status.links.batchUrl})`)
  return lines.join("\n").trimEnd() + "\n"
}
