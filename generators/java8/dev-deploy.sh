#!/bin/bash

STACK_NAME="lambda-benchmarking-java8-generators"
SAM_BUCKET=${1}

# Clean previous target / build
mvn clean package

# Now perform deployment using AWS SAM package and deploy commands
aws cloudformation package \
    --template-file template.yaml \
    --s3-bucket $SAM_BUCKET \
    --output-template-file target/packaged-template.yaml

aws cloudformation deploy \
    --template-file target/packaged-template.yaml \
    --stack-name $STACK_NAME \
    --capabilities CAPABILITY_IAM

# Deployment now complete, so read some values from AWS that we can display
REGION=$(aws configure get region)
WEB_CONSOLE_URL="https://console.aws.amazon.com/lambda/home?region=${REGION}#/applications/${STACK_NAME}"

echo
echo "** Serverless application deployed!"
echo "** Application / Stack name: $STACK_NAME"
echo
echo "** AWS Console URL: ${WEB_CONSOLE_URL} **"
echo