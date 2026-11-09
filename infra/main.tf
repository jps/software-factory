locals {
  name_prefix = "${var.project_name}-${var.environment}"

  specialist_agents = {
    architect = {
      temperature   = 0.2
      system_prompt = <<-EOT
        You are the Lead Software Factory Architect running on Amazon Bedrock AgentCore Harness.
        Analyze the incoming feature request, repository structure, and architectural constraints.
        Produce a deterministic JSON specification detailing architecture decisions, target files
        to create or modify, and testable acceptance criteria.
      EOT
    }
    builder = {
      temperature   = 0.2
      system_prompt = <<-EOT
        You are the Software Factory Builder Agent running on Amazon Bedrock AgentCore Harness.
        Implement production-grade TypeScript code and unit tests strictly adhering to the
        Architect's specification and resolving any QA or Security Reviewer feedback.
      EOT
    }
    tester = {
      temperature   = 0.1
      system_prompt = <<-EOT
        You are the Software Factory QA & Verification Agent running on Amazon Bedrock AgentCore Harness.
        Execute verification suites against the Builder's artifacts, evaluate test coverage against
        acceptance criteria, and report structured failure diagnostics.
      EOT
    }
    reviewer = {
      temperature   = 0.1
      system_prompt = <<-EOT
        You are the Software Factory Security & Code Reviewer Agent running on Amazon Bedrock AgentCore Harness.
        Audit the implementation artifacts and QA report for security vulnerabilities (OWASP, IAM least privilege,
        secret exposure) and architectural compliance before approving the release.
      EOT
    }
  }
}

# 1. Serverless State & Durable Artifact Layer (S3 + DynamoDB)
module "storage" {
  source      = "./modules/storage"
  name_prefix = local.name_prefix
}

# 2. Amazon Bedrock AgentCore Shared Memory Layer
module "memory" {
  source            = "./modules/memory"
  name_prefix       = local.name_prefix
  event_expiry_days = var.memory_event_expiry_days
}

# 3. Specialist Amazon Bedrock AgentCore Harnesses (Architect, Builder, Tester, Reviewer)
module "agent_harnesses" {
  source   = "./modules/agent-harness"
  for_each = local.specialist_agents

  harness_name         = "${local.name_prefix}-${each.key}"
  role_key             = each.key
  model_id             = var.foundation_model_id
  temperature          = each.value.temperature
  system_prompt        = each.value.system_prompt
  artifacts_bucket_arn = module.storage.artifacts_bucket_arn
  state_table_arn      = module.storage.state_table_arn
}

# 4. AWS Lambda Durable Function Orchestrator & Tool Runtime
module "durable_orchestrator" {
  source = "./modules/durable-orchestrator"

  name_prefix                       = local.name_prefix
  artifacts_bucket_name             = module.storage.artifacts_bucket_name
  artifacts_bucket_arn              = module.storage.artifacts_bucket_arn
  state_table_name                  = module.storage.state_table_name
  state_table_arn                   = module.storage.state_table_arn
  agentcore_memory_id               = module.memory.memory_id
  durable_execution_timeout_seconds = var.durable_execution_timeout_seconds
  durable_retention_days            = var.durable_retention_days

  harness_ids = {
    for k, h in module.agent_harnesses : k => h.harness_id
  }
  harness_arns = [
    for h in module.agent_harnesses : h.harness_arn
  ]

  orchestrator_zip_path = "${path.module}/../packages/orchestrator/dist/orchestrator.zip"
  tools_zip_path        = "${path.module}/../packages/tools/dist/tools.zip"
}
