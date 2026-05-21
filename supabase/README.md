# Supabase

This folder holds SQL migrations and (later) Edge Functions for the Sudoku Squad backend.

## Migrations

Numbered files in `migrations/` apply in order. Each one is a complete, idempotent SQL script that should apply cleanly to a fresh database.

### Running locally

You can either:

**A. Paste into the Supabase SQL editor.** Project dashboard → SQL editor → paste contents → run. Simplest for V1.

**B. Use the Supabase CLI.**

```bash
# One-time setup
brew install supabase/tap/supabase

# Link the project
supabase link --project-ref YOUR-PROJECT-REF

# Apply migrations
supabase db push
```

## Edge Functions

Not yet created. Phase 2 adds `create_room`, `join_room`, and `submit_move`. They'll live in `supabase/functions/` per Supabase's standard layout.
