# Lambda Benchmarking

**Benchmarks for the AWS Lambda service.**

## ARCHIVED

Please note - this repository is not under anything like active maintainance so please don't use it for anything more than ideas!

...


Currently what we're capturing is Lambda platform latencies for functions that haven't been invoked for an hour or so. In other words - **cold start latency**.

It's interesting to see how cold start latencies compare across a number of axes. For example, we know that cold starts are typically longer when we enable VPC support, but what about other factors like runtime, memory, region, function package size - how do they impact cold starts? And how does cold start latency vary over time?

This project captures cold start data every hour for a number of configurations. We record that data, capturing a number of attributes and metrics. We can see cold start latencies by looking at the **system duration** for when a Lambda function is invoked - this is the time from when the lambda platform receives an event to when our own code starts.

Historical results are available in HTML, JSON and CSV forms, at https://lambda-benchmarking.symphonia.io/, alternatively latest results are available:

* [In HTML](https://lambda-benchmarking.symphonia.io/runtime-invocation-latency/latest.html)
* [In JSON](https://lambda-benchmarking.symphonia.io/runtime-invocation-latency/latest.json)
* [In CSV](https://lambda-benchmarking.symphonia.io/runtime-invocation-latency/latest.csv)

We benchmark across a number of axes, at present these are:

* Region (us-east-1, us-east-2, us-west-1, us-west-2, eu-central-1, eu-west-1, eu-west-2, eu-west-3)
* VPC (enabled, or not)
* Runtime (Node JS 8, Java)
* Memory Size (256MB, 1024MB, 3008MB)

We have 3 individual lambda functions for each combination, and each is run once per hour. We take the median duration values of the 3 and record these, and in the JSON / CSV forms you'll also see the min and max values.

## Example analyses

There are a whole bunch of ways of slicing and dicing this data, here are a couple of examples that I generated by using AWS QuickSight:

![Example 1](/images/example1.png "title")
![Example 2](/images/example2.png "title")

I'm hoping to drill more into the data as time goes by and I have more to analyze.

## Feedback

If you have any questions, comments, additions or suggestions please feel free to comment through GitHub, on twitter at [@mikebroberts](https://twitter.com/mikebroberts), or via email at mike@symphonia.io.

If your company is looking for help using the various services used in this project, or architecture using AWS, then please also drop me an email, or contact us at [Symphonia](https://www.symphonia.io/).

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
* Change manual invoker to call synchronously and show returned value (so we know if errors)
* Also do warm starts?

Data collection / presentation

* Think about how to do better data analysis
* Handle non existence of particular generator data and move on
* Other error checking / handling

Infrastructure

* Consider using for CDK for generators and/or pipeline template
* Consider monitoring generators for invocation errors (similar to how we already do for timingsCollector)

