output "artifacts_bucket_name" {
  description = "S3 bucket storing durable specs, source bundles, and QA/Review reports"
  value       = module.storage.artifacts_bucket_name
}

output "state_table_name" {
  description = "DynamoDB table storing Software Factory run state and callback tokens"
  value       = module.storage.state_table_name
}

output "agentcore_memory_id" {
  description = "Amazon Bedrock AgentCore Memory ID shared by the Software Factory"
  value       = module.memory.memory_id
}

output "specialist_harness_ids" {
  description = "Map of specialist role to provisioned aws_bedrockagentcore_harness ID"
  value = {
    for role, h in module.agent_harnesses : role => h.harness_id
  }
}

output "specialist_harness_arns" {
  description = "Map of specialist role to provisioned aws_bedrockagentcore_harness ARN"
  value = {
    for role, h in module.agent_harnesses : role => h.harness_arn
  }
}

output "durable_orchestrator_function_name" {
  description = "AWS Lambda Durable Function name orchestrating the Software Factory"
  value       = module.durable_orchestrator.orchestrator_function_name
}

output "durable_orchestrator_function_arn" {
  description = "AWS Lambda Durable Function ARN"
  value       = module.durable_orchestrator.orchestrator_function_arn
}

output "harness_tools_function_arn" {
  description = "AWS Lambda function ARN backing AgentCore Harness tool calls"
  value       = module.durable_orchestrator.tools_function_arn
}
