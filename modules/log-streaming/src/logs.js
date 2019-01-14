// Based on AWS Cloudwatch "Stream to Amazon Elasticsearch Service" funcion v1.1.2
// Required stack parameters:
// * EnvVarElasticsearchEndpoint - Amazon Elasticsearch Service domain endpoint

var https = require('https');
var zlib = require('zlib');
var crypto = require('crypto');

var logLambda = {

    ENDPOINT: process.env.ELASTICSEARCH_URL,
    API_KEY: process.env.ELASTICSEARCH_API_KEY,
    REGION: process.env.AWS_REGION,

    init: function() {
        self = this;
        self.callbackLevel = 0;
    },

    handler: function(input, context) {
    // decode input from base64
        var zippedInput = new Buffer(input.awslogs.data, 'base64');

        // decompress the input
        zlib.gunzip(zippedInput, function(error, buffer) {
            if (error) { context.fail(error); return; }

            // parse the input from JSON
            var awslogsData = JSON.parse(buffer.toString('utf8'));

            // transform the input to Elasticsearch documents
            var elasticsearchBulkData = self.transform(awslogsData);

            // skip control messages
            if (!elasticsearchBulkData) {
                console.log('Received a control message');
                context.succeed('Control message handled successfully');
                return;
            }

            // post documents to the Amazon Elasticsearch Service
            self.post(elasticsearchBulkData, self.responseCallback);

        });
    },

    responseCallback: function(error, success, statusCode, failedItems) {
        console.log('Response: ' + JSON.stringify({
            "statusCode": statusCode
        }));

        if (error) {
            console.log('Error: ' + JSON.stringify(error, null, 2));

            if (failedItems && failedItems.length > 0) {
                console.log("Failed Items: " +
                    JSON.stringify(failedItems, null, 2));
            }

            context.fail(JSON.stringify(error));
        } else {
            console.log('Success: ' + JSON.stringify(success));
            context.succeed('Success');
        }
    },

    transform: function(payload) {
        if (payload.messageType === 'CONTROL_MESSAGE') {
            return null;
        }

        var bulkRequestBody = '';

        payload.logEvents.forEach(function(logEvent) {
            var timestamp, source, indexName;
            timestamp = new Date(1 * logEvent.timestamp);

            // index by cloud watch log group
            indexName = 'cloudwatch-logs-' + payload.logGroup.replace(/[\/\:]/g,'-');

            //var source = self.buildSource(logEvent.message, payload.logGroup);
            source = logEvent;

            console.log("LogEvent",logEvent);

            source['instance_id'] = payload.logStream;

            source['@timestamp'] = timestamp.toISOString();

            var action = {
                index: {
                    _index: indexName,
                    _type: payload.logGroup,
                    _id: logEvent.id
                }
            };

            bulkRequestBody += [
                JSON.stringify(action),
                JSON.stringify(source),
            ].join('\n') + '\n';
        });
        console.log("Post CloudWatch logs stringified body", bulkRequestBody)
        return bulkRequestBody;
    },

    buildSource: function(message, logGroup) {
        var jsonSubString = self.extractJson(message);
        if (jsonSubString === null) {
            return {};
        }

        var source = JSON.parse(jsonSubString);

        ['time', 'user'].forEach(function (key) {
            delete source[key];
        });

        // If self is a SNS feedback log `status` will be set to 'SUCCESS' or 'FAILURE' which Kibana will reject due to a
        // `number_format_exception` (it expects `status` to be a number rather than a string). We can transform it to the
        // http code from the delivery report, and move the existing value to a different key.
        if (logGroup.startsWith('sns')) {
          source['sns_feedback_status'] = source['status']
          source['status'] = source['delivery']['statusCode']
        }

        // Convert nested objects and arrays to strings to stop Kibana from rejecting records
        // for missing nested keys mappings
        Object.keys(source).forEach(function (key) {
          if (typeof source[key] === 'object' && source[key] !== null) {
            source[key] = JSON.stringify(source[key]);
          }
        });

        return source;
    },

    extractJson: function(message) {
        var jsonStart = message.indexOf('{');
        if (jsonStart < 0) return null;
        var jsonSubString = message.substring(jsonStart);
        return self.isValidJson(jsonSubString) ? jsonSubString : null;
    },

    isValidJson: function(message) {
        try {
            JSON.parse(message);
        } catch (e) { return false; }
        return true;
    },

    post: function(body, callback) {
        var requestParams = self.buildRequest(self.ENDPOINT, self.API_KEY, body);

        var request = https.request(requestParams, function(response) {
            var responseBody = '';
            response.on('data', function(chunk) {
                console.log("Logit response chunk", chunk);
                responseBody += chunk;
            });
            response.on('end', function() {
                var info = JSON.parse(responseBody);
                var failedItems;
                var success;

                if (response.statusCode >= 200 && response.statusCode < 299) {
                    failedItems = info.items.filter(function(x) {
                        return x.index.status >= 300;
                    });

                    success = {
                        "attemptedItems": info.items.length,
                        "successfulItems": info.items.length - failedItems.length,
                        "failedItems": failedItems.length
                    };
                }

                var error = response.statusCode !== 200 || info.errors === true ? {
                    "statusCode": response.statusCode,
                    "responseBody": responseBody
                } : null;

                callback(error, success, response.statusCode, failedItems);
            });
        }).on('error', function(error) {
            console.log("Logit response error", error);
            callback(error);
        });
        request.end(requestParams.body);
    },

    buildRequest: function(endpoint, api_key, body) {
        return {
            host: endpoint,
            method: 'POST',
            path: '/_bulk',
            body: body,
            headers: {
                'Host': endpoint,
                'ApiKey': api_key,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
            }
        };
    }

};

logLambda.init();

exports.handler = logLambda.handler;