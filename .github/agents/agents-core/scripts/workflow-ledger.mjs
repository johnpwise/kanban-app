#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readExecutionProfileCache } from "./execution-profile-router.mjs";

const SCHEMA_VERSION = 1;
const LEDGER_FILE = "ledger.jsonl";
const VIEW_DIRECTORY = "ledger-views";
const VALID_TYPES = new Set([
  "workflow-started",
  "step-recorded",
  "checkpoint-recorded",
  "dispatch-created",
  "handoff-returned",
  "exception-recorded",
  "closeout-recorded",
]);
const VALID_STATUSES = new Set([
  "in-progress",
  "blocked",
  "awaiting-approval",
  "ready-to-resume",
  "ready-for-closeout",
  "closed",
]);
const VALID_CAPABILITIES = new Set([
  "analysis",
  "synthesis",
  "code-generation",
  "verification",
  "coordination",
]);
const VALID_REASONING_DEMANDS = new Set(["lightweight", "routine", "elevated", "deep"]);
const VALID_DELEGATIONS = new Set(["inline", "advisor", "independent", "parallel"]);
const VALID_TDD_STATES = new Set(["red", "green", "refactor", "n/a"]);
const ARRAY_FIELDS = [
  "commands",
  "shas",
  "changedAreas",
  "decisions",
  "risks",
  "blockers",
  "approvals",
  "exceptions",
];

function ledgerPath(workflowDir) {
  return join(workflowDir, LEDGER_FILE);
}

function assertNonEmptyString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function assertStringArray(value, field) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${field} must be an array of strings`);
  }
}

function assertJsonValue(value, field) {
  let serialized;

  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new Error(`${field} must be JSON-serializable: ${error.message}`);
  }

  if (serialized === undefined) {
    throw new Error(`${field} must be JSON-serializable`);
  }
}

function validateRecordedAt(recordedAt) {
  assertNonEmptyString(recordedAt, "recordedAt");
  const parsed = new Date(recordedAt);

  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== recordedAt) {
    throw new Error("recordedAt must be a canonical UTC ISO-8601 timestamp");
  }
}

function validateCommands(commands) {
  if (!Array.isArray(commands)) throw new Error("commands must be an array");

  commands.forEach((command, index) => {
    if (!command || typeof command !== "object" || Array.isArray(command)) {
      throw new Error(`commands[${index}] must be an object`);
    }
    assertNonEmptyString(command.command, `commands[${index}].command`);
    if (!Number.isInteger(command.exitCode)) {
      throw new Error(`commands[${index}].exitCode must be an integer`);
    }
    assertNonEmptyString(command.result, `commands[${index}].result`);
  });
}

function validateShas(shas) {
  if (!Array.isArray(shas)) throw new Error("shas must be an array");

  shas.forEach((sha, index) => {
    if (!sha || typeof sha !== "object" || Array.isArray(sha)) {
      throw new Error(`shas[${index}] must be an object`);
    }
    assertNonEmptyString(sha.kind, `shas[${index}].kind`);
    if (typeof sha.value !== "string" || !/^[a-f0-9]{7,64}$/i.test(sha.value)) {
      throw new Error(`shas[${index}].value must be a 7-64 character hexadecimal SHA`);
    }
  });
}

function validateTdd(tdd) {
  if (!tdd || typeof tdd !== "object" || Array.isArray(tdd)) {
    throw new Error("tdd must be an object");
  }
  if (!VALID_TDD_STATES.has(tdd.state)) {
    throw new Error(`tdd.state must be one of: ${[...VALID_TDD_STATES].join(", ")}`);
  }
  assertNonEmptyString(tdd.command, "tdd.command");
  assertNonEmptyString(tdd.result, "tdd.result");
  if (!Number.isInteger(tdd.exitCode)) throw new Error("tdd.exitCode must be an integer");
}

function validateExecutionProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw new Error("dispatch-created requires executionProfile");
  }

  [
    "name",
    "capability",
    "reasoningDemand",
    "delegation",
    "risk",
    "scope",
    "reversibility",
    "verification",
    "rationale",
  ].forEach((field) => assertNonEmptyString(profile[field], `executionProfile.${field}`));

  if (!VALID_CAPABILITIES.has(profile.capability)) {
    throw new Error(`executionProfile.capability must be one of: ${[...VALID_CAPABILITIES].join(", ")}`);
  }
  if (!VALID_REASONING_DEMANDS.has(profile.reasoningDemand)) {
    throw new Error(
      `executionProfile.reasoningDemand must be one of: ${[...VALID_REASONING_DEMANDS].join(", ")}`,
    );
  }
  if (!VALID_DELEGATIONS.has(profile.delegation)) {
    throw new Error(`executionProfile.delegation must be one of: ${[...VALID_DELEGATIONS].join(", ")}`);
  }
}

function validateExecutionProfileId(profileId) {
  if (typeof profileId !== "string" || !/^ep-[a-f0-9]{12}$/.test(profileId)) {
    throw new Error("executionProfileId must be a compact content-addressed profile ID");
  }
}

function validateRouting(routing) {
  if (!routing || typeof routing !== "object" || Array.isArray(routing)) {
    throw new Error("dispatch-created requires routing");
  }

  [
    "from",
    "to",
    "returnToAgent",
    "nextAgentAlias",
    "workflowStatus",
    "reentryReason",
  ].forEach((field) => assertNonEmptyString(routing[field], `routing.${field}`));
}

function validateSliceSpecReference(sliceSpec) {
  if (!sliceSpec || typeof sliceSpec !== "object" || Array.isArray(sliceSpec)) {
    throw new Error("sliceSpec must be an object");
  }
  assertNonEmptyString(sliceSpec.path, "sliceSpec.path");
  assertNonEmptyString(sliceSpec.sliceId, "sliceSpec.sliceId");
  if (!Number.isInteger(sliceSpec.revision) || sliceSpec.revision < 1) {
    throw new Error("sliceSpec.revision must be an integer >= 1");
  }
  if (typeof sliceSpec.hash !== "string" || !/^[a-f0-9]{64}$/.test(sliceSpec.hash)) {
    throw new Error("sliceSpec.hash must be a lowercase SHA-256 hash");
  }
}

function validateEventInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("workflow event must be an object");
  }

  assertJsonValue(input, "workflow event");

  if (!VALID_TYPES.has(input.type)) {
    throw new Error(`type must be one of: ${[...VALID_TYPES].join(", ")}`);
  }

  assertNonEmptyString(input.workflowId, "workflowId");
  validateRecordedAt(input.recordedAt);
  assertNonEmptyString(input.actor, "actor");
  assertNonEmptyString(input.status, "status");
  if (!VALID_STATUSES.has(input.status)) {
    throw new Error(`status must be one of: ${[...VALID_STATUSES].join(", ")}`);
  }
  assertNonEmptyString(input.sourceOfTruth, "sourceOfTruth");
  assertNonEmptyString(input.summary, "summary");
  assertNonEmptyString(input.nextAction, "nextAction");
  if (input.sliceSpec !== undefined) validateSliceSpecReference(input.sliceSpec);

  ARRAY_FIELDS.forEach((field) => {
    if (input[field] !== undefined) {
      if (field === "commands") validateCommands(input[field]);
      else if (field === "shas") validateShas(input[field]);
      else assertStringArray(input[field], field);
    }
  });
  if (input.tdd !== undefined) validateTdd(input.tdd);

  if (input.type === "workflow-started" && input.status !== "in-progress") {
    throw new Error("workflow-started status must be in-progress");
  }

  if (input.type === "dispatch-created") {
    if (input.executionProfile !== undefined && input.executionProfileId !== undefined) {
      throw new Error("dispatch-created must use executionProfileId or legacy executionProfile, not both");
    }
    if (input.executionProfileId !== undefined) validateExecutionProfileId(input.executionProfileId);
    else validateExecutionProfile(input.executionProfile);
    validateRouting(input.routing);
    assertStringArray(input.sourcePointers, "sourcePointers");
    if (input.sourcePointers.length === 0) {
      throw new Error("dispatch-created sourcePointers must not be empty");
    }
    assertNonEmptyString(input.expectedOutput, "expectedOutput");
  }

  if (input.type === "handoff-returned") {
    assertNonEmptyString(input.dispatchEventId, "dispatchEventId");
  }

  if (input.type === "closeout-recorded" && input.status !== "closed") {
    throw new Error("closeout-recorded status must be closed");
  }
}

function eventHash(eventWithoutHash) {
  return createHash("sha256").update(JSON.stringify(eventWithoutHash)).digest("hex");
}

function withoutHash(event) {
  const copy = { ...event };
  delete copy.hash;
  return copy;
}

function validatePersistedEvent(event, index, previousEvent) {
  validateEventInput(event);

  if (event.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`event ${index + 1} has unsupported schemaVersion ${event.schemaVersion}`);
  }

  const expectedId = `event-${String(index + 1).padStart(6, "0")}`;
  if (event.eventId !== expectedId) {
    throw new Error(`event ${index + 1} has eventId ${event.eventId}; expected ${expectedId}`);
  }

  const expectedPreviousHash = previousEvent?.hash ?? null;
  if (event.previousHash !== expectedPreviousHash) {
    throw new Error(`event ${event.eventId} previousHash does not match the ledger chain`);
  }

  const expectedHash = eventHash(withoutHash(event));
  if (event.hash !== expectedHash) {
    throw new Error(`event ${event.eventId} hash mismatch`);
  }

  if (previousEvent) {
    if (event.workflowId !== previousEvent.workflowId) {
      throw new Error(`event ${event.eventId} workflowId does not match the ledger workflowId`);
    }
    if (event.recordedAt < previousEvent.recordedAt) {
      throw new Error(`event ${event.eventId} recordedAt must be monotonic`);
    }
    if (eventsUseSliceSpec(previousEvent, event)) {
      validateSliceSpecContinuity(previousEvent, event);
    }
  } else if (event.type !== "workflow-started") {
    throw new Error("the first ledger event must be workflow-started");
  }
}

function eventsUseSliceSpec(previousEvent, event) {
  return previousEvent.sliceSpec !== undefined || event.sliceSpec !== undefined;
}

function validateSliceSpecContinuity(previousEvent, event) {
  if (!previousEvent.sliceSpec || !event.sliceSpec) {
    throw new Error(`event ${event.eventId} must retain the canonical sliceSpec reference`);
  }
  if (event.sliceSpec.sliceId !== previousEvent.sliceSpec.sliceId) {
    throw new Error(`event ${event.eventId} sliceSpec.sliceId does not match the ledger slice`);
  }
  if (event.sliceSpec.path !== previousEvent.sliceSpec.path) {
    throw new Error(`event ${event.eventId} sliceSpec.path does not match the ledger slice`);
  }
  if (event.sliceSpec.revision < previousEvent.sliceSpec.revision) {
    throw new Error(`event ${event.eventId} sliceSpec.revision must not regress`);
  }
  if (
    event.sliceSpec.revision === previousEvent.sliceSpec.revision &&
    event.sliceSpec.hash !== previousEvent.sliceSpec.hash
  ) {
    throw new Error(`event ${event.eventId} changed the sliceSpec hash without a revision change`);
  }
}

export function readWorkflowLedger(workflowDir) {
  const path = ledgerPath(workflowDir);
  if (!existsSync(path)) return [];

  const content = readFileSync(path, "utf8");
  if (content.length === 0) return [];
  if (!content.endsWith("\n")) {
    throw new Error(`${LEDGER_FILE} has an incomplete final record`);
  }

  const events = content
    .split("\n")
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${LEDGER_FILE} line ${index + 1} is invalid JSON: ${error.message}`);
      }
    });

  events.forEach((event, index) => {
    validatePersistedEvent(event, index, events[index - 1]);
    if (event.executionProfileId) resolveEventExecutionProfile(workflowDir, event);
  });
  return events;
}

function resolveEventExecutionProfile(workflowDir, event) {
  if (event.executionProfile) return event.executionProfile;
  const cache = readExecutionProfileCache(workflowDir);
  if (!cache) throw new Error(`${event.eventId ?? "dispatch-created"} references executionProfileId ${event.executionProfileId}, but execution-profile-cache.json is missing`);
  if (cache.workflowId !== event.workflowId) {
    throw new Error(`execution-profile cache workflowId ${cache.workflowId} does not match event workflowId ${event.workflowId}`);
  }
  const entry = cache.profiles.find(({ profileId }) => profileId === event.executionProfileId);
  if (!entry) throw new Error(`${event.eventId ?? "dispatch-created"} references unknown executionProfileId ${event.executionProfileId}`);
  const { profileId: _profileId, ...profile } = entry;
  return profile;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeEventInput(input) {
  const normalized = cloneJson(input);
  ARRAY_FIELDS.forEach((field) => {
    normalized[field] ??= [];
  });
  return normalized;
}

function withLedgerLock(workflowDir, operation) {
  mkdirSync(workflowDir, { recursive: true });
  const lockPath = join(workflowDir, ".ledger.lock");
  let lockFd;

  try {
    lockFd = openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(`workflow ledger is locked: ${lockPath}`);
    }
    throw error;
  }

  try {
    return operation();
  } finally {
    closeSync(lockFd);
    rmSync(lockPath, { force: true });
  }
}

export function appendWorkflowEvent(workflowDir, input) {
  validateEventInput(input);

  if (input.executionProfileId) resolveEventExecutionProfile(workflowDir, input);

  const event = withLedgerLock(workflowDir, () => {
    const events = readWorkflowLedger(workflowDir);
    const previous = events.at(-1);

    if (previous && input.workflowId !== previous.workflowId) {
      throw new Error(
        `workflowId ${input.workflowId} does not match ledger workflowId ${previous.workflowId}`,
      );
    }
    if (previous && input.recordedAt < previous.recordedAt) {
      throw new Error("recordedAt must be monotonic within a workflow ledger");
    }
    if (previous && eventsUseSliceSpec(previous, input)) {
      validateSliceSpecContinuity(previous, { ...input, eventId: "pending event" });
    }
    if (!previous && input.type !== "workflow-started") {
      throw new Error("the first ledger event must be workflow-started");
    }
    if (input.type === "handoff-returned") {
      const dispatch = events.find(
        ({ type, eventId }) => type === "dispatch-created" && eventId === input.dispatchEventId,
      );
      if (!dispatch) {
        throw new Error(
          `handoff-returned ${input.dispatchEventId} does not reference an existing dispatch-created event`,
        );
      }
      if (
        events.some(
          ({ type, dispatchEventId }) =>
            type === "handoff-returned" && dispatchEventId === input.dispatchEventId,
        )
      ) {
        throw new Error(`dispatch ${input.dispatchEventId} already has a handoff-returned event`);
      }
    }

    const next = {
      schemaVersion: SCHEMA_VERSION,
      eventId: `event-${String(events.length + 1).padStart(6, "0")}`,
      previousHash: previous?.hash ?? null,
      ...normalizeEventInput(input),
    };
    next.hash = eventHash(next);

    const path = ledgerPath(workflowDir);
    const fd = openSync(path, "a", 0o600);
    try {
      appendFileSync(fd, `${JSON.stringify(next)}\n`, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }

    return next;
  });

  // The ledger append above is the commit point. These Markdown views are
  // disposable: recovery can rebuild them if rendering is interrupted.
  rebuildWorkflowViews(workflowDir);
  return event;
}

function markdownEscape(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function listOrNone(values, format = (value) => value) {
  if (!values || values.length === 0) return "- None.";
  return values.map((value) => `- ${format(value)}`).join("\n");
}

function commandLines(commands) {
  return listOrNone(
    commands,
    ({ command, exitCode, result }) => `\`${command}\` → exit ${exitCode} — ${result}`,
  );
}

function shaLines(shas) {
  return listOrNone(shas, ({ kind, value }) => `${kind}: \`${value}\``);
}

function atomicWrite(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  writeFileSync(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, path);
}

function deriveState(events) {
  if (events.length === 0) throw new Error("cannot derive workflow state from an empty ledger");

  const latest = events.at(-1);
  const returnedDispatches = new Set(
    events
      .filter(({ type }) => type === "handoff-returned")
      .map(({ dispatchEventId }) => dispatchEventId),
  );
  const pendingDispatch = events
    .filter(({ type, eventId }) => type === "dispatch-created" && !returnedDispatches.has(eventId))
    .at(-1) ?? null;
  const latestCheckpoint = events.filter(({ type }) => type === "checkpoint-recorded").at(-1) ?? null;
  const latestCommandEvent = [...events].reverse().find(({ commands }) => commands.length > 0);

  return {
    workflowId: latest.workflowId,
    activeOwner: events[0].actor,
    status: latest.status,
    sourceOfTruth: latest.sourceOfTruth,
    sliceSpec: latest.sliceSpec ?? null,
    updatedAt: latest.recordedAt,
    currentEventId: latest.eventId,
    currentHash: latest.hash,
    summary: latest.summary,
    nextAction: latest.nextAction,
    changedAreas: [...new Set(events.flatMap(({ changedAreas }) => changedAreas))],
    decisions: events.flatMap(({ decisions }) => decisions),
    risks: events.flatMap(({ risks }) => risks),
    blockers: events.flatMap(({ blockers }) => blockers),
    approvals: events.flatMap(({ approvals }) => approvals),
    exceptions: events.flatMap(({ exceptions }) => exceptions),
    lastCommand: latestCommandEvent?.commands.at(-1) ?? null,
    latestCheckpoint,
    pendingDispatch,
  };
}

function renderIndex(events, state) {
  const visibleEvents = [...events].reverse().slice(0, 50);
  const truncated = events.length > visibleEvents.length;
  const rows = visibleEvents.map(
    (event) =>
      `| ${event.recordedAt} | \`${event.eventId}\` | \`${event.type}\` | ${markdownEscape(event.actor)} | \`${event.status}\` | ${markdownEscape(event.summary)} |`,
  );

  return `# Workflow Index (derived from ledger)\n\n` +
    `> Shadow-mode compatibility view. Do not edit this file; rebuild it from \`${LEDGER_FILE}\`.\n\n` +
    `## Workflow Metadata\n\n` +
    `- **Workflow ID:** ${state.workflowId}\n` +
    `- **Active owner:** ${state.activeOwner}\n` +
    `- **Status:** \`${state.status}\`\n` +
    `- **Source of truth:** ${state.sourceOfTruth}\n` +
    `- **Canonical slice spec:** ${state.sliceSpec ? `\`${state.sliceSpec.path}\` (${state.sliceSpec.sliceId}, revision ${state.sliceSpec.revision}, hash \`${state.sliceSpec.hash}\`)` : "legacy workflow — not linked"}\n` +
    `- **Current event:** \`${state.currentEventId}\`\n` +
    `- **Ledger head hash:** \`${state.currentHash}\`\n` +
    `- **Last updated (UTC):** ${state.updatedAt}\n\n` +
    `## Current Position\n\n` +
    `- **Summary:** ${state.summary}\n` +
    `- **Next action:** ${state.nextAction}\n` +
    `- **Pending dispatch:** ${state.pendingDispatch ? `\`${state.pendingDispatch.eventId}\` → ${state.pendingDispatch.routing.to}` : "none"}\n\n` +
    `## Derived Views\n\n` +
    `- Latest checkpoint: ${state.latestCheckpoint ? "`ledger-views/checkpoints/latest.md`" : "none"}\n` +
    `- Cross-context handoffs: ${events.filter(({ type }) => type === "dispatch-created").length}\n` +
    `- Closeout: ${events.some(({ type }) => type === "closeout-recorded") ? "`ledger-views/closeout.md`" : "none"}\n\n` +
    `## Event Log (newest first)\n\n` +
    `| Recorded (UTC) | Event | Type | Actor | Status | Summary |\n` +
    `| --- | --- | --- | --- | --- | --- |\n` +
    `${rows.join("\n")}\n` +
    (truncated ? `\n> Showing the newest 50 of ${events.length} events; the ledger retains the complete history.\n` : "");
}

function renderCheckpoint(event) {
  return `# Workflow Checkpoint (derived)\n\n` +
    `> Source event: \`${event.eventId}\`; ledger hash: \`${event.hash}\`. Do not edit this view.\n\n` +
    `- **Workflow:** ${event.workflowId}\n` +
    `- **Source of truth:** ${event.sourceOfTruth}\n` +
    `- **Canonical slice spec:** ${event.sliceSpec ? `\`${event.sliceSpec.path}\` (${event.sliceSpec.sliceId}, revision ${event.sliceSpec.revision})` : "legacy workflow — not linked"}\n` +
    `- **Status:** \`${event.status}\`\n` +
    `- **As of:** ${event.recordedAt}\n` +
    `- **Position:** ${event.summary} → ${event.nextAction}\n\n` +
    `## Commands and exit results\n\n${commandLines(event.commands)}\n\n` +
    `## SHAs\n\n${shaLines(event.shas)}\n\n` +
    `## Changed areas\n\n${listOrNone(event.changedAreas)}\n\n` +
    `## Decisions\n\n${listOrNone(event.decisions)}\n\n` +
    `## Risks\n\n${listOrNone(event.risks)}\n\n` +
    `## Blockers\n\n${listOrNone(event.blockers)}\n\n` +
    `## Approvals\n\n${listOrNone(event.approvals)}\n\n` +
    `## Free-form exceptions\n\n${listOrNone(event.exceptions)}\n`;
}

function renderHandoff(workflowDir, event) {
  const profile = resolveEventExecutionProfile(workflowDir, event);
  const routing = event.routing;

  return `Use agent spec: ${routing.nextAgentAlias}\n\n` +
    `# Cross-Context Handoff (derived)\n\n` +
    `> This dispatch committed atomically when its single ledger event was fsynced. Validate the event ID and hash below, then execute it. **No acknowledgement round-trip is required.**\n\n` +
    `- **Dispatch Event:** ${event.eventId}\n` +
    `- **Ledger Hash:** ${event.hash}\n` +
    `- **Workflow / status:** ${event.workflowId} / \`${event.status}\`\n` +
    `- **From / to:** ${routing.from} → ${routing.to}\n` +
    `- **Return to:** ${routing.returnToAgent}\n` +
    `- **Source of truth:** ${event.sourceOfTruth}\n\n` +
    `- **Canonical slice spec:** ${event.sliceSpec ? `\`${event.sliceSpec.path}\` (${event.sliceSpec.sliceId}, revision ${event.sliceSpec.revision}, hash \`${event.sliceSpec.hash}\`)` : "legacy workflow — not linked"}\n\n` +
    `## Execution Profile Metadata\n\n` +
    (event.executionProfileId ? `- **Execution Profile ID:** \`${event.executionProfileId}\`\n` : "") +
    `- **Execution Profile:** ${profile.name}\n` +
    `- **Capability:** ${profile.capability}\n` +
    `- **Reasoning Demand:** ${profile.reasoningDemand}\n` +
    `- **Delegation:** ${profile.delegation}\n` +
    `- **Risk / Scope / Reversibility / Verification:** ${profile.risk} / ${profile.scope} / ${profile.reversibility} / ${profile.verification}\n` +
    `- **Rationale:** ${profile.rationale}\n\n` +
    `## Pass\n\n` +
    `- **Summary:** ${event.summary}\n` +
    `- **Source pointers:** ${event.sourcePointers.map((pointer) => `\`${pointer}\``).join(", ")}\n` +
    `- **Changed areas:** ${event.changedAreas.join(", ") || "none"}\n` +
    `- **Commands / results:**\n${commandLines(event.commands)}\n` +
    `- **SHAs:**\n${shaLines(event.shas)}\n` +
    `- **Decisions:**\n${listOrNone(event.decisions)}\n` +
    `- **Risks:**\n${listOrNone(event.risks)}\n` +
    `- **Blockers:**\n${listOrNone(event.blockers)}\n` +
    `- **Approvals:**\n${listOrNone(event.approvals)}\n` +
    `- **Free-form exceptions:**\n${listOrNone(event.exceptions)}\n\n` +
    `## Expect / Return Contract\n\n` +
    `- **Expect:** ${event.expectedOutput}\n` +
    `- **Next action:** ${event.nextAction}\n` +
    `- **Return To Agent:** ${routing.returnToAgent}\n` +
    `- **Routing metadata:** next_agent_alias=${routing.nextAgentAlias}; workflow_status=${routing.workflowStatus}; reentry_reason=${routing.reentryReason}\n`;
}

function renderCloseout(event) {
  return `# Workflow Closeout (derived)\n\n` +
    `> Source event: \`${event.eventId}\`; ledger hash: \`${event.hash}\`. Do not edit this view.\n\n` +
    `- **Workflow:** ${event.workflowId}\n` +
    `- **Source of truth:** ${event.sourceOfTruth}\n` +
    `- **Canonical slice spec:** ${event.sliceSpec ? `\`${event.sliceSpec.path}\` (${event.sliceSpec.sliceId}, revision ${event.sliceSpec.revision})` : "legacy workflow — not linked"}\n` +
    `- **Status:** \`${event.status}\`\n` +
    `- **Summary:** ${event.summary}\n` +
    `- **Next action:** ${event.nextAction}\n\n` +
    `## Commands and exit results\n\n${commandLines(event.commands)}\n\n` +
    `## SHAs\n\n${shaLines(event.shas)}\n\n` +
    `## Changed areas\n\n${listOrNone(event.changedAreas)}\n\n` +
    `## Decisions\n\n${listOrNone(event.decisions)}\n\n` +
    `## Remaining risks\n\n${listOrNone(event.risks)}\n\n` +
    `## Blockers\n\n${listOrNone(event.blockers)}\n\n` +
    `## Approvals\n\n${listOrNone(event.approvals)}\n\n` +
    `## Free-form exceptions\n\n${listOrNone(event.exceptions)}\n`;
}

export function rebuildWorkflowViews(workflowDir) {
  const events = readWorkflowLedger(workflowDir);
  const state = deriveState(events);
  const viewRoot = join(workflowDir, VIEW_DIRECTORY);
  const indexPath = join(viewRoot, "index.md");
  atomicWrite(indexPath, renderIndex(events, state));

  let checkpointPath = null;
  if (state.latestCheckpoint) {
    checkpointPath = join(viewRoot, "checkpoints", "latest.md");
    atomicWrite(checkpointPath, renderCheckpoint(state.latestCheckpoint));
  }

  const handoffPaths = events
    .filter(({ type }) => type === "dispatch-created")
    .map((event) => {
      const path = join(viewRoot, "handoffs", `${event.eventId}.md`);
      atomicWrite(path, renderHandoff(workflowDir, event));
      return path;
    });

  const closeoutEvent = events.filter(({ type }) => type === "closeout-recorded").at(-1);
  let closeoutPath = null;
  if (closeoutEvent) {
    closeoutPath = join(viewRoot, "closeout.md");
    atomicWrite(closeoutPath, renderCloseout(closeoutEvent));
  }

  return { indexPath, checkpointPath, handoffPaths, closeoutPath };
}

export function recoverWorkflow(workflowDir) {
  const events = readWorkflowLedger(workflowDir);
  const state = deriveState(events);
  const views = rebuildWorkflowViews(workflowDir);
  return { state, events, views };
}

function usage() {
  return [
    "Usage:",
    "  node scripts/workflow-ledger.mjs append --workflow-dir <path> --event-file <event.json>",
    "  node scripts/workflow-ledger.mjs rebuild --workflow-dir <path>",
    "  node scripts/workflow-ledger.mjs recover --workflow-dir <path>",
    "  node scripts/workflow-ledger.mjs validate --workflow-dir <path>",
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
  return { command, workflowDir: resolve(options["workflow-dir"]), eventFile: options["event-file"] };
}

function runCli() {
  try {
    const { command, workflowDir, eventFile } = parseCli(process.argv.slice(2));

    if (command === "append") {
      if (!eventFile) throw new Error("append requires --event-file\n\n" + usage());
      const input = JSON.parse(readFileSync(resolve(eventFile), "utf8"));
      const event = appendWorkflowEvent(workflowDir, input);
      console.log(`Appended ${event.eventId} (${event.type}); ledger hash ${event.hash}.`);
      return;
    }
    if (command === "rebuild") {
      rebuildWorkflowViews(workflowDir);
      console.log(`Rebuilt derived views for ${workflowDir}.`);
      return;
    }
    if (command === "recover") {
      const { state } = recoverWorkflow(workflowDir);
      console.log(JSON.stringify(state, null, 2));
      return;
    }
    if (command === "validate") {
      const events = readWorkflowLedger(workflowDir);
      console.log(`Validated ${events.length} hash-chained workflow events.`);
      return;
    }

    throw new Error(`Unknown command: ${command}\n\n${usage()}`);
  } catch (error) {
    console.error(`Workflow ledger error: ${error.message}`);
    process.exitCode = 1;
  }
}

export function runWorkflowLedgerCli() {
  runCli();
}

if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runWorkflowLedgerCli();
}
