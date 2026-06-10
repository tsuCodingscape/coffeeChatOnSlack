/**
 * Given the current date and a cadence, returns the next scheduled run date.
 * Always runs on Monday at 9am to give people a fresh-week energy boost.
 */
export function getNextRunDate(
    from: Date,
    cadence: 'weekly' | 'biweekly' | 'monthly'
  ): Date {
    const next = new Date(from);
    next.setHours(9, 0, 0, 0);
  
    switch (cadence) {
      case 'weekly':
        next.setDate(next.getDate() + 7);
        break;
      case 'biweekly':
        next.setDate(next.getDate() + 14);
        break;
      case 'monthly':
        next.setMonth(next.getMonth() + 1);
        break;
    }
  
    // Nudge to the next Monday if the calculated date isn't one
    const day = next.getDay(); // 0=Sun, 1=Mon ... 6=Sat
    if (day !== 1) {
      const daysUntilMonday = day === 0 ? 1 : 8 - day;
      next.setDate(next.getDate() + daysUntilMonday);
    }
  
    return next;
  }