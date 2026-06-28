# Week 3 — N8N + Claude Code Exercise (LongTo)

Two-direction daily-standup agent on top of `n8n-nodes-claude-code-cli`.

```
Direction 1:  Schedule/Manual/Webhook ─► GitHub ► Redmine ► Slack ► Code(merge+dedup) ► Claude Code CLI ► Slack post ► Respond
Direction 2:  Claude (claude.ai / CLI) ── MCP tool `run_standup_workflow` ─► n8n MCP trigger ─► Direction 1
```

## Files
| File | Purpose |
|------|---------|
| `.env.example` | All secrets / config in one place — referenced from n8n as `{{$env.VAR}}` |
| `docker-compose.override.yml` | Loads `.env` into n8n + claude-code-runner; enables `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` |
| `workflows/direction1-standup.json` | Importable n8n workflow (Direction 1) |
| `workflows/direction2-mcp.json` | Importable n8n workflow (MCP tool wrapper for Direction 1) |
| `code-node-merge.js` | Same JS as inlined in the workflow's Code node — kept here for readability/review |

## Setup
1. `cd docker/production/n8n-with-claude-code`
2. `Dockerfile.claude-code` -> change first line to `FROM debian:trixie-slim`
3. Copy `exercise/week3-standup/.env.example` to `.env` in the same folder; fill values
4. Copy `exercise/week3-standup/docker-compose.override.yml` next to `docker-compose.yml`
5. `docker compose up -d --build`
6. `docker exec -it claude-code-runner claude login` (one-time)
7. Open http://localhost:5678 → Settings → Community Nodes → install `n8n-nodes-claude-code-cli`
8. Import `workflows/direction1-standup.json` then `workflows/direction2-mcp.json`
9. Configure the Claude Code credential: **connectionMode=docker, containerName=claude-code-runner, containerIdentifier=name**
10. Activate both workflows

## Test (Direction 1)
```
curl -X POST http://localhost:5678/webhook/standup-run
# expects HTTP 200 + { ok:true, message:"...standup..." }; check Slack DM/channel.
```

## Test (Direction 2 — MCP)
Register the MCP server in your Claude client:
```
claude mcp add --transport sse n8n-standup http://localhost:5678/mcp/standup-mcp/sse
```
Then in Claude: **"run my standup for today"** → Claude calls `run_standup_workflow` → n8n executes Direction 1 → Slack post.

## Memory
The Claude Code CLI node is NOT a LangChain agent (no `ai_memory` input), so a Window Buffer Memory node cannot attach. Instead we use the node's **Resume Session** option with a fixed `STANDUP_SESSION_ID` UUID — functionally equivalent (last-N messages context retained across runs, persisted in `./claude-config`).

To verify:
```
docker exec -it claude-code-runner claude --resume 7b3e9c2a-1d4f-4a6b-9c8e-2f0a5d7b1e30 "What did I report in my last standup?"
```
