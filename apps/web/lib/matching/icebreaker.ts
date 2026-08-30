import type { Profile } from '@orbit/shared';

export function generateIcebreaker(profileA: Profile, profileB: Profile): string {
  const hobbiesA = profileA.hobbies || [];
  const hobbiesB = profileB.hobbies || [];
  const sharedHobbies = hobbiesA.filter(h => hobbiesB.includes(h));

  const activitiesA = profileA.activities || [];
  const activitiesB = profileB.activities || [];
  const sharedActivities = activitiesA.filter(a => activitiesB.includes(a));

  const sameMajor = profileA.major && profileB.major && profileA.major === profileB.major;
  const majorA = profileA.major || 'your major';
  const majorB = profileB.major || 'their major';

  const pickRandom = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

  if (sharedHobbies.length > 0) {
    const hobby = sharedHobbies[0];
    return pickRandom([
      `🎯 Plot twist — you both love ${hobby}! What got you into it?`,
      `✨ Hidden connection: ${hobby} fans unite! What's your hot take on it?`,
      `🔥 You both listed ${hobby}. If you could do it anywhere in the world, where?`
    ]);
  }

  if (sharedActivities.length > 0) {
    const activity = sharedActivities[0];
    return pickRandom([
      `🏛️ Campus connection: you're both involved in ${activity}. What's the best part?`,
      `🎪 Small world — ${activity} brought you both here. What's your favorite memory from it?`
    ]);
  }

  if (sameMajor && profileA.major) {
    const major = profileA.major;
    return pickRandom([
      `📚 You're both studying ${major}! What class has been your favorite so far?`,
      `🧠 Fellow ${major} majors! What made you choose this path?`
    ]);
  }

  if (profileA.major && profileB.major) {
    return pickRandom([
      `🌈 One of you studies ${majorA}, the other ${majorB}. What's something from your field that would blow the other's mind?`,
      `🔬 ${majorA} meets ${majorB} — what invention would you create together?`
    ]);
  }

  return pickRandom([
    "🌌 Two strangers in the cosmos — what's the most surprising thing about you?",
    "🎲 The universe paired you tonight! What's something you've never told anyone?",
    "🚀 Fresh connection! If you could have dinner with anyone, living or dead, who?",
    "💫 Mystery match! What's the last thing that genuinely made you laugh?"
  ]);
}
