export const KANBAN_CARD_TEST_IDS = {
  card: (cardId: string) => `kanban-card-${cardId}`,
  moveSelect: (cardId: string) => `kanban-card-move-${cardId}`,
  deleteButton: (cardId: string) => `kanban-card-delete-${cardId}`,
  moveUpButton: (cardId: string) => `kanban-card-move-up-${cardId}`,
  moveDownButton: (cardId: string) => `kanban-card-move-down-${cardId}`,
} as const;
