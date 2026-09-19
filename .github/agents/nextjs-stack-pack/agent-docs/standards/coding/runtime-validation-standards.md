# runtime-validation-standards.md

## Purpose

This document defines the runtime trust-boundary validation standard for this stack. The
`react-stack-pack` does not need this document because a Vite SPA has no server-side trust boundary
of its own; Next.js does — Route Handlers, Server Actions, and server-side integrations all receive
data from outside the application's control.

## The rule

**Static typing is not runtime validation.** A TypeScript type is erased at compile time and proves
nothing about what actually arrives at runtime. All untrusted data entering the trusted application
boundary must be validated before application/domain logic relies on it.

**Validate untrusted data once at the trust boundary, then operate on trusted typed data internally.**
Zod is the default schema-validation mechanism for this stack, unless a specific integration already
provides an equivalent or stronger runtime-validated contract (for example a code-generated client
from an already-validated OpenAPI/GraphQL schema).

```text
UNTRUSTED                       TRUSTED

HTTP body        ──┐
FormData         ──┤
query params     ──┤
route params     ──┼──> Zod validation ──> typed application/domain data
webhook payload  ──┤
third-party API  ──┤
env/config       ──┘
```

## Where Zod is required

Validate with Zod at every point listed below where the data did not originate from code you already
control and validated upstream in the same request:

- HTTP request bodies (Route Handlers)
- Route Handler query parameters and route (dynamic segment) parameters where the value drives
  behavior
- Server Action input, including `FormData`
- webhook payloads
- third-party/external API responses your application depends on for correctness
- environment/configuration values where a wrong or missing value would cause silent misbehavior
  rather than a clear startup failure
- other user-submitted values not already covered above

## Where repeated validation is not required

Once data has crossed a validated trust boundary, do not re-parse it between ordinary internal typed
function calls "just in case." A service function called by a Route Handler that already validated
its input should accept the typed, trusted shape directly — parsing again at every internal call
adds cost without adding safety, and it obscures where the actual trust boundary is.

## Deriving types from schemas

Prefer deriving TypeScript types from the Zod schema that validates them (`type Subscribe =
z.infer<typeof subscribeSchema>`) rather than hand-writing a separate interface. Two independent
descriptions of the same shape drift; a schema-derived type cannot.

Avoid maintaining unnecessarily duplicated schema and interface definitions for the same boundary
value.

## Error handling

Validation failures must be handled safely and predictably:

- return a clear, actionable error to the caller (which field, what was wrong) without leaking
  internal state, stack traces, or implementation details
- a Route Handler returns an appropriate 4xx status with a stable error shape; a Server Action returns
  a narrowly scoped error result the calling Client Component can render
- do not let a validation failure surface as an unhandled exception / framework error page in
  production

## Minimal example

```ts
// src/schemas/subscribe.ts
import { z } from "zod";

export const subscribeRequestSchema = z.object({
  email: z.string().trim().email(),
});

export type SubscribeRequest = z.infer<typeof subscribeRequestSchema>;
```

```ts
// src/actions/subscribe.ts
"use server";

import { subscribeRequestSchema } from "@/schemas/subscribe";
import { subscribeEmail } from "@/lib/services/subscriptions";

export async function subscribeAction(
  _prevState: { status: "idle" | "success" | "error"; message?: string },
  formData: FormData,
) {
  const parsed = subscribeRequestSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return { status: "error" as const, message: "Enter a valid email address." };
  }

  await subscribeEmail(parsed.data);

  return { status: "success" as const };
}
```

The Server Action validates once at the boundary; `subscribeEmail` receives trusted, typed data and
does not re-validate it.
