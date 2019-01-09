# Lambda Benchmarking

Benchmarks for the AWS Lambda service.

Currently what we're capturing is Lambda platform latencies for functions that haven't been invoked for an hour or so. In other words - **cold start latency**.

Historical results are available in HTML, JSON and CSV forms, at https://lambda-benchmarking.symphonia.io/, alternatively latest results are available:

* [In HTML](https://lambda-benchmarking.symphonia.io/runtime-invocation-latency/latest.html)
* [In JSON](https://lambda-benchmarking.symphonia.io/runtime-invocation-latency/latest.json)
* [In CSV](https://lambda-benchmarking.symphonia.io/runtime-invocation-latency/latest.csv)

We benchmark across a number of axes, at present these are:

* Region (us-east-1, us-east-2, us-west-1, us-west-2)
* VPC (enabled, or not)
* Runtime (Node JS 8, Java)
* Memory Size (256MB, 1024MB, 3008MB)

We have 3 individual lambda functions for each combination, and each is run once per hour. We take the median duration values of the 3 and record these.

## Implementation

Implementation currently consists of the following:

* A set of *generator* Lambda functions that are invoked in order to capture data. Right now that means generating traces in X-Ray.
* A *timings collector* Lambda that queries X-Ray for trace data, and summarizes this data in various forms
* An S3 bucket where timings are collected
* A CloudFront distribution to make data publicly available

## Running your own version

If you want to run your own version of lambda-benchmarking, take a look at the [infrastructure](./infrastructure/) directory - there are instructions in there.

## TODO

Data generation:

* Add more runtimes (submissions gratefully accepted!)
* Add package size as axis
* Add more regions
* Also do warm start
* Change manual invoker to call synchronously and show returned value (so we know if errors)

Data collection / presentation

* Handle non existence of particular generator data and move on
* Other error checking / handling
* Do S3 API paging for indexes
* Delete indexes and data for earlier than Jan 9
* Think about how to do better data analysis
* Set longer cache expiry for date/time paths

Infrastructure

* Consider using for CDK for generators and/or pipeline template

