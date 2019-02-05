# Code coverage

When people talk about code coverage, they're referring to metrics which show 
how much of their source code is "covered" by their tests. Now covering the code
is of course only the first step, the tests actually have to test the 
functionality in a meaningful way, but coverage is a good way of finding areas
in your code which you haven't tested as thoroughly.

So how do we define coverage? Well there are numerous metrics, Wikipedia lists 
these methods as the simplest ways of measuring coverage.

* Function coverage - how many functions have been executed?
* Statement (line) coverage - how many statements have been executed?
* Branch coverage - how many of the possible paths have been executed?
* Condition coverage - how many boolean subconditions have been executed?

Currently, open source coverage tools (bcov, gcov, kcov) only offer statement
coverage. They also require some effort to execute depending on your language 
and project setup. This is the motivation for tarpaulin, a code coverage tool
created specifically for rust as a cargo subcommand.

# Why tarpaulin?

[Tarpaulin](https://github.com/xd009642/tarpaulin) uses cargo as a library 
meaning it can automatically identify files in your project. It can also 
generate and identify the test executables and run coverage on all of them. 

Compare this to kcov where you need to clean the project area, build the test 
executables then iterate over the executables in target/debug running kcov on 
each one and merging the reports at the end. Additionally, kcov will include 
extern crate definitions and module statements (`pub mod foo`) in it's coverage
results. Tarpaulin is designed for rust and aims to remove lines which are 
"uncoverable" from the coverage results.

Below is some example output for tarpaulin ran on one of the example projects.

```
cargo tarpaulin
Launching test

running 1 test
test tests::bad_test ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured

Coverage Results
src/lib.rs: 7/8
src/unused.rs: 0/4

58.33% coverage, 7/12 lines covered
```

Currently, tarpaulin implements line coverage and has 
[coveralls.io](https://coveralls.io) integration. It is linux only and only 
designed with x86\_64 support (so 64 bit AMD and Intel processors). Wider 
support is planned for future expansion, but this should work for the majority 
of users.

By focusing on Rust only and it's build system tarpaulin can potentially provide
better results by being able to extend information derived from the test 
binaries with information from cargo and the source code itself. By having 
access to crates like [syntex](https://github.com/serde-rs/syntex), tarpaulin 
aims to become the first open source code coverage tool to offer a solution for 
condition coverage.

That's all for this relatively short introduction,
check out the [github repository](https://github.com/xd009642/tarpaulin) for 
more information as well as the roadmap! If you find any issues please raise 
them and I should get back to you fairly sharpish. 
