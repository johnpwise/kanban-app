# css-coding-standards.md

## Purpose

This document defines reusable CSS policy for frontend work generated under this stack pack.

Use this guidance for any CSS file in scope, including global styles (for example `src/app/globals.css`), feature styles, and component-local styles where directives are used.

## Directive ordering contract

When a stylesheet uses Tailwind CSS v4 directives, enforce this exact top-level order:

1. all `@import` rules first
2. then `@source` (only when scanning class names outside the default detection, for example a
   package under `node_modules` that ships Tailwind-scanned markup)
3. then `@plugin`
4. then `@custom-variant`

Rationale:
- PostCSS enforces `@import` precedence and requires imports before other statements.
- Tailwind v4's CSS-first configuration (`@theme`, `@plugin`, `@custom-variant`) reads top to bottom;
  keeping directives grouped in this order keeps build behavior deterministic regardless of which
  Next.js loader processes the file.

## Additional rules

- keep directive ordering deterministic and consistent across files to avoid environment-dependent build behavior
- do not interleave non-directive selectors between these top-level directives
- when updating existing files, normalize directive order to this contract as part of the change
- do not copy Vite application configuration or Vite-relative import paths (`../node_modules/...`)
  into this stack; Next.js resolves Tailwind CSS-first configuration and any plugin CSS from package
  exports, not relative `node_modules` paths
