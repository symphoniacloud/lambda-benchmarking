#!/bin/bash

set -eu

aws cloudformation create-stack \
        --capabilities CAPABILITY_IAM \
        --stack-name lambda-benchmarking-pipeline \
        --parameters ParameterKey=GitHubOAuthToken,ParameterValue=${1} \
        --template-body file://pipeline.yaml
