export type Severity = 'clean' | 'warn' | 'block' | 'flag';

export interface ModerationResult {
  severity: Severity;
  reason?: string;
  originalContent: string;
}

const BLOCK_PATTERNS = [
  /\b(nigger|faggot|kyes|chink|spic)\b/i, // Explicit slurs
  /\b(kill yourself|kys|die|beat you up)\b/i,
  /\b(i will hurt|shoot|stab|murder|assassinate)\b/i,
  /\b(rape|molest)\b/i,
];

const FLAG_PATTERNS = [
  /\b(shit|fuck|damn|bitch|asshole)\b/i,
  /\b(whatever|fine then|not my problem)\b/i, 
];

const CRISIS_PATTERNS = [
  /\b(suicide|kill myself|want to die|end it all)\b/i,
  /\b(cutting|self harm|hurt myself)\b/i,
];

export function isCrisisContent(content: string): boolean {
  return CRISIS_PATTERNS.some(pattern => pattern.test(content));
}

export function moderateContent(content: string): ModerationResult {
  if (isCrisisContent(content)) {
    return {
      severity: 'block', 
      reason: 'Crisis content detected. Please reach out to the National Suicide Prevention Lifeline at 988.',
      originalContent: content
    };
  }

  for (const pattern of BLOCK_PATTERNS) {
    if (pattern.test(content)) {
      return { severity: 'block', reason: 'Blocked content detected', originalContent: content };
    }
  }

  for (const pattern of FLAG_PATTERNS) {
    if (pattern.test(content)) {
      return { severity: 'flag', reason: 'Flagged content detected', originalContent: content };
    }
  }

  const letters = content.replace(/[^a-zA-Z]/g, '');
  if (letters.length > 10) {
    const uppercase = letters.replace(/[^A-Z]/g, '');
    if (uppercase.length / letters.length > 0.7) {
      return { severity: 'warn', reason: 'Excessive capitalization', originalContent: content };
    }
  }

  if (/(.)\1{5,}/.test(content)) {
    return { severity: 'warn', reason: 'Spam patterns detected', originalContent: content };
  }

  const emojis = content.match(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu);
  if (emojis && emojis.length > 20) {
    return { severity: 'warn', reason: 'Excessive emoji usage', originalContent: content };
  }

  return { severity: 'clean', originalContent: content };
}
