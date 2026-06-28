// Code node — Merge & Dedup (Direction 1)
// Inputs (referenced by name, no need to be wired as inputs):
//   - HTTP Request "GitHub Commits"   -> array of commits OR { data: <html-on-error> }
//   - HTTP Request "Redmine Issues"   -> { issues: [...] } OR { data: <401 html> }
//   - HTTP Request "Slack Messages"   -> { messages: [...] }
// Output: single item { activity, counts, session_id, post_channel } feeding the Claude Code node.

const today = new Date().toISOString().slice(0, 10);

function unwrap(node) {
  const items = $items(node);
  if (!items.length) return null;
  const j = items[0].json;
  // HTTP node sometimes wraps as { data: ... } (e.g. for non-JSON 401 HTML);
  // unwrap unless this is already a recognized JSON shape.
  if (j && typeof j === 'object' && 'data' in j && !('issues' in j) && !('messages' in j) && !Array.isArray(j)) {
    return j.data;
  }
  return j;
}

function asArray(x) { return Array.isArray(x) ? x : (x ? [x] : []); }

function normGithub(raw) {
  return asArray(raw)
    .filter((c) => c && c.commit)
    .map((c) => ({
      source: 'github',
      id: c.sha,
      text: `[GitHub] ${(c.commit.message || '').split('\n')[0]} (${(c.sha || '').slice(0, 7)})`,
      ts: (c.commit.author && c.commit.author.date) || '',
    }));
}

function normRedmine(raw) {
  const obj = raw && typeof raw === 'object' ? raw : {};
  const issues = obj.issues || [];
  return issues.map((i) => ({
    source: 'redmine',
    id: `RM-${i.id}`,
    text: `[Redmine #${i.id}] [${(i.project || {}).name || '?'}] ${i.subject} — ${(i.status || {}).name || '?'} (updated ${(i.updated_on || '').slice(0, 10)})`,
    ts: i.updated_on || '',
  }));
}

function normSlack(raw) {
  const obj = raw && typeof raw === 'object' ? raw : {};
  const msgs = obj.messages || [];
  return msgs
    .filter((m) => m && m.type === 'message' && m.text && !m.subtype)
    .map((m) => ({ source: 'slack', id: m.ts, text: `[Slack] ${m.text.slice(0, 240)}`, ts: m.ts }));
}

const gh = normGithub(unwrap('GitHub Commits'));
const rm = normRedmine(unwrap('Redmine Issues'));
const sl = normSlack(unwrap('Slack Messages'));

const seen = new Set();
const deduped = [...gh, ...rm, ...sl].filter((r) => {
  const k = `${r.source}:${r.id}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

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
  'Redmine (assigned to me, last 7d):',
  group('redmine'),
  '',
  'Slack (today):',
  group('slack'),
].join('\n');

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
