import { WebClient } from '@slack/web-api';
import type { Block, KnownBlock } from '@slack/types';
import { db } from '../db/pool';

/**
 * Nudge reminder job.
 *
 * Runs daily and checks for matches where:
 *   - The intro DM was sent 3+ days ago
 *   - Neither participant has clicked "We met!"
 *   - Neither participant has already been nudged
 *
 * Sends a friendly follow-up DM to each person in the match.
 */

const NUDGE_AFTER_DAYS = 3;    // days after match before nudging
const NUDGE_MAX_DAYS  = 10;    // stop nudging after this many days

export async function runNudgeJob(): Promise<void> {
  console.log('💬 Running nudge reminder job...');

  try {
    // Find matches that need a nudge:
    // - created 3-10 days ago
    // - no "We met!" feedback from either participant
    // - not already nudged
    const { rows: matches } = await db.query<{
      match_id: number;
      match_round_id: number;
      participant_a_id: number;
      participant_b_id: number;
      slack_user_a: string;
      slack_user_b: string;
      bot_token: string;
      created_at: Date;
    }>(
      `
      SELECT
        m.id              AS match_id,
        m.match_round_id,
        m.participant_a_id,
        m.participant_b_id,
        pa.slack_user_id  AS slack_user_a,
        pb.slack_user_id  AS slack_user_b,
        w.bot_token,
        m.created_at
      FROM matches m
      JOIN participants pa  ON pa.id = m.participant_a_id
      JOIN participants pb  ON pb.id = m.participant_b_id
      JOIN match_rounds mr  ON mr.id = m.match_round_id
      JOIN programs p       ON p.id  = mr.program_id
      JOIN workspaces w     ON w.id  = p.workspace_id
      WHERE
        -- Match was sent 3-10 days ago
        m.created_at BETWEEN NOW() - INTERVAL '${NUDGE_MAX_DAYS} days'
                         AND NOW() - INTERVAL '${NUDGE_AFTER_DAYS} days'
        -- No "We met!" feedback from either participant
        AND NOT EXISTS (
          SELECT 1 FROM feedback f
          WHERE f.match_id = m.id AND f.did_meet = TRUE
        )
        -- Not already nudged
        AND NOT EXISTS (
          SELECT 1 FROM nudges n
          WHERE n.match_id = m.id
        )
        -- Round completed successfully
        AND mr.status = 'completed'
        -- Neither participant has opted out
        AND pa.status != 'opted_out'
        AND pb.status != 'opted_out'
      `
    );

    if (matches.length === 0) {
      console.log('💬 No matches need nudging right now');
      return;
    }

    console.log(`💬 Found ${matches.length} match(es) to nudge`);

    for (const match of matches) {
      await sendNudge(match);
    }

    console.log('💬 Nudge job complete');

  } catch (err) {
    console.error('❌ Nudge job error:', err);
  }
}

// ─── Send nudge DMs ───────────────────────────────────────────────────────────

async function sendNudge(match: {
  match_id: number;
  participant_a_id: number;
  participant_b_id: number;
  slack_user_a: string;
  slack_user_b: string;
  bot_token: string;
}): Promise<void> {
  const slack = new WebClient(match.bot_token);

  try {
    // Send a nudge DM to each participant individually
    await Promise.all([
      slack.chat.postMessage({
        channel: match.slack_user_a,
        text: buildNudgeText(match.slack_user_b),
        blocks: buildNudgeBlocks(match.slack_user_b, match.match_id),
      }),
      slack.chat.postMessage({
        channel: match.slack_user_b,
        text: buildNudgeText(match.slack_user_a),
        blocks: buildNudgeBlocks(match.slack_user_a, match.match_id),
      }),
    ]);

    // Record that this match was nudged so we don't send again
    await db.query(
      `INSERT INTO nudges (match_id) VALUES ($1) ON CONFLICT (match_id) DO NOTHING`,
      [match.match_id]
    );

    console.log(`💬 Nudge sent for match ${match.match_id}`);

  } catch (err) {
    console.error(`❌ Failed to send nudge for match ${match.match_id}:`, err);
  }
}

// ─── Message builders ─────────────────────────────────────────────────────────

function buildNudgeText(otherUserSlackId: string): string {
  return `☕ Just checking in — did you get a chance to connect with <@${otherUserSlackId}> yet?`;
}

function buildNudgeBlocks(otherUserSlackId: string, matchId: number): (Block | KnownBlock)[] {
    return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `☕ *Just checking in!*\n\nDid you get a chance to connect with <@${otherUserSlackId}> yet? Even a quick 15 min chat can go a long way.`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '✅ We met!', emoji: true },
          style: 'primary',
          value: String(matchId),
          action_id: 'confirm_met',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '⏰ Not yet', emoji: true },
          value: String(matchId),
          action_id: 'nudge_not_yet',
        },
      ],
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: 'No worries if life got busy — just let us know when you do connect! 😊',
        },
      ],
    },
  ];
}