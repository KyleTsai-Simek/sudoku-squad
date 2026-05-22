# Game Design

Everything UX-facing: modes, settings, what shows up on the board, what shouldn't, and the open questions we still need to answer. Where a decision is open, it's flagged with **OPEN**.

> **What's live vs. spec.** Single-player is the only mode that exists today (live at https://sudoku-squad-web.vercel.app/). Battle and coop sections below are the design spec — they describe what we'll build in Phases 2 and 3. Treat them as the source of truth for what those modes should *feel like* when they ship.

---

## Modes

### Single player ✅ live
- One player, one puzzle.
- All settings (notes, reveal, hints) available.
- Local state only — does not require a Supabase room.
- Purpose: most casual entry point, also our testbed for the core engine.

### Battle 📝 spec (Phase 2)
- 2–4 players, each with their own private copy of the same puzzle.
- Each player sees their own board only. We do show a **progress bar per opponent** (% cells correctly filled) — enough social pressure without giving away their answers.
- First player to legally complete the puzzle wins. Server validates.
- When a winner is declared, every player sees a "{username} won!" overlay. Losers can dismiss the overlay and **keep solving** their own board (the result is already final and recorded). See [DECISIONS.md #0008](DECISIONS.md).
- If a player gets stuck, they can give up at any time (counts as a loss for them; game continues for others).
- Optional: time-based fallback — if no one finishes in X minutes, highest progress % wins. **OPEN**.

### Coop 📝 spec (Phase 3)
- 2–4 players, all writing to the same board.
- Visible colored cursors show where other players are looking.
- Last-write-wins per cell (server-ordered).
- **Notes are shared by default** (toggling adds/removes the mark for everyone). Each player can flip on a **"Private notes"** toggle to keep their own pencil marks invisible to teammates. See [DECISIONS.md #0007](DECISIONS.md). If V1 build is tight, private-notes mode descopes to V2.
- Game ends when the board is correctly completed. Win celebrated together.

---

## Board UI

- 9×9 grid with thicker borders demarcating 3×3 boxes (standard).
- Given (clue) cells are visually distinct (bolder, slightly darker bg) and locked.
- Selected cell highlighted; **row, column, and box** also faintly highlighted (this is standard in NYT Sudoku and Sudoku.com and is genuinely helpful).
- Cells sharing the value of the selected cell get a subtle highlight (also standard).
- Conflicting cells (same value in row/col/box) get a red tint — **only if "show conflicts" is on**.
- In coop mode, other players' cursors appear as a colored ring on the cell they're selecting; their username appears in a tiny chip on hover.

## Input methods

- **On-screen number pad** (1–9 + clear + notes toggle + undo) — primary input on mobile/web.
- **Physical keyboard** (1–9 to enter, Backspace/0 to clear, N to toggle notes mode, arrow keys to navigate) — desktop.
- **Notes mode**: when on, tapping numbers toggles them as small marks in the cell rather than setting the value.

---

## Settings — V1 defaults

**Settings are per-room.** In multiplayer, the host configures them in the lobby; once the game starts, settings are locked for everyone. In single player, the player configures them privately. We don't persist settings across sessions in V1. See [DECISIONS.md #0009](DECISIONS.md).

| Setting | Default | Notes |
|---|---|---|
| Show conflicts | **On** | Highlights cells in red if they violate sudoku rules vs. other player-entered cells. Does NOT compare to the solution. |
| Auto-check correctness | **Off** | When ON, the moment you place a wrong number it's flagged (compared against solution). When OFF, you only learn at completion attempt. |
| Notes (pencil marks) | **On** | Always available. |
| Auto-eliminate notes | **Off** | When you place a number, notes for that number in the row/col/box could auto-clear. Convenient but considered cheating by purists. |
| Hints / Reveal cell | **Available but counted** | Players can request a hint (reveals one correct cell). In battle, hints are tracked and shown to opponents to discourage spam. In coop, no penalty. |
| Timer visible | **On** | Battle uses it for tiebreaks; coop just for fun. |

### The "reveal answers" cluster — resolved

These all default to per-room settings (host picks in the lobby):

- **Show conflicts (rule violations vs. other entered cells)** — defaults **ON**. Does not reveal the solution.
- **Auto-check correctness (vs. solution)** — defaults **OFF**. Available as a lobby setting if the host wants to enable it.
- **Hints / Reveal cell** — available; when used in battle, the usage is visible on the opponent progress UI so it can't be spammed unfairly. **OPEN**: exact UI for hint disclosure.
- **End-of-game check** — pressing "Done" / "Check" when you think you're finished. Always available, always allowed. Server validates against the solution and either announces win or returns "not yet" without saying which cells are wrong (otherwise it's a free auto-check).

---

## Player identity

- On joining a room, player picks a username (1–20 chars, anonymous, scoped to that room).
- Each player gets a system-assigned color (used for cursor highlight + progress bar).
- No password, no account. The Supabase anon user ID persists in localStorage so a reconnect within ~24h restores you as the same player.

---

## Room lifecycle

1. **Create.** Host clicks "Battle" or "Coop" → server creates a `room` with a short code, redirects to `/r/{code}`.
2. **Lobby.** Host sees the share link. As other players join via link, they appear in the lobby with their username + color. Host clicks **Start** when ready.
3. **Playing.** Game timer starts. Realtime channel active.
4. **Finishing.**
   - Battle: first player to complete legally wins. Channel announces; everyone else's game ends with "X won." Losers can keep solving if they want (low-priority feature; defer if needed).
   - Coop: everyone wins when the board is complete. Confetti and a "play again" button.
5. **Replay.** Host clicks "Play again" → server creates a new room with a new puzzle, optionally same player set.

---

## Connection / disconnect handling

- If a player drops connection mid-game, their seat is held for 60 seconds; their cursor disappears but their inputs so far remain.
- If they rejoin within 60s, they pick up where they left off.
- If they don't, in battle the game continues without them. In coop, the game continues — their seat is freed up.
- Host migration: if the original host leaves, the longest-tenured remaining player becomes host. **OPEN**: should host migration require explicit acknowledgement?

---

## Accessibility — V1 minimum

- Keyboard-navigable grid.
- Color is never the only signal (conflicts also get an icon or pattern; cursors also have username labels).
- Sufficient contrast for given vs. entered cells.
- Screen reader: at minimum the grid has aria labels for `row N, column M, value X` and announces conflicts. Full audit can wait to V2.

---

## Things explicitly NOT in V1

- Daily puzzle / shared world puzzle.
- Chat or emoji reactions inside the room.
- Spectator mode.
- Expert tier (3 tiers ship in V1: easy/medium/hard — see [DECISIONS.md #0018](DECISIONS.md). Expert is on hold pending a higher-difficulty puzzle source.)
- Achievements, stats, history.
- Custom rules / variants (X-sudoku, killer sudoku, etc.).
- Audio / SFX.

---

## Open UX questions (running list)

1. **Time-based tiebreak** in battle if no one finishes — yes/no? Leaning no for V1.
2. **Host migration** acknowledgement — explicit or silent? Leaning silent (transfer to longest-tenured remaining player).
3. **Mobile lobby / share link UX** — auto-copy on room create? Native share sheet? QR code for in-person play?
4. **Mobile cursor visualization in coop** — phones have no persistent cursor. Working assumption: ring stays on the last-tapped cell, fades after ~3 seconds of inactivity. Confirm with testing.
5. **Hint disclosure UX in battle** — how is "X used a hint" shown to opponents? An icon on their progress bar? A toast?
6. **Mid-game join policy** — confirmed working assumption: battle is locked after Start; coop is open anytime.
