# On Coverage and Macros

As a maintainer of a [code coverage tool](https://github.com/xd009642/tarpaulin) 
one of the common issues I get is that the coverage statistics are incorrect. 
Users may gate CI on coverage percentages to try and ensure they hit a level of
testing and false-negatives can be seen to hamper this. 

Often there's some validity to this based on how dead code has been eliminated 
or code has been optimised sometimes coverage instrumentation is missed and 
there are false negatives. However, there are cases when it's correct that the
code isn't covered.

Take the following test, what should the coverage be?

```rust
fn status_check() {
    println!("All good");
}

#[test]
fn is_good() {
    status_check();
}
```

I think we can all agree this should be 100%. But what about this?

```rust
fn status_check() {
    tracing::trace!("All good");
}

#[test]
fn is_good() {
    status_check();
}
```

Ignoring the lines of test code we have two unambiguously coverable lines -
the function signature and the macro call. And with this in mind coverage
should be 50%.

Why? Maybe this code which was exercised by tests but can cause a segfault
shows why:

```rust
let input = self
    .format_context
    .streams()
    .best(media::Type::Audio)
    .ok_or(TranscodingError::NoAudio)?;

let mut audio_decoder = input
    .decoder()
    .map_err(|e| {
        error!("Unable to create decoder: {}", e);
        TranscodingError::Unknown("Unable to create decoder".to_string())
    })?
    .audio() 
    .map_err(|_| TranscodingError::NoAudio)?;

trace!("Layout: {:?}", audio_decoder.channel_layout()); 
```

The answer is that the macro expands into a bunch of code which will
semantically be something like (not this exactly):

```rust
if tracing::level() == tracing::Level::Trace {
    println!("TRACE: Layout: {:?}", audio_decoder.channel_layout());
}
```

And in that branch there is code with a segfault. Marking the trace macros
as covered when they're not being tested does give a false sense of security.
Then when we actually need trace logging to debug an issue the segfault pops up
adding to some of the confusion.

## The Solution

Fortunately, there is an answer to this, I use the
[`tracing-test`](https://crates.io/crates/tracing-test) crate in projects which
also gives me a big log dump when a test fails which is more useful to me than
just swallowing all those traces. It also has the side-effect of the tracing
calls being covered.

Of course, analytically examples like the first one could be removed from the
false negatives. But the more assumptions you make when filtering results the
more you risk coverage becoming deceptive and not guiding you in any useful way.
For what it's worth my approach is to use coverage as a signal of where I'm
maybe not testing adequately. I don't aim for high coverage numbers and I use
it in combination with tools like [cargo-mutants](https://crates.io/crates/cargo-mutants)
to ensure my testing strategy is sound. Every metric becomes useless when it's
a target.

The relevant GitHub issue that inspired this short post is
[here](https://github.com/meh/rust-ffmpeg/issues/183)
