resource "aws_lambda_permission" "cloudwatch_application" {
  count         = "${length(var.log_groups)}"
  statement_id  = "cloudwatch-lambda-${element(var.log_groups, count.index)}"
  action        = "lambda:InvokeFunction"
  function_name = "${aws_lambda_function.log_stream_lambda.arn}"
  principal     = "logs.${data.aws_region.current.name}.amazonaws.com"
  source_arn    = "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${element(var.log_groups, count.index)}:*"
}

resource "aws_cloudwatch_log_subscription_filter" "elasticsearch_subscription_application_errors" {
  count           = "${length(var.log_groups)}"
  name            = "elasticsearch-subscription-group-${element(var.log_groups, count.index)}-errors"
  log_group_name  = "/aws/lambda/${element(var.log_groups, count.index)}"
  filter_pattern  = "DEBUG"
  destination_arn = "${aws_lambda_function.log_stream_lambda.arn}"
  depends_on      = ["aws_lambda_permission.cloudwatch_application"]
}

