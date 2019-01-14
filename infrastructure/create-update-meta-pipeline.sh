aws cloudformation deploy \
        --template-file meta-pipeline.yaml \
        --stack-name lambda-benchmarking-meta-pipeline \
        --capabilities CAPABILITY_IAM \
        --parameter-overrides GitHubOAuthToken=${1} TargetPipelineStackName=lambda-benchmarking-pipeline SlackUrl=${2}