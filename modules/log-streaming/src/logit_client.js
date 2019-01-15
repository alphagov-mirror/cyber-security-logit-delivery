//
'use strict'

var https = require('https');
var zlib = require('zlib');
var crypto = require('crypto');

var logitClient = {

    ENDPOINT: process.env.ELASTICSEARCH_URL,
    API_KEY: process.env.ELASTICSEARCH_API_KEY,
    REGION: process.env.AWS_REGION,

    init: function() {
        console.log("Initialised Logit client");
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

    post: function(body, callback) {

        var requestParams = this.buildRequest(this.ENDPOINT, this.API_KEY, body);
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
    }

};

console.log("Loaded Logit client");

exports.client = function() {
    return logitClient;
};
