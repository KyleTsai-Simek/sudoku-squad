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
- **Auto-clean (smart notes)**: when you place a value in a cell, that digit is automatically removed from the pencil-marks of every peer cell (same row, column, or 3×3 box). Always on; not a setting. Undo restores both the placement and the wiped notes in one step. This matches the universal pattern in NYT Sudoku, Sudoku.com, and Good Sudoku — players expect it. See [research notes in chat transcript].

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

### The "reveal answers" cluster — resolved

These all default to per-room settings (host picks in the lobby):

- **Show conflicts (rule violations vs. other entered cells)** — defaults **ON**. Does not reveal the solution.
- **Auto-check correctness (vs. solution)** — defaults **OFF**. Available as a lobby setting if the host wants to enable it.
- **Hints / Reveal cell** — **removed from V1** (Chunk A). Player feedback indicated hints felt like the wrong escape hatch for a competitive mode; auto-check is the milder, opt-in replacement. The `sp_get_puzzle` RPC remains for SP auto-check, but no multiplayer `hint` Edge Function is planned.
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
5. **Hint disclosure UX in battle** — how is "X used a hint" shown to opponents? An icon on their progress bar? A toast?
6. **Mid-game join policy** — confirmed working assumption: battle is locked after Start; coop is open anytime.
