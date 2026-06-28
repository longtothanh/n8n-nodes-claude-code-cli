# AGENT-NOTES — Daily Standup Bot (LongTo)

Context, prompts and operating rules for the Week-3 standup agent that the Week-4 harness wraps. This file is the L3/L4 evidence for the capstone PR.

---

## 1. What the agent is

A two-way daily-standup bot built on `n8n-nodes-claude-code-cli`.

```
Direction 1 (N8N → Claude):
  Schedule 9AM / Manual / Webhook
    ─► GitHub commits (last 24h)
    ─► Redmine issues (assigned to me, last 7d)
    ─► Slack messages (today)
    ─► Code: Merge & Dedup
    ─► Claude Code CLI (Resume Session)
    ─► Build Slack Payload (Block Kit)
    ─► Slack chat.postMessage
    ─► Respond Done

Direction 2 (Claude → N8N, via MCP):
  Claude (claude.ai / CLI) ── tools/call `run_standup_workflow`
    ─► n8n MCP Server Trigger (SSE /mcp/standup-mcp/sse)
    ─► toolWorkflow → executes Direction 1
```

## 2. L3 — Context (system prompt + data contract)

### System prompt (`replace` mode, pinned in the *Generate Standup* node)

```
You are a standup assistant. Read the activity data and summarize it into a
Yesterday / Today / Blockers standup. Output **Slack mrkdwn** (not Markdown):
- Use single asterisks `*text*` for bold (NOT double `**`)
- Use `•` for bullets, indent with 2 spaces for sub-bullets
- Cite the source on each bullet (Redmine #id, GitHub SHA, etc.)
- Keep each bullet under 140 chars
- Use exactly these 3 section headers, each with the emoji:
    `:white_check_mark: *Yesterday*`
    `:dart: *Today*`
    `:warning: *Blockers*`
Separate sections with one blank line. Never fabricate.
If a section truly has no signal, write `• _(nothing)_`.
```

### User prompt template

```
Activity for {{$now.toFormat('yyyy-MM-dd')}}:

{{$json.activity}}

Write my daily standup in EXACTLY three sections (Yesterday / Today / Blockers).
Use bullet points referencing the GitHub commits / Redmine issues / Slack
messages shown above. If a section truly has no signal, write • _(nothing)_.
```

### Data contract (input to Claude)

The `Merge & Dedup` Code node always emits **one item** with this shape — Claude relies on it being stable:

```json
{
  "activity": "Date: 2026-06-28\n\nGitHub (last 24h):\n• ...\n\nRedmine (assigned to me, last 7d):\n• ...\n\nSlack (today):\n• ...",
  "counts":   { "github": 0, "redmine": 0, "slack": 0 },
  "session_id":   "<STANDUP_SESSION_ID>",
  "post_channel": "<SLACK_POST_CHANNEL_ID>"
}
```

Operating rules:
- Never fabricate items not in `activity`.
- Empty section ⇒ `• _(nothing)_`, do not skip the header.
- Output is plain text (`outputFormat: text`) — the downstream node converts it to Block Kit.

## 3. L4 — Compounding (native session memory)

The Claude Code CLI node is **not** a LangChain agent, so a Window Buffer Memory node cannot be attached. Instead we use the node's built-in **Resume Session** mode with a fixed UUID — functionally equivalent for our purpose (the last-N conversation turns are kept across runs, persisted on the `./claude-config` volume).

- `STANDUP_SESSION_ID = 5f1c8d04-9a7e-4b3a-8e21-7c0d3a2f6b9d` (fixed; mine)
- Persisted in the `claude-code-runner` container at `/home/node/.claude` (mounted from `./claude-config`).

Recall check (verified working):

```bash
docker exec -it claude-code-runner \
  claude --resume 5f1c8d04-9a7e-4b3a-8e21-7c0d3a2f6b9d \
  "What did I report in my last standup?"
# → Claude recalls yesterday's Yesterday/Today/Blockers content.
```

## 4. L5 — MCPs & Skills

| Artifact | Purpose |
|---|---|
| **MCP tool `run_standup_workflow`** | Exposed by the MCP Server Trigger in `workflows/standup-mcp-tool.json` (SSE at `/mcp/standup-mcp/sse`). Wired through `toolWorkflow` to execute Direction 1 end-to-end. Verified via a real `tools/list` + `tools/call` handshake in Week 3. |
| **Claude Code CLI skill** | The *Generate Standup* node runs `claude` inside the `claude-code-runner` container via a Docker credential (`connectionMode=docker`, `containerName=claude-code-runner`). No API key — uses the interactive login token stored on the container volume. |

Register the MCP from a Claude client:

```bash
claude mcp add --transport sse n8n-standup http://localhost:5678/mcp/standup-mcp/sse
# Then in Claude:  "run my standup for today"
```

## 5. Where the harness plugs in (preview of Week 4)

The Week-4 PR adds 6 harness nodes around the existing topology, but does NOT change the data contract above:

```
... Merge & Dedup ─► Validate Input ─► Input Gate ─true─► Generate Standup
                                                  └false─► Handle Error → Stop And Error
   Generate Standup ─► Validate Output ─► Output Gate ─true─► Build Slack Payload → Post Standup → Respond Done
                                                       └false─► Handle Error → Stop And Error
```

Both validators preserve the existing JSON shape on the *true* branch — downstream nodes are unchanged.

## 6. Environment variables this agent depends on

`STANDUP_SESSION_ID`, `SLACK_POST_CHANNEL_ID`, `SLACK_FETCH_CHANNEL_ID`, `SLACK_BOT_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_TOKEN`, `REDMINE_BASE_URL`, `REDMINE_API_KEY`, `REDMINE_BASIC_B64`.

Week 4 adds one more: `STANDUP_FORCE_FAIL` ∈ `{unset, "input", "output"}` — used only by the harness self-test to inject a failure at the named gate without corrupting real source data.
