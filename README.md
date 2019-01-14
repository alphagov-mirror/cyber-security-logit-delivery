# cyber-security-logit-delivery
Terraforms lambda subscriptions to cloud watch which deliver the data to our Logit stack.

## What it does now

At the moment most of the configuration is hard-coded into the lambdas
or into the terraform subscription filters. 

The config in tfvars allows you to set the refresh rate for the 
CloudWatch metrics data and set the list of log groups to be 
delivered.

It is currently set up to ship simple CloudWatch metrics from 
API Gateway every 20 minutes and to ship only the ERROR messages 
from the specified log group. This assumes that the log group 
contains lambda log messages which are plain text prefixed by 
ERROR or DEBUG.   

## Next steps

1. Refactor the lambda code to implement the logit client once. 
2. Add some lambda unit tests using mocha
3. Extract the config into separate files for the log and metric 
config. 
4. Implement the log group subscription and log filter pattern 
separately so you can have different filters applied to different
log groups.
5. Decide how to separate log stacks and how to implement cross 
account.
6. Move config data into a separate private repo    
