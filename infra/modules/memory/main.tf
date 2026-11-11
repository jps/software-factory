variable "name_prefix" {
  type = string
}

variable "event_expiry_days" {
  type    = number
  default = 30
}

data "aws_iam_policy_document" "memory_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["bedrock-agentcore.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "memory_execution" {
  name               = "${var.name_prefix}-agentcore-memory-role"
  assume_role_policy = data.aws_iam_policy_document.memory_assume_role.json
}

resource "aws_iam_role_policy_attachment" "memory_inference" {
  role       = aws_iam_role.memory_execution.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonBedrockAgentCoreMemoryBedrockModelInferenceExecutionRolePolicy"
}

resource "aws_bedrockagentcore_memory" "factory" {
  name                      = replace("${var.name_prefix}_memory", "-", "_")
  description               = "Shared cross-session memory for the Software Factory AgentCore Harnesses"
  event_expiry_duration     = var.event_expiry_days
  memory_execution_role_arn = aws_iam_role.memory_execution.arn
}

output "memory_id" {
  value = aws_bedrockagentcore_memory.factory.id
}
