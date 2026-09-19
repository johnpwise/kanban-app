# Route handler boundary lens

Runs when transport, service, and persistence concerns risk being mixed, or boundary ownership is
unclear — handlers, controllers, middleware, services, or repositories changing. Recommend the
smallest architecture correction that restores boundary clarity, not a rewrite.

## Boundary rules

**Route handlers own:** request extraction; invoking validation/auth middleware or boundary checks
(TS stack: Zod parsing of params/query/headers/body where relevant, mapped to typed DTOs before the
service call); calling service/application logic; translating outcomes into HTTP responses; shaping
predictable response payloads; delegating error handling per repo conventions.

**Services own:** business rules; coordination across repositories or downstream dependencies;
domain-level branching; transaction intent; typed application inputs and outputs.

**Persistence layers own:** query composition; database-specific concerns; transaction mechanics
where the repo locates them; row/document mapping close to the data boundary; persistence DTOs that
do not leak into Express responses by default.

## Flag

- route handlers with branching-heavy business logic
- handlers assembling persistence queries without an established pattern
- handlers passing raw `req.body` / `req.query` / `req.params` into services (TS: missing Zod
  validation at the trust boundary)
- services returning transport-specific response objects
- repositories deciding HTTP semantics
- duplicated validation and response mapping spread across handlers

## Output into the Step Record

Boundary assessment (`healthy` / `acceptable-with-notes` / `needs-correction`); prioritised
boundary findings; smallest corrective shape.
