import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import KanbanBoard from "./KanbanBoard";

import { useBoardFilterStore } from "@/store/boardFilterStore";
import { ADD_CARD_FORM_TEST_IDS } from "@/components/add-card-form/AddCardForm.testIds";
import { CARD_DETAIL_MODAL_TEST_IDS } from "@/components/card-detail-modal/CardDetailModal.testIds";
import { KANBAN_CARD_TEST_IDS } from "@/components/kanban-card/KanbanCard.testIds";
import { KANBAN_COLUMN_TEST_IDS } from "@/components/kanban-column/KanbanColumn.testIds";

import type { Board } from "@/schemas/board";

const initialBoard: Board = {
  columns: [
    { id: "todo", title: "To Do", cardIds: ["card-1", "card-2"] },
    { id: "done", title: "Done", cardIds: [] },
  ],
  cardsById: {
    "card-1": {
      id: "card-1",
      title: "Ship the demo",
      label: "feature",
      createdAt: "2026-01-05T09:00:00.000Z",
      notes: null,
      dueDate: null,
    },
    "card-2": {
      id: "card-2",
      title: "Write the docs",
      label: null,
      createdAt: "2026-01-06T09:00:00.000Z",
      notes: null,
      dueDate: null,
    },
  },
};

describe("KanbanBoard", () => {
  beforeEach(() => {
    useBoardFilterStore.setState({ activeLabel: null });
  });

  it("should move a card into the destination column when its move control changes", async () => {
    // Arrange
    render(<KanbanBoard initialBoard={initialBoard} />);
    const moveSelect = screen.getByTestId(KANBAN_CARD_TEST_IDS.moveSelect("card-1"));

    // Act
    fireEvent.change(moveSelect, { target: { value: "done" } });

    // Assert
    await waitFor(() => {
      const doneCards = screen.getByTestId(KANBAN_COLUMN_TEST_IDS.cardList("done"));
      expect(doneCards).toHaveTextContent("Ship the demo");
    });
  });

  it("should hide cards whose label does not match the active filter", () => {
    // Arrange
    useBoardFilterStore.setState({ activeLabel: "bug" });

    // Act
    render(<KanbanBoard initialBoard={initialBoard} />);

    // Assert
    expect(screen.queryByTestId(KANBAN_CARD_TEST_IDS.card("card-1"))).not.toBeInTheDocument();
  });

  it("should add a new card to a column via its add-card form", async () => {
    // Arrange
    render(<KanbanBoard initialBoard={initialBoard} />);
    const titleInput = screen.getByTestId(ADD_CARD_FORM_TEST_IDS.titleInput("done"));

    // Act
    fireEvent.change(titleInput, { target: { value: "Celebrate the release" } });
    fireEvent.submit(screen.getByTestId(ADD_CARD_FORM_TEST_IDS.form("done")));

    // Assert
    await waitFor(() => {
      const doneCards = screen.getByTestId(KANBAN_COLUMN_TEST_IDS.cardList("done"));
      expect(doneCards).toHaveTextContent("Celebrate the release");
    });
  });

  it("should reorder cards within a column when a move-down button is clicked", async () => {
    // Arrange
    render(<KanbanBoard initialBoard={initialBoard} />);
    const todoCards = screen.getByTestId(KANBAN_COLUMN_TEST_IDS.cardList("todo"));
    expect(todoCards).toHaveTextContent(/Ship the demo[\s\S]*Write the docs/);

    // Act
    fireEvent.click(screen.getByTestId(KANBAN_CARD_TEST_IDS.moveDownButton("card-1")));

    // Assert
    await waitFor(() => {
      expect(todoCards).toHaveTextContent(/Write the docs[\s\S]*Ship the demo/);
    });
  });

  it("should remove a card from the board when its delete button is clicked", async () => {
    // Arrange
    render(<KanbanBoard initialBoard={initialBoard} />);
    const deleteButton = screen.getByTestId(KANBAN_CARD_TEST_IDS.deleteButton("card-1"));

    // Act
    fireEvent.click(deleteButton);

    // Assert
    await waitFor(() => {
      expect(screen.queryByTestId(KANBAN_CARD_TEST_IDS.card("card-1"))).not.toBeInTheDocument();
    });
  });

  it("should open the card detail modal on double-click and persist notes and a due date on save", async () => {
    // Arrange: add a fresh card so this test doesn't depend on card state left over from other tests
    render(<KanbanBoard initialBoard={initialBoard} />);
    fireEvent.change(screen.getByTestId(ADD_CARD_FORM_TEST_IDS.titleInput("done")), {
      target: { value: "Review the modal copy" },
    });
    fireEvent.submit(screen.getByTestId(ADD_CARD_FORM_TEST_IDS.form("done")));
    await waitFor(() => {
      expect(screen.getByTestId(KANBAN_COLUMN_TEST_IDS.cardList("done"))).toHaveTextContent(
        "Review the modal copy",
      );
    });
    const newCardId = screen
      .getByTestId(KANBAN_COLUMN_TEST_IDS.cardList("done"))
      .querySelector("[data-id^='kanban-card-']")
      ?.getAttribute("data-id")
      ?.replace("kanban-card-", "");

    // Act
    fireEvent.doubleClick(screen.getByTestId(KANBAN_CARD_TEST_IDS.card(newCardId as string)));
    fireEvent.change(screen.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.notesInput), {
      target: { value: "Check with design" },
    });
    fireEvent.change(screen.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.dueDateInput), {
      target: { value: "2026-02-01" },
    });
    fireEvent.click(screen.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.saveButton));

    // Assert
    await waitFor(() => {
      expect(screen.queryByTestId(CARD_DETAIL_MODAL_TEST_IDS.dialog)).not.toBeInTheDocument();
    });
    fireEvent.doubleClick(screen.getByTestId(KANBAN_CARD_TEST_IDS.card(newCardId as string)));
    await waitFor(() => {
      expect(screen.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.notesInput)).toHaveValue("Check with design");
    });
    expect(screen.getByTestId(CARD_DETAIL_MODAL_TEST_IDS.dueDateInput)).toHaveValue("2026-02-01");
  });
});
