/**
 * Deterministic local fixture for `processCodingAgentRuntime.integration.test.ts`. Drains stdin,
 * then never exits on its own — used to prove the runtime adapter's timeout/kill behaviour.
 */

process.stdin.on("data", () => {});
setInterval(() => {}, 1_000_000_000);
