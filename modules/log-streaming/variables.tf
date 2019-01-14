variable "prefix" {}
variable "account_id" {}
variable "elasticsearch_url" {}
variable "elasticsearch_api_key" {}

variable "log_groups" {
  type = "list"
}

variable "metric_update_frequency" {
  default="20 minutes"
}
