# Deploying your own version of lambda-benchmarking

If you'd like to deploy your own version of lambda-benchmarking, you can
do so using the content in this directory.

I'm going to assume that you have admin permissions in an AWS account, know how to
use the AWS CLI, CodePipeline, etc.

First pick an account to run this in. I **strongly recommend** creating a separate sub-account since we're going to deploy a lot of lambda functions

Decide what regions you want to run benchmarks in, and update `deploy-prerequisites.sh` if necessary. Then run that file - it will create an S3 bucket and a region in each region

Now to deploy the CodePipeline pipeline. This is responsible for deploying:
* The generator functions that generate data
* The timings collector function that gathers the data and writes it out to various formats
* A bucket where all the gathered data will be kept, and which will be the source for our web distribution

Update `pipeline.yaml` as follows:
* Update the artifact bucket names in the `Parameters` section, using your sub account ID
* If you want a different set of regions then update everywhere in the template that is region specific
* If you don't care about using Slack for notifications, then delete the `SlackUrl` parameter and the line `ParameterOverrides: !Sub '{"SlackUrl": "${SlackUrl}"}'` from `DeployTimingsCollector`

If you removed the Slack items, then also update the `create-pipeline.sh` and `update-pipeline.sh` scripts, removing the second argument for a Slack URL; **and** update `timingsCollector/template.yaml` to remove the `SlackUrl` parameter and `SlackErrorNotifier` function.

Commit your changes, and deploy the pipeline using `create-pipeline.sh` passing a GitHub personal access token (with admin access to your version of the repository) as an argument. If you still have Slack notification also pass a Incoming Webhook URL.

Once all that is working you can deploy the web resources. If you don't care about
custom domain names then edit the `web.yaml` file to remove all the parts about aliases and certificates, and ignore the section below about DNS and certificates.

* Create a certificate in AWS Certifcate manager. Make sure to do it in **us-east-1**. Go through the validation process for your certificate.
* Update the `web.yaml` `Parameters` section with your values
* Run `create-web.yaml` and wait for a while as CloudFront does its thing
* Update DNS to point to your new distribution. If you're using Route53 then you can create CNAME A (and optionally IPV6 AAAA) records, that are aliases to your CloudFront distribution.

And that should about be it. Updates to generators and the timings collector will be continuously deployed by CodePipeline. Any changes you want to make around which regions to use, to your web resources, or to the pipeline itself will mean using the scripts and templates in this directory again. Note that if you add regions, just set the new regions you want when running `deploy-prerequisites.sh` .

