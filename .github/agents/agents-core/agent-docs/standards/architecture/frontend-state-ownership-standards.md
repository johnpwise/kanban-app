# frontend-state-ownership-standards.md

## Purpose

This document defines shared frontend state-ownership guidance for stacks that use frontend capability fields.

Use this as the canonical policy source for:
- `capability_owners.local_ui_state_owner`
- `capability_owners.shared_client_state_owner`
- `capability_owners.server_state_owner`
- `capability_owners.shared_client_state_tier` (frontend companion qualifier)

## Decision ladder

Ask these questions in order:

1. Is the state only needed by one component?
   - set `capability_owners.local_ui_state_owner` and keep it local

2. Is the state needed by multiple nearby descendants in one feature subtree?
   - set `capability_owners.shared_client_state_owner`
   - set `capability_owners.shared_client_state_tier: subtree`

3. Does the state coordinate behavior across distant features or pages?
   - set `capability_owners.shared_client_state_owner`
   - set `capability_owners.shared_client_state_tier: cross_feature`

4. Does the value originate remotely and need lifecycle handling?
   - set `capability_owners.server_state_owner` and use dedicated server-state handling

5. Is the value derived from existing state?
   - compute it instead of storing it where practical

Note: steps 2 and 3 intentionally use the same capability owner key. The tier qualifier distinguishes subtree-scoped sharing from broader cross-feature sharing.

## Tier qualifier semantics

When `capability_owners.shared_client_state_owner` is present in frontend slices, include:
- `capability_owners.shared_client_state_tier: subtree | cross_feature`

Value meanings:
- `subtree`: ownership is scoped to one feature tree (for example React/Next.js context/lifted tree state or Vue provide/inject/lifted tree state)
- `cross_feature`: ownership spans distant routes, pages, or features and needs broader client-state coordination

Enforcement:
- required for new or updated frontend implementation slices and frontend specialist handoffs
- not retroactive for existing workflow artifacts created before this policy

## Rules of thumb

Prefer local state when possible because:
- ownership is obvious
- testing is simpler
- coordination cost stays low

Use broader client state only when it buys something concrete:
- cross-page continuity
- synchronized distant consumers
- durable UI/app-level preferences
- global session-ish client behavior

Avoid:
- multiple writable sources of truth
- copying fetched server data into client stores by habit
- globalizing modal, filter, or form state prematurely
- storing simple derivations that can drift from source data

Concrete package choices for these ownership capabilities belong in stack packs and repo-local overlays.
