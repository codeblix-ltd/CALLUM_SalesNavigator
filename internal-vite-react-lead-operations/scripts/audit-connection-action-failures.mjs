import pg from 'pg';

if (!process.env.COCKROACH_DATABASE_URL) throw new Error('COCKROACH_DATABASE_URL is required');
const client = new pg.Client({
  connectionString: process.env.COCKROACH_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  options: '--default_transaction_read_only=on --statement_timeout=30000',
});
await client.connect();
try {
  const scoutPatterns = await client.query(`
    WITH events AS (
      SELECT operator_id, created_at, event_type, details->>'error' AS error
      FROM lead_assignment_events
      WHERE created_at >= now() - INTERVAL '7 days'
    )
    SELECT operator_id,
      count(*) FILTER (WHERE error LIKE 'We couldn%check that the request is for %')::INT AS recipient_failures,
      count(*) FILTER (WHERE error = 'The connection state could not be confirmed. Nothing was sent for this lead.')::INT AS state_failures,
      count(*) FILTER (WHERE event_type = 'connection_requested')::INT AS requests,
      max(created_at) FILTER (WHERE event_type = 'connection_requested')::STRING AS last_request,
      max(created_at) FILTER (WHERE error LIKE 'We couldn%check that the request is for %')::STRING AS last_recipient_failure
    FROM events GROUP BY operator_id
    HAVING count(*) FILTER (WHERE error LIKE 'We couldn%check that the request is for %') > 0
      OR count(*) FILTER (WHERE error = 'The connection state could not be confirmed. Nothing was sent for this lead.') > 0
    ORDER BY state_failures DESC, recipient_failures DESC`);
  const maryamDaily = await client.query(`
    SELECT created_at::DATE::STRING AS day, event_type, details->>'error' AS error,
      count(*)::INT AS n
    FROM lead_assignment_events
    WHERE operator_id = $1 AND created_at >= now() - INTERVAL '14 days'
      AND event_type IN ('connection_requested', 'failed', 'post_engaged')
    GROUP BY created_at::DATE, event_type, details->>'error'
    ORDER BY day DESC, event_type, error`, ['maryam']);
  const recipientRecovery = await client.query(`
    WITH failures AS (
      SELECT operator_id, min(created_at) AS first_failure, max(created_at) AS last_failure,
        count(*)::INT AS failures
      FROM lead_assignment_events
      WHERE created_at >= now() - INTERVAL '7 days'
        AND details->>'error' LIKE 'We couldn%check that the request is for %'
      GROUP BY operator_id
    )
    SELECT f.operator_id, f.failures, f.first_failure::STRING, f.last_failure::STRING,
      count(e.*) FILTER (WHERE e.event_type = 'connection_requested'
        AND e.created_at > f.last_failure)::INT AS requests_after_last_failure
    FROM failures f LEFT JOIN lead_assignment_events e
      ON e.operator_id = f.operator_id AND e.created_at > f.last_failure
        AND e.created_at <= now()
    GROUP BY f.operator_id, f.failures, f.first_failure, f.last_failure
    ORDER BY f.failures DESC, f.operator_id`);
  const rymaelieGuardReplay = await client.query(`
    SELECT created_at::STRING AS at, event_type, details->>'error' AS error
    FROM lead_assignment_events
    WHERE operator_id = $1
      AND created_at <= $2::TIMESTAMPTZ
      AND created_at >= $2::TIMESTAMPTZ - INTERVAL '15 minutes'
      AND event_type IN ('failed', 'connection_requested', 'accepted', 'skipped')
    ORDER BY created_at DESC LIMIT 3`, ['rymaelie', '2026-09-25 22:11:52+00']);
  const withRecipientFailure = scoutPatterns.rows.filter(row => Number(row.recipient_failures) > 0);
  const withStateFailure = scoutPatterns.rows.filter(row => Number(row.state_failures) > 0);
  console.log(JSON.stringify({
    queriedAt: new Date().toISOString(),
    summary: {
      recipientFailureScouts: withRecipientFailure.length,
      recipientFailures: withRecipientFailure.reduce((sum, row) => sum + Number(row.recipient_failures), 0),
      recipientScoutsWithLaterRequest: recipientRecovery.rows.filter(row => Number(row.requests_after_last_failure) > 0).length,
      stateFailureScouts: withStateFailure.length,
      stateFailures: withStateFailure.reduce((sum, row) => sum + Number(row.state_failures), 0),
    },
    rymaelieGuardReplay: rymaelieGuardReplay.rows,
    scoutPatterns: scoutPatterns.rows,
    recipientRecovery: recipientRecovery.rows,
    maryamDaily: maryamDaily.rows,
  }, null, 2));
} finally {
  await client.end();
}
