// Shared between app/(auth)/signup.tsx (asked once during onboarding)
// and app/(app)/profile.tsx (editable later). Keeping this in one file
// means the two screens can't drift out of sync on wording or order,
// and the matchmaker's compatibility scorer stays comparable across
// users (word-for-word exact-match; a rename here breaks past overlap
// for existing rows).
//
// These lists are deliberately short and unambiguous — cheap noise like
// "Gym" vs "Working out" vs "Fitness" is the enemy of the +2/+1 match
// score. Only add to these lists, don't rename existing entries.

export const HOBBIES = [
  'Gaming',
  'Hiking',
  'Reading',
  'Music',
  'Cooking',
  'Sports',
  'Art',
  'Photography',
  'Travel',
  'Coding',
  'Movies',
  'Fitness',
] as const;

export const ACTIVITIES = [
  'Greek Life',
  'Student Government',
  'Intramurals',
  'Research',
  'Volunteering',
  'Club Sports',
  'Band/Orchestra',
  'Theater',
  'Debate',
  'Esports',
] as const;
