+++
title = "Onnxruntime and the Pit of Failure"
date = "2026-07-21"
path = "2026/07/21/onnxruntime-and-the-pit-of-failure"
aliases = ["/2026/01/03/onnxruntime-and-the-pit-of-failure.html"]
+++
There's a saying of designing things so you fall into the pit-of-success.
Sometimes however, you fall into a pit of failure. Where an innoculous API
decision means that you suddenly make things much worse in ways that you
don't fully comprehend until someone starts to dig into it.

This is how [this PR](https://github.com/emotechlab/silero-rs/pull/79),
a one line change to reduce the number of threads the onnxruntime uses reduced
the compute requirements for a work service to the point we had ~84% cost reduction
with no performance regressions.

But first the background.

## The Background

This project is an interface around Silero, a Voice Activity Detection (VAD) model.
What this does is for our speech services it lets us find the voiced frames and only
process them with the heavier neural networks. It's a fast model capable of processing
around 5s of audio in around 30ms. When our larger models are looking for like 1-3s to
process the same chunk the VAD becomes an insignificant portion of the processing time
and saves a lot of extra processing.

Additionally, when we deal with models that run on GPU the memory transfer to the GPU
and dealing with getting the most out of the GPU becomes a more glaring target for
optimisation. After all GPUs are expensive.

But recently, we've made some of our models "true streaming", this means that instead of
needing to process the entire voiced segment we can feed small chunks into the model every
time audio streams in and iteratively update the state eventually running the state through
another model to get the final transcription. This smaller input done more iteratively 
makes the models able to be used faster than real time on CPU decreasing cost and giving us
a faster system. But now we want to make sure we're getting the most out of our CPUs so we
can load the servers more and deal with more concurrent streams than the number of CPUs.

With Silero we're using [ort](https://crates.io/crates/ort) bindings to the 
[onnxruntime](https://github.com/microsoft/onnxruntime). Onnxruntime is often seen as the
de-facto implementation and contains things like optimisation levels and a lot of dials
to tweak and fiddle with for performance. As well as CPU and GPU execution.

For each session we would create a VAD instance which loads the model again. It's not
safe to share the same loaded model between threads. For some models you might want to
use a threadpool implementation and have a session grab an existing one or some other
means of sharing one loaded instance. But Silero is a small fast model and the overhead
was deemed unnecessary.
 
## The Change

Spoiler we just changed `.with_intra_threads(4)?` to `.with_intra_threads(1)?`. Benchmarking
revealed that one request was using a lot of cores even when it wasn't doing anything.
Digging into the results further and then the onnxruntime 
[docs on thread management](https://onnxruntime.ai/docs/performance/tune-performance/threading.html)
revealed the culprit.

> Thread-Pool Spinning Behavior
> 
> * Controls whether additional INTRA or INTER threads spin waiting for work. Provides faster inference but consumes more CPU cycles, resources, and power
> * Default: 1 (Enabled)

So when we set the threads to 4 it creates a 4-thread pool which is just busy spinning as
an optimisation. Geez okay. Well is the model using any threads? Can we reduce it to 1 and 
have it work?

There's a more thorough benchmarking result in the PR. But as a summary for a 5s file sent
in 20ms chunks:

| Threads | Fastest | Median | Slowest |
| ------- | ------- | ------ | ------- |
|  4      | 31.09ms | 32.38ms| 58.19ms |
|  1      | 31.89ms | 32.46ms| 46.76ms |

That's no change. Well it's not exact but by my reckoning this is well within statistical noise.
Just as a note, intra-threads means concurrency within operations on the graph. So breaking up a
large matrix multiplication into different chunks processed concurrently. It doesn't involve processing
different nodes in parallel.

With this change we were able to 4x the concurrent sessions in the service. This also meant we could drop
to a much smaller AWS instance to get our desired maximum concurrency resulting in an 84% yearly cost saving.
For a startup running on it's own steam without big VC money behind us this is a big win and let's us price
our solutions a bit more competitively.

## The Pit of Failure

Look at the code to initialise the session:

```rust
let model = Session::builder()?
    .with_optimization_level(GraphOptimizationLevel::Level3)?
    .with_intra_threads(1)?
    .commit_from_memory(model_bytes)?;
```

This a fluent builder type API where the session is created once we give it a model. There's also
an optimisation level. It will look over the network graph and attempt to do a number of optimisations
to get the most performance. My first thought was if a model can't be parallelised internally why
would it insist on making the threadpool - but I'd forgotten about batching. Batching is a useful
optimisation. It doesn't really work for us though since the coordination overhead to get multiple
sessions into the model makes it less appealing sharing a model between instances. Also we can't batch
our chunks from the incoming audio since each chunk relies on the state generated from the prior chunk.

For this model with this usage batching isn't feasible. Maybe if we could signal that via the API it could
make a decision that it won't create the threadpool if there's no chance of it being used. However, there is 
a chance that only the most extreme of batch sizes could even make intra-op concurrency worthwhile.

With all of this in mind, I don't think there's a reasonable way for the optimiser to realise we won't
use that threadpool and avoid making it with the maximum threads we requested. But what about the default
of busy spinning the threads? This leads to high CPU usage even when the session is idle. 

In terms of API design and configuration, I don't think this qualifies as a pit of success. I do think
this qualifies as a footgun. 

It's also worth noting that in home projects I'm using [rten](https://crates.io/crates/rten) and I've
contributed a few PRs to it recently. From some benchmarking rten gives us better performance out of the
box even without the optimisation levels onnxruntime offers with no such footguns that I've hit. I'm looking
forward to the next release and we might switch over at that time. Because as of right now we're stuck on
an old version of ort anyway due to libc conflicts with onnxruntime and the nvidia docker base images. Every
native dependency removed is one build process simplified!
