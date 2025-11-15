Recently I've been doing tackling some issues in my open source projects
related to Ferrous System's work to get code coverage for libcore - the
Rust core library. Because of this I've been talking to
[Jyn](https://github.com/jyn514) a fair bit and this has lead to some
ideation my side, about combining this work with crater. Jyn telling me
this idea sounded cool is what gave me the push to write this up - so 
blame or thank them as necessary 😅.

Of course libcore isn't libstd, but having coverage for core should result
in coverage for libstd potentially being possible with no extra work!

# What's Crater?

If you know what crater is feel free to skip ahead, this won't be anything
groundbreaking in terms of insights!

[Crater](https://github.com/rust-lang/crater) helps detect regressions in
the Rust compiler by grabbing all the projects on crates.io and then running
`cargo build` and `cargo test` on them. This helps make sure that changes
to the language or standard library don't cause any breakages in users
projects.

It won't run every project, ones with flaky tests or that can't run in the
environment often get blacklisted. But it will run through a lot. Looking,
at the [crater queue](https://crater.rust-lang.org/) I can see one of the
current runs is going over 1471548 jobs which is more than the number of
crates on crates.io, looking at a report I can see it's testing multiple
versions of crates so that's likely why.

# What is Coverage?

Code coverage is a means to measure how much of your code is hit by your
tests. The simplest metrics are very coarse, just lines or functions, and
they get more complex looking at branches, boolean subconditions or
combinations of them (MC/DC coverage).

It's a reasonable heuristic for spotting what part of your code isn't being
exercised by your tests, but it doesn't help you determine the quality of
your tests. Because of this it's often effective when used in combination
with things like mutation testing, or other testing methods. Coverage might
also be coupled with formal verification tooling like kani to ensure that
the verification harness isn't overly constrained.

In the safety critical world you'll typically have some form of
requirements-based testing and your tests contain a written brief which
references your requirements and design and what they're exercising. Then you
can assess both your code coverage and you requirements coverage. If you have
100% requirements coverage and only 60% code coverage something is probably 
wrong - either some requirements are poorly tested or your system is
under-specified. Likewise if you had 60% requirements coverage and 100% code
coverage you can't have confidence that all your tests are meaningfully
testing the system.

This is just a general idea of the concept and how it's useful in engineering.
When I was working in a safety-critical domain we had requirements based tests,
real world data simulation tests and something akin to property based testing.
With all of these in combination it's possible to deliver incredibly robust
software like flight control computers etc.

# Okay Then What's Your Idea?

Well it should be obviously at this point. But use crater to get coverage
statistics of how rust crates in the ecosystem are using the standard library.
Are there any parts that tests in the wild just don't hit? Mainly just curiosity
at what the data says. Having a lot of eyes (crates) on an API makes it easier
to spot regressions, so what aren't we looking at?

Plus when it comes to assessing nightly features, which ones are more or less
widely tested? With source code analysis we can come up with usage but we don't
necessarily know how much that code is being ran. There's also potential to couple
source analysis and coverage analysis but I've not thought of any interesting
things to get from that.

Of course getting more data for analysis and doing something useful with that
analysis is another matter entirely. But by putting this idea out maybe some people
might have useful ideas, and that's the aim of this post. 
