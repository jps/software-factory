/**
 * Durable Execution Context & Replay Engine compatible with `@aws/durable-execution-sdk-js`.
 *
 * On AWS Lambda with `durable_config` enabled, `@aws/durable-execution-sdk-js`
 * intercepts `context.step()`, `context.wait()`, and `context.waitForCallback()`
 * to checkpoint state and suspend/resume invocations with zero idle compute cost.
 *
 * This module also exports `LocalDurableTestRunner` so workflows can be tested
 * and simulated locally with full checkpoint replay semantics.
 */

export interface DurableWaitDuration {
  seconds?: number;
  minutes?: number;
  hours?: number;
}

export interface WaitForCallbackOptions {
  timeout?: DurableWaitDuration;
}

export interface DurableContext {
  /**
   * Executes an atomic, checkpointed unit of work.
   * On replay after a suspension or failure, completed steps return their
   * cached checkpoint value without re-executing `fn`.
   */
  step<T>(name: string, fn: () => Promise<T>): Promise<T>;

  /**
   * Suspends execution for the specified duration without idle compute cost.
   */
  wait(duration: DurableWaitDuration): Promise<void>;

  /**
   * Suspends execution and waits for an external system or human-in-the-loop
   * callback (`SendDurableExecutionCallbackSuccess` / `SendDurableExecutionCallbackFailure`).
   */
  waitForCallback<T = unknown>(
    name: string,
    submitter: (callbackId: string) => Promise<void>,
    options?: WaitForCallbackOptions,
  ): Promise<T>;
}

export type DurableWorkflowFn<TEvent, TResult> = (
  event: TEvent,
  context: DurableContext,
) => Promise<TResult>;

export class DurableExecutionSuspendedError extends Error {
  public readonly stepName: string;
  public readonly callbackId: string;

  constructor(stepName: string, callbackId: string) {
    super(
      `Durable execution suspended at callback '${stepName}' (callbackId: ${callbackId})`,
    );
    this.name = "DurableExecutionSuspendedError";
    this.stepName = stepName;
    this.callbackId = callbackId;
  }
}

/**
 * Wraps a durable workflow handler function.
 * When invoked by AWS Lambda Durable Functions runtime, delegates to the
 * injected durable context; when invoked standalone, provides a checkpointing context.
 */
export function withDurableExecution<TEvent, TResult>(
  workflow: DurableWorkflowFn<TEvent, TResult>,
): (event: TEvent, context?: DurableContext) => Promise<TResult> {
  return async (event: TEvent, providedContext?: DurableContext) => {
    if (providedContext && typeof providedContext.step === "function") {
      return workflow(event, providedContext);
    }
    const runner = new LocalDurableTestRunner(workflow);
    return runner.run(event);
  };
}

export interface StepExecutionTrace {
  name: string;
  type: "step" | "wait" | "callback";
  replayed: boolean;
  output?: unknown;
}

/**
 * Local durable execution test runner (`LocalDurableTestRunner`) that models
 * AWS Lambda Durable Functions checkpointing, suspension, and replay semantics.
 */
export class LocalDurableTestRunner<TEvent, TResult> {
  private readonly workflow: DurableWorkflowFn<TEvent, TResult>;
  private readonly checkpoints = new Map<string, unknown>();
  private readonly callbackPayloads = new Map<string, unknown>();
  public readonly traces: StepExecutionTrace[] = [];

  constructor(workflow: DurableWorkflowFn<TEvent, TResult>) {
    this.workflow = workflow;
  }

  /**
   * Pre-registers or resolves a callback response by callback step name or callbackId.
   */
  public resolveCallback(nameOrId: string, payload: unknown): void {
    this.callbackPayloads.set(nameOrId, payload);
  }

  public getCheckpoints(): ReadonlyMap<string, unknown> {
    return this.checkpoints;
  }

  public async run(event: TEvent): Promise<TResult> {
    const context: DurableContext = {
      step: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
        if (this.checkpoints.has(name)) {
          const cached = this.checkpoints.get(name) as T;
          this.traces.push({
            name,
            type: "step",
            replayed: true,
            output: cached,
          });
          return cached;
        }
        const value = await fn();
        this.checkpoints.set(name, value);
        this.traces.push({
          name,
          type: "step",
          replayed: false,
          output: value,
        });
        return value;
      },

      wait: async (duration: DurableWaitDuration): Promise<void> => {
        const key = `wait:${JSON.stringify(duration)}`;
        const replayed = this.checkpoints.has(key);
        this.checkpoints.set(key, true);
        this.traces.push({ name: key, type: "wait", replayed });
      },

      waitForCallback: async <T = unknown>(
        name: string,
        submitter: (callbackId: string) => Promise<void>,
      ): Promise<T> => {
        const callbackId = `cb_${name}`;
        const submittedKey = `callback-submitted:${name}`;

        if (!this.checkpoints.has(submittedKey)) {
          await submitter(callbackId);
          this.checkpoints.set(submittedKey, callbackId);
        }

        if (this.checkpoints.has(name)) {
          const cached = this.checkpoints.get(name) as T;
          this.traces.push({
            name,
            type: "callback",
            replayed: true,
            output: cached,
          });
          return cached;
        }

        const resolved =
          this.callbackPayloads.get(name) ??
          this.callbackPayloads.get(callbackId);
        if (resolved !== undefined) {
          this.checkpoints.set(name, resolved);
          this.traces.push({
            name,
            type: "callback",
            replayed: false,
            output: resolved,
          });
          return resolved as T;
        }

        throw new DurableExecutionSuspendedError(name, callbackId);
      },
    };

    return this.workflow(event, context);
  }
}
