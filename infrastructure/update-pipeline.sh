#!/bin/bash

set -eu

aws cloudformation update-stack \
        --capabilities CAPABILITY_IAM \
        --stack-name lambda-benchmarking-pipeline \
        --parameters ParameterKey=GitHubOAuthToken,ParameterValue=${1} ParameterKey=SlackUrl,ParameterValue=${2} \
        --template-body file://pipeline.yaml
