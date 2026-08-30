// Shared between app/(auth)/signup.tsx (asked once during onboarding) and
// app/(app)/profile.tsx (editable later). Keeping this in one place means
// the two screens can't drift out of sync on wording or option order.
export const PERSONALITY_QUESTIONS = [
  {
    key: 'energy',
    label: 'How do you recharge your energy?',
    options: ['By myself (Introvert)', 'With others (Extrovert)', 'A mix of both (Ambivert)'],
  },
  {
    key: 'decisions',
    label: 'How do you make big choices?',
    options: ['Logic and facts', 'Gut feeling / Intuition', 'Seeking advice from others'],
  },
  {
    key: 'lifestyle',
    label: 'How do you approach your daily life?',
    options: ['Careful planning', 'Spontaneous and flexible', 'Go with the flow'],
  },
  {
    key: 'mindset',
    label: 'What is your general outlook?',
    options: ['Optimistic (Glass half full)', 'Realistic (It is what it is)', 'Idealistic (Chasing perfection)'],
  },
] as const;
