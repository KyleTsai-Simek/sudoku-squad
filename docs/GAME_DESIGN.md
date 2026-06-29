# Game Design

Everything UX-facing: modes, settings, what shows up on the board, what shouldn't, and the open questions we still need to answer. Where a decision is open, it's flagged with **OPEN**.

> **What's live vs. spec.** Single-player and battle are live (https://sudoku-squad-web.vercel.app/); coop has an MVP landed (shared board, server-overlay sync, shared win) with cursors / private notes / disconnect-grace still to come. The sections below double as the design spec — treat them as the source of truth for how each mode should *feel*, and the 🔲 markers for what hasn't shipped yet.

---

## Modes

### Single player ✅ live
- One player, one puzzle.
- All settings (notes, reveal, hints) available.
- Local state only — does not require a Supabase room.
- Purpose: most casual entry point, also our testbed for the core engine.

### Daily puzzles 🔄 implemented in branch
- One shared Easy / Medium / Hard puzzle set per Pacific calendar day.
- Daily assignments rotate at midnight Pacific and are stored in `daily_puzzles`.
- Assignment prefers puzzles no player has solved yet, falling back to the tier pool only when needed.
- The home screen shows the Easy / Medium / Hard daily set as a horizontal row under a Pacific-date header like "June 26 Daily Puzzles"; `/daily` remains the full daily page. Both launch the existing single-player board with daily metadata attached.
- Home uses a single-primary-CTA hierarchy: unsolved Daily Easy → unsolved Daily Medium → unsolved Daily Hard → Quick Play's "Start a game". Non-primary action buttons use the subtle blue `primary-muted` treatment rather than white. Unsolved home daily buttons only display the centered difficulty label; completed daily buttons use a distinct light-green card treatment with a corner checkmark, today's solved count, and completion time.
- The daily completion modal reuses the same Easy / Medium / Hard row. The just-finished daily is shown as completed immediately, and the next unsolved daily becomes the primary button; the existing home/another-puzzle controls remain below the row.
- A daily solve is recorded only when the player completes the assigned puzzle on its assigned Pacific day; future leaderboard/history UI will read `player_daily_completions`.
- Single-player and multiplayer lobby selectors expose the five visible difficulty labels: Easy / Medium / Hard / Expert / Extreme. Home single-player difficulty buttons are centered one-word labels; the hidden `killer` tier remains unsurfaced.
- Quick Play subflows use short helper copy under their page headings: "Start a game" says "Choose a game mode.", and "Single-player" says "Choose a difficulty level."

### Leaderboards 🔄 first board deployed
- The home page shows a bottom "Puzzles solved" leaderboard. It ranks players by unique completed puzzles from `player_completions`, across anonymous and signed-in users.
- Users with zero completions are omitted.
- Display names come from the current `issued_usernames` row, so a signed-in username change is reflected on the leaderboard for everyone.
- The first UI requests the top 15 and bolds the current player when present. If the current player is outside the top 15 or has zero completions, their row is pinned above the ranked list; if they are inside the top 15, they appear in the normal ranked position. The backend RPC returns the current player's row outside the requested page and for zero-completion callers, so large leaderboards can show both the leaders and "your place" without loading every ranked user.

### End-game sharing 🔄 implemented locally
- End-game modals should offer a Share action once a puzzle is complete: single-player completion, daily completion, battle winner, and coop win.
- Shared text should be anonymous and simple: "Try this easy puzzle. I finished in 5:51!" plus a link that lets another player try the exact same puzzle.
- Share links should unfurl with a result-specific Open Graph image: black Sudoku Squad branding, puzzle info, a finished-time badge, a primary-style "Try this puzzle" button, and a playful board-card visual. The visual must not expose the solution in a useful way.
- The recipient experience should be direct: open a short `/s/{puzzleCode}/{time}` share link, see a compact challenge/result page, then tap to play the same puzzle. Daily share links must preserve daily metadata so completing today's shared daily behaves like entering from the home Daily Puzzles row.
- Tone and identity are settled for the first pass: anonymous shares with softer "Try this puzzle" copy, not username-based or competitive "Can you beat me?" copy. Local `/share-preview` supports iteration before external unfurl caches are involved. See [SHARE_LINKS_PLAN.md](SHARE_LINKS_PLAN.md).

### Multiplayer lobby sharing 🔄 implemented locally; manual test pending
- Battle and co-op lobby invite links use the existing short room URL shape, `/r/{code}`, and should open directly into the lobby join flow with no interstitial page.
- Player-created lobbies are public by default. Hosts can uncheck Public lobby inside Lobby Settings to make a lobby private. Unused warmed preload rooms stay private until consumed so public browsing is not polluted by background preloads.
- When the creator lands in the lobby, the app copies the invite payload to their clipboard and shows a snackbar confirmation. The copied text is: "Tap this link to play sudoku with me!" plus the room URL.
- The lobby copy button uses the iOS share icon and copies the same payload.
- Room links should unfurl with a lobby-specific Open Graph image: existing Sudoku Squad branding and puzzle preview, middle copy "Play sudoku with me!", and bottom CTA "Join game". Local `/share-preview` includes direct lobby OG-image examples.

### Battle ✅ live (Phase 2)
- 2–8 players, each with their own private copy of the same puzzle.
- Each player sees their own board only. We do show a **progress bar per opponent** (% cells correctly filled) — enough social pressure without giving away their answers.
- Late joiners can enter an already-started battle until the room reaches 8 players. They start from an empty private board, inherit the original game timer, and have to catch up.
- First player to legally complete the puzzle wins. Server validates.
- When a winner is declared, every player sees a "{username} won!" overlay. Losers can dismiss the overlay and **keep solving** their own board (the result is already final and recorded). See [DECISIONS.md #0008](DECISIONS.md).
- If a player gets stuck, they can give up at any time (counts as a loss for them; game continues for others).
- Optional: time-based fallback — if no one finishes in X minutes, highest progress % wins. **OPEN**.

### Coop 🔄 MVP landed (Phase 3)
- 2–8 players, all writing to the same board.
- Late joiners can enter an already-started co-op room until the room reaches 8 players. They replay the shared move log and can start helping immediately.
- ✅ Last-write-wins per cell, server-ordered by `seq` (server-overlay reconciliation in `coop-store.ts`).
- ✅ Game ends when the board is correctly completed. Win celebrated together (shared-win broadcast). Coop-colored shared progress.
- 🔲 Visible colored cursors show where other players are looking (Supabase Presence).
- 🔲 **Notes shared by default** with an opt-in **"Private notes"** toggle to keep your own pencil marks invisible to teammates. See [DECISIONS.md #0007](DECISIONS.md). Descopes to V2 if the build is tight.
- 🔲 Disconnect/rejoin grace handling.

---

## Board UI

- 9×9 grid with thicker borders demarcating 3×3 boxes (standard).
- Given (clue) cells are visually distinct (bolder, slightly darker bg) and locked.
- Selected cell highlighted; **row, column, and box** also faintly highlighted (this is standard in NYT Sudoku and Sudoku.com and is genuinely helpful).
- Cells sharing the value of the selected cell get a subtle highlight (also standard).
- Conflicting cells (same value in row/col/box) get a red tint — **only if "show conflicts" is on**.
- In coop mode, other players' cursors appear as a colored ring on the cell they're selecting; their username appears in a tiny chip on hover.

## Input methods

- **On-screen number pad** (1–9 + clear + notes toggle + undo/redo) — primary input on mobile/web. The Notes button is a real toggle: outlined pencil + neutral fill when off, filled pencil + amber-500 fill when on, glanceable mid-puzzle.
- **Physical keyboard** — desktop. The header has a `?` button that opens a shortcut cheatsheet; the same overlay is bound to `?` as a hotkey. Bindings:
  - `1`–`9` enter a value (or toggle a pencil-mark in notes mode).
  - `Shift`+`1`–`9` toggles a pencil-mark *regardless* of current mode — one-shot, doesn't flip the mode. Useful when you're mostly placing values but want to drop a single note without round-tripping through `Space`.
  - `0` / `Backspace` / `Delete` clear the cell.
  - Arrow keys move the selection.
  - `Space` toggles notes mode (NYT-style); `N` is kept as a legacy alias.
  - `Cmd/Ctrl+Z` undo, `Cmd/Ctrl+Shift+Z` or `Cmd/Ctrl+Y` redo.
  - `Esc` closes any open overlay.
- **Notes mode**: when on, tapping numbers (or pressing 1–9) toggles them as small marks in the cell rather than setting the value.
- **Auto-clean (smart notes)**: when you place a value in a cell, that digit is automatically removed from the pencil-marks of every peer cell (same row, column, or 3×3 box). Always on; not a setting. Undo (and the "smart-clear" of re-typing/erasing the value you just placed) restores both the placement and the wiped notes in one step — identically across single-player, battle, and coop. In multiplayer this restoration is synced to every player: undo emits the restoring `note_toggle`s as real moves in the server log ([DECISIONS #0041](DECISIONS.md)), so a teammate's board never diverges from yours. This matches the universal pattern in NYT Sudoku, Sudoku.com, and Good Sudoku — players expect it.

---

## Settings — V1 defaults

**Settings are per-room.** In multiplayer, the host configures them in the lobby; once the game starts, settings are locked for everyone. In single player, the player configures them privately. We don't persist settings across sessions in V1. See [DECISIONS.md #0009](DECISIONS.md).

| Setting | Default | Notes |
|---|---|---|
| Show conflicts | **On** | Highlights cells in red if they violate sudoku rules vs. other player-entered cells. Does NOT compare to the solution. |
| Auto-check correctness | **Off** | When ON, the moment you place a wrong number it's flagged (compared against solution). When OFF, you only learn at completion attempt. |
| Notes (pencil marks) | **On** | Always available. |
| Auto-clean notes | **Always on** | When you place a number, that digit is removed from the pencil-marks of every peer cell (row/col/box). Universal pattern in major sudoku apps; no toggle. Undo restores. |
| Hints / Reveal cell | **Removed in V1** (Chunk A). Auto-check is the replacement signal: when on, the moment a wrong digit is placed it's flagged. The `sp_get_puzzle` RPC stays for SP auto-check; the multiplayer `hint` Edge Function was dropped from scope. |
| Timer visible | **On** | Battle uses it for tiebreaks; coop just for fun. |
| Appearance | **Auto** | Follows the user's system light/dark setting unless manually overridden to Light or Dark from the account menu. The override is stored locally. |

### The "reveal answers" cluster — resolved

These all default to per-room settings (host picks in the lobby):

- **Show conflicts (rule violations vs. other entered cells)** — defaults **ON**. Does not reveal the solution.
- **Auto-check correctness (vs. solution)** — defaults **OFF**. Available as a lobby setting if the host wants to enable it.
- **Hints / Reveal cell** — **removed from V1** (Chunk A). Player feedback indicated hints felt like the wrong escape hatch for a competitive mode; auto-check is the milder, opt-in replacement. The `sp_get_puzzle` RPC remains for SP auto-check, but no multiplayer `hint` Edge Function is planned.
- **End-of-game check** — pressing "Done" / "Check" when you think you're finished. Always available, always allowed. Server validates against the solution and either announces win or returns "not yet" without saying which cells are wrong (otherwise it's a free auto-check).

---

## Player identity

- Every visitor is signed in **anonymously** by default — no signup required. The Supabase anon user ID persists in localStorage so a reconnect restores you as the same player, and progress (`player_completions`) accrues against that ID per device.
- Anonymous players get a system-assigned, globally-unique **adjective-noun** username (server-issued — [DECISIONS #0027](DECISIONS.md)) and a system-assigned color (cursor highlight + progress bar). They **cannot** change their name.
- `room_players.username` is a join-time snapshot of the player's display name (1–20 chars), scoped to that room.

### Accounts (Phase 5 — [DECISIONS #0043](DECISIONS.md))

Optional email sign-in, layered on top of anonymous play:

- **Sign in / account menu.** The in-flow app header on every screen has an account menu headed by the current username, including anonymous users. Account actions (change username when signed in, sign out, or "Sign in to save progress" when anonymous) stay grouped at the top above Appearance. Sign-in is a full-screen `/auth/sign-in` home-style subflow with the Sudoku Squad title, a fully clickable arrow + Back control, a large "Sign in" heading, and an autofill-friendly email field; it accepts either the **magic link** or a **6-digit code** (Supabase OTP).
- **Why sign in.** Progress becomes portable across devices, and you can change your username. First-time sign-in *links* the email to your current anonymous identity (same player ID — nothing is lost). Signing in on another device **merges** that device's anonymous progress into your account (union of solved puzzles).
- **Renaming (signed-in only).** Pick any base name; if it's already taken, a random `#NNNN` discriminator is appended (`kyle#1234`), Discord-style — many people can be `kyle`. The width grows (5 digits, …) only if a base's number space fills up. Changing away from a name frees it for reuse.
- **Sign out** drops you to a fresh anonymous identity; your account's progress stays safe and returns on next sign-in.
- **Stats.** Solved counts per difficulty (and unique solved-puzzle hashes, backend-only) are captured server-side now; a visible stats/profile screen is a later pass.

## Visual Theme

- Theme decisions: [DECISIONS #0044](DECISIONS.md), [#0045](DECISIONS.md).
- Primary app color is a user-friendly, high-contrast blue, extended into semantic UI tokens instead of direct Tailwind palette utilities.
- Light mode and dark mode are supported. Default behavior is `auto`, following the user's native system setting; users can override locally to `light` or `dark` from the account menu.
- Notes mode keeps its warm amber accent.
- Player identity colors are stable per room but rendered through theme-aware light/dark tokens, so lobby dots, battle progress, coop ownership, coop names, and winner labels remain readable in both modes.
- Board state colors must remain readable in both modes: givens, entered values, selected cell, related row/column/box, same-value highlights, completed-digit state, conflicts, and incorrect auto-check state.
- Color cannot be the only signal for important states; existing text, labels, icons, and focus affordances should remain intact.

---

## Room lifecycle

1. **Create.** Host clicks "Battle" or "Coop" → server creates a `room` with a short code, redirects to `/r/{code}`.
2. **Lobby.** Host sees the share link. New joiners get a durable seat immediately, but they appear to other players only after staying visible in the room for a few seconds. This filters out mobile in-app browser hops before the user opens the link in their real browser. The joining user still sees their own row while waiting. Host clicks **Start** when ready; Battle's two-player gate counts confirmed visible players only.
   Lobby mode and difficulty selectors follow a tonal toggle pattern: faint-blue containers when unselected and a deeper light-blue selected container, so Start remains the only primary-blue CTA.
   Lobby Settings are collapsed by default; hosts can expand them to change Public lobby, Show conflicts, Auto-check, and Highlight same value while the room is still in lobby, and non-hosts can expand them read-only.
3. **Playing.** Game timer starts. Realtime channel active.
4. **Finishing.**
   - Battle: first player to complete legally wins. Channel announces; everyone else's game ends with "X won." Losers can keep solving if they want (low-priority feature; defer if needed).
   - Coop: everyone wins when the board is complete. Confetti and a "play again" button.
5. **Replay.** Host clicks "Play again" → server creates a new room with a new puzzle, optionally same player set.

---

## Connection / disconnect handling

- Durable room membership is separate from confirmed lobby presence. A brand-new joiner is hidden from other players until they stay visible for about 5 seconds; after confirmation, they remain a room participant through normal task switching.
- If a player drops connection mid-game, their durable seat and inputs so far remain. Battle and coop both support returning through the room URL; late joins after Start continue to work.
- A confirmed player who comes back after the game has started rejoins the game surface and can continue participating.
- Never-confirmed lobby rows are ignored for Start and can be pruned after a short stale window.
- Host migration: if the original host leaves, the longest-tenured remaining player becomes host. **OPEN**: should host migration require explicit acknowledgement?

---

## Accessibility — V1 minimum

- Keyboard-navigable grid.
- Color is never the only signal (conflicts also get an icon or pattern; cursors also have username labels).
- Sufficient contrast for given vs. entered cells.
- Screen reader: at minimum the grid has aria labels for `row N, column M, value X` and announces conflicts. Full audit can wait to V2.

---

## Things explicitly NOT in V1

- Daily puzzle leaderboard/history UI.
- Chat or emoji reactions inside the room.
- Spectator mode.
- (Removed — expert tier shipped 2026-05-22 in [DECISIONS #0031](DECISIONS.md). A true "evil" tier rated 7+ is still post-V1 pending a richer puzzle source.)
- Achievements, stats, history.
- Custom rules / variants (X-sudoku, killer sudoku, etc.).
- Audio / SFX.

---

## Open UX questions (running list)

1. **Time-based tiebreak** in battle if no one finishes — yes/no? Leaning no for V1.
2. **Host migration** acknowledgement — explicit or silent? Leaning silent (transfer to longest-tenured remaining player).
3. **Mobile lobby / share link UX** — auto-copy on room create? Native share sheet? QR code for in-person play?
4. **Mobile cursor visualization in coop** — phones have no persistent cursor. Working assumption: ring stays on the last-tapped cell, fades after ~3 seconds of inactivity. Confirm with testing.
5. **End-game share link iteration** — after implementation, test real share links and OG images, then iterate on board-card art and copy.
