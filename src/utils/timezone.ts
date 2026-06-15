/**
 * Timezone utilities for Coffee Roulette.
 *
 * Suggests a meeting time window that works for all participants
 * based on their stored timezones. Falls back gracefully if
 * timezones are missing.
 *
 * Working hours defined as 9am - 5pm local time.
 * Overlap is calculated to find a window that works for everyone.
 */

export interface TimezoneSuggestion {
  calendarStart: string;  // ISO string for calendar URL
  calendarEnd: string;    // ISO string for calendar URL
  displayText: string;    // Human readable e.g. "10am PT / 1pm ET"
}

/**
 * Given a list of IANA timezone strings (e.g. "America/Los_Angeles"),
 * finds the next overlapping working hours window and returns
 * a suggested meeting time.
 */
export function suggestMeetingTime(timezones: (string | null)[]): TimezoneSuggestion {
  const validTimezones = timezones.filter((tz): tz is string => Boolean(tz));

  // If no timezones stored, default to next hour
  if (validTimezones.length === 0) {
    return getDefaultSuggestion();
  }

  // Find overlapping working hours across all timezones
  const overlap = findWorkingHoursOverlap(validTimezones);
  if (!overlap) {
    return getDefaultSuggestion();
  }

  return overlap;
}

/**
 * Finds the next time slot where all timezones overlap within
 * working hours (9am - 5pm local time).
 *
 * Returns the earliest overlapping slot starting from tomorrow.
 */
function findWorkingHoursOverlap(timezones: string[]): TimezoneSuggestion | null {
  try {
    // Start checking from tomorrow at 9am UTC
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);

    // Skip weekends
    while (tomorrow.getDay() === 0 || tomorrow.getDay() === 6) {
      tomorrow.setDate(tomorrow.getDate() + 1);
    }

    // Try each hour from 9am-4pm UTC and find first slot where
    // all participants are within 9am-5pm local time
    for (let hour = 9; hour <= 16; hour++) {
      const candidate = new Date(tomorrow);
      candidate.setUTCHours(hour, 0, 0, 0);

      const allInWorkingHours = timezones.every((tz) => {
        const localHour = getLocalHour(candidate, tz);
        return localHour !== null && localHour >= 9 && localHour < 17;
      });

      if (allInWorkingHours) {
        const endTime = new Date(candidate.getTime() + 30 * 60 * 1000);

        const displayParts = timezones.map((tz) => {
          const localHour = getLocalHour(candidate, tz);
          if (localHour === null) return null;
          const period = localHour >= 12 ? 'pm' : 'am';
          const displayHour = localHour > 12 ? localHour - 12 : localHour;
          const tzAbbr = getTimezoneAbbr(tz);
          return `${displayHour}${period} ${tzAbbr}`;
        }).filter(Boolean);

        // Deduplicate display parts (same timezone shouldn't show twice)
        const uniqueParts = [...new Set(displayParts)];

        return {
          calendarStart: candidate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z',
          calendarEnd: endTime.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z',
          displayText: uniqueParts.join(' / '),
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Gets the local hour for a given date in a timezone.
 */
function getLocalHour(date: Date, timezone: string): number | null {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const hourPart = parts.find((p) => p.type === 'hour');
    return hourPart ? parseInt(hourPart.value, 10) : null;
  } catch {
    return null;
  }
}

/**
 * Returns a short timezone abbreviation (e.g. PT, ET, CT).
 */
function getTimezoneAbbr(timezone: string): string {
  const abbrs: Record<string, string> = {
    'America/Los_Angeles': 'PT',
    'America/Denver':      'MT',
    'America/Chicago':     'CT',
    'America/New_York':    'ET',
    'America/Phoenix':     'AZ',
    'Pacific/Honolulu':    'HT',
    'America/Anchorage':   'AKT',
    'Europe/London':       'GMT',
    'Europe/Paris':        'CET',
    'Europe/Berlin':       'CET',
    'Asia/Tokyo':          'JST',
    'Asia/Shanghai':       'CST',
    'Asia/Kolkata':        'IST',
    'Australia/Sydney':    'AEST',
  };
  return abbrs[timezone] ?? timezone.split('/')[1]?.replace('_', ' ') ?? timezone;
}

/**
 * Default suggestion when no timezone data is available.
 * Returns next hour as a 30 min window.
 */
function getDefaultSuggestion(): TimezoneSuggestion {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  now.setHours(now.getHours() + 1);

  // Skip to next weekday if weekend
  while (now.getDay() === 0 || now.getDay() === 6) {
    now.setDate(now.getDate() + 1);
    now.setHours(9, 0, 0, 0);
  }

  const end = new Date(now.getTime() + 30 * 60 * 1000);

  return {
    calendarStart: now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z',
    calendarEnd: end.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z',
    displayText: '',
  };
}

/**
 * Common IANA timezone options for the Slack modal dropdown.
 */
export const TIMEZONE_OPTIONS = [
  { label: 'Pacific Time (PT)',    value: 'America/Los_Angeles' },
  { label: 'Mountain Time (MT)',   value: 'America/Denver' },
  { label: 'Central Time (CT)',    value: 'America/Chicago' },
  { label: 'Eastern Time (ET)',    value: 'America/New_York' },
  { label: 'Alaska Time (AKT)',    value: 'America/Anchorage' },
  { label: 'Hawaii Time (HT)',     value: 'Pacific/Honolulu' },
  { label: 'GMT (London)',         value: 'Europe/London' },
  { label: 'Central European (CET)', value: 'Europe/Paris' },
  { label: 'India (IST)',          value: 'Asia/Kolkata' },
  { label: 'Japan (JST)',          value: 'Asia/Tokyo' },
  { label: 'China (CST)',          value: 'Asia/Shanghai' },
  { label: 'Australia/Sydney (AEST)', value: 'Australia/Sydney' },
];
