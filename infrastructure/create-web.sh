#!/bin/bash

set -eu

aws cloudformation create-stack \
        --capabilities CAPABILITY_IAM \
        --stack-name lambda-benchmarking-web \
        --template-body file://web.yaml
