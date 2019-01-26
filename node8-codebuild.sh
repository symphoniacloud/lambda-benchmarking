#!/bin/bash

if  [ -z "$US_EAST_1_ARTIFACT_BUCKET" ] || 
    [ -z "$US_EAST_2_ARTIFACT_BUCKET" ] ||
    [ -z "$US_WEST_1_ARTIFACT_BUCKET" ] ||
    [ -z "$US_WEST_2_ARTIFACT_BUCKET" ] ||
    [ -z "$EU_CENTRAL_1_ARTIFACT_BUCKET" ] ||
    [ -z "$EU_WEST_1_ARTIFACT_BUCKET" ] ||
    [ -z "$EU_WEST_2_ARTIFACT_BUCKET" ] ||
    [ -z "$EU_WEST_3_ARTIFACT_BUCKET" ]
then
      echo "Artifact bucket environment variables are not set correctly"
      exit 1
fi

sam_package () {
  echo "Packaging in region ${1} to bucket ${2} for ${3}"
  aws cloudformation package \
      --template-file template.yaml \
      --s3-bucket ${2} \
      --output-template-file target/${3}-packaged-template-${1}.yaml \
      --region ${1}
}

echo "** Starting packaging of Node 8 generators"
cd generators/node8
npm install --production
npm run dist
sam_package us-east-1 ${US_EAST_1_ARTIFACT_BUCKET} node8-generator
sam_package us-east-2 ${US_EAST_2_ARTIFACT_BUCKET} node8-generator
sam_package us-west-1 ${US_WEST_1_ARTIFACT_BUCKET} node8-generator
sam_package us-west-2 ${US_WEST_2_ARTIFACT_BUCKET} node8-generator
sam_package eu-central-1 ${EU_CENTRAL_1_ARTIFACT_BUCKET} node8-generator
sam_package eu-west-1 ${EU_WEST_1_ARTIFACT_BUCKET} node8-generator
sam_package eu-west-2 ${EU_WEST_2_ARTIFACT_BUCKET} node8-generator
sam_package eu-west-3 ${EU_WEST_3_ARTIFACT_BUCKET} node8-generator

echo "** Starting packaging of Timings Collector"
cd ../../timingsCollector
npm install --production
npm run dist
sam_package us-west-2 ${US_WEST_2_ARTIFACT_BUCKET} timings-collector

