import { db } from '../db/pool';

/**
 * Icebreaker question library.
 *
 * Questions are scored based on user feedback:
 *   - Thumbs up   → +1
 *   - Thumbs down → -1
 *
 * Questions with higher net scores are picked more often.
 * New questions start with a score of 0 and get equal weight.
 *
 * Guidelines for adding new ones:
 *  - Keep them low-stakes and universally approachable
 *  - Avoid anything political, religious, or deeply personal
 *  - Aim for questions that spark real conversation, not yes/no answers
 */
export const ICEBREAKERS: string[] = [
  "What's something you're working on right now that you're excited about?",
  'If you could teleport anywhere for lunch today, where would you go?',
  "What's a skill you've picked up outside of work that surprised you?",
  "What's the best piece of advice you've ever received?",
  'What did you want to be when you were growing up?',
  "What's a book, podcast, or show you've been into lately?",
  'What hobby do you wish you had more time for?',
  "What's your go-to order when you don't know what to pick at a restaurant?",
  "What's something about your job that you don't think other people fully understand?",
  'If you could swap roles with anyone at the company for a week, who would it be?',
  "What's a tool or trick that made your work life noticeably better?",
  'What does your ideal Friday afternoon look like?',
  "What's a city you've visited that surprised you — in a good way?",
  "What's something you believed for a long time that turned out to be wrong?",
  'What would you do with an extra hour every day?',
  "What's the most interesting project you've worked on in your career?",
  'Morning person or night owl — and has that changed over time?',
  "What's something small that consistently makes your day better?",
  'If you were teaching a class on anything, what would it be?',
  "What's a question you'd genuinely like to ask more people at the company?",
];

/**
 * Picks an icebreaker question using weighted random selection.
 *
 * Questions with more thumbs up are picked more often.
 * Questions with many thumbs down are picked less often.
 * Questions with no feedback get a neutral weight of 3.
 *
 * Falls back to pure random if DB is unavailable.
 */
export async function pickIcebreakerWeighted(): Promise<string> {
  try {
    // Get net scores for all questions that have feedback
    const { rows } = await db.query<{ question: string; net_score: number }>(
      `
      SELECT
        question,
        SUM(CASE WHEN rating = 'up' THEN 1 ELSE -1 END) AS net_score
      FROM icebreaker_feedback
      GROUP BY question
      `
    );

    // Build a score map
    const scoreMap = new Map<string, number>();
    for (const row of rows) {
      scoreMap.set(row.question, Number(row.net_score));
    }

    // Assign weights — minimum weight of 1 so no question is completely excluded
    const weights = ICEBREAKERS.map((q) => {
      const score = scoreMap.get(q) ?? 0; // 0 = no feedback yet
      return Math.max(1, 3 + score);      // base weight 3, adjusted by score
    });

    // Weighted random selection
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let random = Math.random() * totalWeight;

    for (let i = 0; i < ICEBREAKERS.length; i++) {
      random -= weights[i];
      if (random <= 0) return ICEBREAKERS[i];
    }

    return ICEBREAKERS[ICEBREAKERS.length - 1];

  } catch {
    // Fallback to pure random if DB fails
    return pickIcebreaker();
  }
}

/**
 * Simple random picker — used as fallback.
 */
export function pickIcebreaker(): string {
  return ICEBREAKERS[Math.floor(Math.random() * ICEBREAKERS.length)];
}

/**
 * Record a thumbs up or down for an icebreaker question.
 */
export async function recordIcebreakerFeedback(
  question: string,
  participantId: number,
  matchId: number,
  rating: 'up' | 'down'
): Promise<void> {
  await db.query(
    `
    INSERT INTO icebreaker_feedback (question, participant_id, match_id, rating)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (question, participant_id, match_id)
    DO UPDATE SET rating = EXCLUDED.rating
    `,
    [question, participantId, matchId, rating]
  );
}

/**
 * Get the top and bottom rated icebreakers for the admin report.
 */
export async function getIcebreakerStats(): Promise<{
  top: Array<{ question: string; net_score: number }>;
  bottom: Array<{ question: string; net_score: number }>;
}> {
  const { rows } = await db.query<{ question: string; net_score: number }>(
    `
    SELECT
      question,
      SUM(CASE WHEN rating = 'up' THEN 1 ELSE -1 END) AS net_score,
      COUNT(*) AS total_ratings
    FROM icebreaker_feedback
    GROUP BY question
    HAVING COUNT(*) >= 2
    ORDER BY net_score DESC
    `
  );

  return {
    top: rows.slice(0, 3),
    bottom: rows.slice(-3).reverse(),
  };
}