import { corsHeaders } from './cors.ts';

/**
 * Standard error response shape. Clients pattern-match on `code`.
 *
 * `code` values used so far (extend as new functions land):
 *   unauthenticated      - missing or invalid JWT
 *   bad_request          - malformed input
 *   forbidden            - caller authenticated but lacks the role for this op
 *   not_found            - referenced row doesn't exist (e.g. unknown puzzle code)
 *   room_in_progress     - join_room: battle already started
 *   room_finished        - join_room: room already over
 *   room_full            - join_room: 4 players already
 *   too_few_players      - start-game: battle requires >= 2 players
 *   invalid_move         - submit-move: cell range, given cell, value range, etc.
 *   internal             - unexpected failure
 */
export function errorResponse(
  code: string,
  message: string,
  status = 400,
): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
