import {
  InMemoryFactoryStateStore,
  SimulatedHarnessAdapter,
} from "@software-factory/core";
import { LocalDurableTestRunner } from "./durable-runtime.js";
import { createSoftwareFactoryWorkflow } from "./durable-workflow.js";

async function main() {
  console.log("==========================================================");
  console.log(" AWS Bedrock AgentCore Harness - Software Factory Run");
  console.log(" Orchestrator: AWS Lambda Durable Functions (TypeScript)");
  console.log("==========================================================\n");

  const stateStore = new InMemoryFactoryStateStore();
  // Simulate a realistic self-healing scenario where Attempt 1 fails a QA check
  // and Attempt 2 resolves the failure automatically.
  const harness = new SimulatedHarnessAdapter({ failFirstAttempt: true });

  const workflow = createSoftwareFactoryWorkflow({ harness, stateStore });
  const runner = new LocalDurableTestRunner(workflow);

  const result = await runner.run({
    runId: "run_demo_001",
    repository: "acme/payments-service",
    featurePrompt:
      "Add idempotency key validation middleware to POST /v1/charges",
    requireHumanApproval: false,
    maxRefinementAttempts: 2,
  });

  console.log("Checkpointed Durable Steps Executed:");
  for (const trace of runner.traces) {
    console.log(
      `  [✓] ${trace.name} (${trace.type}${trace.replayed ? ", replayed" : ""})`,
    );
  }

  console.log("\nFinal Software Factory Outcome:");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
