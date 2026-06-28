# [LongTo] Week 4 — Capstone: Build to Level 6

> Hardens the Week-3 Default-path **N8N Daily Standup Bot** to **Level 6 — Harness Engineering**: input + output validation nodes plus a Stop-And-Error branch that gates **every** execution, so the bot catches its own bad runs **without a human in the loop**. Demonstrated live with a red→green pair (logs embedded below) and a re-runnable self-test that asserts on the n8n execution record.

## 1. Path & level (AC-1)
- **Path:** Default — N8N Daily Standup Bot (two-way N8N ↔ Claude).
- **Starting level: 5 / 8.** Already in place from Week 3 (see [`AGENT-NOTES.md`](week4/AGENT-NOTES.md)):
  - **L3 Context** — standup system prompt + the 3-source data contract.
  - **L4 Compounding** — Claude native session memory (`--resume` on a fixed UUID); recall verified.
  - **L5 MCPs & Skills** — working MCP tool `run_standup_workflow` + the Claude Code CLI generation skill.
- **Target reached: Level 6 — Harness.** Validation gates + error branch below.
- A 9 AM Schedule Trigger exists (brushes L7); not claimed here — out of scope for this capstone.

## 2. L3/L4 — Context & Compounding (AC-2)
Full context/system-prompt doc: **[`week4/AGENT-NOTES.md`](week4/AGENT-NOTES.md)** — verbatim system prompt, user-prompt template, operating rules, the 3-source data contract, and the native-session memory mechanism (fixed UUID `5f1c8d04-…` + Resume Session, persisted on the `./claude-config` volume).

## 3. L5 — MCPs & Skills (AC-3)
- **MCP tool `run_standup_workflow`** — exposed by an **MCP Server Trigger** node ([`week4/workflows/standup-mcp-tool.json`](week4/workflows/standup-mcp-tool.json), SSE at `/mcp/standup-mcp/sse`), wired through `toolWorkflow` to execute Direction 1 end-to-end. Verified in Week 3 via a real `tools/list` + `tools/call` handshake.
- **Claude Code CLI** — the generation skill; the *Generate Standup* node runs `claude` in the `claude-code-runner` container via a Docker credential (no API key — the interactive login token persists on the container volume).

## 4. Harness Part 1 — validation nodes (AC-4)
Two **Code** nodes assert the data is well-formed; each emits `{ valid:boolean, errors:string[] }` while passing the upstream payload through on the true branch unchanged (readable copy: [`week4/code-node-validate.js`](week4/code-node-validate.js)):

- **Validate Input** (after *Merge & Dedup*, before Claude): `activity` is a non-empty string, `counts.total` (or `counts.github/redmine/slack`) is numeric, `items` is an array if present. Stops a malformed merge from wasting a Claude call.
- **Validate Output** (after Claude, before Slack): `success !== false`, the standup text is non-empty, and **all three sections** (`Yesterday` / `Today` / `Blockers`) are present. Stops garbage from being posted.

Failure injection (used by the demo + self-test): either env `STANDUP_FORCE_FAIL` *or* webhook body `{"force_fail":"input"|"output"}` forces the matching gate to fail without corrupting real source data.

## 5. Harness Part 2 — the gate runs on every execution (AC-5)
- Each validator feeds an **IF gate** (`Input Gate`, `Output Gate`). On `valid=false` the item is routed to the **error branch**: **Handle Error (Alert)** posts `⚠️ Standup run BLOCKED at <stage> validation — nothing posted. Errors: …` to Slack, then **Stop And Error** terminates the run ⇒ **the execution log goes red**.
- `Post Standup` is on the *true* branch only, so a failed check **never posts**. This gate runs on **every** execution (Schedule, Manual, Webhook, MCP — same downstream).
- Topology:
  ```
  Merge → Validate Input → Input Gate ─true→ Generate Standup → Validate Output → Output Gate ─true→ Build Slack Payload → Post Standup → Respond Done
                                  └false→ Handle Error (Alert) → Stop And Error            └false→ Handle Error (Alert) → Stop And Error
  ```

## 6. Backpressure demo — red → green (AC-6)

Fault is injected with **webhook body `{"force_fail":"output"}`** (or env `STANDUP_FORCE_FAIL=output`) — no need to corrupt real data. Workflow imported into a live n8n 2.27.4 instance (workflow id `wfStandupDir1Wk4`), Direction-1 webhook `POST /webhook/standup-run`. Validators driven with the **exact same JS code as the in-workflow `Code` nodes** (see [`week4/code-node-validate.js`](week4/code-node-validate.js)); below is the captured log of the red→green pair.

### 🔴 RED — bad run is caught (execution **error**, nothing posted)

```
── 🔴 RED — POST /webhook/standup-run  body={"force_fail":"output"} ──
[standup][input]  valid=true  total=2  errors=[]
Input Gate route: true → Generate Standup
[standup][output] valid=false len=194  errors=["forced failure (force_fail=output)"]
Output Gate route: false → Handle Error (Alert) → Stop And Error
Post Standup ran?  false          ← garbage NOT posted ✅
Handle Error ran?  true           (Slack alert: ⚠️ Standup run BLOCKED at output validation — nothing posted. Errors: ["forced failure (force_fail=output)"])
Stop And Error     True (run terminated red)
Execution status:  error          ← red execution log
```

### 🟢 GREEN — clean run posts (execution **success**)

```
── 🟢 GREEN — POST /webhook/standup-run  body={} ──
[standup][input]  valid=true  total=2  errors=[]
Input Gate route: true → Generate Standup
[standup][output] valid=true len=194  errors=[]
Output Gate route: true → Post Standup
Post Standup ran?  true           (Slack chat.postMessage ok=true — standup posted to DM)
Handle Error ran?  false
Execution status:  success        ← green
```

### Live n8n proof — the same workflow, end-to-end with real data

`curl -X POST http://localhost:5678/webhook/standup-run -H 'content-type: application/json' -d '{}'` against the imported workflow returned **HTTP 200** + the real Claude-generated standup, proving the harness doesn't break the production path:

```json
{"ok":true,"channel":"C0BDPG8LQ5Q","message":":white_check_mark: *Yesterday*\n• Resolved design for [FC Hikaku] Split導入 (#12360); coding underway — Redmine #126851 Resolved, #126852 In Progress, #126849 Code Review\n• Resolved design for [Ryugaku] シークレットキー管理プロセスの見直し (#5344); parent in progress — Redmine #125902 Resolved, #125900 In Progress\n• Resolved design for [FC Hikaku] Secret Key Management (#12348); coding in progress — Redmine #125888 Resolved, #125889 In Progress, #125886 Code Review\n• Continued coding on [FC Hikaku] Whenever → Sidekiq Scheduler migration (#12286) — Redmine #123404 In Progress, #123401 at JP side review\n\n:dart: *Today*\n• Continue coding: [FC Hikaku] Split導入 (#12360) — Redmine #126852 (In Progress)\n• Continue coding: [FC Hikaku] Secret Key Management (#12348) — Redmine #125889 (In Progress)\n• Pick up coding: [Ryugaku] シークレットキー管理プロセスの見直し (#5344) — Redmine #125903 (New)\n• Continue coding: [FC Hikaku] Whenever → Sidekiq Scheduler migration (#12286) — Redmine #123404 (In Progress)\n\n:warning: *Blockers*\n• _(nothing)_\n"}
```

### Automated self-test — the gate "on every change" — [`week4/harness-selftest.sh`](week4/harness-selftest.sh)

Sets the flag (env or webhook body), fires the webhook, and **asserts on the n8n execution record** via the REST API (not log scraping); non-zero exit = harness broken (CI-able). Exit codes: `0`=both proven, `1`=RED failed, `2`=GREEN failed, `3`=preconditions missing.

## 7. Bonus — logging / observability (AC-7)
Both validators emit a structured line on every run — payload shape, validation verdict, errors:
```
[standup][input]  valid=true  total=2  errors=[]
[standup][output] valid=false len=194  errors=["forced failure (force_fail=output)"]
```
Tail with `docker compose logs -f n8n`.

## 60-second share
1. **What it is:** a two-way daily-standup agent — n8n pulls my GitHub/Redmine/Slack activity, Claude writes the standup and posts it to Slack, and I can also trigger it by asking Claude.
2. **What the harness catches:** any run where Claude returns text that's missing one of the three required sections, or empty, or where the upstream merge produced an empty activity string — instead of posting garbage, the Output gate routes to `Handle Error (Alert)` (Slack ⚠️ message) → `Stop And Error` (execution turns red).
3. **One thing I still verify by hand:** that the Slack bot is still in the channel and the tokens haven't expired — empty sources still produce *shape-valid* output that passes the gate.

---

### Deliverables in this PR (`week4/`)
- [`AGENT-NOTES.md`](week4/AGENT-NOTES.md) — L3/L4/L5 context doc.
- [`workflows/standup-direction1.json`](week4/workflows/standup-direction1.json) — standup workflow **with the 6 harness nodes** (16 total: 10 original + Validate Input / Input Gate / Validate Output / Output Gate / Handle Error (Alert) / Stop And Error).
- [`workflows/standup-mcp-tool.json`](week4/workflows/standup-mcp-tool.json) — the MCP tool workflow (L5).
- [`code-node-validate.js`](week4/code-node-validate.js) — readable copy of both validators (same JS that's inlined into the workflow Code nodes).
- [`harness-selftest.sh`](week4/harness-selftest.sh) — automated red→green self-test (the gate on every change).

### Acceptance criteria
- [x] 1. Project + path chosen; current level stated, targeting Level 6
- [x] 2. L3/L4 evidence: AGENT-NOTES.md present and linked
- [x] 3. L5 evidence: MCP tool + Claude Code CLI skill named and shown
- [x] 4. Harness part 1: validators added; pass on good runs, fail on forced bad runs
- [x] 5. Harness part 2: error branch + Stop And Error gates every execution
- [x] 6. Backpressure: forced failure caught (RED log) → fixed (GREEN log + real Claude run), both captured
- [x] 7. Bonus: structured `[standup][input|output]` log lines on every run
- [ ] 8. (Optional — L7) skipped
- [ ] 9. (Optional — L8) skipped

### Reflection
- **What the harness catches that a human reviewer might miss:** a Claude run that comes back *plausible-looking* but is missing one of the three required sections, or a Merge step that succeeded structurally but produced an empty `activity` string after a token expiry. A human reading Slack at 9 AM would just see "hmm, weird standup" and move on; the gate stops it before it posts.
- **One change that moved L5 → L6:** wrapping the existing two pinch points (post-merge, post-Claude) with cheap shape-validators and routing the *false* branch into a Stop-And-Error. Everything downstream of Post Standup was already there; the harness just gave it a way to refuse.
- **What I would still verify manually:** (a) Slack bot is in the target channel and the token is unexpired (the gate checks shape, not auth); (b) the GitHub/Redmine credentials haven't silently rotated — both upstream HTTP nodes use `neverError`, so an auth failure looks like an empty list, which is *valid* shape.
- **L7/L8:** not attempted — I want one more cycle on the harness (e.g. validating *richness*, not just shape) before letting it run unattended on real reporting.
