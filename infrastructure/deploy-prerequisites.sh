#!/bin/bash

set -e

for region in us-east-1 us-east-2 us-west-1 us-west-2
do
  aws cloudformation create-stack --region $region --stack-name lambda-benchmarking-prerequisites --template-body file://pre-region-prerequisites.yaml
done
