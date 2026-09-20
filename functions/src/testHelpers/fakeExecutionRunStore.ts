import type { AcceptExecutionRunOutcome, AcceptExecutionRunTransaction, RunAcceptExecutionRunTransaction } from "../acceptExecutionRun";
import type { ExecutionRunDocument } from "../schemas/executionRunDocument";

/**
 * A minimal in-memory Firestore transaction fake shared by `acceptExecutionRun` and
 * `onAdaExecutionRequestPublished` unit tests: reads happen against a shared store, writes are
 * staged and only applied to the store if the transaction's work function resolves without
 * throwing (mirroring Firestore's atomic commit-or-rollback behaviour), and concurrent calls are
 * serialized one at a time (mirroring Firestore's optimistic-concurrency retry guarantee that a
 * transaction never observes another transaction's writes mid-flight).
 */
export class FakeExecutionRunStore {
  private readonly documents = new Map<string, ExecutionRunDocument>();
  private queue: Promise<unknown> = Promise.resolve();

  runTransaction: RunAcceptExecutionRunTransaction = (work) => {
    const run = this.queue.then(async () => {
      let staged: ExecutionRunDocument | undefined;
      const tx: AcceptExecutionRunTransaction = {
        getExistingRun: async () => this.documents.get("req-1"),
        createRun: (document) => {
          staged = document;
        },
      };
      const outcome: AcceptExecutionRunOutcome = await work(tx);
      if (outcome === "created" && staged) {
        this.documents.set(staged.executionRequestId, staged);
      }
      return outcome;
    });
    this.queue = run.catch(() => undefined);
    return run as Promise<AcceptExecutionRunOutcome>;
  };

  get(executionRequestId: string): ExecutionRunDocument | undefined {
    return this.documents.get(executionRequestId);
  }

  size(): number {
    return this.documents.size;
  }
}
