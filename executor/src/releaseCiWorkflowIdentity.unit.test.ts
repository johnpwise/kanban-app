import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseReleaseCiRunIdentity } from "./releaseCiObservation";

/**
 * Static, no-YAML-parser verification that `.github/workflows/ci.yml`'s `run-name` contract stays
 * cross-consistent with `parseReleaseCiRunIdentity` — the parser and the emitting expression must
 * never silently drift apart. Deliberately does not add a YAML-parsing dependency: the workflow
 * file's `run-name:` line is a single literal string GitHub Actions passes through its own `${{ }}`
 * expression evaluator; this test locates that line by regex and simulates the evaluator's
 * substitution with sample `pull_request` event values, then feeds the result through the real
 * parser used at observation time.
 */
const CI_YML_PATH = join(__dirname, "..", "..", ".github", "workflows", "ci.yml");

const RUN_NAME_LINE_PATTERN = /^run-name:\s*"([^"]*)"\s*$/m;

const EXPECTED_EXPRESSION_ORDER = [
  "${{ github.event.pull_request.number }}",
  "${{ github.event.pull_request.base.ref }}",
  "${{ github.event.pull_request.head.ref }}",
  "${{ github.event.pull_request.head.sha }}",
];

function renderSampleRunName(template: string): string {
  const sampleValues = ["64", "main", "release/0.1.1", "c".repeat(40)];
  return EXPECTED_EXPRESSION_ORDER.reduce(
    (rendered, expression, index) => rendered.replaceAll(expression, sampleValues[index]),
    template,
  );
}

describe("ci.yml release CI run-name identity contract", () => {
  it("should declare a run-name line built only from trusted pull_request event context, in the exact field order the parser expects", () => {
    // Arrange
    const workflowSource = readFileSync(CI_YML_PATH, "utf8");

    // Act
    const match = RUN_NAME_LINE_PATTERN.exec(workflowSource);

    // Assert
    expect(match).not.toBeNull();
    const template = match![1];
    for (const expression of EXPECTED_EXPRESSION_ORDER) {
      expect(template).toContain(expression);
    }
    expect(template.indexOf(EXPECTED_EXPRESSION_ORDER[0])).toBeLessThan(template.indexOf(EXPECTED_EXPRESSION_ORDER[1]));
    expect(template.indexOf(EXPECTED_EXPRESSION_ORDER[1])).toBeLessThan(template.indexOf(EXPECTED_EXPRESSION_ORDER[2]));
    expect(template.indexOf(EXPECTED_EXPRESSION_ORDER[2])).toBeLessThan(template.indexOf(EXPECTED_EXPRESSION_ORDER[3]));
    expect(template).not.toMatch(/pull_request\.(title|body)/);
  });

  it("should render, once GitHub substitutes sample pull_request event values, into a string the real parser accepts", () => {
    // Arrange
    const workflowSource = readFileSync(CI_YML_PATH, "utf8");
    const template = RUN_NAME_LINE_PATTERN.exec(workflowSource)![1];

    // Act
    const rendered = renderSampleRunName(template);
    const identity = parseReleaseCiRunIdentity(rendered);

    // Assert
    expect(identity).toEqual({ prNumber: 64, baseBranch: "main", headBranch: "release/0.1.1", headSha: "c".repeat(40) });
  });

  it("should preserve the existing pull_request trigger branches and all three job gates unweakened", () => {
    // Arrange
    const workflowSource = readFileSync(CI_YML_PATH, "utf8");

    // Assert
    expect(workflowSource).toMatch(/branches:\s*\n\s*- develop\s*\n\s*- main/);
    for (const job of ["app", "functions", "executor"]) {
      expect(workflowSource).toContain(`${job}:\n`);
    }
    expect(workflowSource).toContain("npm run lint");
    expect(workflowSource).toContain("npm run build");
    expect(workflowSource).toContain("npm run test:unit");
    expect(workflowSource).toContain("npm run test:component");
    expect(workflowSource).toContain("npm run typecheck");
  });
});
