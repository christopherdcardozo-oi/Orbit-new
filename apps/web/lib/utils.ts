

export function getTimeUntilMidnight(timezone: string = 'America/Chicago'): { hours: number; minutes: number; totalMs: number } {
  const now = new Date();
  
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const getPart = (type: string) => parseInt(parts.find(p => p.type === type)?.value || '0', 10);
  
  const year = getPart('year');
  const month = getPart('month') - 1; 
  const day = getPart('day');
  
  const tzNow = new Date(year, month, day, getPart('hour') === 24 ? 0 : getPart('hour'), getPart('minute'), getPart('second'));
  const tzMidnight = new Date(year, month, day + 1, 0, 0, 0);
  
  const totalMs = tzMidnight.getTime() - tzNow.getTime();
  const hours = Math.floor(totalMs / (1000 * 60 * 60));
  const minutes = Math.floor((totalMs % (1000 * 60 * 60)) / (1000 * 60));
  
  return { hours, minutes, totalMs };
}

export function formatTimeRemaining(ms: number): string {
  if (ms < 0) return '0h 0m';
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
}

export function generateAnonymousAlias(): string {
  const adjectives = ['Cosmic', 'Nebula', 'Quantum', 'Stellar', 'Galactic', 'Lunar', 'Solar', 'Astral'];
  const animals = ['Panda', 'Tiger', 'Fox', 'Wolf', 'Bear', 'Owl', 'Hawk', 'Dolphin'];
  
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const animal = animals[Math.floor(Math.random() * animals.length)];
  const num = Math.floor(Math.random() * 99) + 1;
  
  return `${adj}${animal}${num}`;
}

export function cn(...inputs: (string | undefined | null | false | 0)[]): string {
  return inputs.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

