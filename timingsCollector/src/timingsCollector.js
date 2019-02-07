const AWS = require('aws-sdk');
const common = require('./common.js')
const generators = require('./generators.js')
const stringify = require('csv-stringify/lib/sync')

const defaultRegion = "us-west-2";

const s3 = new AWS.S3({ region: defaultRegion });

// Eequivalent to { "us-east-1": new AWS.XRay({region: "us-east-1"}), etc... }
const xray = Object.assign({}, ...common.allRegions.map(region => ({[region]: new AWS.XRay({region: region})})));

const standardHeading = '<h1><a href="https://github.com/symphoniacloud/lambda-benchmarking">Lambda Benchmarking</a>, from <a href="https://www.symphonia.io/">Symphonia</a></h1>';

// Uncomment this for local testing
// collectTimings(
//   "lambda-benchmarking-timings-collector-bucket-84wl7ot2per5", 
//   ["lambda-benchmarking-node8-generators", "lambda-benchmarking-java8-generators"],
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
  console.log("Querying CloudFormation to locate generator functions")
  const generatorInstanceSpecs = await generators.createGeneratorInstanceSpecs(stackNames, regions, generatorSpecs);
  console.log("Querying XRay for timings")
  // const timings = await queryAllXRayForTimings(regions, generatorInstanceSpecs)
  const timings = await Promise.all(generatorInstanceSpecs.map(queryXRayForTimings))
  console.log("Collected timings:")
  console.log(JSON.stringify(timings))
  const instanceMergedTimings = generatorSpecs.map(generator => mergeInstanceTimings(generator, timings));
  console.log("Writing output files")
  await publishTimingsHTML(instanceMergedTimings, bucketName);
  await publishTimingsJSON(instanceMergedTimings, bucketName);
  await publishTimingsCSV(instanceMergedTimings, bucketName);
  await publishIndexes(bucketName);
  console.log("Complete")
}

async function queryAllXRayForTimings(regions, generators) {
  const timings = [];
  regions.forEach(region => {
    const generatorsForRegion = generators.filter(g => g.region === region)
    Array.prototype.push.apply(timings, Promise.all(generatorsForRegion.map(queryXRayForTimings)))
  })
}

async function queryXRayForTimings(generator) {
  const traceSummaries = await getTraceSummaries(generator);

  callXRayBatchGetTraciesAndRetry

  const traces = (await callXRayBatchGetTraciesAndRetry(generator.region, {
    TraceIds: traceSummaries.map(summary => summary.Id)
  })).Traces;

  const timingData = traces.map(trace => processTrace(trace, generator));
  // Just want latest values for this generator
  return timingData.sort((a, b) => a.startTime - b.startTime)[timingData.length - 1];
}

async function getTraceSummaries(generator) {
  const now = new Date().getTime() / 1000;
  return getPaginatedTraceSummaries(now, generator, null, []);
}

async function getPaginatedTraceSummaries(endTime, generator, nextToken, summariesAccumulator) {
  const traceSummaryResults = await callXRayTraceSummariesAndRetry(generator.region,{
    StartTime: endTime - 60 * 60, // Last hour
    EndTime: endTime,
    FilterExpression: `service("${generator.generatorFunction}")`,
    NextToken: nextToken
  })

  const newTraceSummaries = summariesAccumulator.concat(traceSummaryResults.TraceSummaries);

  if (traceSummaryResults.NextToken)
    return await getPaginatedTraceSummaries(endTime, generator, traceSummaryResults.NextToken, newTraceSummaries);
  else
    return newTraceSummaries;
}

function sleep(approxSeconds) {
  console.log(approxSeconds * 1000 + Math.floor(Math.random() * Math.floor(1000)))
  return new Promise(resolve => setTimeout(resolve, approxSeconds * 1000 + Math.floor(Math.random() * Math.floor(1000))));
}

async function callXRayTraceSummariesAndRetry(region, params, attempt = 1) {
  try {
    return await xray[region].getTraceSummaries(params).promise()
  }
  catch (err) {
    console.log(`Error calling xray[${region}].getTraceSummaries, attempt ${1}`)
    if (attempt > 9) {
      const message = `Reached max retry count for xray[${region}].getTraceSummaries - aborting`
      console.error(message)
      throw message
    }
    else {
      await sleep(attempt)
      return await callXRayTraceSummariesAndRetry(region, params, attempt + 1)
    }
  }
}

async function callXRayBatchGetTraciesAndRetry(region, params, attempt = 1) {
  try {
    return await xray[region].batchGetTraces(params).promise()
  }
  catch (err) {
    console.log(`Error calling xray[${region}].batchGetTraces, attempt ${1}`)
    if (attempt > 9) {
      const message = `Reached max retry count for xray[${region}].batchGetTraces - aborting`
      console.error(message)
      throw message
    }
    else {
      await sleep(attempt)
      return await callXRayBatchGetTraciesAndRetry(region, params, attempt + 1)
    }
  }
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
  return `${now.getFullYear()}-${("0"+(now.getMonth()+1)).slice(-2)}-${("0" + now.getDate()).slice(-2)}`
}

function currentHourHH() {
  return ("0"+(new Date().getHours())).slice(-2);
}

function thisHourPath(){
  return `runtime-invocation-latency/date=${todaysDateYYYYMMDD()}/hour=${currentHourHH()}`
}

function latestPathPrefix() {
  return "runtime-invocation-latency/latest";
}

async function writeToS3(bucket, keySuffix, content, contentType, cacheSeconds) {
  const key = `lambda-benchmarks/${keySuffix}`;
  console.log(`Writing ${key} to S3`);
  return s3.putObject({
    Body: content,
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    CacheControl: `public, max-age=${cacheSeconds}`
  }).promise();
}

async function publishTimingsJSON(timings, bucket) {
  await publishTimingsFiles(bucket, JSON.stringify(timings, null, 2), "json");
}

async function publishTimingsCSV(timings, bucket) {
  await publishTimingsFiles(bucket, createCSVString(timings), "csv");
}

async function publishTimingsHTML(timings, bucket) {
  await publishTimingsFiles(bucket, createTimingsHTML(timings), "html");
}

const fileTypeToContentType = {
  "html" : "text/html",
  "csv" : "text/csv",
  "json" : "application/json"
}

async function publishTimingsFiles(bucket, content, fileType) {
  const contentType = fileTypeToContentType[fileType];

  await Promise.all([
    writeToS3(bucket, `${latestPathPrefix()}.${fileType}`, content, contentType, 10),
    writeToS3(bucket, `${thisHourPath()}/timings.${fileType}`, content, contentType, 3600)
  ])
}

function createCSVString(instanceMergedTimings) {
  const headerRow = ["region", "runtime", "memory", "packageSize", "vpc", "generatorID",
                      "systemDuration", "userDuration", "totalDuration", "traceId", "startTime", "startFullDateTime",
                      "minOtherSystemDurations", "maxOtherSystemDurations", "timingsCaptured"]

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

async function publishIndexes(bucket) {
  await writeToS3(bucket, "index.html", generateRootIndex(), "text/html", 10)
  const days = await findDaysWithContent(bucket);
  await writeToS3(bucket, "runtime-invocation-latency/index.html", generateLatencyIndex(days), "text/html", 10)
  await writeToS3(
    bucket,
    `runtime-invocation-latency/date=${days[0]}/index.html`,
    generateDayIndex(days[0], await findHoursWithContent(bucket, days[0])),
    "text/html",
    10)
}

async function findDaysWithContent(bucket) {
  const keys = await listKeysInBucket(bucket, 'lambda-benchmarks/runtime-invocation-latency/date=');
  const days = keys.map(dir => dir.substring(50, 60))
  return removeDuplicates(days).sort().reverse();
}

async function findHoursWithContent(bucket, day) {
  const keys = await listKeysInBucket(bucket, `lambda-benchmarks/runtime-invocation-latency/date=${day}/hour=`);
  const hours = keys.map(dir => dir.substring(66, 68))
  return removeDuplicates(hours).sort().reverse();
}

async function listKeysInBucket(bucket, prefix) {
  return (await pagedListObjectsInBucket(bucket, prefix, null, [])).map(o => o.Key);
}

async function pagedListObjectsInBucket(bucket, prefix, continuationToken, accumulator) {
  const objectsResponse = await s3.listObjectsV2({
    Bucket: bucket,
    Prefix: prefix,
    ContinuationToken: continuationToken
  }).promise();

  const newAccumulator = accumulator.concat(objectsResponse.Contents);

  if (objectsResponse.IsTruncated) {
    return pagedListObjectsInBucket(bucket, prefix, objectsResponse.NextContinuationToken, newAccumulator);
  }
  else {
    return newAccumulator;
  }
}

function removeDuplicates(array) {
  return ([...new Set(array)]);
}

function createTimingsHTML(instanceMergedTimings) {
  return generateHTML("Lambda Benchmarking", 
  `
    ${standardHeading}
    <p>
      Lambda benchmark data generated during the ${currentHourHH()}:00 hour on ${todaysDateYYYYMMDD()}.
      See <a href="/runtime-invocation-latency/index.html">here</a> for historical data.
    </p>
    <p>
      Machine readable versions are avalable in <a href="${thisHourPath()}/timings.json">JSON</a> and 
      <a href="${thisHourPath()}/timings.csv">CSV</a>.
    </p>
    <table class="table table-striped table-condensed">
      <tr>
        ${['Region', 'Runtime', 'Memory', 'Package Size', 'Uses VPC?', 'System Duration', 
            'User Duration', 'Total Duration', 'Start Time', 'Generator ID'].map(header => `
          <th>${header}</th>
        `).join('')}
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

function generateRootIndex() {
  return generateHTML("Lambda Benchmarking", 
  `
    ${standardHeading}
    <ul>
      <li><a href="/runtime-invocation-latency/index.html">Invocation Latency (Cold Start Analysis, etc.)</a></li>
    </ul>
  `)
}

function generateLatencyIndex(days) {
  return generateHTML("Lambda Benchmarking", 
  `
    ${standardHeading}
    <h2>Invocation Latency (for Cold Start analysis)</h2>
    <p><a href="latest.html"><b>Latest Timings</b></a>, also available in <a href="latest.json">JSON</a> and <a href="latest.csv">CSV</a>
    <p>Historical data available for the following dates:</p>
    <ul>
      ${days.map(day => `
        <li><a href="date%3D${day}/index.html">${day}</a></li>
      `).join('')}
    </ul>
  `)
}

function generateDayIndex(day, hours) {
  return generateHTML("Lambda Benchmarking", 
  `
  ${standardHeading}
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
    </body>
  </html>  
  `
}