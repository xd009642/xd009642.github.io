# Snapshot Testing an AI Project

In this post I'm mainly going to explain a bit about what snapshot testing is
some pros and cons and how I approached it for an audio processing project at
work.

## What Are They?

Snapshot testing is when we take a "shapshot" of the programs output or state
and store that alongside the tests. Then when running the test we run our code,
generate the same output and then compare with our stored version.

You may have seen this used by the Rust compiler if you've ever poked into it's
diagnostic tests. And also in Rust there's a handy crate for it
[insta](https://crates.io/crates/insta).

Of course sometimes our tests will fail, when that happens we will either
confirm it's an issue and fix our code or confirm the new snapshot is correct
and replace the old one. Sometimes a mixture of the two if partially broke
something when adding a feature.

The benefit of this approach is we can hit a large amount of our code with
tests on realistic data/scenarios and do this much quicker than crafting test
cases manually. A negative is that the more your outputs change or the harder
snapshots are to review the greater tendancy people might have to just blindly
"bless" the new snapshots resulting in tests that aren't helping you.

## Where I’m Using Them

So at my work [Emotech](https://emotech.ai) I spend a lot of time working on
audio AI systems. Often these models we want to limit to just running on speech
data and not any background noise or dead air. For that we use some form of 
audio segmentation model such as a Voice Activity Detection (VAD) model. We
recently open sourced a Rust library around a popular one silero which you can
find [here](https://github.com/emotechlab/silero-rs).

Part of making such a library we want to test it and make sure it works well
so we can have confidence all throughout our stack. And while the model has
been benchmarked and we can run it through and compare there's some nuances in
using a VAD model and configuration which may not be tested by that approach.
Things like:

1. Different audio chunk sizes going in
2. Different padding values - the silence we allow at the start/end of the audio
3. Switching speed (sometimes you want to limit the max speaking/non-speaking transition)
4. Sensitivity

So an easy way to test this is to generate some test audio and then run all
the audios through the VAD with different parameters and chunkings. And utilise
snapshot testing to make sure they're all as expected.

But because of this, while it's useful we really can't use insta.

A text diff of our structures isn't useful, long float arrays of durations,
timestamps. These are things that you can't really review as text diffs. And
with that we lose a lot of insta's power.
