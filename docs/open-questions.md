# Open product questions

Design questions we've discussed but deliberately not built yet. Each
one has a decision to make later, not a coding task ready to pick up.

## View-only access to past chats

Should users be able to open an expired match to read the transcript
one more time (without being able to reply)?

**For**
- Reading back a good conversation is satisfying — most "disposable
  match" apps in the space do let you scroll old ones.
- Ratings and mini-profiles (built) feel more meaningful when there's
  real context to attach them to ("oh yeah, THAT person").
- The data already exists in the DB — this is purely a UI over rows
  we're already storing.

**Against**
- Cuts against the "reset at midnight" identity. Part of Orbit's
  premise is that the person is gone forever at midnight. If they
  linger in a history list, the urgency of "chat now before they
  vanish" softens.
- Privacy: an old match can potentially be re-identified over time
  (alias changes, cross-referencing campus + major, etc.) if we keep
  showing them.
- Once there's a past-matches list, feature-creep pressure is real:
  search, favorite, share, screenshot, etc.

**Three ways to land it (from least invasive to most):**

1. **Summary card only** — "You had 34 messages with NebulaNomad199 on
   Sept 1" plus the icebreaker. No message content shown. Cheap to
   ship, doesn't undermine ephemerality much.
2. **View-once time capsule** — user can pull the full transcript up
   one more time, and then it's gone from their view forever. Nice
   moment, more engineering.
3. **Full history browser** — like a normal messenger. Simplest to
   build, most damaging to the ephemerality premise.

Current recommendation if we decide to do anything: **option 1**. It
scratches the "did that really happen?" itch without turning Orbit
into another chat app. Option 3 can layer on later if we want.

Deciding: TBD. Talk again after we see what real usage looks like.
