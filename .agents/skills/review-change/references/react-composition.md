# Composition lens — React

Runs when the diff adds or reshapes components, hooks, context, or a shared abstraction. Review
component boundaries, props shape, hook extraction, and reuse decisions so the code stays readable
without drifting into premature abstraction. Preserve working code unless a boundary change clearly
improves ownership, reuse, or clarity — not a refactor maximalist.

## Priorities

1. **Responsibility clarity** — does each component have a coherent job? Is render logic
   understandable?
2. **Boundary quality** — props meaningful and explicit; callback contracts narrow and clear;
   extractions create reusable seams rather than just moving code around.
3. **Hook discipline** — should the logic stay in the component? Does a custom hook earn its
   existence through reuse, complexity isolation, or testability?
4. **Abstraction discipline** — is a shared component actually shared? Is the API surface smaller
   or larger after abstraction? Has genericity appeared before repeated need?

## Smells to flag

- generic shared components created for a single call site
- custom hooks that merely relocate obvious local logic
- components with unclear input/output contracts
- props objects that hide weak typing or unclear ownership
- helper extraction that harms locality more than it helps reuse

## Output into the Step Record

Status (`solid` / `acceptable` / `needs-rework`); key findings with the smallest practical
correction; component/hook/prop boundary recommendations; any premature generalisation or hidden
complexity.
