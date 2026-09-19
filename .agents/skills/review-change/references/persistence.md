# Persistence and transaction lens

Runs when repository behaviour, query shapes, multi-entity writes, or transaction guarantees change
or are risky — repositories/data-access modules, ORM models/mappings, transactions, multi-write
flows, concurrency-sensitive logic, read/write performance assumptions. Protect correctness before
optimization.

## Review order

1. **Correctness** — reads and writes do the right thing; not-found, duplicate/conflict, and
   stale-data cases handled intentionally.
2. **Transaction safety** — logically atomic changes commit together; partial success cannot leave
   invalid state; retry/idempotency implications understood for non-idempotent writes; transaction
   ownership clear between service and repository layers.
3. **Boundary fit** — persistence logic isolated appropriately; services delegate persistence
   details rather than embedding them; persistence shapes mapped before reaching API responses;
   repository inputs/outputs typed without leaking storage-specific details.
4. **Query intent** — filters, joins/includes, ordering, and pagination intentional; assumptions
   about selected columns, nullable fields, and relation presence explicit; no accidental
   N+1-style access or repeated lookup churn.
5. **Resource handling** — connections, clients, cursors, and transactions cleaned up correctly.
6. **Performance sanity** — flag obviously expensive or repeated work; do not recommend speculative
   optimization without a concrete risk.

## Output into the Step Record

Status (`approve` / `approve-with-notes` / `changes-required`); correctness risks; transaction /
consistency risks; query / performance notes (concrete risks only); persistence- or
transaction-sensitive test gaps.
