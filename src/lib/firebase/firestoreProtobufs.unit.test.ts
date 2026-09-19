import { describe, expect, it, vi } from "vitest";

import { prepareFirestoreProtobufTypes } from "@/lib/firebase/firestoreProtobufs";

describe("prepareFirestoreProtobufTypes", () => {
  it("should resolve the root and prepare every nested protobuf type", () => {
    // Arrange
    const firstType = { setup: vi.fn() };
    const nestedType = { setup: vi.fn() };
    const root = {
      resolveAll: vi.fn(),
      nestedArray: [firstType, { nestedArray: [nestedType] }],
    };

    // Act
    const preparedTypeCount = prepareFirestoreProtobufTypes(root);

    // Assert
    expect(root.resolveAll).toHaveBeenCalledOnce();
    expect(firstType.setup).toHaveBeenCalledOnce();
    expect(nestedType.setup).toHaveBeenCalledOnce();
    expect(preparedTypeCount).toBe(2);
  });
});
