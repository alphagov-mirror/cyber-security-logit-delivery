var AWS = require('aws-sdk');
var https = require('https');
var zlib = require('zlib');
var crypto = require('crypto');

var metricLambda = {

    ENDPOINT: process.env.ELASTICSEARCH_URL,
    API_KEY: process.env.ELASTICSEARCH_API_KEY,
    REGION: process.env.AWS_REGION,

    init: function() {
        self = this;
        self.callbackLevel = 0;
    },

    getMetricStatistics: function(type, dimensions) {

        try {
            var cloudwatch = new AWS.CloudWatch({ region: self.REGION });
            self.Metrics[type].forEach(function (metric) {
                var Namespace = metric.Namespace;
                metric.MetricNames.forEach(function (MetricName) {
                    self.callbackLevel++;
                    var params = {
                        Period: 60,
                        StartTime: self.StartTime,
                        EndTime: self.EndTime,
                        MetricName: MetricName,
                        Namespace: Namespace,
                        Dimensions: dimensions,
                        Statistics: ["Sum"],
                        Unit: "Count"
                    };
                    console.log('Fetching ' + Namespace + ':' + MetricName + ' for ' + dimensions[0].Value);
                    console.log('Params', params);
                    cloudwatch.getMetricStatistics(params, function (err, data) {
                        if (err) {
                            console.log(err, err.stack);
                        } else {
                            console.log("Get cloudwatch metrics data succeeded", data);

                            data.Datapoints.forEach(function (datapoint) {

                                datapoint.Namespace = Namespace;
                                datapoint.MetricName = MetricName;
                                datapoint.Dimension = dimensions[0];
                                if (datapoint.Timestamp) {
                                    datapoint["@timestamp"] = datapoint.Timestamp.toISOString();
                                }

                                var type = Namespace + ':' + MetricName;

                                console.log('Datapoint: ' + type, datapoint);

                                // push instruction
                                self.bulkData.body.push({
                                    index: {
                                        _index: 'cloudwatch-metrics-'+type.replace(/[\/\:]/g,'-').toLowerCase(),
                                        _type: type,
                                        _id: Math.floor(datapoint.Timestamp.getTime() / 1000)
                                    }
                                });

                                // push data
                                self.bulkData.body.push(datapoint);
                            });

                            self.callbackLevel--;
                            if (self.callbackLevel == 0) {
                                self.sendToElasticSearch(self.bulkData);
                            }
                        }
                    });
                })
            });
        } catch(error) {
            console.log("GetMetricStatistics failed", error);
        }
    },

    sendToElasticSearch: function(bulkData) {

        if (bulkData.body.length > 0) {
            console.log('Sending ' + (bulkData.body.length/2) + ' metrics to ElasticSearch:');

            self.post(bulkData.body, function(err, data) {
                if (err) {
                    self.errorExit(err, self.context);
                    console.log("Post to Logit failed");
                } else {
                    // console.log(data);
                    self.context.succeed();
                    console.log("Post to Logit succeeded");
                }
            });
        } else {
            self.context.done();
        }
    },

    convertToAssocTags: function (tags) {
        var assocTags = {};
        tags.forEach(function(tag) {
            assocTags[tag.Key] = tag.Value;
        });
        return assocTags;
    },

    errorExit: function (message, context) {
        var res = {Error: message};
        console.log(res.Error);
        context.fail(res);
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
        }
    },

    transform: function(body) {
        var bodyText, logLines, logEntry;
        try {
            logLines = []
            // TODO switch to array.map
            body.forEach(function(item) {
                logEntry = JSON.stringify(item);
                logLines.push(logEntry);
            });
            bodyText = logLines.join("\n") + "\n";
        } catch (error) {
            console.log("Transform failed", error);
            bodyText = null;
        }
        return bodyText;
    },

    post: function(body, callback) {

        var bodyText = self.transform(body);

        console.log("Post body", bodyText);

        var requestParams = self.buildRequest(self.ENDPOINT, self.API_KEY, bodyText);
        console.log("Post request", requestParams);

        try {
            var request = https.request(requestParams, function(response) {
                var responseBody = '';
                response.on('data', function(chunk) {
                    console.log("Logit response: data", chunk);
                    responseBody += chunk;
                });
                response.on('end', function() {
                    console.log("Logit response: end");
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

                        console.log("Sent cloudwatch metrics", success);

                    }

                    var error = response.statusCode !== 200 || info.errors === true ? {
                        "statusCode": response.statusCode,
                        "responseBody": responseBody
                    } : null;

                    if (error) console.log("Failed to send cloudwatch metrics", error);

                    callback(error, success, response.statusCode, failedItems);
                });
            }).on('error', function(error) {
                callback(error);
            });

            request.end(requestParams.body);
        } catch(error) {
            callback(error);
        }
        console.log("Request ended");
    },

    getRegions: function() {
        var ec2Client = new AWS.EC2({ region: self.REGION });
        ec2Client.describeRegions({}, function(err, data) {
            if (err) {
                console.log("Unable to get region list", err);
            } else {
                self.regionList = data.Regions;
            }
        });
    },

    getApiGateways: function(region, callback) {
        var apigatewayClient = new AWS.ApiGateway({ region: self.REGION });
        apigatewayClient.getRestApis({}, function(err, data) {
            if (err) {
                callback(err, data);
            } else {
                var found = 0;
                data.ApiGateways.forEach(function (item) {
                    var assocTags = self.convertToAssocTags(item.Tags);
                    found++;
                    callback(null, item.id);
                });
                if (!found) {
                    callback('No autoscaling group found', null);
                }
            }
        });
    },

    handler: function (event, context) {

        self.EndTime = new Date;
        self.StartTime = new Date(self.EndTime - 20*60*1000);

        self.bulkData = {body:[]};
        self.context = context;

        // TODO move self into a config file or SSM
        self.Metrics = {
            CswApiGateway: [
                {
                    'Namespace': 'AWS/ApiGateway',
                    'MetricNames': [
                        "Count",
                        "4XXError",
                        "5XXError"
                    ]
                }
            ]
        };

        console.log('Start: ' + self.StartTime);
        console.log('End: ' + self.EndTime);

        // TODO make self dynamic
        self.getMetricStatistics('CswApiGateway',
        [
            {
                "Name": "ApiName",
                "Value": "cloud-security-watch"
            },
            {
                "Name": "Stage",
                "Value": "app"
            }
        ]);
    }

};

metricLambda.init();

exports.handler = metricLambda.handler;