# API contracts lens

Two uses:

1. **Contract modelling (planning)** — when a plan increment introduces or reshapes an API
   boundary, model the contract up front as part of `skills/feature-planning/`. The heuristics
   below define what "modelled" means.
2. **Contract review (lens)** — runs when the diff changes request/response/error shapes,
   status-code semantics, nullability, Zod/DTO schemas, or mapping boundaries. Review the contract
   as a stable interface other consumers depend on.

Replaces the retired per-stack `api-contract-modeling` agents.

## Model / check the boundary

Make every changed API boundary state, explicitly:

- **endpoint** — purpose, method, route shape
- **request** — path params, query params, relevant headers, body shape; validation rules
- **success response** — shape, status code, pagination/metadata shape if relevant
- **error response** — reliable fields, whether field-level validation errors exist, retryable vs
  non-retryable, which status-specific branches change caller behaviour
- **nullable vs optional** — semantics stated, not guessed; explicit coercion/defaulting rules
- **compatibility** — `additive`, `compatible-change`, or `breaking-change`, with the reason

## Standards

- Prefer explicit unions, nullable types where warranted, and narrow normalization functions at the
  boundary over optimistic assumptions hidden behind casts, "optional treated as always present",
  or broad defaulting that erases meaning.
- Preserve uncertainty honestly — do not invent certainty where the API is unclear; record the
  open question.
- **Separate transport shape from domain/UI shape** when field names or nullability are awkward, the
  same data is consumed widely, or a narrow model reduces caller branching. Use raw transport types
  when the shape is already close to usage and mapping adds no clarity. Name mappers
  `mapXDtoToX` / `mapXToXDto`.
- One clear response shape per endpoint outcome family; do not reuse a schema across routes whose
  contracts can evolve independently.
- Do not return raw ORM/database records as public contracts by default.
- Do not merge validation failures and business-rule failures into one vague response.
- **TS / Zod stacks** — treat Zod schemas as first-class contract artifacts; response schemas for
  API-visible payloads; TypeScript types aligned with the runtime schemas at trust boundaries;
  schema ownership and reuse intentional.

## Escalation

A contract change that affects other consumers or has unclear backward compatibility raises this
lens to `review-elevated` and warrants an `architecture-advisor` consult.

## Output into the Step Record

Boundary modelled; compatibility assessment (`additive` / `compatible-change` / `breaking-change` /
unclear); request + success + error contract; mapping and nullability notes; risks / open questions
to confirm before implementation; suggested contract-level test coverage.
