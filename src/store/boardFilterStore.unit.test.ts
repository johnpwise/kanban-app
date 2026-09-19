import { beforeEach, describe, expect, it } from "vitest";

import { useBoardFilterStore } from "./boardFilterStore";

describe("useBoardFilterStore", () => {
  beforeEach(() => {
    useBoardFilterStore.setState({ activeLabel: null });
  });

  it("should set and clear the active label filter", () => {
    // Arrange
    const { setActiveLabel } = useBoardFilterStore.getState();

    // Act
    setActiveLabel("bug");

    // Assert
    expect(useBoardFilterStore.getState().activeLabel).toBe("bug");

    // Act
    setActiveLabel(null);

    // Assert
    expect(useBoardFilterStore.getState().activeLabel).toBeNull();
  });
});
