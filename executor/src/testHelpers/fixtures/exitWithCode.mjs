/**
 * Deterministic local fixture for `processCodingAgentRuntime.integration.test.ts`. Drains stdin
 * (so the parent's write never sees EPIPE), then exits with the code given as argv[2].
 */

process.stdin.on("data", () => {});
process.stdin.on("end", () => {
  process.exit(Number(process.argv[2]));
});
