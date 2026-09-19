import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import KanbanColumn from "./KanbanColumn";
import { KANBAN_COLUMN_TEST_IDS } from "./KanbanColumn.testIds";

import { ADD_CARD_FORM_TEST_IDS } from "@/components/add-card-form/AddCardForm.testIds";
import { KANBAN_CARD_TEST_IDS } from "@/components/kanban-card/KanbanCard.testIds";

const columns = [
  { id: "todo", title: "To Do", cardIds: ["card-1"] },
  { id: "done", title: "Done", cardIds: [] },
];

describe("KanbanColumn", () => {
  it("should render its cards and column title with a count", () => {
    // Arrange
    const cards = [
      { id: "card-1", title: "Ship the demo", label: null, createdAt: "2026-01-05T09:00:00.000Z", notes: null, dueDate: null },
    ];

    // Act
    render(
      <KanbanColumn
        column={columns[0]}
        cards={cards}
        columns={columns}
        onDropCard={vi.fn()}
        onMoveCard={vi.fn()}
        onAddCard={vi.fn()}
        onDeleteCard={vi.fn()}
        onReorderCard={vi.fn()}
        onOpenCard={vi.fn()}
      />,
    );

    // Assert
    expect(screen.getByRole("heading", { name: "To Do (1)" })).toBeVisible();
  });

  it("should call onDropCard with the dragged card id when a card is dropped", () => {
    // Arrange
    const onDropCard = vi.fn();
    render(
      <KanbanColumn
        column={columns[1]}
        cards={[]}
        columns={columns}
        onDropCard={onDropCard}
        onMoveCard={vi.fn()}
        onAddCard={vi.fn()}
        onDeleteCard={vi.fn()}
        onReorderCard={vi.fn()}
        onOpenCard={vi.fn()}
      />,
    );
    const dropZone = screen.getByTestId(KANBAN_COLUMN_TEST_IDS.column("done"));

    // Act
    fireEvent.drop(dropZone, { dataTransfer: { getData: () => "card-1" } });

    // Assert
    expect(onDropCard).toHaveBeenCalledWith("card-1", "done");
  });

  it("should call onAddCard with the column id when a new card is submitted", () => {
    // Arrange
    const onAddCard = vi.fn();
    render(
      <KanbanColumn
        column={columns[0]}
        cards={[]}
        columns={columns}
        onDropCard={vi.fn()}
        onMoveCard={vi.fn()}
        onAddCard={onAddCard}
        onDeleteCard={vi.fn()}
        onReorderCard={vi.fn()}
        onOpenCard={vi.fn()}
      />,
    );
    const titleInput = screen.getByTestId(ADD_CARD_FORM_TEST_IDS.titleInput("todo"));

    // Act
    fireEvent.change(titleInput, { target: { value: "Refill the snacks" } });
    fireEvent.submit(screen.getByTestId(ADD_CARD_FORM_TEST_IDS.form("todo")));

    // Assert
    expect(onAddCard).toHaveBeenCalledWith("todo", "Refill the snacks", null);
  });

  it("should call onDeleteCard with the card id when its delete button is clicked", () => {
    // Arrange
    const onDeleteCard = vi.fn();
    const cards = [
      { id: "card-1", title: "Ship the demo", label: null, createdAt: "2026-01-05T09:00:00.000Z", notes: null, dueDate: null },
    ];
    render(
      <KanbanColumn
        column={columns[0]}
        cards={cards}
        columns={columns}
        onDropCard={vi.fn()}
        onMoveCard={vi.fn()}
        onAddCard={vi.fn()}
        onDeleteCard={onDeleteCard}
        onReorderCard={vi.fn()}
        onOpenCard={vi.fn()}
      />,
    );

    // Act
    fireEvent.click(screen.getByTestId(KANBAN_CARD_TEST_IDS.deleteButton("card-1")));

    // Assert
    expect(onDeleteCard).toHaveBeenCalledWith("card-1");
  });

  it("should call onReorderCard with the card id and direction when a move button is clicked", () => {
    // Arrange
    const onReorderCard = vi.fn();
    const cards = [
      { id: "card-1", title: "Ship the demo", label: null, createdAt: "2026-01-05T09:00:00.000Z", notes: null, dueDate: null },
      { id: "card-2", title: "Write the docs", label: null, createdAt: "2026-01-06T09:00:00.000Z", notes: null, dueDate: null },
    ];
    const columnWithTwoCards = { id: "todo", title: "To Do", cardIds: ["card-1", "card-2"] };
    render(
      <KanbanColumn
        column={columnWithTwoCards}
        cards={cards}
        columns={columns}
        onDropCard={vi.fn()}
        onMoveCard={vi.fn()}
        onAddCard={vi.fn()}
        onDeleteCard={vi.fn()}
        onReorderCard={onReorderCard}
        onOpenCard={vi.fn()}
      />,
    );

    // Act
    fireEvent.click(screen.getByTestId(KANBAN_CARD_TEST_IDS.moveDownButton("card-1")));

    // Assert
    expect(onReorderCard).toHaveBeenCalledWith("card-1", "down");
  });

  it("should disable move-up for the first card and move-down for the last card", () => {
    // Arrange
    const cards = [
      { id: "card-1", title: "Ship the demo", label: null, createdAt: "2026-01-05T09:00:00.000Z", notes: null, dueDate: null },
      { id: "card-2", title: "Write the docs", label: null, createdAt: "2026-01-06T09:00:00.000Z", notes: null, dueDate: null },
    ];
    const columnWithTwoCards = { id: "todo", title: "To Do", cardIds: ["card-1", "card-2"] };

    // Act
    render(
      <KanbanColumn
        column={columnWithTwoCards}
        cards={cards}
        columns={columns}
        onDropCard={vi.fn()}
        onMoveCard={vi.fn()}
        onAddCard={vi.fn()}
        onDeleteCard={vi.fn()}
        onReorderCard={vi.fn()}
        onOpenCard={vi.fn()}
      />,
    );

    // Assert
    expect(screen.getByTestId(KANBAN_CARD_TEST_IDS.moveUpButton("card-1"))).toBeDisabled();
    expect(screen.getByTestId(KANBAN_CARD_TEST_IDS.moveDownButton("card-2"))).toBeDisabled();
    expect(screen.getByTestId(KANBAN_CARD_TEST_IDS.moveDownButton("card-1"))).toBeEnabled();
    expect(screen.getByTestId(KANBAN_CARD_TEST_IDS.moveUpButton("card-2"))).toBeEnabled();
  });
});
