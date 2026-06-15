import { WebClient } from '@slack/web-api';
import type { Block, KnownBlock } from '@slack/types';
import { db } from '../db/pool';
import {
  getActiveParticipants,
  expireSnoozedParticipants,
  autoSnoozeOddParticipant,
  clearPriority,
  Participant,
} from '../db/participants';
import {
  getRecentMatchPairs,
  getLastRoundMatchPairs,
  saveRoundWithMatches,
  updateMatchMessageTs,
  getConfirmedMatchPairs,
} from '../db/matches';
import { buildMatches, MatchGroup } from './algorithm';
import { pickIcebreaker } from '../utils/icebreakers';
import { getNextRunDate } from '../utils/schedule';
import { suggestMeetingTime } from '../utils/timezone';

interface Program {
  id: number;
  workspace_id: number;
  channel_id: string;
  cadence: 'weekly' | 'biweekly' | 'monthly';
  next_run_at: Date | null;
  paused: boolean;
  intro_message_template: string;
}

interface Workspace {
  id: number;
  slack_workspace_id: string;
  bot_token: string;
}

export async function runMatchingJob(
  program: Program,
  workspace: Workspace
): Promise<void> {
  console.log(`🎲 Starting matching run for workspace ${workspace.slack_workspace_id}`);

  if (program.paused) {
    console.log('⏸  Program is paused — skipping run');
    return;
  }

  await expireSnoozedParticipants(workspace.id);

  const participants = await getActiveParticipants(workspace.id);
  if (participants.length < 2) {
    console.log(`⚠️  Only ${participants.length} active participant(s) — skipping run`);
    await advanceNextRun(program);
    return;
  }

  const [recentPairs, lastRoundPairs, confirmedPairs] = await Promise.all([
    getRecentMatchPairs(workspace.id, 90),
    getLastRoundMatchPairs(program.id),
    getConfirmedMatchPairs(workspace.id),
  ]);
  
  const { groups, oddPersonOut } = buildMatches(
    participants,
    recentPairs,
    lastRoundPairs,
    confirmedPairs  
  );
  if (groups.length === 0) {
    console.log('⚠️  No groups produced — skipping run');
    await advanceNextRun(program);
    return;
  }

  console.log(`✅ Produced ${groups.length} pair(s) from ${participants.length} participants`);

  if (oddPersonOut) {
    const nextRun = getNextRunDate(new Date(), program.cadence);
    await autoSnoozeOddParticipant(workspace.id, oddPersonOut.slack_user_id, nextRun);
    console.log(`⏭  Odd person out: ${oddPersonOut.slack_user_id} — priority queued for next round`);

    const slackNotifier = new WebClient(workspace.bot_token);
    await slackNotifier.chat.postMessage({
      channel: oddPersonOut.slack_user_id,
      text: `👋 We had an odd number of participants this round so you've been automatically carried over to the *next* matching round — and you'll be first in the queue. See you then! ☕`,
    }).catch((err) => console.error('Failed to notify odd person out:', err));
  }

  const participantTuples = groups.map((g) => {
    const [a, b] = g.participants;
    return [a.id, b.id] as [number, number, number?];
  });
  const roundId = await saveRoundWithMatches(program.id, participantTuples);

  for (const group of groups) {
    for (const participant of group.participants) {
      if (participant.priority) {
        await clearPriority(participant.id);
      }
    }
  }

  const slack = new WebClient(workspace.bot_token);
  for (const group of groups) {
    await sendIntroMessage(slack, group, program.intro_message_template, roundId);
  }

  await advanceNextRun(program);
  console.log(`🎉 Matching run complete — ${groups.length} intros sent`);
}

async function sendIntroMessage(
  slack: WebClient,
  group: MatchGroup,
  introTemplate: string,
  roundId: number
): Promise<void> {
  const userIds = group.participants.map((p) => p.slack_user_id);

  try {
    const userInfos = await Promise.all(
      userIds.map((id) => slack.users.info({ user: id }))
    );

    const displayNames = userInfos.map(
      (info) =>
        (info.user as { profile?: { display_name?: string; real_name?: string } })
          ?.profile?.display_name ||
        (info.user as { profile?: { real_name?: string } })?.profile?.real_name ||
        'Teammate'
    );

    const emails = userInfos
      .map((info: { user?: { profile?: { email?: string } } }) =>
        info.user?.profile?.email)
      .filter((email): email is string => Boolean(email));

    console.log(`📧 Emails fetched for calendar: ${emails.join(', ')}`);

    const timezones = group.participants.map((p) => p.timezone ?? null);

    // Collect Zoom links from participant records
    const zoomLinks = group.participants
      .map((p) => p.zoom_link)
      .filter((link): link is string => Boolean(link));

    const conversationResult = await slack.conversations.open({
      users: userIds.join(','),
    });
    const channelId = (conversationResult.channel as { id: string }).id;
    const icebreaker = pickIcebreaker();

    const { rows } = await db.query<{ id: number }>(
      `SELECT id FROM matches WHERE match_round_id = $1 AND participant_a_id = (
        SELECT id FROM participants WHERE slack_user_id = $2 LIMIT 1
      )`,
      [roundId, group.participants[0].slack_user_id]
    );
    const matchId = rows[0]?.id ?? roundId;

    const blocks = buildIntroBlocks(
      group.participants,
      displayNames,
      emails,
      zoomLinks,
      timezones,
      icebreaker,
      introTemplate,
      matchId
    );

    const messageResult = await slack.chat.postMessage({
      channel: channelId,
      text: buildIntroFallbackText(group.participants),
      blocks,
    });

    if (messageResult.ts) {
      await updateMatchMessageTs(roundId, group.participants[0].id, messageResult.ts);
    }

  } catch (err) {
    console.error(`❌ Failed to send intro DM to [${userIds.join(', ')}]:`, err);
  }
}

function buildIntroFallbackText(participants: Participant[]): string {
  const mentions = participants.map((p) => `<@${p.slack_user_id}>`).join(' and ');
  return `☕ Time for a coffee chat! Introducing ${mentions}.`;
}

function buildIntroBlocks(
  participants: Participant[],
  displayNames: string[],
  emails: string[],
  zoomLinks: string[],
  timezones: (string | null)[], 
  icebreaker: string,
  customTemplate: string,
  matchId: number
): (Block | KnownBlock)[] {
  const mentions = participants.map((p) => `<@${p.slack_user_id}>`).join(' & ');

  const suggestion = suggestMeetingTime(timezones);
  const startTime = suggestion.calendarStart;
  const endTime = suggestion.calendarEnd;
  
  const timeSuggestion = suggestion.displayText
    ? `\n\n🕐 *Suggested time:* ${suggestion.displayText}`
    : '';

  const introText = customTemplate.trim()
    ? customTemplate
        .replace('{mentions}', mentions)
        .replace('{icebreaker}', icebreaker)
        : `${mentions} — you've been matched for a coffee chat! ☕\n\nFind a 20–30 min slot that works for both of you and get to know each other.${timeSuggestion}`;
        
  const eventTitle = encodeURIComponent(`☕ Coffee Chat: ${displayNames.join(' & ')}`);
  const eventDetails = encodeURIComponent(
    `Intro coffee chat set up by Coffee Roulette.\n\nConversation starter: ${icebreaker}`
  );

  const guestParams = emails
    .map((e: string) => `&add=${encodeURIComponent(e)}`)
    .join('');

  const calendarUrl =
    `https://calendar.google.com/calendar/render?action=TEMPLATE` +
    `&text=${eventTitle}&details=${eventDetails}&dates=${startTime}/${endTime}` +
    guestParams;

  // Build the blocks
  const blocks: (Block | KnownBlock)[] = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: introText },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `💬 *Conversation starter:*\n_${icebreaker}_` },
    },
    { type: 'divider' },
  ];

  // Add Zoom links if any participants have saved one
  if (zoomLinks.length > 0) {
    const zoomText = zoomLinks.length === 1
      ? `📹 *Meeting room:* ${zoomLinks[0]}`
      : zoomLinks
          .map((link, i) => `📹 *${displayNames[i]}'s Zoom:* ${link}`)
          .join('\n');

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: zoomText },
    });
    blocks.push({ type: 'divider' });
  }

  // Action buttons
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: '📅 Schedule a time', emoji: true },
        style: 'primary',
        url: calendarUrl,
        action_id: 'schedule_calendar',
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '✅ We met!', emoji: true },
        value: String(matchId),
        action_id: 'confirm_met',
      },
    ],
  });

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: 'Use `/coffee zoom` to add your Zoom link · `/coffee snooze` to skip a round · `/coffee optout` to leave',
      },
    ],
  });

  return blocks;
}

async function advanceNextRun(program: Program): Promise<void> {
  const nextRun = getNextRunDate(new Date(), program.cadence);
  await db.query(`UPDATE programs SET next_run_at = $1 WHERE id = $2`, [nextRun, program.id]);
  console.log(`📅 Next run scheduled for ${nextRun.toISOString()}`);
}
