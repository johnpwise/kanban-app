#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = 1;
const CACHE_FILE = "execution-profile-cache.json";
const DEMANDS = ["lightweight", "routine", "elevated", "deep"];
const DELEGATIONS = ["inline", "advisor", "independent", "parallel"];
const RISKS = ["low", "moderate", "high", "severe"];
const SCOPES = ["local", "module", "cross-module", "system-wide"];
const REVERSIBILITIES = ["easily-reversible", "reversible-with-effort", "hard-to-reverse"];
const VERIFICATIONS = [
  "deterministic-check",
  "test-backed",
  "review-backed",
  "multi-specialist-verification",
];

const DEEP_SIGNALS = new Set(["tightly-coupled", "elevated-insufficient"]);
const ELEVATED_SIGNALS = new Set([
  "multiple-viable-approaches",
  "unfamiliar-area",
  "ambiguous-requirements",
  "cross-module-contract",
  "high-risk",
  "hard-to-reverse",
  "contested-verification",
]);

const PHASE_ALIASES = Object.freeze({
  intake: "planning",
  red: "testing",
  green: "implementation",
  refactor: "implementation",
  closeout: "delivery",
});

const PHASES = Object.freeze({
  exploration: {
    capability: "analysis",
    defaultDemand: "routine",
    profiles: { routine: "exploration-routine", elevated: "exploration-elevated" },
  },
  planning: {
    capability: "synthesis",
    defaultDemand: "routine",
    profiles: { routine: "planning-routine", elevated: "planning-elevated" },
  },
  architecture: {
    capability: "synthesis",
    defaultDemand: "elevated",
    profiles: { elevated: "architecture-elevated" },
  },
  testing: {
    capability: "verification",
    defaultDemand: "routine",
    profiles: { routine: "testing-routine", elevated: "testing-elevated" },
  },
  implementation: {
    capability: "code-generation",
    defaultDemand: "routine",
    profiles: {
      lightweight: "implementation-lightweight",
      routine: "implementation-routine",
      elevated: "implementation-elevated",
    },
  },
  debugging: {
    capability: "analysis",
    defaultDemand: "routine",
    profiles: { routine: "debugging-routine", elevated: "debugging-elevated" },
  },
  review: {
    capability: "verification",
    defaultDemand: "routine",
    profiles: { routine: "review-routine", elevated: "review-elevated" },
  },
  verification: {
    capability: "verification",
    defaultDemand: "routine",
    profiles: {
      lightweight: "verification-lightweight",
      routine: "verification-routine",
      elevated: "verification-elevated",
    },
  },
  delivery: {
    capability: "coordination",
    defaultDemand: "lightweight",
    profiles: { lightweight: "delivery-lightweight", routine: "delivery-routine" },
  },
  orchestration: {
    capability: "coordination",
    defaultDemand: "elevated",
    profiles: { elevated: "orchestration-multi-specialist-review" },
  },
});

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function without(object, ...keys) {
  return Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function requireString(value, field) {
  if (!isNonEmptyString(value)) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function requireEnum(value, allowed, field) {
  if (!allowed.includes(value)) throw new Error(`${field} must be one of: ${allowed.join(", ")}`);
  return value;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function normalizeEvidence(evidence = {}) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new Error("evidence must be an object");
  }
  if (!Array.isArray(evidence.signals ?? [])) throw new Error("evidence.signals must be an array");
  (evidence.signals ?? []).forEach((signal, index) => requireString(signal, `evidence.signals[${index}]`));
  const signals = uniqueSorted(evidence.signals ?? []);

  return {
    signals,
    risk: requireEnum(evidence.risk ?? (signals.includes("high-risk") ? "high" : "moderate"), RISKS, "evidence.risk"),
    scope: requireEnum(
      evidence.scope ?? (signals.includes("cross-module-contract") ? "cross-module" : "module"),
      SCOPES,
      "evidence.scope",
    ),
    reversibility: requireEnum(
      evidence.reversibility ?? (signals.includes("hard-to-reverse") ? "hard-to-reverse" : "reversible-with-effort"),
      REVERSIBILITIES,
      "evidence.reversibility",
    ),
    verification: evidence.verification,
  };
}

function normalizeDelegation(delegation = { level: "inline" }) {
  if (!delegation || typeof delegation !== "object" || Array.isArray(delegation)) {
    throw new Error("delegation must be an object");
  }
  const level = requireEnum(delegation.level ?? "inline", DELEGATIONS, "delegation.level");
  if (!Array.isArray(delegation.workstreams ?? [])) {
    throw new Error("delegation.workstreams must be an array");
  }
  (delegation.workstreams ?? []).forEach(
    (workstream, index) => requireString(workstream, `delegation.workstreams[${index}]`),
  );
  const workstreams = uniqueSorted(delegation.workstreams ?? []);

  if (level !== "inline") requireString(delegation.reason, "delegation.reason");
  if (level === "parallel" && workstreams.length < 2) {
    throw new Error("parallel delegation requires two or more named independent workstreams");
  }

  return {
    level,
    ...(level === "inline" ? {} : { reason: delegation.reason.trim() }),
    ...(workstreams.length === 0 ? {} : { workstreams }),
  };
}

function demandFor(phase, signals) {
  if (signals.some((signal) => DEEP_SIGNALS.has(signal))) return "deep";
  if (signals.some((signal) => ELEVATED_SIGNALS.has(signal))) return "elevated";
  if (
    signals.length === 1 &&
    signals[0] === "mechanical" &&
    PHASES[phase].profiles.lightweight
  ) return "lightweight";
  return PHASES[phase].defaultDemand;
}

function profileFor(phase, demand) {
  const profiles = PHASES[phase].profiles;
  const demandIndex = DEMANDS.indexOf(demand);
  for (let index = demandIndex; index >= 0; index -= 1) {
    if (profiles[DEMANDS[index]]) return profiles[DEMANDS[index]];
  }
  throw new Error(`phase ${phase} has no profile at or below reasoning demand ${demand}`);
}

function defaultVerification(phase, delegation) {
  if (delegation === "parallel") return "multi-specialist-verification";
  if (phase === "review") return "review-backed";
  if (phase === "implementation" || phase === "testing" || phase === "debugging") return "test-backed";
  return "deterministic-check";
}

function profileId(profile) {
  return `ep-${sha256(stableJson(profile)).slice(0, 12)}`;
}

function canonicalPhase(value) {
  const phase = PHASE_ALIASES[value] ?? value;
  if (!PHASES[phase]) throw new Error(`unsupported phase ${JSON.stringify(value)}`);
  return phase;
}

function resolveProfile(input, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("execution-profile input must be an object");
  }
  requireString(input.workflowId, "workflowId");
  requireString(input.boundaryId, "boundaryId");
  const phase = canonicalPhase(requireString(input.phase, "phase"));
  const evidence = normalizeEvidence(input.evidence);
  const delegation = normalizeDelegation(input.delegation);
  if (phase === "orchestration" && delegation.level !== "parallel") {
    throw new Error("orchestration phase requires delegation: parallel");
  }
  const reasoningDemand = demandFor(phase, evidence.signals);
  const verification = requireEnum(
    evidence.verification ?? defaultVerification(phase, delegation.level),
    VERIFICATIONS,
    "evidence.verification",
  );
  const profile = {
    name: profileFor(phase, reasoningDemand),
    capability: PHASES[phase].capability,
    reasoningDemand,
    delegation: delegation.level,
    risk: evidence.risk,
    scope: evidence.scope,
    reversibility: evidence.reversibility,
    verification,
  };

  const rationaleParts = [];
  if (options.escalatedFrom) {
    const added = options.addedSignals.join(", ");
    rationaleParts.push(`New risk evidence raised this boundary: ${added}.`);
    profile.escalatedFrom = options.escalatedFrom;
    profile.escalationReason = `New risk evidence: ${added}.`;
  }
  if (delegation.level !== "inline") {
    rationaleParts.push(delegation.reason);
    if (delegation.workstreams) rationaleParts.push(`Independent workstreams: ${delegation.workstreams.join(", ")}.`);
  }
  if (options.downgradeReason) rationaleParts.push(`Acknowledged downgrade: ${options.downgradeReason}`);
  if (isNonEmptyString(input.exception?.reason)) rationaleParts.push(`Exception: ${input.exception.reason.trim()}`);
  if (rationaleParts.length > 0) profile.rationale = rationaleParts.join(" ");

  return {
    workflowId: input.workflowId.trim(),
    phase,
    boundaryId: input.boundaryId.trim(),
    evidence,
    profile,
    profileId: profileId(profile),
  };
}

export function resolveExecutionProfile(input) {
  return resolveProfile(input);
}

function emptyCache(workflowId) {
  const cache = {
    schemaVersion: SCHEMA_VERSION,
    workflowId,
    profiles: [],
    boundaries: [],
  };
  cache.hash = sha256(stableJson(cache));
  return cache;
}

function cacheHash(cache) {
  return sha256(stableJson(without(cache, "hash")));
}

function addProfile(cache, result) {
  if (!cache.profiles.some(({ profileId: id }) => id === result.profileId)) {
    cache.profiles.push({ profileId: result.profileId, ...result.profile });
    cache.profiles.sort((left, right) => left.profileId.localeCompare(right.profileId));
  }
}

function evidenceRecord(evidence) {
  const normalized = without(evidence, "verification");
  if (evidence.verification !== undefined) normalized.verification = evidence.verification;
  return { ...normalized, fingerprint: sha256(stableJson(normalized)) };
}

function writeCache(workflowDir, cache) {
  cache.hash = cacheHash(cache);
  const path = join(workflowDir, CACHE_FILE);
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  writeFileSync(temporaryPath, `${JSON.stringify(cache, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, path);
}

export function validateExecutionProfileCache(cache) {
  const errors = [];
  if (!cache || typeof cache !== "object" || Array.isArray(cache)) return ["cache must be an object"];
  if (cache.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (!isNonEmptyString(cache.workflowId)) errors.push("workflowId must be a non-empty string");
  if (!Array.isArray(cache.profiles)) errors.push("profiles must be an array");
  if (!Array.isArray(cache.boundaries)) errors.push("boundaries must be an array");
  if (typeof cache.hash !== "string" || cache.hash !== cacheHash(cache)) errors.push("cache hash mismatch");

  const profiles = new Map();
  for (const entry of cache.profiles ?? []) {
    const profile = without(entry, "profileId");
    if (!/^ep-[a-f0-9]{12}$/.test(entry.profileId ?? "")) {
      errors.push(`invalid profileId ${JSON.stringify(entry.profileId)}`);
      continue;
    }
    if (profileId(profile) !== entry.profileId) errors.push(`profile ${entry.profileId} content hash mismatch`);
    if (profiles.has(entry.profileId)) errors.push(`duplicate profile ${entry.profileId}`);
    profiles.set(entry.profileId, entry);
  }

  const boundaries = new Set();
  for (const boundary of cache.boundaries ?? []) {
    if (!isNonEmptyString(boundary.boundaryId)) errors.push("boundaryId must be a non-empty string");
    if (boundaries.has(boundary.boundaryId)) errors.push(`duplicate boundary ${boundary.boundaryId}`);
    boundaries.add(boundary.boundaryId);
    if (!profiles.has(boundary.profileId)) errors.push(`boundary ${boundary.boundaryId} references missing profile ${boundary.profileId}`);
    if (!PHASES[boundary.phase]) errors.push(`boundary ${boundary.boundaryId} has unsupported phase ${boundary.phase}`);
    const evidence = without(boundary.evidence ?? {}, "fingerprint");
    if (boundary.evidence?.fingerprint !== sha256(stableJson(evidence))) {
      errors.push(`boundary ${boundary.boundaryId} evidence fingerprint mismatch`);
    }
  }
  return errors;
}

export function readExecutionProfileCache(workflowDir) {
  const path = join(workflowDir, CACHE_FILE);
  if (!existsSync(path)) return null;
  const cache = JSON.parse(readFileSync(path, "utf8"));
  const errors = validateExecutionProfileCache(cache);
  if (errors.length > 0) throw new Error(`invalid execution-profile cache: ${errors.join("; ")}`);
  return cache;
}

function demandRank(value) {
  return DEMANDS.indexOf(value);
}

function delegationRank(value) {
  return DELEGATIONS.indexOf(value);
}

function profileFromCache(cache, id) {
  const entry = cache.profiles.find(({ profileId: candidate }) => candidate === id);
  if (!entry) throw new Error(`profile ${id} is missing from the execution-profile cache`);
  return without(entry, "profileId");
}

function resultFromCache(cache, boundary, status) {
  return {
    status,
    profileId: boundary.profileId,
    profile: profileFromCache(cache, boundary.profileId),
    cachePath: CACHE_FILE,
  };
}

export function routeExecutionProfile(workflowDir, input) {
  requireString(workflowDir, "workflowDir");
  requireString(input?.workflowId, "workflowId");
  const cache = readExecutionProfileCache(workflowDir) ?? emptyCache(input.workflowId.trim());
  if (cache.workflowId !== input.workflowId.trim()) {
    throw new Error(`workflowId ${input.workflowId} does not match cached workflowId ${cache.workflowId}`);
  }

  const initial = resolveProfile(input);
  const boundary = cache.boundaries.find(({ boundaryId }) => boundaryId === initial.boundaryId);

  if (!boundary) {
    addProfile(cache, initial);
    cache.boundaries.push({
      boundaryId: initial.boundaryId,
      phase: initial.phase,
      profileId: initial.profileId,
      evidence: evidenceRecord(initial.evidence),
    });
    cache.boundaries.sort((left, right) => left.boundaryId.localeCompare(right.boundaryId));
    writeCache(workflowDir, cache);
    return { status: "resolved", profileId: initial.profileId, profile: initial.profile, cachePath: CACHE_FILE };
  }

  if (boundary.phase !== initial.phase) {
    throw new Error(`boundary ${boundary.boundaryId} is already assigned to phase ${boundary.phase}`);
  }
  const current = profileFromCache(cache, boundary.profileId);
  const previousSignals = new Set(boundary.evidence.signals);
  const addedSignals = initial.evidence.signals.filter((signal) => !previousSignals.has(signal));
  const delegationRaised = delegationRank(initial.profile.delegation) > delegationRank(current.delegation);
  const downgradeRequested = input.downgrade !== undefined;

  if (downgradeRequested) {
    if (!isNonEmptyString(input.downgrade?.reason) || input.downgrade.acknowledged !== true) {
      throw new Error("downgrade requires a recorded reason and acknowledged: true");
    }
    const downgraded = resolveProfile(input, { downgradeReason: input.downgrade.reason.trim() });
    addProfile(cache, downgraded);
    boundary.profileId = downgraded.profileId;
    boundary.evidence = evidenceRecord(downgraded.evidence);
    writeCache(workflowDir, cache);
    return { status: "downgraded", profileId: downgraded.profileId, profile: downgraded.profile, cachePath: CACHE_FILE };
  }

  if (addedSignals.length === 0 && !delegationRaised) {
    return resultFromCache(cache, boundary, "cache-hit");
  }

  const carriedDelegation = delegationRaised
    ? input.delegation
    : current.delegation === "inline"
      ? { level: "inline" }
      : {
          level: current.delegation,
          reason: current.rationale ?? "Previously assigned delegation is retained to prevent silent downgrade.",
        };
  const candidate = resolveProfile(
    { ...input, delegation: carriedDelegation },
    {
      ...(addedSignals.length > 0 ? { escalatedFrom: boundary.profileId, addedSignals } : {}),
    },
  );

  if (
    demandRank(candidate.profile.reasoningDemand) < demandRank(current.reasoningDemand) ||
    delegationRank(candidate.profile.delegation) < delegationRank(current.delegation)
  ) {
    return resultFromCache(cache, boundary, "cache-hit");
  }

  addProfile(cache, candidate);
  boundary.profileId = candidate.profileId;
  boundary.evidence = evidenceRecord(candidate.evidence);
  writeCache(workflowDir, cache);
  return {
    status: candidate.profileId === initial.profileId ? "re-evaluated" : "escalated",
    profileId: candidate.profileId,
    profile: candidate.profile,
    cachePath: CACHE_FILE,
  };
}

function usage() {
  return [
    "Usage:",
    "  node scripts/execution-profile-router.mjs resolve --workflow-dir <path> --input <input.json>",
    "  node scripts/execution-profile-router.mjs validate --workflow-dir <path>",
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
  if (!command || !options["workflow-dir"]) throw new Error(usage());
  return { command, workflowDir: resolve(options["workflow-dir"]), input: options.input };
}

export function runExecutionProfileRouterCli() {
  try {
    const { command, workflowDir, input } = parseCli(process.argv.slice(2));
    if (command === "resolve") {
      if (!input) throw new Error(`resolve requires --input\n\n${usage()}`);
      const selection = JSON.parse(readFileSync(resolve(input), "utf8"));
      const result = routeExecutionProfile(workflowDir, selection);
      console.log(`${result.status}: ${result.profileId} (${result.profile.name}).`);
      return;
    }
    if (command === "validate") {
      const cache = readExecutionProfileCache(workflowDir);
      if (!cache) throw new Error(`missing ${CACHE_FILE}`);
      console.log(`Validated execution-profile cache with ${cache.profiles.length} profiles and ${cache.boundaries.length} boundaries.`);
      return;
    }
    throw new Error(`unknown command ${JSON.stringify(command)}\n\n${usage()}`);
  } catch (error) {
    console.error(`Execution-profile router error: ${error.message}`);
    process.exitCode = 1;
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  runExecutionProfileRouterCli();
}
