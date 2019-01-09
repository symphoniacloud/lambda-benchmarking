const AWS = require('aws-sdk');
const common = require('./common.js')
const generators = require('./generators.js')
const stringify = require('csv-stringify/lib/sync')

const defaultRegion = "us-west-2";

const s3 = new AWS.S3({ region: defaultRegion });

// Eequivalent to { "us-east-1": new AWS.XRay({region: "us-east-1"}), etc... }
const xray = Object.assign({}, ...common.allRegions.map(region => ({[region]: new AWS.XRay({region: region})})));

// Uncomment this for local testing
// collectTimings(
//   "symphonia-mike-dev", 
//   ["lambda-benchmarking-node8-generators"],
//   ["us-west-2"]
//   )

exports.handler = async (event, context) => {
  await collectTimings(
    common.getAndCheckEnvVar("BUCKET_NAME"),
    [common.getAndCheckEnvVar("NODE8_GENERATOR_STACK_NAME"), common.getAndCheckEnvVar("JAVA8_GENERATOR_STACK_NAME")],
    common.allRegions
  );
}

async function collectTimings(bucketName, stackNames, regions) {
  const generatorSpecs = generators.createGeneratorSpecs(regions)
  const generatorInstanceSpecs = await generators.createGeneratorInstanceSpecs(stackNames, regions, generatorSpecs);
  const timings = await Promise.all(generatorInstanceSpecs.map(queryXRayForTimings))
  const instanceMergedTimings = generatorSpecs.map(generator => mergeInstanceTimings(generator, timings));
  await publishHTML(instanceMergedTimings, bucketName);
  await publishJSON(instanceMergedTimings, bucketName);
  await publishCSV(instanceMergedTimings, bucketName);
  await updateIndexes(bucketName);
}

async function queryXRayForTimings(generator) {
  const traceSummaries = await getTraceSummaries(generator);

  const traces = (await xray[generator.region].batchGetTraces({
    TraceIds: traceSummaries.map(summary => summary.Id)
  }).promise()).Traces;

  const timingData = traces.map(trace => processTrace(trace, generator));
  // Just want latest values for this generator
  return timingData.sort((a, b) => a.startTime - b.startTime)[timingData.length - 1];
}

async function getTraceSummaries(generator) {
  const now = new Date().getTime() / 1000;
  return getPaginatedTraceSummaries(now, generator, null, []);
}

async function getPaginatedTraceSummaries(endTime, generator, nextToken, summariesAccumulator) {
  const traceSummaryResults = await xray[generator.region].getTraceSummaries({
    StartTime: endTime - 60 * 60, // Last hour
    EndTime: endTime,
    FilterExpression: `service("${generator.generatorFunction}")`,
    NextToken: nextToken
  }).promise();

  const newTraceSummaries = summariesAccumulator.concat(traceSummaryResults.TraceSummaries);

  if (traceSummaryResults.NextToken)
    return await getPaginatedTraceSummaries(endTime, generator, traceSummaryResults.NextToken, newTraceSummaries);
  else
    return newTraceSummaries;
}

// A "trace" in X-Ray corresponds to all the activity to do with an event
// A "segment" corresponds to different activities within the trace, and segments can overlap
// The traces we're looking at all have two segments - one where the "origin" is 
// named "AWS::Lambda" - this corresponds to the entire activity within Lambda to process the event
// including "system" time (outside of our code), and "user" time, that which is spent inside our
// code (includes both our specified initialization code outside a handler function, plus the handler
// function itself)
// The other segement has the origin "AWS::Lambda::Function" - this corresponds just to our user code
// Since we're interested in cold start timings, or "systemDuration" for occasions it's not a cold start
// we can calculate this by looking at the durations of the two segments:
//
// AWS::Lambda           : |------------------------------------------|
// AWS::Lambda::Function :                  |-------------------------|
//                          (    system     )(          user          )
function processTrace(trace, generator) {
  const processedSegments = trace.Segments.map(processSegment);
  const entireFunctionSegment = processedSegments.find(seg => seg.origin == "AWS::Lambda");
  const totalDuration = entireFunctionSegment.duration;
  const userDuration = processedSegments.find(seg => seg.origin == "AWS::Lambda::Function").duration;
  return {
    generatorID: generator.generatorID,
    runtime: generator.runtime,
    memory: generator.memory,
    packageSize: generator.packageSize,
    region: generator.region,
    vpc: generator.vpc,
    systemDuration: to3DPs(totalDuration - userDuration),
    userDuration: to3DPs(userDuration),
    totalDuration: to3DPs(totalDuration),
    traceId: trace.Id,
    startTime: entireFunctionSegment.startTime,
    startFullDateTime: new Date(entireFunctionSegment.startTime * 1000).toString()
  }
}

function to3DPs(number) {
  return Math.round(number * 1000) / 1000;
}

// Some "segments" just correspond to one activity, others can contain "subsegments"
// and so when calculating the end time of a segment we need to consider both of these
// scenarios. Note that the end_time on the document may be *before* the end time of any
// of the subsegments
function processSegment(segment) {
  // The detail for a "segment" is encoded itself as a JSON string on the "document" field
  const document = JSON.parse(segment.Document);
  var allTraceEndTimes = [document.end_time]
  if (document.subsegments)
    allTraceEndTimes = allTraceEndTimes.concat(document.subsegments.map(subseg => subseg.end_time))
  const endTime = Math.max(...allTraceEndTimes);
  return { 
    origin: document.origin, 
    startTime: document.start_time,
    endTime: endTime,
    duration : endTime - document.start_time 
  }
}

function mergeInstanceTimings(generator, allTimings) {
  const timingsForGenerator = allTimings
    .filter(timing => timing.region == generator.region && timing.generatorID.startsWith(generator.generatorID))
    .sort((a, b) => a.systemDuration - b.systemDuration);
  
  const medianTiming = timingsForGenerator[1];
  return {
    ...medianTiming,
    generatorID: generator.generatorID,
    minOtherSystemDurations: timingsForGenerator[0].systemDuration,
    maxOtherSystemDurations: timingsForGenerator[2].systemDuration,
    timingsCaptured: timingsForGenerator.length
  }
}

function todaysDateYYYYMMDD() {
  const now = new Date();
  return`${now.getFullYear()}-${("0"+(now.getMonth()+1)).slice(-2)}-${("0" + now.getDate()).slice(-2)}`
}

// TODO - timestamped files cache should be longer, e.g. 3600
async function publishJSON(timings, bucket) {
  const outputBody = JSON.stringify(timings, null, 2);
  const keyPrefix = "lambda-benchmarks/runtime-invocation-latency"
  const latestKey = `${keyPrefix}/latest.json`
  const timestampedKey = `${keyPrefix}/date=${todaysDateYYYYMMDD()}/hour=${("0"+(new Date().getHours())).slice(-2)}/timings.json`
  await Promise.all([timestampedKey, latestKey].map(key => {
    console.log("Writing timings to " + key);
    return s3.putObject({
      Body: outputBody,
      Bucket: bucket,
      Key: key,
      ContentType: "application/json",
      CacheControl: 'public, max-age=10'
    }).promise();
    })
  );
}

// TODO - timestamped files cache should be longer, e.g. 3600
async function publishCSV(timings, bucket) {
  const outputBody = createCSVString(timings);
  const keyPrefix = "lambda-benchmarks/runtime-invocation-latency"
  const latestKey = `${keyPrefix}/latest.csv`
  const timestampedKey = `${keyPrefix}/date=${todaysDateYYYYMMDD()}/hour=${("0"+(new Date().getHours())).slice(-2)}/timings.csv`
  await Promise.all([timestampedKey, latestKey].map(key => {
    console.log("Writing timings to " + key);
    return s3.putObject({
      Body: outputBody,
      Bucket: bucket,
      Key: key,
      ContentType: "text/csv",
      CacheControl: 'public, max-age=10'
    }).promise();
    })
  );
}

function createCSVString(instanceMergedTimings) {
  const headerRow = ["region", "runtime", "memory", "packageSize", "vpc", "generatorID",
                      "systemDuration", "userDuration", "totalDuration", "traceId", "startTime", "startFullDateTime",
                      "minOtherSystemDurations", "maxOtherSystemDurations", "timingsCaptured"
                    ]

  const dataRows = instanceMergedTimings.map(instance => [
    instance.region,
    instance.runtime,
    instance.memory,
    instance.packageSize,
    instance.vpc,
    instance.generatorID,
    instance.systemDuration,
    instance.userDuration,
    instance.totalDuration,
    instance.traceId,
    instance.startTime,
    instance.startFullDateTime,
    instance.minOtherSystemDurations,
    instance.maxOtherSystemDurations,
    instance.timingsCaptured
  ])

  const allrows = [headerRow].concat(dataRows);
  return stringify(allrows);
}

async function writeContentToS3(bucket, keySuffix, content, contentType) {
  return s3.putObject({
    Body: content,
    Bucket: bucket,
    Key: `lambda-benchmarks/${keySuffix}`,
    ContentType: contentType,
    CacheControl: 'public, max-age=10'
  }).promise();
}

// TODO - timestamped files cache should be longer, e.g. 3600
async function publishHTML(timings, bucket) {
  const keyPrefix = "lambda-benchmarks/runtime-invocation-latency"
  const latestKey = `${keyPrefix}/latest.html`
  const timestampedKey = `${keyPrefix}/date=${todaysDateYYYYMMDD()}/hour=${("0"+(new Date().getHours())).slice(-2)}/timings.html`
  const timestampedLinkPrefix = `/runtime-invocation-latency/date=${todaysDateYYYYMMDD()}/hour=${("0"+(new Date().getHours())).slice(-2)}`
  const outputBody = createHTML(timings, timestampedLinkPrefix);
  await Promise.all([timestampedKey, latestKey].map(key => {
    console.log("Writing timings to " + key);
    return s3.putObject({
      Body: outputBody,
      Bucket: bucket,
      Key: key,
      ContentType: "text/html",
      CacheControl: 'public, max-age=10'
    }).promise();
    })
  );
}

function createHTML(instanceMergedTimings, timestampedLinkPrefix) {
  return generateHTML("Lambda Benchmarking", 
  `
    <h3>Lambda Benchmarking, from <a href="https://www.symphonia.io/">Symphonia</a></h3>
    <p>
      Lambda benchmark data generated during the ${("0"+(new Date().getHours())).slice(-2)}:00 hour on ${todaysDateYYYYMMDD()}.
      See <a href="/runtime-invocation-latency/index.html">here</a> for historical data.
    </p>
    <p>
      Machine readable versions are avalable in <a href="${timestampedLinkPrefix}/timings.json">JSON</a> and 
      <a href="${timestampedLinkPrefix}/timings.csv">CSV</a>.
    </p>
    <table class="table table-striped table-condensed">
      <tr>
        <th>Region</th>
        <th>Runtime</th>
        <th>Memory</th>
        <th>Package Size</th>
        <th>Uses VPC?</th>
        <th>System Duration</th>
        <th>User Duration</th>
        <th>Total Duration</th>
        <th>Start Time</th>
        <th>Generator ID</th>
      </tr>
      ${instanceMergedTimings.map(instance => `
      <tr>
        <td>${instance.region}</td>
        <td>${instance.runtime}</td>
        <td>${instance.memory}</td>
        <td>${instance.packageSize}</td>
        <td>${instance.vpc}</td>
        <td>${instance.systemDuration}</td>
        <td>${instance.userDuration}</td>
        <td>${instance.totalDuration}</td>
        <td>${instance.startFullDateTime}</td>
        <td>${instance.generatorID}</td>
      </tr>`
      ).join('')}
    </table>
  `)
}

// Uncomment to test locally
// updateHTML('symphonia-mike-dev');

async function updateIndexes(bucket) {
  await writeContentToS3(bucket, "index.html", generateRootIndex(), "text/html")
  const days = await findDaysWithContent(bucket);
  console.log(`Found the following days in bucket ${bucket} : ${days}`)
  await writeContentToS3(bucket, "runtime-invocation-latency/index.html", generateLatencyIndex(days), "text/html")
  // TODO - will only need to do this for days[0] once earlier days data created
  await writeContentToS3(
    bucket,
    `runtime-invocation-latency/date=${days[0]}/index.html`,
    generateDayIndex(days[0], await findHoursWithContent(bucket, days[0])),
    "text/html")
  console.log("Complete")
}

// findDaysWithContent('symphonia-mike-dev')

// TODO - paging !!
async function findDaysWithContent(bucket) {
  const objectsResponse = await s3.listObjectsV2({
    Bucket: bucket,
    Prefix: 'lambda-benchmarks/runtime-invocation-latency/date='
  }).promise();

  const keys = objectsResponse.Contents.map(o => o.Key);

  // Switch to Set and back again to filter to unique entries
  const days = ([...new Set(
    keys.map(dir => dir.substring(50, 60))
  )]).sort().reverse();

  return days;
}

async function findHoursWithContent(bucket, day) {
  const objectsResponse = await s3.listObjectsV2({
    Bucket: bucket,
    Prefix: `lambda-benchmarks/runtime-invocation-latency/date=${day}/hour=`
  }).promise();

  const keys = objectsResponse.Contents.map(o => o.Key);

  // Switch to Set and back again to filter to unique entries
  const hours = ([...new Set(
    keys.map(dir => dir.substring(66, 68))
  )]).sort().reverse();

  return hours;
}

function generateRootIndex() {
  return generateHTML("Lambda Benchmarking", 
  `
    <h1>Welcome to Lambda Benchmarking, from <a href="https://www.symphonia.io/">Symphonia</a></h1>
    <ul>
      <li><a href="/runtime-invocation-latency/index.html">Invocation Latency (Cold Start Analysis, etc.)</a></li>
    </ul>
  `)
}

function generateLatencyIndex(days) {
  return generateHTML("Lambda Benchmarking", 
  `
    <h1>Welcome to Lambda Benchmarking, from <a href="https://www.symphonia.io/">Symphonia</a></h1>
    <h2>Invocation Latency (for Cold Start analysis)</h2>
    <p><a href="latest.html"><b>Latest Timings</b></a>, also available in <a href="latest.json">JSON</a> and <a href="latest.csv">CSV</a>
    <p>Historical data available for the following dates:</p>
    <ul>
      ${days.map(day => `<li><a href="date%3D${day}/index.html">${day}</a></li>`).join('')}
    </ul>
  `)
}

function generateDayIndex(day, hours) {
  return generateHTML("Lambda Benchmarking", 
  `
  <h3>Lambda Benchmarking, from <a href="https://www.symphonia.io/">Symphonia</a></h3>
  <h2>Invocation Latency for ${day} by hour</h2>
  <p>See <a href="/runtime-invocation-latency/index.html">here</a> for historical data.</p>
  <table class="table table-striped table-condensed">
    <tr>
      <th>Hour</th>
      <th>HTML</th>
      <th>JSON</th>
      <th>CSV</th>
    </tr>
    ${hours.map(hour => `
    <tr>
      <td>${hour}:00</td>
      <td><a href="hour%3D${hour}/timings.html">HTML</a></td>
      <td><a href="hour%3D${hour}/timings.json">JSON</a></td>
      <td><a href="hour%3D${hour}/timings.csv">CSV</a></td>
    </tr>`
  ).join('')}
  </table>
  `)
}

function generateHTML(title, content) {
  return `
  <!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta http-equiv="X-UA-Compatible" content="IE=edge">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>${title}</title>
      <link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/3.4.0/css/bootstrap.min.css" integrity="sha384-PmY9l28YgO4JwMKbTvgaS7XNZJ30MK9FAZjjzXtlqyZCqBY6X6bXIkM++IkyinN+" crossorigin="anonymous">
      <link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/3.4.0/css/bootstrap-theme.min.css" integrity="sha384-jzngWsPS6op3fgRCDTESqrEJwRKck+CILhJVO5VvaAZCq8JYf8HsR/HPpBOOPZfR" crossorigin="anonymous">
    </head>
  
    <body>
      <div class="container">
${content}
      </div>
      <!-- Latest compiled and minified JavaScript -->
      <!-- <script src="https://stackpath.bootstrapcdn.com/bootstrap/3.4.0/js/bootstrap.min.js" integrity="sha384-vhJnz1OVIdLktyixHY4Uk3OHEwdQqPppqYR8+5mjsauETgLOcEynD9oPHhhz18Nw" crossorigin="anonymous"></script> -->
  
    </body>
  </html>  
  `
}