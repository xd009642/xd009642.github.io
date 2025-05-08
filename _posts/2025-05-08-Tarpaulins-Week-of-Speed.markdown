This week I've dropped two [cargo-tarpaulin](https://github.com/xd009642/tarpaulin)
releases both of which have significant speed-ups for llvm coverage reporting.
When I say significant the first one gave me a ~80% speedup on a benchmark, and
then the next one was a further 90% speedup. Meaning on this benchmark I achieved
overall a 98% speedup.

Obviously, with getting speed-ups of this significance I was doing something
really stupid, that's definitely true for the first speed-up. For the second
one it wasn't so much idiocy as a missed opportunity. 

But before that let's dive into some context! 

# The Preamble

Tarpaulin is a code coverage tool, and as part of coverage it offers two
backends:

1. ptrace - UNIX process tracing API, like a debugger. Not fully accurate
but more flexible on where you can get coverage data
2. LLVM instrumentation - runtime bundled into a binary which exports some
data files. Fully accurate, some limitations of what coverage it can report

The LLVM coverage instrumentation is what was slow, so how doess that work?

1. You run your tests
2. It spits out a profraw file
3. **Typically** you use llvm-profdata (found in the llvm-tools rustup
component) to turn profraw to profdata
4. **Typically** you use llvm-cov (also in llvm-tools) to take the
executable file and your profdata and make a report

I say **typically** here because I always find it a bit annoying having to
install multiple tools to use one, and when tools just go installing other
things. This doesn't matter as much in CI but in my own hubris I implemented 
the profraw parsing and mapping [here](https://github.com/xd009642/llvm-profparser). 

_Note I do have a feature planned to optionally use the llvm-tools_

But anyway, it's this parsing code that's the issue. And we can tell this by the
fact tarpaulin can go 6 minutes plus on some projects just after printing out
`Mapping coverage data to source` before we see anything else.

Of course, the best way to figure things out is benchmarking on realistic
input data, and we really want something that will stress tarpaulin so prompted
by a users comment on a GitHub issue I'll be comparing execution times using
[polars](http://crates.io/crates/polars).

After doing `cargo tarpaulin --engine llvm --no-run` to avoid measuring the cost
of downloading dependencies and building the tests. This is the initial result:

Then for testing I'll run:

```sh
time cargo tarpaulin --engine llvm --skip-clean
// SNIP tarpaulin output
real	41m34.411s
user	40m1.784s
sys	1m4.368s
```

Looking, I can also see we generated 37 profraws so we're dealing with at least 37
test binaries and 37 calls to merge the reports. Running polars without tarpaulin
but with the coverage instrumentation we get:

```sh
real	0m3.103s
user	0m7.077s
sys	0m1.715s
```

So there's clearly a big gap to close. We can't get down to 3s but we should
try to get as close as possible. _Though it is worth mentioning that the 
instrumentation profiling does seem to balloon the compilation time A LOT._

# The Idiocy

So first off lets isolate to the code that caused the issue. Then once we've
discussed it I'll go a bit into how I figured this out and then using that
technique again to find the next issue.

```rust
while !pending_exprs.is_empty() {
    assert!(tries_left > 0);
    if index >= pending_exprs.len() {
        index = 0;
        tries_left -= 1;
    }
    let (expr_index, expr) = pending_exprs[index];
    let lhs = region_ids.get(&expr.lhs);
    let rhs = region_ids.get(&expr.rhs);
    match (lhs, rhs) {
        (Some(lhs), Some(rhs)) => {
            pending_exprs.remove(index);
            let count = match expr.kind {
                ExprKind::Subtract => lhs - rhs,
                ExprKind::Add => lhs + rhs,
            };

            let counter = Counter {
                kind: CounterType::Expression(expr.kind),
                id: expr_index as _,
            };

            region_ids.insert(counter, count);
            if let Some(expr_region) = func.regions.iter().find(|x| {
                x.count.is_expression() && x.count.id == expr_index as u64
            }) {
                let result = report
                    .files
                    .entry(paths[expr_region.file_id].clone())
                    .or_default();
                result.insert(expr_region.loc.clone(), count as _);
            }
        }
        _ => {
            index += 1;
            continue;
        }
    }
}
```

Here `pending_exprs` is a `Vec<(usize, Expression)>` where expression is just
two counts and a binary operator to apply to them. So pretty small types. This
code then goes through a list of expressions that depend on other expressions
and evaluates them, stores the result and then passes through until all the
expressions are resolved.

I remember roughly writing this code, and I remember my main concern was just
figuring out how the expressions and coverage regions worked. And that's why I
did the big dumb-dumb. And dear reader if you want to take a guess you have
until the next paragraph to finish making it before I start revealing.

The entire issue is `pending_exprs.remove(index);`. With this line I remove an
element from potentially the start of the vector, and then have to move every
element back filling in the hole. These expressions are also used to work out
condition coverage. So the more boolean subconditions you have and the more
branches in your code the more you likely have in a function. I haven't
attempted to prove it, but I feel the number of regions should correlate with
the cyclometric complexity of a function.

That aside there's two "easy" solutions for this:

1. Try to iterate through the list in reverse order so hopefully you can remove
from the back and significantly reduce copies 
2. Have a way to mark a vec element as done so you can skip it in the list and
do no copies

Intuitively, I feel that 1. has too much risk of still copying too much and
causing a performance hit. So I went for 2. And to do this I just make the
pending expression type an `Option` and set it to `None` instead of removing it.

After this the while statement looks like:

```rust
let mut index = 0;
let mut cleared_expressions = 0;
let mut tries_left = pending_exprs.len() + 1;
while pending_exprs.len() != cleared_expressions {
    assert!(tries_left > 0);
    if index >= pending_exprs.len() {
        index = 0;
        tries_left -= 1;
    }
    let (expr_index, expr) = match pending_exprs[index].as_ref() {
        Some((idx, expr)) => (idx, expr),
        None => {
            index += 1;
            continue;
        }
    };
    let lhs = region_ids.get(&expr.lhs);
    let rhs = region_ids.get(&expr.rhs);
    match (lhs, rhs) {
        (Some(lhs), Some(rhs)) => {
            let count = match expr.kind {
                ExprKind::Subtract => lhs - rhs,
                ExprKind::Add => lhs + rhs,
            };

            let counter = Counter {
                kind: CounterType::Expression(expr.kind),
                id: *expr_index as _,
            };

            region_ids.insert(counter, count);
            if let Some(expr_region) = func.regions.iter().find(|x| {
                x.count.is_expression() && x.count.id == *expr_index as u64
            }) {
                let result = report
                    .files
                    .entry(paths[expr_region.file_id].clone())
                    .or_default();
                result.insert(expr_region.loc.clone(), count as _);
            }
            pending_exprs[index] = None;
            cleared_expressions += 1;
        }
        _ => {
            index += 1;
            continue;
        }
    }
}
```

After this change the polars run is:

```
real	2m24.941s
user	1m27.586s
sys	1m2.708s
```

# How to Find Bad Code (Flamegraphs)

Now that parts all well and good, a massive win. Pat on the back and go home. 
But how did I find where to fix my dumb mistake? The relevant part of the
parsing code is probably only 500 lines or so. I guess I could have read it
or sprinkled some print statements around. But this is serious work so I aim
to be a smidgen scientific. And in enter flamegraphs.

Just add the following to Tarpaulin's Cargo.tom so I can actually get
function names instead of addresses and install the local version:

```toml
[profile.release]
debug = true
```

Next up I want to run tarpaulin with `perf` to get a `perf.data` file. Perf is
a sampling profiler so no instrumentation or changes to your binary - except
for the debug symbols to make like easier. I also use
[inferno](https://github.com/jonhoo/inferno) by Jon Gjengset to generate the
flamegraphs:

```
perf record --call-graph dwarf --  cargo tarpaulin --engine llvm --skip-clean
perf script | inferno-collapse-perf | inferno-flamegraph > perf_flamegraph.svg
```

If you want to understand more about perf and getting useful calls for it you
probably want to look at anything Brendan Gregg has written [link](https://www.brendangregg.com/perf.html).
Also Denis Bakhvalov's book is great [link](https://products.easyperf.net/perf-book-2).

Unfortunately, I lost the flamegraph I originally did. But it wasn't of polars
but a smaller project. And serializing the perf.data files afterwards takes so
long I didn't fancy a 1 hour plus wait to create a flamegraph of before the stupid 
issue was fixed so you'll have to live with the after flamegraph.

After:

![Flamegraph](/assets/20250508/flamegraph_1.svg)

You should be able to open this SVG in your browser, click on blocks and then have
it zoom on that execution stack. You can use that to dig in and see what some of the
really small spikey towers are. Before the trace was massively taken up by calls to
`Vec<T>::remove`, which is why I tackled that first.

## Why Not Cargo-Flamegraph?

I also tried using [cargo-flamegraph](https://github.com/flamegraph-rs/flamegraph). 
However, the flamegraph was mostly dominated by cargo and tarpaulin was only a tiny
sliver so something was wrong there. But I've used `cargo-flamegraph` before successfully
so if you want to see the command it was:

```
flamegraph -- cargo tarpaulin --engine llvm --skip-clean
```

# Still Slow?

Well I cut a release and updated the issue and:

> After updating to Tarpaulin 0.32.4, I see a performance boost of around ~25%,
> which is already a good improvement. I tried creating a fresh project and adding
> heavy dependencies to it (like polars-rs), but the performance is still quite fast.
> So, I don't know how to provide a minimal example where this step takes too long to
> execute.

And looking at that new flamegraph we've got a lot of time spent in find. In
fact it's the dominant time. This feels like something I can fix. Going back
to the code I can see instantly where the find is:

```
let record = self.profile.records().iter().find(|x| {
    x.hash == Some(func.header.fn_hash) && Some(func.header.name_hash) == x.name_hash
});
```

That's not great, and I don't think we can search the records to do things
like binary searching for the hashes. But there's something easier to do...

## Memoization

For previous performance work some memoization was added for the profraw parsing, 
an `FxHashMap` going from the strings to the index in the records array. There's
already a symbol table going from hashes to names so I can just look up the name
then get the index from the name and get the exact record. This turns one find
on a vec to two hashmap lookups and then the array access.

So adding this method to my `InstrumentationProfile` type:

```rust
pub fn find_record_by_hash(&self, hash: u64) -> Option<&NamedInstrProfRecord> {
    let name = self.symtab.get(hash)?;
    self.find_record_by_name(name)
}
```

I then change the find call to:

```rust
let record = self.profile.find_record_by_hash(func.header.name_hash);
```

And now the times for the outputs:

```
real	2m24.562s
user	1m25.707s
sys	1m3.097s
```

And the flamegraph:

![Flamegraph](/assets/20250508/flamegraph_2.svg)

# Some Thoughts

Now, looking at these results I don't see much change. Which is disappointing,
although the flamegraph is a lot different. Running the Criterion benchmarks
for my profparser crate I do see a 80% speedup on top of the previous speedup.
This indicates that either there's something a bit screwy with the benchmark
for the data is respresentative of a different pattern to the polars code.

The find scans across all the function records, and remove handles the coverage
region expressions. There is some interplay between the amount of functions in
your project and the complexity of the coverage regions of those functions. And where do
most of the complex functions live? Near the start of the records list or the end?

All these things could dramatically change how much impact these different speedups
give different projects. I'm still waiting on a response back to see if the second
speedup significantly improved things for that user. Hopefully, but time will tell.

# More Speedup?

The LLVM profiling data does require (at least for polars), parsing around 1GB
of data files. Then after parsing the extra ELF sections added expression
evaluation and a lot of merging/resolution work. Looking at the profile I do
see a lot of time spent reading files. From the sampling 51%n of the tarpaulin
running time is handling the instrumentation runs - which will be parsing, merging
and extracting relevant data from the profraws and binaries. But ~30% is just
reading files.

Now this can be thrown off by inaccuracies in sampling, and there is potentially
room for some multi-threading to be applied smartly to speed up parsing of a mass
of files. But it seems the low hanging fruit may have all been plucked.

While, I can just _try things_, seeing around 96% speedups on one project but only
25% on another with the same code being the bottleneck it feels like a more analytic
approach is in order.

The next steps are going to be to gather better insights of the shape of the data
for different projects. So things like, the number of function records, the number
of counters in those. The number of expressions and how many steps to resolve them.
Start to analyse how each of these varies and how these variations impact performance.
Part of this will also be creating a corpus of test projects where I can stress the 
code in different ways. But that's a topic for a future post.
