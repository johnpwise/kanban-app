import { describe, expect, it } from "vitest";

import { parseExecutorConfig } from "./config";

describe("parseExecutorConfig", () => {
  it("accepts a valid ADA_EXECUTION_RUN_ID", () => {
    // Arrange
    const env = { ADA_EXECUTION_RUN_ID: "run-123" };

    // Act
    const result = parseExecutorConfig(env);

    // Assert
    expect(result).toEqual({ executionRunId: "run-123" });
  });

  it("rejects a missing ADA_EXECUTION_RUN_ID", () => {
    // Arrange
    const env = {};

    // Act
    const act = () => parseExecutorConfig(env);

    // Assert
    expect(act).toThrow();
  });

  it("rejects a blank ADA_EXECUTION_RUN_ID", () => {
    // Arrange
    const env = { ADA_EXECUTION_RUN_ID: "   " };

    // Act
    const act = () => parseExecutorConfig(env);

    // Assert
    expect(act).toThrow();
  });

  it("rejects an invalid Firestore document ID (contains a slash)", () => {
    // Arrange
    const env = { ADA_EXECUTION_RUN_ID: "run/123" };

    // Act
    const act = () => parseExecutorConfig(env);

    // Assert
    expect(act).toThrow();
  });

  it("rejects a Firestore document ID of exactly '.'", () => {
    // Arrange
    const env = { ADA_EXECUTION_RUN_ID: "." };

    // Act
    const act = () => parseExecutorConfig(env);

    // Assert
    expect(act).toThrow();
  });

  it("does not require any credential fields to be present", () => {
    // Arrange
    const env = { ADA_EXECUTION_RUN_ID: "run-123" };

    // Act
    const result = parseExecutorConfig(env);

    // Assert
    expect(Object.keys(result)).toEqual(["executionRunId"]);
  });
});
