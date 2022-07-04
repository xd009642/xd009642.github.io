[Tarpaulin](https://github.com/xd009642/tarpaulin) (or cargo-tarpaulin) is a 
code coverage tool for Rust. Last year was pretty busy with the launch of the 
project and the rush of issues as people started to use it so this is just a 
chance to look at what's new with version 0.6.0 and what's planned for the rest 
of this year.

## 2017 A year in review

So in 2017 I started tarpaulin, largely because I realised it's probably the
best project name I've came up with, but mainly because I found the process of
using kcov with Rust frustrating. Language agnostic coverage tools tend to only
work properly with C, struggle with abstractions, and setup is fiddly.
Whereas building a coverage tool targeted at a specific language means you can
utilise tooling in that language to make things easier - Cargo for example.

So after my initial May release tarpaulin can now:

* Send coverage reports to popular coverage sites (coveralls and codecov)
* Generate cobertural xml reports
* Include unused templated code in results (kcov doesn't do this for Rust or C++)
* Handle unused inlined functions
* Trim out a lot of false positives that show up such as module imports and `using` aliases
* Include or exclude packages
* Ignore certain tests
* Work on multithreaded code (with the `--no-count` option, now a default)
* Tarpaulin ran on Windows via docker and new releases are now available on
[docker-hub](https://hub.docker.com/r/xd009642/tarpaulin)

### syntex\_syntax to syn

As syntex\_syntax is unmaintained the introduction of nested import statements
wasn't able to be handled and caused a panic. Because of this tarpaulin had to
move to syn for syntax analysis. It also had to make use of semver exempt code
to get the source positions from syn.

Because of this you may need `RUSTFLAGS="--cfg procmacro2_semver_exempt"` when
running `cargo install` for tarpaulin 0.6.0. So just type the following:

`RUSTFLAGS="--cfg procmacro2_semver_exempt" cargo install cargo-tarpaulin`

Another alternative is to use the install script to download the binary from the
github releases for travis or one of the [docker images available](https://hub.docker.com/r/xd009642/tarpaulin).

## 2018 What's planned

So in 2018 there's a few different features and improvements planned but I'll
focus on the big ones.

### HTML Reports

Tarpaulin will have it's own HTML report format it can generate for people
who aren't using codecov or coveralls as a web interface to their coverage
results. These reports will be able to show coverage at a folder level, individual
file level and also let you inspect the source and see it annotated with the results.

### Branch and condition coverage

So a couple of open source tools provide branch coverage, none provide condition
coverage. I'm aiming straight for a technical solution that works for condition
coverage, this is harder than just branch coverage but has some benefits.
It means tarpaulin will be capable of branch coverage and open the door to
Modified Condition Decision Coverage (MCDC) something I've only seen in expensive
closed source tools. MCDC coverage is significantly more useful as a metric and
mandated in some safety critical software projects.

Currently, I'm deciding between attempting to tackle all three at once or start
with branch coverage. Because of the need to analyse boolean subconditions for 
condition and MCDC coverage they're harder to implement than branch coverage. 
However, implementing a system that can provide condition coverage can provide
branch and MCDC without extra complexity in the tracing and interpretation of 
the programs.

There may also be a blog post in the future going into the different types of
coverage and explaining the pros and cons of them!

### Performance

Instrumenting code with breakpoints and stepping through logging the coverage
is obviously a slow process. There are a number of flags in tarpaulin to mitigate
the performance issues and by using syn I've aimed to remove
unnecessary breakpoints to speed up runs. In 2018 I'd like to improve the
performance further, potentially by running test executables in parallel or
simpler means.

## Other Improvements

As the year goes on I'd like to continue to close issues improving accuracy and
consistency across projects of different types and different distros. And a lot
of that work will be by closing issues.

One issue I'd really like to see closed is 
[#23](https://github.com/xd009642/tarpaulin/issues/23), although that might be
reliant on [rust#35061](https://github.com/rust-lang/rust/issues/35061). Likewise,
[#13](https://github.com/xd009642/tarpaulin/issues/13) coverage of doctests will
be another tricky one to close.

## Community contributions

In 2018 the aim is to remove any barriers to entry for people interested in
contributing and I'm going to try and start having mentored issues among other
initiatives. I've already made some significant headway into this by refactoring
the code to abstract away some of the details of ptrace  and adding more tests
and docs. This work will continue as the year goes on.

Any help is appreciated and with that in mind I'd like to thank
people who have contributed this year. So thanks to:

* Robinst
* Andy128k
* llogiq
* tafia
* rep-nop
* vberger
* alex-mckenna
* quodlibetor
* yodaldevoid
* mathstuf
* philipc
* bbigras
* jean553
* apeduru
* mgeisler
