import { create } from "zustand";

import type { CardLabel } from "@/schemas/board";

interface BoardFilterState {
  activeLabel: CardLabel | null;
  setActiveLabel: (label: CardLabel | null) => void;
}

export const useBoardFilterStore = create<BoardFilterState>((set) => ({
  activeLabel: null,
  setActiveLabel: (label) => set({ activeLabel: label }),
}));
