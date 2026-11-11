import type {
  AgentRole,
  ArchitectSpec,
  BuildArtifact,
  QAReport,
  ReviewVerdict,
} from "./schemas.js";

export interface HarnessInvokeInput {
  role: AgentRole;
  harnessIdentifier: string;
  sessionId: string;
  prompt: string;
  context: Record<string, unknown>;
}

export interface AgentCoreHarnessAdapter {
  invoke<T>(input: HarnessInvokeInput, parse: (raw: unknown) => T): Promise<T>;
}

export interface HarnessEndpointMap {
  architect: string;
  builder: string;
  tester: string;
  reviewer: string;
  memoryId?: string;
}

/**
 * Default environment-driven configuration mapping each Software Factory specialist
 * to its provisioned `aws_bedrockagentcore_harness` ARN or ID.
 */
export function getHarnessEndpointsFromEnv(): HarnessEndpointMap {
  return {
    architect:
      process.env.ARCHITECT_HARNESS_ID ?? "harness-architect-placeholder",
    builder: process.env.BUILDER_HARNESS_ID ?? "harness-builder-placeholder",
    tester: process.env.TESTER_HARNESS_ID ?? "harness-tester-placeholder",
    reviewer: process.env.REVIEWER_HARNESS_ID ?? "harness-reviewer-placeholder",
    memoryId: process.env.AGENTCORE_MEMORY_ID,
  };
}

/**
 * Deterministic local/simulated AgentCore Harness adapter for local durable
 * execution testing (`LocalDurableTestRunner`) and offline simulation.
 */
export class SimulatedHarnessAdapter implements AgentCoreHarnessAdapter {
  private readonly failFirstAttempt: boolean;

  constructor(options?: { failFirstAttempt?: boolean }) {
    this.failFirstAttempt = options?.failFirstAttempt ?? false;
  }

  async invoke<T>(
    input: HarnessInvokeInput,
    parse: (raw: unknown) => T,
  ): Promise<T> {
    const runId = String(input.context.runId ?? input.sessionId);
    const attempt = Number(input.context.attempt ?? 1);
    const bucket = process.env.ARTIFACTS_BUCKET ?? "software-factory-artifacts";

    switch (input.role) {
      case "architect": {
        const spec: ArchitectSpec = {
          summary: `Architecture specification for: ${input.prompt}`,
          architectureDecisions: [
            "Use AWS Lambda Durable Functions (@aws/durable-execution-sdk-js) for stateful checkpointed orchestration",
            "Persist durable specifications and source bundles in S3 and run state in DynamoDB",
            "Isolate specialist agent permissions via per-harness IAM execution roles",
          ],
          targetFiles: [
            {
              path: "src/feature/handler.ts",
              action: "create",
              purpose: "Implement core feature entrypoint",
            },
            {
              path: "src/feature/handler.test.ts",
              action: "create",
              purpose: "Unit and integration tests for feature handler",
            },
          ],
          acceptanceCriteria: [
            "All unit tests pass with >= 85% coverage",
            "Zero HIGH or CRITICAL security findings",
          ],
          specS3Uri: `s3://${bucket}/runs/${runId}/spec.json`,
        };
        return parse(spec);
      }

      case "builder": {
        const artifact: BuildArtifact = {
          attempt,
          modifiedFiles: [
            {
              path: "src/feature/handler.ts",
              s3Key: `runs/${runId}/attempts/${attempt}/src/feature/handler.ts`,
              linesChanged: 84,
            },
            {
              path: "src/feature/handler.test.ts",
              s3Key: `runs/${runId}/attempts/${attempt}/src/feature/handler.test.ts`,
              linesChanged: 62,
            },
          ],
          commitSummary: `feat: implement requested feature (attempt ${attempt})`,
          bundleS3Uri: `s3://${bucket}/runs/${runId}/attempts/${attempt}/bundle.json`,
        };
        return parse(artifact);
      }

      case "tester": {
        const shouldFail = this.failFirstAttempt && attempt === 1;
        const report: QAReport = {
          passed: !shouldFail,
          totalTests: 12,
          failedTests: shouldFail ? 1 : 0,
          coveragePercent: shouldFail ? 78 : 94,
          failures: shouldFail
            ? ["src/feature/handler.test.ts: missing edge-case input validation"]
            : [],
        };
        return parse(report);
      }

      case "reviewer": {
        const verdict: ReviewVerdict = {
          approved: true,
          securityFindings: [],
          feedback: ["Clean implementation conforming to architecture spec."],
        };
        return parse(verdict);
      }
    }
  }
}
