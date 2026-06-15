import { db } from './pool';

export interface Match {
  id: number;
  match_round_id: number;
  participant_a_id: number;
  participant_b_id: number;
  participant_c_id: number | null;
  slack_message_ts: string | null;
  created_at: Date;
}

/**
 * Returns recent match pairs with two separate sets:
 * - confirmedPairs: matched AND confirmed they met (180 day lookback)
 * - recentPairs: matched but unconfirmed (90 day lookback)
 */
export async function getRecentMatchPairs(
  workspaceId: number,
  lookbackDays: number = 90
): Promise<Set<string>> {
  const { rows } = await db.query<{
    participant_a_id: number;
    participant_b_id: number;
    participant_c_id: number | null;
  }>(
    `
    SELECT m.participant_a_id, m.participant_b_id, m.participant_c_id
    FROM matches m
    JOIN match_rounds mr ON mr.id = m.match_round_id
    JOIN programs p      ON p.id  = mr.program_id
    WHERE p.workspace_id = $1
      AND mr.run_at >= NOW() - ($2 || ' days')::INTERVAL
      AND mr.status = 'completed'
    `,
    [workspaceId, lookbackDays]
  );

  const pairs = new Set<string>();
  for (const row of rows) {
    pairs.add(pairKey(row.participant_a_id, row.participant_b_id));
    if (row.participant_c_id !== null) {
      pairs.add(pairKey(row.participant_a_id, row.participant_c_id));
      pairs.add(pairKey(row.participant_b_id, row.participant_c_id));
    }
  }
  return pairs;
}

/**
 * Returns pairs that have confirmed they met — used for extended
 * repeat prevention (180 days instead of 90).
 */
export async function getConfirmedMatchPairs(
  workspaceId: number
): Promise<Set<string>> {
  const { rows } = await db.query<{
    participant_a_id: number;
    participant_b_id: number;
    participant_c_id: number | null;
  }>(
    `
    SELECT m.participant_a_id, m.participant_b_id, m.participant_c_id
    FROM matches m
    JOIN match_rounds mr ON mr.id = m.match_round_id
    JOIN programs p      ON p.id  = mr.program_id
    WHERE p.workspace_id = $1
      AND mr.run_at >= NOW() - INTERVAL '180 days'
      AND mr.status = 'completed'
      AND EXISTS (
        SELECT 1 FROM feedback f
        WHERE f.match_id = m.id AND f.did_meet = TRUE
      )
    `,
    [workspaceId]
  );

  const pairs = new Set<string>();
  for (const row of rows) {
    pairs.add(pairKey(row.participant_a_id, row.participant_b_id));
    if (row.participant_c_id !== null) {
      pairs.add(pairKey(row.participant_a_id, row.participant_c_id));
      pairs.add(pairKey(row.participant_b_id, row.participant_c_id));
    }
  }
  return pairs;
}

/**
 * Returns the most recent match_round for a program, if any.
 * Used to detect "matched in previous cycle" (heaviest penalty).
 */
export async function getLastRoundMatchPairs(
  programId: number
): Promise<Set<string>> {
  // Find the most recently completed round for this program
  const { rows: roundRows } = await db.query<{ id: number }>(
    `
    SELECT id FROM match_rounds
    WHERE program_id = $1 AND status = 'completed'
    ORDER BY run_at DESC
    LIMIT 1
    `,
    [programId]
  );

  if (roundRows.length === 0) return new Set();

  const lastRoundId = roundRows[0].id;
  const { rows } = await db.query<{
    participant_a_id: number;
    participant_b_id: number;
    participant_c_id: number | null;
  }>(
    `SELECT participant_a_id, participant_b_id, participant_c_id
     FROM matches WHERE match_round_id = $1`,
    [lastRoundId]
  );

  const pairs = new Set<string>();
  for (const row of rows) {
    pairs.add(pairKey(row.participant_a_id, row.participant_b_id));
    if (row.participant_c_id !== null) {
      pairs.add(pairKey(row.participant_a_id, row.participant_c_id));
      pairs.add(pairKey(row.participant_b_id, row.participant_c_id));
    }
  }
  return pairs;
}

/**
 * Persist a completed round and its matches inside a single transaction.
 */
export async function saveRoundWithMatches(
  programId: number,
  pairs: Array<[number, number, number?]>
): Promise<number> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Create the round record
    const { rows: roundRows } = await client.query<{ id: number }>(
      `INSERT INTO match_rounds (program_id, run_at, status)
       VALUES ($1, NOW(), 'completed') RETURNING id`,
      [programId]
    );
    const roundId = roundRows[0].id;

    // Insert each match
    for (const [a, b, c] of pairs) {
      await client.query(
        `INSERT INTO matches (match_round_id, participant_a_id, participant_b_id, participant_c_id)
         VALUES ($1, $2, $3, $4)`,
        [roundId, a, b, c ?? null]
      );
    }

    await client.query('COMMIT');
    return roundId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Update the slack_message_ts on a match after the DM has been sent.
 */
export async function updateMatchMessageTs(
  matchRoundId: number,
  participantAId: number,
  messageTs: string
): Promise<void> {
  await db.query(
    `UPDATE matches SET slack_message_ts = $1
     WHERE match_round_id = $2 AND participant_a_id = $3`,
    [messageTs, matchRoundId, participantAId]
  );
}

/**
 * Mark a round as failed with an error message.
 */
export async function failRound(roundId: number, error: string): Promise<void> {
  await db.query(
    `UPDATE match_rounds SET status = 'failed', error_log = $1 WHERE id = $2`,
    [error, roundId]
  );
}

export function pairKey(a: number, b: number): string {
  return `${Math.min(a, b)}:${Math.max(a, b)}`;
}