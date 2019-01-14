data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "./modules/log-streaming/src"
  output_path = "./modules/log-streaming/${var.prefix}-cloudwatch.zip"
}

resource "aws_cloudwatch_log_group" "lambda_logs" {
  name              = "/aws/lambda/${var.prefix}-log-group"
  retention_in_days = 7
}

data "template_file" "trust" {
  template = "${file("${path.module}/json/trust.json")}"
}

resource "aws_iam_role" "lambda_execution_role" {
  name = "${var.prefix}-lambda-execution-role"

  assume_role_policy = "${data.template_file.trust.rendered}"
}

data "template_file" "policy" {
  template = "${file("${path.module}/json/policy.json")}"

  vars {
    region      = "${data.aws_region.current.name}"
    account_id  = "${var.account_id}"
  }
}

resource "aws_iam_role_policy" "lambda_logging" {
  name = "${var.prefix}-lambda-role-policy"
  role = "${aws_iam_role.lambda_execution_role.id}"

  policy = "${data.template_file.policy.rendered}"
}

resource "aws_lambda_function" "log_stream_lambda" {
  function_name    = "${var.prefix}-log-stream-lambda"
  description      = "Stream CloudWatch Logs to Elasticsearch"
  filename         = "./modules/log-streaming/${var.prefix}-cloudwatch.zip"
  source_code_hash = "${data.archive_file.lambda_zip.output_base64sha256}"
  role             = "${aws_iam_role.lambda_execution_role.arn}"
  handler          = "logs.handler"
  runtime          = "nodejs6.10"
  memory_size      = 128
  timeout          = 10

  environment {
    variables = {
      ELASTICSEARCH_URL     = "${var.elasticsearch_url}"
      ELASTICSEARCH_API_KEY = "${var.elasticsearch_api_key}"
    }
  }
}

resource "aws_lambda_function" "metric_stream_lambda" {
  function_name    = "${var.prefix}-metric-stream-lambda"
  description      = "Send CloudWatch Metrics to Elasticsearch"
  filename         = "./modules/log-streaming/${var.prefix}-cloudwatch.zip"
  source_code_hash = "${data.archive_file.lambda_zip.output_base64sha256}"
  role             = "${aws_iam_role.lambda_execution_role.arn}"
  handler          = "metrics.handler"
  runtime          = "nodejs6.10"
  memory_size      = 128
  timeout          = 10

  environment {
    variables = {
      ELASTICSEARCH_URL     = "${var.elasticsearch_url}"
      ELASTICSEARCH_API_KEY = "${var.elasticsearch_api_key}"
    }
  }
}

resource "aws_cloudwatch_event_rule" "metric_refresh_rate" {
  name = "${var.prefix}-metric-refresh-rate"
  description = "Update cloud watch metrics to Logit on schedule"
  schedule_expression = "rate(${var.metric_update_frequency})"
}

resource "aws_cloudwatch_event_target" "metric_event_target" {
  rule = "${aws_cloudwatch_event_rule.metric_refresh_rate.name}"
  target_id = "metric_stream_lambda"
  arn = "${aws_lambda_function.metric_stream_lambda.arn}"
}

resource "aws_lambda_permission" "metric_lambda_permission" {
  statement_id = "AllowExecutionFromCloudWatch"
  action = "lambda:InvokeFunction"
  function_name = "${aws_lambda_function.metric_stream_lambda.function_name}"
  principal = "events.amazonaws.com"
  source_arn = "${aws_cloudwatch_event_rule.metric_refresh_rate.arn}"
}

