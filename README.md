# Well Tested suite run

Run a [Well Tested](https://welltested.io) suite on every push or pull request, wait for the verdict, and post one PR comment with proof links.

## Setup

1. In Well Tested, open your suite → **When should this run?** → turn on **Every push**. Copy the hook URL and the secret (shown once).
2. Add the secret to your repository as `WELLTESTED_HOOK` (Settings → Secrets and variables → Actions).
3. Add the workflow:

```yaml
name: Well Tested
on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  suite:
    runs-on: ubuntu-latest
    steps:
      - uses: Avangarde2225/welltested-run-action@v1
        with:
          hook-url: https://welltested.io/api/hooks/suites/<triggerId>
          token: ${{ secrets.WELLTESTED_HOOK }}
```

## Inputs

| Input | Default | Meaning |
|-------|---------|---------|
| `hook-url` | required | The suite trigger's hook URL |
| `token` | required | The trigger secret (`wt_hook_…`) |
| `wait` | `true` | Wait for the verdict |
| `comment-on-pr` | `true` | Upsert one PR comment for every outcome (passed, failed, blocked, not counted) |
| `fail-on` | `failed` | Comma-separated verdicts that fail the job |
| `timeout-seconds` | `1800` | Stop waiting after this many seconds |
| `poll-interval-seconds` | `15` | Seconds between status polls |
| `github-token` | `${{ github.token }}` | Token for the PR comment |

## Outputs

`verdict` (`passed` · `failed` · `blocked` · `not_counted` · `pending`), `proof-urls`, `batch-id`, `status-url`.

Runs that fail because our platform or your environment had a problem (for example a dead target) are reported as `blocked` or `not_counted` and never count against your plan.

No dependencies: plain Node, nothing installed at run time. The token is sent only in the `Authorization` header to the hook URL.
