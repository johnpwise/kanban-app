#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = 1;
const LAYERS = ["unit", "component", "integration", "e2e"];
const PREIMPLEMENTATION_LAYERS = new Set(["unit", "component", "integration"]);
const SLICE_STATUSES = [
  "intake",
  "planned",
  "red",
  "implementation-ready",
  "implementing",
  "verifying",
  "ready-for-closeout",
  "closed",
];
const STAGES = new Set(["progressive", "planned", "implementation-ready", "closeout"]);
const TOP_LEVEL_FIELDS = new Set([
  "updatedAt",
  "status",
  "objective",
  "complexity",
  "acceptanceCriteria",
  "scope",
  "observations",
  "provenance",
  "approvals",
  "capabilityOwners",
  "testMatrix",
  "increments",
  "tests",
  "expectedRedEvidence",
  "verification",
  "e2eStatus",
  "schemaVersion",
  "sliceId",
  "workflowId",
  "kind",
  "revision",
  "createdAt",
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isCanonicalTimestamp(value) {
  if (!isNonEmptyString(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function addError(errors, condition, message) {
  if (!condition) errors.push(message);
}

function validateIdRecords(errors, records, field) {
  if (!Array.isArray(records)) {
    errors.push(`${field} must be an array`);
    return new Set();
  }

  const ids = new Set();
  records.forEach((record, index) => {
    if (!isObject(record)) {
      errors.push(`${field}[${index}] must be an object`);
      return;
    }
    if (!isNonEmptyString(record.id)) {
      errors.push(`${field}[${index}].id must be a non-empty string`);
      return;
    }
    if (ids.has(record.id)) errors.push(`${field} contains duplicate id ${record.id}`);
    ids.add(record.id);
  });
  return ids;
}

function validateProvenanceReference(errors, reference, field, provenanceIds) {
  addError(errors, isNonEmptyString(reference), `${field}.provenanceRef must be a non-empty string`);
  if (isNonEmptyString(reference) && !provenanceIds.has(reference)) {
    errors.push(`${field}.provenanceRef ${reference} does not exist`);
  }
}

function validateStatementRecords(errors, records, field, provenanceIds) {
  validateIdRecords(errors, records, field);
  if (!Array.isArray(records)) return;
  records.forEach((record, index) => {
    if (!isObject(record)) return;
    addError(errors, isNonEmptyString(record.statement), `${field}[${index}].statement must be a non-empty string`);
    validateProvenanceReference(errors, record.provenanceRef, `${field}[${index}]`, provenanceIds);
  });
}

function validateProgressiveStructure(spec, errors) {
  addError(errors, isObject(spec), "slice spec must be an object");
  if (!isObject(spec)) return;

  Object.keys(spec).forEach((field) => {
    if (!TOP_LEVEL_FIELDS.has(field)) errors.push(`slice spec contains unknown field ${field}`);
  });

  addError(errors, spec.schemaVersion === SCHEMA_VERSION, `schemaVersion must be ${SCHEMA_VERSION}`);
  addError(errors, isNonEmptyString(spec.sliceId), "sliceId must be a non-empty string");
  addError(errors, isNonEmptyString(spec.workflowId), "workflowId must be a non-empty string");
  addError(errors, ["feature", "bug"].includes(spec.kind), "kind must be feature or bug");
  addError(errors, Number.isInteger(spec.revision) && spec.revision >= 1, "revision must be an integer >= 1");
  addError(errors, SLICE_STATUSES.includes(spec.status), `status must be one of: ${SLICE_STATUSES.join(", ")}`);
  addError(errors, isCanonicalTimestamp(spec.createdAt), "createdAt must be a canonical UTC ISO-8601 timestamp");
  addError(errors, isCanonicalTimestamp(spec.updatedAt), "updatedAt must be a canonical UTC ISO-8601 timestamp");
  if (isCanonicalTimestamp(spec.createdAt) && isCanonicalTimestamp(spec.updatedAt)) {
    addError(errors, spec.updatedAt >= spec.createdAt, "updatedAt must not precede createdAt");
  }

  const provenanceIds = validateIdRecords(errors, spec.provenance, "provenance");
  if (Array.isArray(spec.provenance)) {
    spec.provenance.forEach((entry, index) => {
      if (!isObject(entry)) return;
      addError(errors, ["user", "inferred", "repository", "approval"].includes(entry.sourceType), `provenance[${index}].sourceType is invalid`);
      addError(errors, isNonEmptyString(entry.source), `provenance[${index}].source must be a non-empty string`);
      addError(errors, isCanonicalTimestamp(entry.capturedAt), `provenance[${index}].capturedAt must be a canonical UTC ISO-8601 timestamp`);
      addError(errors, isNonEmptyString(entry.capturedBy), `provenance[${index}].capturedBy must be a non-empty string`);
    });
  }

  addError(errors, isObject(spec.objective), "objective must be an object");
  if (isObject(spec.objective)) {
    addError(errors, isNonEmptyString(spec.objective.statement), "objective.statement must be a non-empty string");
    validateProvenanceReference(errors, spec.objective.provenanceRef, "objective", provenanceIds);
  }

  if (spec.complexity !== undefined) {
    addError(errors, isObject(spec.complexity), "complexity must be an object when present");
    if (isObject(spec.complexity)) {
      addError(errors, ["trivial", "non-trivial"].includes(spec.complexity.classification), "complexity.classification must be trivial or non-trivial");
      addError(errors, isNonEmptyString(spec.complexity.rationale), "complexity.rationale must be a non-empty string");
      validateProvenanceReference(errors, spec.complexity.provenanceRef, "complexity", provenanceIds);
    }
  }

  validateStatementRecords(errors, spec.acceptanceCriteria, "acceptanceCriteria", provenanceIds);
  if (Array.isArray(spec.acceptanceCriteria)) {
    addError(errors, spec.acceptanceCriteria.length > 0, "acceptanceCriteria must not be empty");
  }

  addError(errors, isObject(spec.scope), "scope must be an object");
  if (isObject(spec.scope)) {
    validateStatementRecords(errors, spec.scope.in, "scope.in", provenanceIds);
    validateStatementRecords(errors, spec.scope.out, "scope.out", provenanceIds);
  }

  validateIdRecords(errors, spec.observations, "observations");
  if (Array.isArray(spec.observations)) {
    spec.observations.forEach((entry, index) => {
      if (!isObject(entry)) return;
      addError(errors, isNonEmptyString(entry.category), `observations[${index}].category must be a non-empty string`);
      addError(errors, isNonEmptyString(entry.statement), `observations[${index}].statement must be a non-empty string`);
      validateProvenanceReference(errors, entry.provenanceRef, `observations[${index}]`, provenanceIds);
    });
  }

  validateIdRecords(errors, spec.approvals, "approvals");
  if (Array.isArray(spec.approvals)) {
    spec.approvals.forEach((approval, approvalIndex) => {
      if (!isObject(approval)) return;
      addError(errors, isNonEmptyString(approval.boundary), `approvals[${approvalIndex}].boundary must be a non-empty string`);
      addError(errors, isNonEmptyString(approval.requirement), `approvals[${approvalIndex}].requirement must be a non-empty string`);
      validateProvenanceReference(errors, approval.provenanceRef, `approvals[${approvalIndex}]`, provenanceIds);
      validateIdRecords(errors, approval.decisions, `approvals[${approvalIndex}].decisions`);
      if (Array.isArray(approval.decisions)) {
        addError(errors, approval.decisions.length > 0, `approvals[${approvalIndex}].decisions must not be empty`);
        approval.decisions.forEach((decision, decisionIndex) => {
          if (!isObject(decision)) return;
          addError(errors, ["pending", "approved", "rejected", "deferred"].includes(decision.status), `approvals[${approvalIndex}].decisions[${decisionIndex}].status is invalid`);
          addError(errors, isNonEmptyString(decision.rationale), `approvals[${approvalIndex}].decisions[${decisionIndex}].rationale must be a non-empty string`);
          addError(errors, isNonEmptyString(decision.decidedBy), `approvals[${approvalIndex}].decisions[${decisionIndex}].decidedBy must be a non-empty string`);
          addError(errors, isCanonicalTimestamp(decision.decidedAt), `approvals[${approvalIndex}].decisions[${decisionIndex}].decidedAt must be a canonical UTC ISO-8601 timestamp`);
          validateProvenanceReference(errors, decision.provenanceRef, `approvals[${approvalIndex}].decisions[${decisionIndex}]`, provenanceIds);
        });
      }
    });
  }

  if (!Array.isArray(spec.capabilityOwners)) errors.push("capabilityOwners must be an array");
  const ownerKeys = new Set();
  if (Array.isArray(spec.capabilityOwners)) {
    spec.capabilityOwners.forEach((owner, index) => {
      if (!isObject(owner)) return;
      addError(errors, isNonEmptyString(owner.key), `capabilityOwners[${index}].key must be a non-empty string`);
      if (ownerKeys.has(owner.key)) errors.push(`capabilityOwners contains duplicate key ${owner.key}`);
      ownerKeys.add(owner.key);
      addError(errors, isNonEmptyString(owner.owner), `capabilityOwners[${index}].owner must be a non-empty string`);
      addError(errors, isNonEmptyString(owner.rationale), `capabilityOwners[${index}].rationale must be a non-empty string`);
      validateProvenanceReference(errors, owner.provenanceRef, `capabilityOwners[${index}]`, provenanceIds);
    });
  }

  addError(errors, isObject(spec.testMatrix), "testMatrix must be an object");
  if (isObject(spec.testMatrix)) {
    Object.entries(spec.testMatrix).forEach(([layer, entry]) => {
      if (!LAYERS.includes(layer)) errors.push(`testMatrix contains unknown layer ${layer}`);
      if (!isObject(entry)) {
        errors.push(`testMatrix.${layer} must be an object`);
        return;
      }
      addError(errors, ["required", "N/A"].includes(entry.requirement), `testMatrix.${layer}.requirement must be required or N/A`);
      addError(errors, isNonEmptyString(entry.rationale), `testMatrix.${layer}.rationale must be a non-empty string`);
      validateProvenanceReference(errors, entry.provenanceRef, `testMatrix.${layer}`, provenanceIds);
    });
  }

  const incrementIds = validateIdRecords(errors, spec.increments, "increments");
  const testIds = validateIdRecords(errors, spec.tests, "tests");
  const redIds = validateIdRecords(errors, spec.expectedRedEvidence, "expectedRedEvidence");
  const verificationIds = validateIdRecords(errors, spec.verification, "verification");
  void incrementIds;
  void redIds;

  if (Array.isArray(spec.tests)) {
    spec.tests.forEach((entry, index) => {
      if (!isObject(entry)) return;
      addError(errors, LAYERS.includes(entry.layer), `tests[${index}].layer is invalid`);
      addError(errors, isNonEmptyString(entry.description), `tests[${index}].description must be a non-empty string`);
      addError(errors, isNonEmptyString(entry.command), `tests[${index}].command must be a non-empty string`);
      addError(errors, typeof entry.preImplementation === "boolean", `tests[${index}].preImplementation must be boolean`);
      validateProvenanceReference(errors, entry.provenanceRef, `tests[${index}]`, provenanceIds);
    });
  }

  if (Array.isArray(spec.expectedRedEvidence)) {
    spec.expectedRedEvidence.forEach((entry, index) => {
      if (!isObject(entry)) return;
      addError(errors, testIds.has(entry.testId), `expectedRedEvidence[${index}].testId ${entry.testId} does not exist`);
      addError(errors, isNonEmptyString(entry.expectedFailure), `expectedRedEvidence[${index}].expectedFailure must be a non-empty string`);
      addError(errors, ["planned", "captured"].includes(entry.status), `expectedRedEvidence[${index}].status is invalid`);
      validateProvenanceReference(errors, entry.provenanceRef, `expectedRedEvidence[${index}]`, provenanceIds);
      if (entry.status === "captured") {
        addError(errors, isNonEmptyString(entry.command), `expectedRedEvidence[${index}].command is required when captured`);
        addError(errors, Number.isInteger(entry.exitCode) && entry.exitCode !== 0, `expectedRedEvidence[${index}].exitCode must be a non-zero integer when captured`);
        addError(errors, isNonEmptyString(entry.observedFailure), `expectedRedEvidence[${index}].observedFailure is required when captured`);
      }
    });
  }

  if (Array.isArray(spec.verification)) {
    spec.verification.forEach((entry, index) => {
      if (!isObject(entry)) return;
      addError(errors, LAYERS.includes(entry.layer), `verification[${index}].layer is invalid`);
      addError(errors, isNonEmptyString(entry.requirement), `verification[${index}].requirement must be a non-empty string`);
      addError(errors, ["planned", "passing", "failing", "N/A"].includes(entry.status), `verification[${index}].status is invalid`);
      validateProvenanceReference(errors, entry.provenanceRef, `verification[${index}]`, provenanceIds);
      if (["passing", "failing"].includes(entry.status)) {
        addError(errors, isNonEmptyString(entry.command), `verification[${index}].command is required after execution`);
        addError(errors, Number.isInteger(entry.exitCode), `verification[${index}].exitCode must be an integer after execution`);
        addError(errors, isNonEmptyString(entry.result), `verification[${index}].result is required after execution`);
      }
    });
  }

  if (Array.isArray(spec.increments)) {
    spec.increments.forEach((entry, index) => {
      if (!isObject(entry)) return;
      addError(errors, isNonEmptyString(entry.behavior), `increments[${index}].behavior must be a non-empty string`);
      addError(errors, isNonEmptyString(entry.doneWhen), `increments[${index}].doneWhen must be a non-empty string`);
      addError(errors, ["planned", "in-progress", "complete"].includes(entry.status), `increments[${index}].status is invalid`);
      for (const [field, validIds] of [["capabilityOwnerKeys", ownerKeys], ["testIds", testIds], ["verificationIds", verificationIds]]) {
        if (!Array.isArray(entry[field])) {
          errors.push(`increments[${index}].${field} must be an array`);
        } else {
          entry[field].forEach((id) => {
            if (!validIds.has(id)) errors.push(`increments[${index}].${field} references unknown ${id}`);
          });
        }
      }
      validateProvenanceReference(errors, entry.provenanceRef, `increments[${index}]`, provenanceIds);
    });
  }

  addError(errors, isObject(spec.e2eStatus), "e2eStatus must be an object");
  if (isObject(spec.e2eStatus)) {
    addError(errors, ["planned", "authored", "passing", "N/A"].includes(spec.e2eStatus.status), "e2eStatus.status is invalid");
    validateProvenanceReference(errors, spec.e2eStatus.provenanceRef, "e2eStatus", provenanceIds);
  }
}

function validatePlanned(spec, errors) {
  addError(errors, isObject(spec.complexity), "planned slice requires complexity classification");
  addError(errors, Array.isArray(spec.capabilityOwners) && spec.capabilityOwners.length > 0, "planned slice requires capabilityOwners");
  LAYERS.forEach((layer) => addError(errors, isObject(spec.testMatrix?.[layer]), `planned slice requires testMatrix.${layer}`));
  addError(errors, Array.isArray(spec.increments) && spec.increments.length > 0, "planned slice requires increments");
  addError(errors, Array.isArray(spec.verification) && spec.verification.length > 0, "planned slice requires verification");

  if (!Array.isArray(spec.tests) || !Array.isArray(spec.expectedRedEvidence)) return;
  const evidenceTestIds = new Set(spec.expectedRedEvidence.map(({ testId }) => testId));
  LAYERS.filter((layer) => PREIMPLEMENTATION_LAYERS.has(layer) && spec.testMatrix?.[layer]?.requirement === "required")
    .forEach((layer) => {
      const layerTests = spec.tests.filter((entry) => entry.layer === layer && entry.preImplementation);
      addError(errors, layerTests.length > 0, `required ${layer} layer needs a pre-implementation test`);
      layerTests.forEach((entry) => addError(errors, evidenceTestIds.has(entry.id), `pre-implementation test ${entry.id} needs expected RED evidence`));
    });
}

function validateImplementationReady(spec, errors) {
  if (Array.isArray(spec.approvals)) {
    spec.approvals.forEach((approval) => {
      const latest = approval.decisions?.at(-1);
      addError(errors, latest?.status === "approved", `approval ${approval.id} must be approved before implementation`);
    });
  }
  if (Array.isArray(spec.tests) && Array.isArray(spec.expectedRedEvidence)) {
    const evidenceByTest = new Map(spec.expectedRedEvidence.map((entry) => [entry.testId, entry]));
    spec.tests.filter(({ preImplementation }) => preImplementation).forEach((entry) => {
      addError(errors, evidenceByTest.get(entry.id)?.status === "captured", `expected RED evidence for ${entry.id} must be captured before implementation`);
    });
  }
}

function validateCloseout(spec, errors) {
  if (Array.isArray(spec.verification)) {
    spec.verification.forEach((entry) => {
      addError(errors, ["passing", "N/A"].includes(entry.status), `verification ${entry.id} must be passing or N/A at closeout`);
    });
  }
  if (spec.testMatrix?.e2e?.requirement === "required") {
    addError(errors, spec.e2eStatus?.status === "passing", "required e2eStatus must be passing at closeout");
  }
}

export function collectSliceSpecErrors(spec, { stage = "progressive" } = {}) {
  if (!STAGES.has(stage)) throw new Error(`unknown slice-spec validation stage: ${stage}`);
  const errors = [];
  validateProgressiveStructure(spec, errors);
  if (["planned", "implementation-ready", "closeout"].includes(stage)) validatePlanned(spec, errors);
  if (["implementation-ready", "closeout"].includes(stage)) validateImplementationReady(spec, errors);
  if (stage === "closeout") validateCloseout(spec, errors);
  return errors;
}

export function assertSliceSpec(spec, options = {}) {
  const errors = collectSliceSpecErrors(spec, options);
  if (errors.length > 0) throw new Error(`Invalid slice spec:\n- ${errors.join("\n- ")}`);
  return spec;
}

export function sliceSpecHash(spec) {
  assertSliceSpec(spec);
  return createHash("sha256").update(JSON.stringify(spec)).digest("hex");
}

export function createSliceSpecReference(spec, path) {
  assertSliceSpec(spec);
  if (!isNonEmptyString(path)) throw new Error("slice-spec reference path must be a non-empty string");
  return {
    path,
    sliceId: spec.sliceId,
    revision: spec.revision,
    hash: sliceSpecHash(spec),
  };
}

function assertImmutableField(current, patch, field) {
  if (patch[field] !== undefined && patch[field] !== current[field]) {
    throw new Error(`${field} is immutable`);
  }
}

function mergeAppendOnly(existing, incoming, label) {
  const output = clone(existing);
  const byId = new Map(output.map((entry) => [entry.id, entry]));
  for (const entry of incoming ?? []) {
    const current = byId.get(entry.id);
    if (current && JSON.stringify(current) !== JSON.stringify(entry)) {
      throw new Error(`${label} ${entry.id} is append-only`);
    }
    if (!current) {
      const next = clone(entry);
      output.push(next);
      byId.set(next.id, next);
    }
  }
  return output;
}

function mergeRecords(
  existing,
  incoming,
  mergeRecord = (current, patch) => ({ ...current, ...patch }),
  identityField = "id",
) {
  const output = clone(existing);
  const indices = new Map(output.map((entry, index) => [entry[identityField], index]));
  for (const entry of incoming ?? []) {
    const identity = entry[identityField];
    if (indices.has(identity)) {
      const index = indices.get(identity);
      output[index] = mergeRecord(output[index], clone(entry));
    } else {
      indices.set(identity, output.length);
      output.push(clone(entry));
    }
  }
  return output;
}

function mergeApproval(current, patch) {
  for (const field of ["boundary", "requirement", "provenanceRef"]) {
    if (patch[field] !== undefined && patch[field] !== current[field]) {
      throw new Error(`approval ${current.id} ${field} is immutable`);
    }
  }
  return {
    ...current,
    ...patch,
    decisions: mergeAppendOnly(current.decisions, patch.decisions, `approval ${current.id} decision`),
  };
}

function mergeWithImmutableFields(label, immutableFields) {
  return (current, patch) => {
    for (const field of immutableFields) {
      if (patch[field] !== undefined && patch[field] !== current[field]) {
        throw new Error(`${label} ${current.id} ${field} is immutable`);
      }
    }
    return { ...current, ...patch };
  };
}

function mergeMonotonicStatus(label, order, immutableFields = []) {
  const merge = mergeWithImmutableFields(label, immutableFields);
  return (current, patch) => {
    if (patch.status !== undefined) {
      const currentRank = order.indexOf(current.status);
      const nextRank = order.indexOf(patch.status);
      if (currentRank === -1 || nextRank === -1 || nextRank < currentRank) {
        throw new Error(`${label} ${current.id} status cannot regress from ${current.status} to ${patch.status}`);
      }
    }
    return merge(current, patch);
  };
}

function mergeVerification(current, patch) {
  if (["passing", "N/A"].includes(current.status) && patch.status !== undefined && patch.status !== current.status) {
    throw new Error(`verification ${current.id} status cannot regress from ${current.status} to ${patch.status}`);
  }
  return mergeWithImmutableFields("verification", ["layer", "requirement", "provenanceRef"])(current, patch);
}

function mergeScope(current, patch) {
  if (!patch) return clone(current);
  return {
    in: mergeAppendOnly(current.in, patch.in, "in-scope item"),
    out: mergeAppendOnly(current.out, patch.out, "out-of-scope item"),
  };
}

export function mergeSliceSpec(current, patch) {
  assertSliceSpec(current);
  if (!isObject(patch)) throw new Error("slice-spec patch must be an object");
  for (const field of Object.keys(patch)) {
    if (!TOP_LEVEL_FIELDS.has(field)) throw new Error(`slice-spec patch contains unknown field ${field}`);
  }
  for (const field of ["schemaVersion", "sliceId", "workflowId", "kind", "createdAt"]) {
    assertImmutableField(current, patch, field);
  }
  if (patch.revision !== undefined) throw new Error("revision is managed by mergeSliceSpec");
  if (!isCanonicalTimestamp(patch.updatedAt)) {
    throw new Error("slice-spec patch updatedAt must be a canonical UTC ISO-8601 timestamp");
  }
  if (patch.updatedAt <= current.updatedAt) throw new Error("slice-spec patch updatedAt must advance");
  if (patch.status !== undefined) {
    if (!SLICE_STATUSES.includes(patch.status)) throw new Error(`invalid slice status ${patch.status}`);
    if (SLICE_STATUSES.indexOf(patch.status) < SLICE_STATUSES.indexOf(current.status)) {
      throw new Error(`slice status cannot regress from ${current.status} to ${patch.status}`);
    }
  }

  const merged = clone(current);
  merged.revision += 1;
  merged.updatedAt = patch.updatedAt;
  if (patch.status !== undefined) merged.status = patch.status;
  if (patch.objective !== undefined) {
    for (const field of ["statement", "provenanceRef"]) {
      if (patch.objective[field] !== undefined && patch.objective[field] !== merged.objective[field]) {
        throw new Error(`objective.${field} is immutable; append a correction observation instead`);
      }
    }
  }
  if (patch.complexity !== undefined) {
    if (merged.complexity !== undefined && JSON.stringify(patch.complexity) !== JSON.stringify(merged.complexity)) {
      throw new Error("complexity is immutable once planned");
    }
    merged.complexity = clone(patch.complexity);
  }
  if (patch.e2eStatus !== undefined) {
    const currentStatus = merged.e2eStatus.status;
    const nextStatus = patch.e2eStatus.status ?? currentStatus;
    const order = ["planned", "authored", "passing"];
    if (
      (currentStatus === "N/A" && nextStatus !== "N/A") ||
      (["authored", "passing"].includes(currentStatus) && nextStatus === "N/A") ||
      (currentStatus !== "N/A" && nextStatus !== "N/A" && order.indexOf(nextStatus) < order.indexOf(currentStatus))
    ) {
      throw new Error(`e2eStatus.status cannot regress from ${currentStatus} to ${nextStatus}`);
    }
    merged.e2eStatus = { ...merged.e2eStatus, ...clone(patch.e2eStatus) };
  }
  if (patch.scope !== undefined) merged.scope = mergeScope(merged.scope, patch.scope);

  merged.provenance = mergeAppendOnly(merged.provenance, patch.provenance, "provenance");
  merged.acceptanceCriteria = mergeAppendOnly(merged.acceptanceCriteria, patch.acceptanceCriteria, "acceptance criterion");
  merged.observations = mergeAppendOnly(merged.observations, patch.observations, "observation");
  merged.approvals = mergeRecords(merged.approvals, patch.approvals, mergeApproval);
  merged.capabilityOwners = mergeRecords(
    merged.capabilityOwners,
    patch.capabilityOwners,
    (current, entry) => ({ ...current, ...entry }),
    "key",
  );
  merged.increments = mergeRecords(
    merged.increments,
    patch.increments,
    mergeMonotonicStatus("increment", ["planned", "in-progress", "complete"], ["provenanceRef"]),
  );
  merged.tests = mergeRecords(
    merged.tests,
    patch.tests,
    mergeWithImmutableFields("test", ["layer", "preImplementation", "provenanceRef"]),
  );
  merged.expectedRedEvidence = mergeRecords(
    merged.expectedRedEvidence,
    patch.expectedRedEvidence,
    mergeMonotonicStatus("expected RED evidence", ["planned", "captured"], [
      "testId",
      "expectedFailure",
      "provenanceRef",
    ]),
  );
  merged.verification = mergeRecords(merged.verification, patch.verification, mergeVerification);
  if (patch.testMatrix !== undefined) {
    merged.testMatrix = { ...merged.testMatrix };
    Object.entries(patch.testMatrix).forEach(([layer, entry]) => {
      const currentLayer = merged.testMatrix[layer];
      if (
        currentLayer?.requirement !== undefined &&
        entry.requirement !== undefined &&
        entry.requirement !== currentLayer.requirement
      ) {
        throw new Error(`testMatrix.${layer}.requirement is immutable once planned`);
      }
      merged.testMatrix[layer] = { ...merged.testMatrix[layer], ...clone(entry) };
    });
  }

  assertSliceSpec(merged);
  return merged;
}

export function readSliceSpec(path, options = {}) {
  let spec;
  try {
    spec = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read slice spec ${path}: ${error.message}`);
  }
  return assertSliceSpec(spec, options);
}

export function writeSliceSpec(path, spec, options = {}) {
  assertSliceSpec(spec, options);
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = join(dirname(path), `.${randomUUID()}.slice-spec.tmp`);
  writeFileSync(temporaryPath, `${JSON.stringify(spec, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, path);
  return path;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/slice-spec.mjs validate --spec <slice-spec.json> [--stage progressive|planned|implementation-ready|closeout]",
    "  node scripts/slice-spec.mjs merge --spec <slice-spec.json> --patch <patch.json> [--stage progressive|planned|implementation-ready|closeout]",
  ].join("\n");
}

function parseCli(argv) {
  const [command, ...args] = argv;
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(usage());
    options[key.slice(2)] = value;
  }
  if (!command || !options.spec) throw new Error(usage());
  return { command, specPath: resolve(options.spec), patchPath: options.patch && resolve(options.patch), stage: options.stage ?? "progressive" };
}

export function runSliceSpecCli(argv = process.argv.slice(2)) {
  try {
    const { command, specPath, patchPath, stage } = parseCli(argv);
    if (command === "validate") {
      const spec = readSliceSpec(specPath, { stage });
      console.log(`Validated ${spec.sliceId} revision ${spec.revision} at ${stage} stage.`);
      return;
    }
    if (command === "merge") {
      if (!patchPath || !existsSync(patchPath)) throw new Error("merge requires an existing --patch file");
      const current = readSliceSpec(specPath);
      const patch = JSON.parse(readFileSync(patchPath, "utf8"));
      const merged = mergeSliceSpec(current, patch);
      writeSliceSpec(specPath, merged, { stage });
      console.log(`Updated ${merged.sliceId} to revision ${merged.revision}; validated at ${stage} stage.`);
      return;
    }
    throw new Error(`Unknown command: ${command}\n\n${usage()}`);
  } catch (error) {
    console.error(`Slice spec error: ${error.message}`);
    process.exitCode = 1;
  }
}

if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSliceSpecCli();
}
