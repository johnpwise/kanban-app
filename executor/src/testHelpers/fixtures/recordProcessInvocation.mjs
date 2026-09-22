/**
 * Deterministic local fixture for `processCodingAgentRuntime.integration.test.ts`. Records the
 * process's own `cwd` and the raw plain-text payload it receives on stdin (a real CLI coding-agent
 * provider reads stdin as literal prompt text, not JSON) to the output file given as argv[2], then
 * exits 0. Never touches the network or any AI provider.
 */

import { writeFileSync } from "node:fs";

const outputPath = process.argv[2];
const chunks = [];

process.stdin.on("data", (chunk) => {
  chunks.push(chunk);
});

process.stdin.on("end", () => {
  const stdinPayload = Buffer.concat(chunks).toString("utf8");
  writeFileSync(outputPath, JSON.stringify({ cwd: process.cwd(), stdinPayload }));
  process.exit(0);
});
