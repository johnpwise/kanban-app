import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import LabelFilter from "./LabelFilter";

describe("LabelFilter", () => {
  it("should update the active label filter when a label is selected", () => {
    // Arrange
    const onChange = vi.fn();
    render(<LabelFilter activeLabel={null} onChange={onChange} />);
    const select = screen.getByLabelText("Filter by label");

    // Act
    fireEvent.change(select, { target: { value: "bug" } });

    // Assert
    expect(onChange).toHaveBeenCalledWith("bug");
  });

  it("should clear the active label filter when 'All labels' is selected", () => {
    // Arrange
    const onChange = vi.fn();
    render(<LabelFilter activeLabel="bug" onChange={onChange} />);
    const select = screen.getByLabelText("Filter by label");

    // Act
    fireEvent.change(select, { target: { value: "all" } });

    // Assert
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
