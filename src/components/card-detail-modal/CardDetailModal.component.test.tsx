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
  prompt: "Ship the demo build.",
  executionStatus: "not_started" as const,
  createdBy: "user-1",
  updatedAt: "2026-01-05T09:00:00.000Z",
};

function renderModal(overrides: Partial<React.ComponentProps<typeof CardDetailModal>> = {}) {
  return render(
    <CardDetailModal
      card={card}
      onClose={vi.fn()}
      onSave={vi.fn()}
      onStartExecution={vi.fn()}
      isStartingExecution={false}
      startExecutionError={null}
      {...overrides}
    />,
  );
}

describe("CardDetailModal", () => {
  it("should render nothing when no card is provided", () => {
    // Act
    renderModal({ card: null });

    // Assert
    expect(screen.queryByTestId(CARD_DETAIL_MODAL_TEST_IDS.dialog)).not.toBeInTheDocument();
  });

  it("should show the card title, created date, notes, and due date when open", () => {
    // Act
    renderModal();

    // Assert
    expect(screen.getByText("Ship the demo")).toBeVisible();
    expect(screen.getByText(/Created/)).toBeVisible();
    expect(screen.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.notesInput)).toHaveValue("Existing notes");
    expect(screen.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.dueDateInput)).toHaveValue("2026-02-01");
  });

  it("should display the ADA task prompt", () => {
    // Act
    renderModal();

    // Assert
    expect(screen.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.promptDisplay)).toHaveTextContent(
      "Ship the demo build.",
    );
  });

  it("should display the execution status as a human-readable value", () => {
    // Act
    renderModal();

    // Assert
    expect(screen.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.executionStatusBadge)).toHaveTextContent(
      "Not Started",
    );
  });

  it("should format each execution status as a human-readable value", () => {
    // Arrange
    const statuses = [
      { executionStatus: "queued" as const, expected: "Queued" },
      { executionStatus: "planning" as const, expected: "Planning" },
      { executionStatus: "implementing" as const, expected: "Implementing" },
      { executionStatus: "testing" as const, expected: "Testing" },
      { executionStatus: "creating_pr" as const, expected: "Creating PR" },
      { executionStatus: "completed" as const, expected: "Completed" },
      { executionStatus: "failed" as const, expected: "Failed" },
      { executionStatus: "cancelled" as const, expected: "Cancelled" },
    ];

    statuses.forEach(({ executionStatus, expected }) => {
      // Act
      const { unmount } = renderModal({ card: { ...card, executionStatus } });

      // Assert
      expect(screen.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.executionStatusBadge)).toHaveTextContent(expected);
      unmount();
    });
  });

  it("should call onSave with the edited notes and due date, then onClose, when Save is clicked", () => {
    // Arrange
    const onSave = vi.fn();
    const onClose = vi.fn();
    renderModal({ onSave, onClose });
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
    renderModal({ onSave });
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
    renderModal({ onSave, onClose });

    // Act
    fireEvent.click(screen.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.cancelButton));

    // Assert
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("should call onClose when the Escape key is pressed", () => {
    // Arrange
    const onClose = vi.fn();
    renderModal({ onClose });

    // Act
    fireEvent.keyDown(document, { key: "Escape" });

    // Assert
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("should call onClose when the overlay is clicked", () => {
    // Arrange
    const onClose = vi.fn();
    renderModal({ onClose });

    // Act
    fireEvent.click(screen.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.dialog).parentElement as HTMLElement);

    // Assert
    expect(onClose).toHaveBeenCalledOnce();
  });

  describe("Start ADA Work control", () => {
    it("should show the Start ADA Work control when the card has not started", () => {
      // Act
      renderModal();

      // Assert
      expect(screen.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.startExecutionButton)).toBeVisible();
    });

    it("should not show the Start ADA Work control for any other execution status", () => {
      // Arrange
      const statuses = [
        "queued",
        "planning",
        "implementing",
        "testing",
        "creating_pr",
        "completed",
        "failed",
        "cancelled",
      ] as const;

      statuses.forEach((executionStatus) => {
        // Act
        const { unmount } = renderModal({ card: { ...card, executionStatus } });

        // Assert
        expect(screen.queryByTestId(CARD_DETAIL_MODAL_TEST_IDS.startExecutionButton)).not.toBeInTheDocument();
        unmount();
      });
    });

    it("should call onStartExecution with the card id when Start ADA Work is clicked", () => {
      // Arrange
      const onStartExecution = vi.fn();
      renderModal({ onStartExecution });

      // Act
      fireEvent.click(screen.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.startExecutionButton));

      // Assert
      expect(onStartExecution).toHaveBeenCalledWith("card-1");
    });

    it("should disable the control and show Starting… while the request is pending", () => {
      // Act
      renderModal({ isStartingExecution: true });

      // Assert
      const button = screen.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.startExecutionButton);
      expect(button).toBeDisabled();
      expect(button).toHaveTextContent("Starting…");
    });

    it("should remove the control and show Queued once the card has started", () => {
      // Act
      renderModal({ card: { ...card, executionStatus: "queued" } });

      // Assert
      expect(screen.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.executionStatusBadge)).toHaveTextContent("Queued");
      expect(screen.queryByTestId(CARD_DETAIL_MODAL_TEST_IDS.startExecutionButton)).not.toBeInTheDocument();
    });

    it("should announce execution status changes to assistive tech, since the control unmounts on success", () => {
      // Act
      renderModal();

      // Assert
      expect(screen.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.executionStatusBadge)).toHaveAttribute(
        "aria-live",
        "polite",
      );
    });

    it("should not show a leftover board error before the control has been used", () => {
      // Act: a stale board-wide error is passed in, but Start was never clicked in this mount
      renderModal({ startExecutionError: "Could not move the card. Please try again." });

      // Assert
      expect(screen.queryByTestId(CARD_DETAIL_MODAL_TEST_IDS.startExecutionError)).not.toBeInTheDocument();
    });

    it("should allow retrying after a failed attempt", () => {
      // Arrange
      const onStartExecution = vi.fn();
      const { rerender } = render(
        <CardDetailModal
          card={card}
          onClose={vi.fn()}
          onSave={vi.fn()}
          onStartExecution={onStartExecution}
          isStartingExecution={false}
          startExecutionError={null}
        />,
      );
      fireEvent.click(screen.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.startExecutionButton));

      // Act: the parent reports the failure
      rerender(
        <CardDetailModal
          card={card}
          onClose={vi.fn()}
          onSave={vi.fn()}
          onStartExecution={onStartExecution}
          isStartingExecution={false}
          startExecutionError="Could not start ADA work. Please try again."
        />,
      );

      // Assert
      expect(screen.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.startExecutionError)).toHaveTextContent(
        "Could not start ADA work. Please try again.",
      );
      expect(screen.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.executionStatusBadge)).toHaveTextContent(
        "Not Started",
      );
      const button = screen.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.startExecutionButton);
      expect(button).not.toBeDisabled();

      fireEvent.click(button);
      expect(onStartExecution).toHaveBeenCalledTimes(2);
    });
  });
});
