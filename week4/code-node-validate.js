// Week 4 harness — Code-node validators (readable copy of what's inlined in
// the workflow JSON). Each validator emits { valid:boolean, errors:string[] }
// PLUS passes through the upstream payload on the true branch unchanged, so
// downstream nodes don't need to know the harness exists.
//
// Failure-injection: env STANDUP_FORCE_FAIL = "input" | "output" forces the
// matching validator to fail without corrupting real source data. Used only
// by harness-selftest.sh.

// ─── Validate Input ──────────────────────────────────────────────────────────
// Sits after `Merge & Dedup`, before `Generate Standup`.
// Stops a malformed merge from wasting a Claude call.
{
  const j = $json || {};
  const errors = [];

  if (typeof j.activity !== 'string' || j.activity.trim().length === 0) {
    errors.push('activity must be a non-empty string');
  }
  if (!j.counts || typeof j.counts.total !== 'number') {
    // counts.total is derived from github+redmine+slack; tolerate missing total
    // if individual counters are present.
    const c = j.counts || {};
    const fromParts =
      typeof c.github === 'number' &&
      typeof c.redmine === 'number' &&
      typeof c.slack === 'number';
    if (!fromParts) errors.push('counts.total (or github/redmine/slack) must be numeric');
  }
  // items[] is optional in our schema, but if present must be an array.
  if ('items' in j && !Array.isArray(j.items)) {
    errors.push('items must be an array when present');
  }

  if ($env.STANDUP_FORCE_FAIL === 'input') {
    errors.push('forced failure (STANDUP_FORCE_FAIL=input)');
  }

  const valid = errors.length === 0;
  const c = j.counts || {};
  const total =
    typeof c.total === 'number'
      ? c.total
      : (c.github || 0) + (c.redmine || 0) + (c.slack || 0);

  // Structured log line — pick it up with `docker compose logs -f n8n`.
  console.log(`[standup][input]  valid=${valid}  total=${total}  errors=${JSON.stringify(errors)}`);

  return [{ json: { ...j, valid, errors, _stage: 'input' } }];
}

// ─── Validate Output ─────────────────────────────────────────────────────────
// Sits after `Generate Standup`, before `Build Slack Payload`.
// Stops garbage from being posted.
{
  // The Claude Code node emits { output: "...", success: true|false, ... }
  const j = $json || {};
  const text = (j.output || '').toString();
  const errors = [];

  if (j.success === false) errors.push('claude node reported success=false');
  if (text.trim().length === 0) errors.push('claude output is empty');

  // All three sections must be present (header text only — emoji prefix optional).
  const required = ['Yesterday', 'Today', 'Blockers'];
  for (const s of required) {
    if (!new RegExp(`\\*${s}\\*`).test(text)) {
      errors.push(`missing section: ${s}`);
    }
  }

  if ($env.STANDUP_FORCE_FAIL === 'output') {
    errors.push('forced failure (STANDUP_FORCE_FAIL=output)');
  }

  const valid = errors.length === 0;
  console.log(`[standup][output] valid=${valid} len=${text.length}  errors=${JSON.stringify(errors)}`);

  return [{ json: { ...j, valid, errors, _stage: 'output' } }];
}
