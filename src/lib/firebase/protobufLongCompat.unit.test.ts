import { describe, expect, it, vi } from "vitest";

describe("protobufLongCompat", () => {
  it("should clear protobufjs's shared util.Long", async () => {
    // Arrange
    vi.resetModules();
    const { util: pristineUtil } = await import("protobufjs/minimal");
    expect(pristineUtil.Long).toBeDefined();

    // Act
    await import("@/lib/firebase/protobufLongCompat");
    const { util: patchedUtil } = await import("protobufjs/minimal");

    // Assert
    expect(patchedUtil.Long).toBeUndefined();
  });

  it("should make protobufjs treat 64-bit integer fields as plain numbers instead of Long instances, since Long instances are identified by a constructor.name check that Next.js's production minifier breaks", async () => {
    // Arrange
    vi.resetModules();
    await import("@/lib/firebase/protobufLongCompat");
    const { Field } = await import("protobufjs/light");

    // Act
    const int64Field = new Field("position", 1, "int64");

    // Assert
    expect(int64Field.long).toBe(false);
  });
});
