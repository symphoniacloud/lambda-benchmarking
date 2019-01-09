exports.flatten = function (arrayOfArrays) {
  return [].concat(...arrayOfArrays);
}

exports.allRegions = ["us-east-1", "us-east-2", "us-west-1", "us-west-2"];

exports.getAndCheckEnvVar = function getAndCheckEnvVar(envVarName) {
  const envVarValue = process.env[envVarName];
  if (!envVarValue || envVarValue.length == 0)
    throw Error("Expected environment variable " + envVarName + " is not set")
  return envVarValue;
}