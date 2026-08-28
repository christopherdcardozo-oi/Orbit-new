export function scrubPII(text: string): { scrubbed: string; wasFiltered: boolean } {
  let wasFiltered = false;
  let scrubbed = text;

  const patterns = [
    // Emails
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    // Phones
    /(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}/g,
    // Social media handles
    /(?<![a-zA-Z0-9.-])@[a-zA-Z0-9_]{1,15}(?!\.edu|\.com)/g,
    // URLs
    /https?:\/\/[^\s]+|www\.[^\s]+/gi,
    // Dorm rooms
    /(?:room|rm\.?|#)\s*\d{1,4}\s*[a-zA-Z]*/gi,
    // Social intents
    /(?:my ig is|snap me at|dm me on|add me on|follow me)/gi,
    // Names
    /(?:I'm|my name is)\s+[A-Z][a-z]+\s+[A-Z][a-z]+/g
  ];

  for (const pattern of patterns) {
    if (pattern.test(scrubbed)) {
      wasFiltered = true;
      scrubbed = scrubbed.replace(pattern, '[redacted]');
    }
  }

  return { scrubbed, wasFiltered };
}

export function scrubProfile<T extends { major?: string; hobbies?: string[]; activities?: string[] }>(profile: T): T {
  const result = { ...profile };

  if (result.major) {
    result.major = scrubPII(result.major).scrubbed;
  }
  
  if (result.hobbies) {
    result.hobbies = result.hobbies.map(h => scrubPII(h).scrubbed);
  }
  
  if (result.activities) {
    result.activities = result.activities.map(a => scrubPII(a).scrubbed);
  }

  return result;
}
