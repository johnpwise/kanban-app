import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import CardDetailModal from "./CardDetailModal";
import { CARD_DETAIL_MODAL_TEST_IDS } from "./CardDetailModal.testIds";

const card = {
  id: "card-1",
  title: "Ship the demo",
  label: "feature" as const,
  createdAt: "2026-01-05T09:00:00.000Z",
  notes: "Existing notes",
  dueDate: "2026-02-01",
};

describe("CardDetailModal", () => {
  it("should render nothing when no card is provided", () => {
    // Act
    render(<CardDetailModal card={null} onClose={vi.fn()} onSave={vi.fn()} />);

    // Assert
    expect(screen.queryByTestId(CARD_DETAIL_MODAL_TEST_IDS.dialog)).not.toBeInTheDocument();
  });

  it("should show the card title, created date, notes, and due date when open", () => {
    // Act
    render(<CardDetailModal card={card} onClose={vi.fn()} onSave={vi.fn()} />);

    // Assert
    expect(screen.getByText("Ship the demo")).toBeVisible();
    expect(screen.getByText(/Created/)).toBeVisible();
    expect(screen.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.notesInput)).toHaveValue("Existing notes");
    expect(screen.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.dueDateInput)).toHaveValue("2026-02-01");
  });

  it("should call onSave with the edited notes and due date, then onClose, when Save is clicked", () => {
    // Arrange
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<CardDetailModal card={card} onClose={onClose} onSave={onSave} />);
    const notesInput = screen.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.notesInput);
    const dueDateInput = screen.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.dueDateInput);

    // Act
    fireEvent.change(notesInput, { target: { value: "Updated notes" } });
    fireEvent.change(dueDateInput, { target: { value: "2026-03-10" } });
    fireEvent.click(screen.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.saveButton));

    // Assert
    expect(onSave).toHaveBeenCalledWith("card-1", "Updated notes", "2026-03-10");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("should persist a cleared due date as null", () => {
    // Arrange
    const onSave = vi.fn();
    render(<CardDetailModal card={card} onClose={vi.fn()} onSave={onSave} />);
    const dueDateInput = screen.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.dueDateInput);

    // Act
    fireEvent.change(dueDateInput, { target: { value: "" } });
    fireEvent.click(screen.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.saveButton));

    // Assert
    expect(onSave).toHaveBeenCalledWith("card-1", "Existing notes", null);
  });

  it("should call onClose without calling onSave when Cancel is clicked", () => {
    // Arrange
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<CardDetailModal card={card} onClose={onClose} onSave={onSave} />);

    // Act
    fireEvent.click(screen.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.cancelButton));

    // Assert
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("should call onClose when the Escape key is pressed", () => {
    // Arrange
    const onClose = vi.fn();
    render(<CardDetailModal card={card} onClose={onClose} onSave={vi.fn()} />);

    // Act
    fireEvent.keyDown(document, { key: "Escape" });

    // Assert
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("should call onClose when the overlay is clicked", () => {
    // Arrange
    const onClose = vi.fn();
    render(<CardDetailModal card={card} onClose={onClose} onSave={vi.fn()} />);

    // Act
    fireEvent.click(screen.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.dialog).parentElement as HTMLElement);

    // Assert
    expect(onClose).toHaveBeenCalledOnce();
  });
});
