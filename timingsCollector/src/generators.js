const AWS = require('aws-sdk');
const common = require('./common.js')

const cloudformation = Object.assign({}, ...common.allRegions.map(region => ({[region]: new AWS.CloudFormation({region: region})})));

exports.createGeneratorSpecs = createGeneratorSpecs
exports.createGeneratorInstanceSpecs = createGeneratorInstanceSpecs

const memorySizes = ["256", "1024", "3008"];
const vpcStates = [true, false];
const runtimes = ["NodeJS8", "Java8"];

function createGeneratorSpecs(regions) {
  return common.flatten(regions.map(region => 
    common.flatten(memorySizes.map(memory =>
      common.flatten(vpcStates.map(vpc => 
        runtimes.map(runtime => createGeneratorSpec(runtime, memory, vpc, region))))
    ))
  ));
}

function createGeneratorSpec(runtime, memory, vpc, region) {
  return {
    generatorID: `${runtime}M${memory}V${vpc ? "True" : "False"}`,
    runtime: runtime,
    memory: memory,
    packageSize: "small",
    region: region,
    vpc: vpc ? "yes" : "no",
  }
}

async function createGeneratorInstanceSpecs(stackNames, regions, generatorSpecs) {
  const instanceSpecsForRegions = await Promise.all(regions.map(region =>
    createGeneratorInstanceSpecsForRegion(
      stackNames,
      generatorSpecs.filter(spec => spec.region == region), 
      region)
  ));
  return common.flatten(instanceSpecsForRegions);
}

async function createGeneratorInstanceSpecsForRegion(stackNames, generatorSpecs, region) {
  const functions = common.flatten(await Promise.all(stackNames.map(stack => functionsInRegion(stack, region))))
  const instanceSpecsByGenerator = generatorSpecs.map(generatorSpec => createGeneratorInstanceSpecsForGenerator(generatorSpec, functions))
  return common.flatten(instanceSpecsByGenerator);
}

async function functionsInRegion(stackName, region) {
  const allResources = await getPaginatedStackResources(stackName, region, null, [])
  return allResources.filter(r => r.ResourceType == "AWS::Lambda::Function");
}

async function getPaginatedStackResources(stackName, region, nextToken, resourcesAccumulator) {
  const results = await cloudformation[region].listStackResources({
    StackName: stackName,
    NextToken: nextToken
  }).promise();

  const resourceSummaries = resourcesAccumulator.concat(results.StackResourceSummaries);

  if (results.NextToken)
    return await getPaginatedStackResources(stackName, region, results.NextToken, resourceSummaries);
  else
    return resourceSummaries;
}

function createGeneratorInstanceSpecsForGenerator(generatorSpec, allFunctionsInRegion) {
  return [1, 2, 3].map(instanceID => { 
    const generatorID = `${generatorSpec.generatorID}I${instanceID}`
    return {
      generatorID: generatorID,
      runtime: generatorSpec.runtime,
      memory: generatorSpec.memory,
      packageSize: generatorSpec.packageSize,
      region: generatorSpec.region,
      vpc: generatorSpec.vpc,
      generatorFunction: findGeneratorPhysicalResourceID(allFunctionsInRegion, generatorID),
      instanceID: instanceID
    }});
}

function findGeneratorPhysicalResourceID(generatorFunctions, LogicalResourceId) {
  // TODO - throw a useful exception here if can't find function
  return generatorFunctions.find(r => r.LogicalResourceId == LogicalResourceId).PhysicalResourceId;
}