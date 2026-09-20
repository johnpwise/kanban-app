import { Timestamp } from "firebase-admin/firestore";

import { executionRunDocumentSchema } from "./schemas/executionRunDocument";

import type { DispatchMessage } from "./schemas/dispatchMessage";
import type { ExecutionRunDocument, ExecutionRunInput } from "./schemas/executionRunDocument";

export interface AcceptExecutionRunLogger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * The transaction-scoped operations `acceptExecutionRun` needs. Mirrors the two things a
 * Firestore transaction actually does here — read the current state, then stage a create — so the
 * real implementation is a thin adapter over `firestore.runTransaction`, and tests can use a
 * lightweight in-memory fake instead of the emulator.
 */
export interface AcceptExecutionRunTransaction {
  getExistingRun(): Promise<ExecutionRunDocument | undefined>;
  createRun(document: ExecutionRunDocument): void;
}

export type AcceptExecutionRunOutcome = "created" | "duplicate" | "conflict";

export type RunAcceptExecutionRunTransaction = (
  work: (tx: AcceptExecutionRunTransaction) => Promise<AcceptExecutionRunOutcome>,
) => Promise<AcceptExecutionRunOutcome>;

export interface AcceptExecutionRunParams {
  message: DispatchMessage;
  /** The first Pub/Sub transport message id seen for this logical request, when available. */
  firstMessageId?: string;
  runTransaction: RunAcceptExecutionRunTransaction;
  logger: AcceptExecutionRunLogger;
}

function toInput(message: DispatchMessage): ExecutionRunInput {
  return {
    title: message.title,
    prompt: message.prompt,
    repository: message.repository,
    baseBranch: message.baseBranch,
    requestedBy: message.requestedBy,
    requestedAt: message.requestedAt,
    schemaVersion: message.schemaVersion,
    eventType: message.eventType,
  };
}

function isSameLogicalRun(existing: ExecutionRunDocument, message: DispatchMessage, input: ExecutionRunInput): boolean {
  return (
    existing.correlationId === message.correlationId &&
    existing.projectId === message.projectId &&
    existing.cardId === message.cardId &&
    JSON.stringify(existing.input) === JSON.stringify(input)
  );
}

/**
 * Idempotently accepts a validated dispatch message into `executionRuns/{executionRequestId}`.
 *
 * - No existing run: creates it with `status: "accepted"`.
 * - An existing run with identical immutable data: treated as a duplicate Pub/Sub delivery —
 *   logged and left alone.
 * - An existing run with conflicting immutable data for the same id: logged as a permanent
 *   conflict and left alone — never overwritten.
 *
 * Never reads or writes the Execution Request, Project, Card, or Kanban column: the only Firestore
 * access this function performs is the injected `runTransaction` against `executionRuns`.
 */
export async function acceptExecutionRun({
  message,
  firstMessageId,
  runTransaction,
  logger,
}: AcceptExecutionRunParams): Promise<void> {
  const input = toInput(message);

  const outcome = await runTransaction(async (tx) => {
    const existing = await tx.getExistingRun();

    if (!existing) {
      // Validated defensively before it ever reaches Firestore: a future bug in this
      // construction should surface as a clear schema error, not a malformed stored document.
      const document = executionRunDocumentSchema.parse({
        executionRequestId: message.executionRequestId,
        correlationId: message.correlationId,
        projectId: message.projectId,
        cardId: message.cardId,
        status: "accepted",
        acceptedAt: Timestamp.now(),
        ...(firstMessageId ? { firstMessageId } : {}),
        input,
      } satisfies ExecutionRunDocument);
      tx.createRun(document);
      return "created";
    }

    return isSameLogicalRun(existing, message, input) ? "duplicate" : "conflict";
  });

  const logMeta = { executionRequestId: message.executionRequestId, correlationId: message.correlationId };

  if (outcome === "created") {
    logger.info("ADA execution run accepted.", logMeta);
    return;
  }

  if (outcome === "duplicate") {
    logger.info("Duplicate ADA execution run delivery ignored; run already accepted.", logMeta);
    return;
  }

  logger.error("Conflicting ADA execution run data for an existing run id; existing run was not overwritten.", logMeta);
}
