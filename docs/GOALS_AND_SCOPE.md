# Goals & Scope

## Vision

A delightful, low-friction multiplayer sudoku app where friends can play *together* — either cooperating on a single board or racing on identical boards — by sharing a link. Mobile-first feel, no signup required, snappy gameplay.

The closest analogs in spirit:
- **Down for a Cross** — multiplayer crosswords with a shared link, anonymous usernames, both coop and competitive modes.
- **Words With Friends** — turn-based but social; we're taking the "send a friend a link to play" feel and making it realtime.
- **NYT Games iOS app** — the polish bar we aspire to on mobile (eventually).

## Why this exists

Sudoku is traditionally solo. Doing it with another person — either chatting through a tough box together or racing — is genuinely fun and not well-served by existing apps. There are a few clones but none nail the "frictionless invite, both web and mobile, anonymous, realtime" combo.

## V1 scope (lean)

The bar for V1 is **a playable demo we can send to a friend over a link and have a good time with**. Concretely:

### In scope for V1

- **Single-player web** across six difficulty tiers (warmup / easy / medium / hard / expert visible, plus a hidden killer), 15,000 puzzles total. *(Originally scoped to a single tier; expanded during Phase 1.)*
- **Battle mode** on web: create room → share link → both players join, pick a username, click Start. First to legally complete the puzzle wins.
- **Coop mode** on web: create room → share link → both players join, pick a username. Both can input numbers simultaneously, with last-write-wins per cell (see [GAME_DESIGN.md](GAME_DESIGN.md) for conflict handling).
- **Anonymous usernames** only. No accounts. No friends list. No history.
- **Core settings:** notes mode, undo, clear cell, restart. Reveal/check is configurable but defaulted off (see GAME_DESIGN).
- **Realtime presence:** see other players' cursors/selected cells in coop, see other players' progress bar in battle.
- **Mobile-responsive web** so it works on phones in a browser. Native iOS comes in Phase 4.

### Explicit non-goals for V1

These are good ideas, deliberately deferred:

- **iOS / Android native apps.** Planned for Phase 4, after web is solid.
- **Persistent accounts, profiles, friend lists, leaderboards.** Anonymous-only for V1.
- ~~**Multiple difficulty tiers.**~~ *Shipped early* — six tiers landed in Phase 1 (see In scope).
- **Custom puzzle creation / submission.** Use pre-generated or open-source puzzle packs.
- ~~**More than 4 players per room.**~~ *Raised to 8* — rooms cap at 8 players (`MAX_PLAYERS` in `join-room`).
- **Chat / voice.** Players coordinate through whatever channel they're already using (text, FaceTime, in person).
- **Spectator mode.**
- **Daily puzzle / shared world puzzle.** Could be a great future feature but not V1.
- **Monetization, paywalls, ads.**
- **Internationalization.** English-only for V1; sudoku itself is language-neutral.

## Success criteria

V1 ships when:
1. Two browsers (one of which is a phone) can join a room from a link, both modes work, and the game ends correctly (battle: a winner is declared; coop: completion is celebrated).
2. Sync latency feels imperceptible on a normal home network (visually, <250ms typing-to-other-side).
3. No state corruption when both players type into the same cell within ~100ms of each other.
4. The web app is hosted at a real URL we can share.
5. A friend who has never seen it can join a game in under 30 seconds from clicking the link.

## Target user

Two main personas:
- **Casual co-solver** — does the daily NYT mini with their partner; wants a sudoku version of that without sitting on the same couch.
- **Competitive friend group** — small group of friends who want a low-key competitive game to play in a group chat. Battle mode is for them.

Both personas value: low friction to start, no signup, works on whatever device they're holding, looks good.

## V2 candidates (post-launch)

Not committing to these yet — listed so we know what we're optimizing toward:
- Native iOS app via React Native.
- Multiple difficulty tiers + daily puzzle.
- Persistent accounts (magic link or Sign in with Apple) → stats, history, friends.
- Leaderboards / ELO for battle mode.
- Spectator + replays.
- Custom rooms (e.g., "best of 3").
- Android (only after iOS).
