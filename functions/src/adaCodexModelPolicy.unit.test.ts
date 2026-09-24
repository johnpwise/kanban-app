import { describe, expect, it } from "vitest";

import { AdaCodexModelConfigError, parseAdaCodexModelConfig } from "./adaCodexModelPolicy";

describe("parseAdaCodexModelConfig", () => {
  it("accepts an approved model with no reasoning effort configured", () => {
    // Arrange
    const input = { codexModel: "gpt-5_6-luna", codexReasoningEffort: "" };

    // Act
    const result = parseAdaCodexModelConfig(input);

    // Assert
    expect(result).toEqual({ codexModel: "gpt-5_6-luna", codexReasoningEffort: undefined });
  });

  it("accepts an approved model with an approved reasoning effort configured", () => {
    // Arrange
    const input = { codexModel: "gpt-5_6-terra", codexReasoningEffort: "high" };

    // Act
    const result = parseAdaCodexModelConfig(input);

    // Assert
    expect(result).toEqual({ codexModel: "gpt-5_6-terra", codexReasoningEffort: "high" });
  });

  it("rejects a missing/undefined model", () => {
    // Arrange
    const input = { codexModel: undefined, codexReasoningEffort: "" };

    // Act
    const act = () => parseAdaCodexModelConfig(input);

    // Assert
    expect(act).toThrow(AdaCodexModelConfigError);
  });

  it("rejects a blank model", () => {
    // Arrange
    const input = { codexModel: "   ", codexReasoningEffort: "" };

    // Act
    const act = () => parseAdaCodexModelConfig(input);

    // Assert
    expect(act).toThrow(AdaCodexModelConfigError);
  });

  it("rejects a model outside the approved allow-list", () => {
    // Arrange
    const input = { codexModel: "gpt-5_6-nova", codexReasoningEffort: "" };

    // Act
    const act = () => parseAdaCodexModelConfig(input);

    // Assert
    expect(act).toThrow(AdaCodexModelConfigError);
  });

  it("rejects a reasoning effort outside the approved allow-list", () => {
    // Arrange
    const input = { codexModel: "gpt-5_6-luna", codexReasoningEffort: "ultra" };

    // Act
    const act = () => parseAdaCodexModelConfig(input);

    // Assert
    expect(act).toThrow(AdaCodexModelConfigError);
  });
});
