# API Routes — Local Conventions

## Response shape

Every route returns `{ data: T }` on success or `{ error: string }` on failure with the correct HTTP status:

- `200` / `201` — success
- `400` — bad input (validate before DB access; never let Prisma throw a constraint error to the client)
- `401` / `403` — auth
- `404` — missing resource
- `500` — unexpected server error

## Error handling

Never surface Prisma error messages, stack traces, or internal IDs in HTTP responses. Log server-side (`console.error`), return a generic string to the client.

## Auth

Route handlers that mutate data must call `requireAdmin()` or verify the session before touching the DB. Read-only routes may skip auth if the data is non-sensitive.

## Integration tests

Every new endpoint gets an integration test in `tests/integration/`. Use the builders in `tests/helpers/builders.ts` instead of raw `prisma.create` calls — they handle cleanup automatically.
