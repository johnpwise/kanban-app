interface ProtobufReflectionObject {
  nestedArray?: readonly ProtobufReflectionObject[];
  setup?: () => unknown;
}

interface ProtobufRoot extends ProtobufReflectionObject {
  resolveAll: () => unknown;
}

function prepareNestedTypes(reflectionObject: ProtobufReflectionObject): number {
  let preparedTypeCount = 0;

  reflectionObject.setup?.();
  preparedTypeCount += reflectionObject.setup ? 1 : 0;

  for (const nestedObject of reflectionObject.nestedArray ?? []) {
    preparedTypeCount += prepareNestedTypes(nestedObject);
  }

  return preparedTypeCount;
}

export function prepareFirestoreProtobufTypes(root: ProtobufRoot): number {
  root.resolveAll();
  return prepareNestedTypes(root);
}
