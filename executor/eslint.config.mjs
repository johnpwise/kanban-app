import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["lib/**", "node_modules/**"],
  },
  {
    // Plain Node scripts spawned as real subprocesses by the process-runtime integration tests —
    // not TypeScript, so they need Node's runtime globals declared explicitly.
    files: ["src/testHelpers/fixtures/**/*.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
);
