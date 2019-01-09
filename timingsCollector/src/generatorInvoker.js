const AWS = require('aws-sdk');
const common = require('./common.js')
const generators = require('./generators.js')

// Uncomment this for local testing
// invokeGenerators(["lambda-benchmarking-node8-generators"], ["us-west-2"])

const lambda = Object.assign({}, ...common.allRegions.map(region => ({[region]: new AWS.Lambda({region: region})})));

exports.handler = async (event, context) => {
  await invokeGenerators(
    [common.getAndCheckEnvVar("NODE8_GENERATOR_STACK_NAME"), common.getAndCheckEnvVar("JAVA8_GENERATOR_STACK_NAME")],
    common.allRegions
  );
}

async function invokeGenerators(stackNames, regions) {
  const generatorSpecs = generators.createGeneratorSpecs(regions)
  const generatorInstanceSpecs = await generators.createGeneratorInstanceSpecs(stackNames, regions, generatorSpecs);
  await Promise.all(generatorInstanceSpecs.map(invokeGenerator))
}

async function invokeGenerator(generatorInstanceSpec) {
  console.log(`Invoking Generator Function ${generatorInstanceSpec.generatorFunction} in region ${generatorInstanceSpec.region}`)
  await lambda[generatorInstanceSpec.region].invoke({
    FunctionName: generatorInstanceSpec.generatorFunction,
    InvocationType: 'Event'
  }).promise();
}