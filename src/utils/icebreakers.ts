/**
 * A pool of lightweight icebreaker questions.
 * One is picked at random for each intro DM.
 *
 * Guidelines for adding new ones:
 *  - Keep them low-stakes and universally approachable
 *  - Avoid anything political, religious, or deeply personal
 *  - Aim for questions that spark a real conversation, not yes/no answers
 */
const ICEBREAKERS: string[] = [
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
  
  export function pickIcebreaker(): string {
    return ICEBREAKERS[Math.floor(Math.random() * ICEBREAKERS.length)];
  }