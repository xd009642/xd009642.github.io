
You might want to read the [previous post]({% post_url 2025-05-08-Tarpaulins-Week-of-Speed %}). 
This post is going to be much the same stuff, while skipping going over
things I talked about before. And with some changes in approach, and 
different tools than `perf` and `cargo flamegraph`!

# New Tools!

Firstly, now polars doesn't take 40 minutes for a tarpaulin run I'll
be using [hyperfine](https://github.com/sharkdp/hyperfine) to get some
statistics on the tarpaulin runs.

And from the comments of the last post from /u/Shnatsel:

> For profiling I've moved away from perf + flamegraphs to
> [https://crates.io/crates/samply](https://crates.io/crates/samply),
> which provides the same flamegraphs plus much more, and you even get
> to share your results to anyone with a web browser in just two clicks.
> It's also portable to mac and windows, not just linux. It has become my go-to 
> tool for profiling and I cannot recommend it enough.

Strong praise indeed, so I'm finally giving it a try!

# The First Win

Using samply I saw that `HashMap::get` in `generate_subreport` was taking
most of the time in report generation now. This time I ran it on the
llvm-profparsers CLI tool instead of tarpaulin on some files I had lying
around from another project I was testing. At this point I was mainly seeing if
samply worked.

Running samply was as simple as:

```
samply record target/release/cov show --instr-profile benches/data/mapping/profraws/* --object benches/data/mapping/binaries/*
```

Now this code does go over the region expressions and generate count values and
add to a list of pending expressions. You can see the full function at this point
in time [here](https://github.com/xd009642/llvm-profparser/blob/54a2dcfff0e6103b21464f37cea1597125db9e2d/src/coverage/coverage_mapping.rs#L150-L276). But it's long so I won't paste it all in but instead explain a bit.

There is a map of region IDs to counts, as we go over the expression list we
get elements from the initial version and update values as we resolve expressions.
The `HashMap::get` calls happen in loops as we go over the expression tree.

Initially, we do one pass through to build up the pending expressions and then
loop over pending list until we finish it. If we can reduce the number of times
we loop over things we can speed stuff up.

One thing I noticed before is that the expressions are a tree with the deeper
nodes being later in the list. This means potentially, we can go over the list
less times if we initially iterate it in reverse. Grabbing the deeper nodes firsts
should mean the nodes above them get resolved more easily.

With that in mind I did the following diff:

```
< for (expr_index, expr) in func.expressions.iter().enumerate()
---
> for (expr_index, expr) in func.expressions.iter().enumerate().rev()
```

Running the benchmark and...

```
Benchmarking report generation: Warming up for 3.0000 s
Warning: Unable to complete 100 samples in 5.0s. 
report generation       time:   [806.43 ms 809.27 ms 812.17 ms]                              
                        change: [-79.923% -79.433% -78.921%] (p = 0.00 < 0.05)
                        Performance has improved.

Benchmarking subreport generation: Warming up for 3.0000 s
Warning: Unable to complete 100 samples in 5.0s. 
subreport generation    time:   [117.87 ms 119.28 ms 120.84 ms]                                 
                        change: [-22.306% -21.266% -20.132%] (p = 0.00 < 0.05)
                        Performance has improved.
Found 13 outliers among 100 measurements (13.00%)
  9 (9.00%) high mild
  4 (4.00%) high severe
```

This takes report generation from ~3.8s to ~0.8s. I also noticed in report
generation there was a `HashMap` where I could reserve the additional capacity
and maybe save some allocations. Running samply again I see the part of the code
taking the most time is now the profraw parsing not report generation! 

Oh dear glancing briefly at the report parsing I see:

```
let name = symtab.names.get(&data.name_ref).cloned();
let (hash, name_hash) = if symtab.contains(data.name_ref) {
    // SNIP
};
```

That can just be a `if name.is_some()` and avoid another `HashMap` lookup.
When I compared this parsing code to llvm my initial implementation was significantly
faster. With the difficulties in the coverage mapping part of the code and then it's
performance issues I didn't really go back and see if I could speed up the profraw
parsing anymore. But this should be an easy win.

# Some Results

With three changes under our belt lets take a look at the impact. This time I'm running
on:

* [Polars](https://github.com/pola-rs/polars) (commit 5222107)
* [tokio](https://github.com/tokio-rs/tokio) (commit 0cf95f0)
* [datafusion (core)](https://github.com/apache/datafusion) (commit 3e30f77)
* [jiff](https://github.com/BurntSushi/jiff) (commit 08abead)
* [ring](https://github.com/briansmith/ring) (commit a041a75)

I do one warmup run and for some crates I've slightly adapted the tarpaulin command to
either get it working, make it not unreasonably slow or include even more code/features.
I'll also be checking the change in coverage to make sure the iteration order
change doesn't cause a different in the results.

For each tarpaulin invocation I share this was ran in hyperfine as:

```
hyperfine --warmup 1 --export-markdown results.md "$TARPAULIN_COMMAND" 
```

After running these I realised I could have ran both tarpaulin commands together
if I used absolute paths instead of changing my local tarpaulin installation.
I'll keep that in mind for next time.

Running polars with the command `cargo tarpaulin --engine llvm --skip-clean`:

| Command | Mean [s] | Min [s] | Max [s] |
|:---|---:|---:|---:|
| polars before  | 155.460 ± 1.425 | 152.717 | 157.120 |

Running datafusion-common with the command
`cargo tarpaulin --engine llvm --skip-clean  -p datafusion-common`:

| Command | Mean [s] | Min [s] | Max [s] |
|:---|---:|---:|---:|
|  | 10.075 ± 0.069 | 9.942 | 10.155 |

Running jiff with `cargo tarpaulin --engine llvm --skip-clean --all-features`:

| Command | Mean [s] | Min [s] | Max [s] |
|:---|---:|---:|---:|
| jiff before  | 3.241 ± 0.011 | 3.218 | 3.260 | 
| jiff after | 3.063 ± 0.064 | 2.892 | 3.119 | 

Running ring with `cargo tarpaulin --engine llvm --skip-clean --all-features --release`:

| Command | Mean [s] | Min [s] | Max [s] |
|:---|---:|---:|---:|
| ring before  | 77.923 ± 0.954 | 77.394 | 80.529 | 
| ring after | 76.485 ± 0.124 | 76.211 | 76.671 |

Running tokio with `cargo tarpaulin --engine llvm --skip-clean --all-features`:

| Command | Mean [s] | Min [s] | Max [s] | 
|:---|---:|---:|---:|
| tokio after  | 68.236 ± 0.563 | 67.080 | 68.992 | 
| tokio before | 59.273 ± 0.477 | 58.751 | 60.484 |
