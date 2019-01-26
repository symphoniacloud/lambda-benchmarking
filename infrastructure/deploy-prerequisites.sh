#!/bin/bash

set -e

for region in eu-central-1 eu-west-1 eu-west-2 eu-west-3
do
  aws cloudformation create-stack --region $region --stack-name lambda-benchmarking-prerequisites --template-body file://per-region-prerequisites.yaml
done
