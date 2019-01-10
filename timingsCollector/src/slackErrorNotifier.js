const url = require('url');
const https = require('https');
const common = require('./common.js')

// Thanks to https://github.com/awslabs/serverless-application-model/blob/master/examples/apps/cloudwatch-alarm-to-slack/index.js

exports.handler = (event, context, callback) => {
  processEvent(
    event, 
    common.getAndCheckEnvVar("SLACK_URL"),
    common.getAndCheckEnvVar("SLACK_CHANNEL"),
    callback
    );
};

function processEvent(event, slackUrl, slackChannel, callback) {
  const message = JSON.parse(event.Records[0].Sns.Message);

  const slackMessage = {
      channel: slackChannel,
      text: `${message.AlarmName} state is now ${message.NewStateValue}: ${message.NewStateReason}`,
  };

  postMessage(slackMessage, slackUrl, (response) => {
      if (response.statusCode < 400) {
          console.info('Message posted successfully');
          callback(null);
      } else if (response.statusCode < 500) {
          console.error(`Error posting message to Slack API: ${response.statusCode} - ${response.statusMessage}`);
          callback(null);  // Don't retry because the error is due to a problem with the request
      } else {
          // Let Lambda retry
          callback(`Server error when processing message: ${response.statusCode} - ${response.statusMessage}`);
      }
  });
}

function postMessage(message, slackUrl, callback) {
  const body = JSON.stringify(message);
  const options = url.parse(slackUrl);
  options.method = 'POST';
  options.headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
  };

  const postReq = https.request(options, (res) => {
      const chunks = [];
      res.setEncoding('utf8');
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
          if (callback) {
              callback({
                  body: chunks.join(''),
                  statusCode: res.statusCode,
                  statusMessage: res.statusMessage,
              });
          }
      });
      return res;
  });

  postReq.write(body);
  postReq.end();
}