module "log_streaming" {
  source                  = "./modules/log-streaming"
  prefix                  = "csw-cloudwatch"
  elasticsearch_url       = "${var.logs_elasticsearch_url}"
  elasticsearch_api_key   = "${var.logs_elasticsearch_api_key}"
  log_groups              = "${var.log_groups}"
  metric_update_frequency = "${var.metric_update_frequency}"
  account_id              = "${var.account_id}"
}