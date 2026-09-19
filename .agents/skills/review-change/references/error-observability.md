# Error handling and observability lens

Runs when error mapping, retries/timeouts/fallbacks, logging quality, metrics, or traces change or
are risky — error paths, middleware chains, downstream dependency integration, structured logging,
metrics/tracing hooks. Review whether the change fails predictably, surfaces useful diagnostics, and
matches the repo's operational conventions.

## Check for

1. Expected failure modes handled intentionally, with structured application errors for expected
   failure modes.
2. Public error responses consistent and safe — client-safe responses separated from internal
   diagnostics; no stack traces or sensitive internals leaked; no raw validation-library errors
   leaked without shaping.
3. Internal diagnostics useful without leaking sensitive detail — structured logs around dependency
   failures and decision boundaries; correlation/request identifiers where the repo supports them.
4. One obvious error-mapping path per request flow; consistent status-code mapping for the same
   class of problem.
5. Explicit timeout/retry behaviour when external dependencies are involved.
6. Async route handlers cannot bypass the error middleware.

## Flag

`catch` blocks that hide failures; inconsistent status codes for the same class of problem;
sensitive internals leaking to clients; missing logs on important failure boundaries; duplicated
error-serialization logic; swallowed, duplicated, or misclassified errors.

## Output into the Step Record

Reliability assessment (`healthy` / `acceptable-with-notes` / `needs-correction`); error-handling
findings; observability findings; smallest meaningful adjustments.
