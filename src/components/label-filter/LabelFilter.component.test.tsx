import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import LabelFilter from "./LabelFilter";

import { useBoardFilterStore } from "@/store/boardFilterStore";

describe("LabelFilter", () => {
  beforeEach(() => {
    useBoardFilterStore.setState({ activeLabel: null });
  });

  it("should update the active label filter when a label is selected", () => {
    // Arrange
    render(<LabelFilter />);
    const select = screen.getByLabelText("Filter by label");

    // Act
    fireEvent.change(select, { target: { value: "bug" } });

    // Assert
    expect(useBoardFilterStore.getState().activeLabel).toBe("bug");
  });

  it("should clear the active label filter when 'All labels' is selected", () => {
    // Arrange
    useBoardFilterStore.setState({ activeLabel: "bug" });
    render(<LabelFilter />);
    const select = screen.getByLabelText("Filter by label");

    // Act
    fireEvent.change(select, { target: { value: "all" } });

    // Assert
    expect(useBoardFilterStore.getState().activeLabel).toBeNull();
  });
});
