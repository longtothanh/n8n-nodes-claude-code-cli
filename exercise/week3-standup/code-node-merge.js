// Code node — Merge & Dedup (Direction 1)
// Inputs: three HTTP nodes (GitHub Commits, Redmine Issues, Slack Messages).
// Output: a single item with `activity` (string) + per-source counts, ready
// for the Claude Code node prompt.

const today = new Date().toISOString().slice(0, 10);

function normalizeGithub(items) {
  return (items || []).map((c) => ({
    source: 'github',
    id: c.sha,
    text: `[GitHub] ${c.commit?.message?.split('\n')[0] || ''} (${c.sha?.slice(0, 7)})`,
    ts: c.commit?.author?.date || '',
  }));
}

function normalizeRedmine(payload) {
  const issues = payload?.issues || [];
  return issues.map((i) => ({
    source: 'redmine',
    id: `RM-${i.id}`,
    text: `[Redmine #${i.id}] ${i.subject} — status: ${i.status?.name || '?'}`,
    ts: i.updated_on || '',
  }));
}

function normalizeSlack(payload) {
  const msgs = payload?.messages || [];
  return msgs
    .filter((m) => m.type === 'message' && m.text)
    .map((m) => ({
      source: 'slack',
      id: m.ts,
      text: `[Slack] ${m.text.slice(0, 240)}`,
      ts: m.ts,
    }));
}

// n8n: each upstream node is available via $items('Node Name').
const gh = normalizeGithub($items('GitHub Commits').map((i) => i.json).flat());
const rm = normalizeRedmine($items('Redmine Issues')[0]?.json || {});
const sl = normalizeSlack($items('Slack Messages')[0]?.json || {});

const all = [...gh, ...rm, ...sl];

// Dedup by source+id
const seen = new Set();
const deduped = all.filter((row) => {
  const k = `${row.source}:${row.id}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

// Group for the prompt
function group(src) {
  const lines = deduped.filter((r) => r.source === src).map((r) => `• ${r.text}`);
  return lines.length ? lines.join('\n') : '• (nothing)';
}

const activity = [
  `Date: ${today}`,
  '',
  'GitHub (last 24h):',
  group('github'),
  '',
  'Redmine (updated today):',
  group('redmine'),
  '',
  'Slack (today):',
  group('slack'),
].join('\n');

// Optional fault-injection for the red->green demo:
if ($env.STANDUP_FORCE_FAIL === '1') {
  throw new Error('STANDUP_FORCE_FAIL=1 -> failing the merge step on purpose.');
}

return [
  {
    json: {
      activity,
      counts: { github: gh.length, redmine: rm.length, slack: sl.length },
      session_id: $env.STANDUP_SESSION_ID,
      post_channel: $env.SLACK_POST_CHANNEL_ID,
    },
  },
];
