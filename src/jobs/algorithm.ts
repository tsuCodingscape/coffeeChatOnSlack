import { Participant } from '../db/participants';
import { pairKey } from '../db/matches';

// ─── Scoring constants ────────────────────────────────────────────────────────
const SCORE_NEVER_MATCHED     =  100;
const SCORE_NOT_RECENT        =   50;
const PENALTY_PREVIOUS_CYCLE  = -1000;
const PENALTY_CONFIRMED_MET   =  -800;
const PENALTY_RECENT          =  -500;
const PENALTY_SAME_TEAM       = -2000; // strongest penalty — same team should never match

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MatchGroup {
  participants: [Participant, Participant];
}

export interface MatchResult {
  groups: MatchGroup[];
  oddPersonOut: Participant | null;
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Produces 1:1 pairs with repeat prevention, confirmed-pair avoidance,
 * and team exclusion rules.
 *
 * @param participants   Active participants eligible this round
 * @param recentPairs    Pairs matched in last 90 days
 * @param lastRoundPairs Pairs matched in the immediately previous round
 * @param confirmedPairs Pairs who confirmed they met (180 day window)
 * @param teamMap        Map of participant_id → team_name for exclusions
 */
export function buildMatches(
  participants: Participant[],
  recentPairs: Set<string>,
  lastRoundPairs: Set<string>,
  confirmedPairs: Set<string> = new Set(),
  teamMap: Map<number, string> = new Map()
): MatchResult {
  if (participants.length < 2) {
    return { groups: [], oddPersonOut: null };
  }

  const priority = participants.filter((p) => p.priority);
  const regular  = shuffle(participants.filter((p) => !p.priority));
  const pool = [...priority, ...regular];

  const matched = new Set<number>();
  const groups: MatchGroup[] = [];

  for (let i = 0; i < pool.length; i++) {
    const person = pool[i];
    if (matched.has(person.id)) continue;

    const partner = pickBestPartner(
      person,
      pool,
      matched,
      recentPairs,
      lastRoundPairs,
      confirmedPairs,
      teamMap
    );
    if (!partner) continue;

    matched.add(person.id);
    matched.add(partner.id);
    groups.push({ participants: [person, partner] });
  }

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
  confirmedPairs: Set<string>,
  teamMap: Map<number, string>
): Participant | null {
  let bestScore = -Infinity;
  let bestCandidate: Participant | null = null;

  for (const candidate of pool) {
    if (candidate.id === person.id) continue;
    if (matched.has(candidate.id)) continue;

    const score = scorePair(
      person.id,
      candidate.id,
      recentPairs,
      lastRoundPairs,
      confirmedPairs,
      teamMap
    );

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  // If the best available score is the same-team penalty and there are
  // enough people to potentially avoid it, try harder to find a cross-team match
  // Otherwise accept the same-team match rather than leaving someone unmatched
  return bestCandidate;
}

function scorePair(
  idA: number,
  idB: number,
  recentPairs: Set<string>,
  lastRoundPairs: Set<string>,
  confirmedPairs: Set<string>,
  teamMap: Map<number, string>
): number {
  const key = pairKey(idA, idB);

  // Same team — heavy penalty but not absolute (avoids leaving people unmatched
  // in small workspaces where everyone is on the same team)
  const teamA = teamMap.get(idA);
  const teamB = teamMap.get(idB);
  if (teamA && teamB && teamA === teamB) return PENALTY_SAME_TEAM;

  if (lastRoundPairs.has(key))  return PENALTY_PREVIOUS_CYCLE;
  if (confirmedPairs.has(key))  return PENALTY_CONFIRMED_MET;
  if (recentPairs.has(key))     return PENALTY_RECENT;
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