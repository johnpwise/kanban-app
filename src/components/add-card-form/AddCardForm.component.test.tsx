import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AddCardForm from "./AddCardForm";
import { ADD_CARD_FORM_TEST_IDS } from "./AddCardForm.testIds";

describe("AddCardForm", () => {
  it("should call onAddCard with the entered title, label, and prompt, then clear the form", () => {
    // Arrange
    const onAddCard = vi.fn();
    render(<AddCardForm columnId="todo" onAddCard={onAddCard} />);
    const titleInput = screen.getByTestId(ADD_CARD_FORM_TEST_IDS.titleInput("todo"));
    const labelSelect = screen.getByTestId(ADD_CARD_FORM_TEST_IDS.labelSelect("todo"));
    const promptInput = screen.getByTestId(ADD_CARD_FORM_TEST_IDS.promptInput("todo"));

    // Act
    fireEvent.change(titleInput, { target: { value: "Write release notes" } });
    fireEvent.change(labelSelect, { target: { value: "chore" } });
    fireEvent.change(promptInput, { target: { value: "Draft the release notes for v1.2." } });
    fireEvent.submit(screen.getByTestId(ADD_CARD_FORM_TEST_IDS.form("todo")));

    // Assert
    expect(onAddCard).toHaveBeenCalledWith("Write release notes", "chore", "Draft the release notes for v1.2.");
    expect(titleInput).toHaveValue("");
    expect(promptInput).toHaveValue("");
  });

  it("should not call onAddCard when the title is blank", () => {
    // Arrange
    const onAddCard = vi.fn();
    render(<AddCardForm columnId="todo" onAddCard={onAddCard} />);
    const promptInput = screen.getByTestId(ADD_CARD_FORM_TEST_IDS.promptInput("todo"));

    // Act
    fireEvent.change(promptInput, { target: { value: "Draft the release notes for v1.2." } });
    fireEvent.submit(screen.getByTestId(ADD_CARD_FORM_TEST_IDS.form("todo")));

    // Assert
    expect(onAddCard).not.toHaveBeenCalled();
  });

  it("should not call onAddCard when the prompt is blank", () => {
    // Arrange
    const onAddCard = vi.fn();
    render(<AddCardForm columnId="todo" onAddCard={onAddCard} />);
    const titleInput = screen.getByTestId(ADD_CARD_FORM_TEST_IDS.titleInput("todo"));

    // Act
    fireEvent.change(titleInput, { target: { value: "Write release notes" } });
    fireEvent.submit(screen.getByTestId(ADD_CARD_FORM_TEST_IDS.form("todo")));

    // Assert
    expect(onAddCard).not.toHaveBeenCalled();
  });
});
