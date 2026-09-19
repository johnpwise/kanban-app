# Next.js server/client boundary lens

Runs when the diff adds or moves a `"use client"` boundary, a Route Handler (`app/**/route.ts`), a
Server Action, or a trust-boundary Zod validation point, or when server-only code's reachability from
a Client Component changes. Review whether behavior sits in the right place across Server
Components, Client Components, Route Handlers, and Server Actions, and whether every boundary that
crosses trust or process lines enforces validation and authorization on the server.

## Priorities

1. **Boundary placement** — does new behavior belong in a Server Component (default), a Client
   Component (only for a justified client-only reason), a Route Handler (an actual HTTP boundary), or
   a Server Action (a frontend-originated mutation)? A Server Component calling a same-app Route
   Handler instead of the underlying service directly is a smell, not a valid pattern.
2. **`"use client"` size** — is the boundary as small as practical, or did an entire page/subtree get
   converted for one interactive control? Does a Server Component ever get imported into a Client
   Component's module graph (invalid direction)?
3. **Trust-boundary validation** — does every new/changed HTTP body, Server Action input/`FormData`,
   query/route param, webhook payload, or third-party payload get validated with Zod before domain
   logic uses it? Is the TypeScript type derived from that schema rather than hand-duplicated?
4. **Authorization, not just authentication** — does every Route Handler and Server Action that
   performs protected behavior independently verify the caller may perform this specific action, on
   the server, rather than relying on client-side UI hiding?
5. **Thinness** — do the Route Handler / Server Action stay limited to parse → validate →
   authenticate/authorize → delegate → map result, with business logic living in a service/domain
   module instead?
6. **Secrets and serialization** — does the diff risk exposing a server-only environment variable or
   secret to the browser bundle, importing a server-only module into a Client Component, or
   serializing more data to the client than the UI needs?

## Smells to flag

- `"use client"` added to a large page/layout for one interactive child
- a Server Component fetching the same app's own Route Handler over HTTP instead of calling the
  service/data-access function directly
- a Route Handler or Server Action with parsing/validation but no server-side authorization check
- a Zod schema present but not actually used to gate the code path (parsed and then ignored, or
  narrower than the type that claims to represent it)
- a hand-written interface duplicating a Zod schema's shape instead of `z.infer<typeof schema>`
- business logic embedded directly in `page.tsx`, `layout.tsx`, `route.ts`, or a Server Action file
- a `NEXT_PUBLIC_*` variable holding something that should have stayed server-only
- caching applied to user-specific or authorization-sensitive data without a stated invalidation path

## Output into the Step Record

Status (`solid` / `acceptable` / `needs-rework`); which boundary type each changed piece of behavior
should live in and why; any trust-boundary or authorization gap found (treat as blocking); any
`"use client"` boundary that should be narrowed.
