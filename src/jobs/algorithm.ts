import { Participant } from '../db/participants';
import { pairKey } from '../db/matches';

// ─── Scoring constants ────────────────────────────────────────────────────────
const SCORE_NEVER_MATCHED    =  100;
const SCORE_NOT_RECENT       =   50;
const PENALTY_PREVIOUS_CYCLE = -1000;
const PENALTY_RECENT         =  -500;
const PENALTY_CONFIRMED_MET = -800; // met and confirmed, avoid for 180 days


// ─── Types ────────────────────────────────────────────────────────────────────

export interface MatchGroup {
  // Always exactly 2 participants — no more trios
  participants: [Participant, Participant];
}

export interface MatchResult {
  groups: MatchGroup[];
  oddPersonOut: Participant | null; // auto-snoozed until next round
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Produces pairs only. If the participant count is odd, the lowest-priority
 * unmatched person is set aside as `oddPersonOut` — they will be auto-snoozed
 * with priority=TRUE so they are guaranteed a match next round.
 *
 * Priority participants (carried over from a previous odd-out) are placed at
 * the front of the pool before shuffling so they are always matched first.
 */
export function buildMatches(
  participants: Participant[],
  recentPairs: Set<string>,
  lastRoundPairs: Set<string>,
  confirmedPairs: Set<string> = new Set()
): MatchResult {
  if (participants.length < 2) {
    return { groups: [], oddPersonOut: null };
  }

  // Separate priority participants from the rest
  // getActiveParticipants already returns priority first, but we split
  // them here so priority folks are never the odd one out
  const priority = participants.filter((p) => p.priority);
  const regular  = shuffle(participants.filter((p) => !p.priority));

  // Priority participants go first, regular participants shuffled after
  const pool = [...priority, ...regular];

  const matched = new Set<number>();
  const groups: MatchGroup[] = [];

  for (let i = 0; i < pool.length; i++) {
    const person = pool[i];
    if (matched.has(person.id)) continue;

    const partner = pickBestPartner(person, pool, matched, recentPairs, lastRoundPairs, confirmedPairs);
    if (!partner) continue;

    matched.add(person.id);
    matched.add(partner.id);
    groups.push({ participants: [person, partner] });
  }

  // Find the one unmatched person if count was odd
  const unmatched = pool.filter((p) => !matched.has(p.id));
  const oddPersonOut = unmatched.length === 1 ? unmatched[0] : null;

  return { groups, oddPersonOut };
}

// ─── Internals ────────────────────────────────────────────────────────────────

function pickBestPartner(
  person: Participant,
  pool: Participant[],
  matched: Set<number>,
  recentPairs: Set<string>,
  lastRoundPairs: Set<string>,
  confirmedPairs: Set<string>
): Participant | null {
  let bestScore = -Infinity;
  let bestCandidate: Participant | null = null;

  for (const candidate of pool) {
    if (candidate.id === person.id) continue;
    if (matched.has(candidate.id)) continue;

    const score = scorePair(person.id, candidate.id, recentPairs, lastRoundPairs, confirmedPairs);
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  return bestCandidate;
}

function scorePair(
  idA: number,
  idB: number,
  recentPairs: Set<string>,
  lastRoundPairs: Set<string>,
  confirmedPairs: Set<string>
): number {
  const key = pairKey(idA, idB);
  if (lastRoundPairs.has(key)) return PENALTY_PREVIOUS_CYCLE;
  if (confirmedPairs.has(key))  return PENALTY_CONFIRMED_MET;
  if (recentPairs.has(key))    return PENALTY_RECENT;
  return SCORE_NEVER_MATCHED;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}