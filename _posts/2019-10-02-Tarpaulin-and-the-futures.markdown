[Tarpaulin](https://github.com/xd009642/tarpaulin) (or cargo-tarpaulin) is a 
code coverage tool for Rust, and anyone who's used it might know that until
recently it had an issue with code that used futures.

This post is going to go into that issue a bit and the eventual fix. For anyone
who wants the deeper story there's also the github 
[issue](https://github.com/xd009642/tarpaulin/190).

This issue has also existed since January and has had a lot of work so if I
skirt over anything or don't provide nice logs it's genuinely because they've
been lost in the annals of time and my organisational skills.

## A bit of background

So how does Tarpaulin work? Simply it builds your project with a few special
flags to ensure it can get the necessary information to instrument the binaries.
Then for each binary it will get the lines it can instrument, filter out some
lines based on analysis of the source code and add some extra lines for things
other coverage tools miss i.e. unused generic code.

It then forks, launches the test via `execve` so the test starts with the child
PID and uses `ptrace` to add breakpoints to the code and uses `waitpid` and
`ptrace` to follow what the binary is doing and collect the relevant coverage
statistics. After hitting a breakpoint Tarpaulin would count the line, disable
the breakpoint so the program counter can progress, single step and then
re-enable the breakpoint. This was so we could get the hit-rate for a line.

This has all sorts of issues involved, when a test has multiple threads each
thread can be in different places. And sometimes they can be in the same place
(which is where some of the initial issues started). My very first fix was
setting `--test-threads 1` when the test executables were launched by Tarpaulin.

The first threading issue found was much older than this one but is the same
general problem. If a thread stops at a breakpoint we know
it's set so we can disable it, count the hit, single step the thread and
re-enable the breakpoint so we can get the number of line hits.

If two threads hit the same breakpoint at the same time this caused issues
initially. Especially, if the next instruction was also instrumented. 

The main reason why was because when you send a continue, or a step command
via ptrace, all the threads in the process react to that signal. Even if you
specify which TID you want to move on!

The first version of tarpaulin didn't consider how other threads were causing
the instructions to change and would frequently freeze or stall as a result.
This was fixed and not counting line hits was also made default to minimise
other threading quirks and speed up runs. 

But there was something else lurking.

## The issue being fixed

So an issue is a lot easier when you have a minimal reproducible example, and
for the issue we're tackling there was this one:

```Rust
#[test]
pub fn a() {
    futures::executor::ThreadPool::new();
}

#[test]
pub fn b() {
    futures::executor::ThreadPool::new();
}
```

If we ran this Tarpaulin was guaranteed to report a segfault from the test
binary. After spending a while stumped on this I added a `--debug` flag to
tarpaulin that gives any user very detailed logs on all the signals received
and Tarpaulin's  response. 

From this I realised something, if all the threads are stopped and step causes
them to all step and execute what they're doing. If we have a MOV instruction
as below with it's opcode:

```
MOV r/m8,r8 : 88 /r
```

The Opcode would turn into `CC /r` and as we have to move the program counter 
back one byte reenable the instruction and step to execute it to execute a
valid instruction there's a potential issue. Any thread that is also stopped on
a breakpoint will be 1 byte ahead of it and will execute a potentially illformed
instruction. Either way this is definitely undefined behaviour.

From this realisation the solution seemed simple, at the start of the Tarpaulin
update loop call `waitpid` as many times as it will deliver signals and create a
signal queue. Then for every element of the queue collect the coverage data,
update the breakpoints and push a recommended action onto an action list.

Another foible with ptrace is that when you get a signal from a PID you need to
respond to it in the order you get it. So then I go through the action queue
carrying out the recommended action for every signal.

This was implemented (`src/statemachine/mod.rs` and `src/statemachine/linux.rs`
for interested parties). I ran it on the test program 10 times and saw no errors
and then ran it on a real world project that had the issue and got the expected
coverage. So that's it fixed then?

Wrong. Users started reporting the issue persisted. After running for 100 times
I found this occurred 10% of the time on my home machine.

## Changes in rustc

So here's the point where things slowed down considerably. I was stumped and
also I was in the process of changing job and moving so I had a lot on my plate.
Additionally, debugging from the logs was tedious and I often found myself
drawing long sprawling graphs with the lifetime of a program.

To try and speed up my debugging process I took the code for the update loop
and removed everything else. Used a toml file to specify addresses to instrument
and a path to a binary and made [minitarp](https://github.com/xd009642/minitarp)
to generate graphs showing the lifetime of the test. This also let me take the
instrumentation points Tarpaulin derived as a starting point and tweak them
removing some, adding others from reading the dissassembly or DWARF dumps of a
program.

And here is our failing minimal example (but with 4 tests doing the same thing
not 2). _Open all images in a new tab, they're 4K resolution to fit all the 
information_

![A failing test](/assets/20191002/fail.png)

Here the bottom line is the tests PID, all the IDs above are for new threads
spawned. When a thread ends in `<TID>: EXITED 0` it's exited successfully,
otherwise it's failed. The colours were default from gnuplot so don't attach
any meaning to them.

We can also see the printouts show any signals tarpaulin received, actions it
received and if it stopped at a breakpoint the breakpoint address. 

We can see from this image the 8 threads we expect our first `ThreadPool` to
create were created and exited correctly. But then the second test occurs and
we catch the threads being created but none of them exit. Some of them we
also don't catch the creation event, others we only catch creation and nothing
afterwards.

Eventually, after all 8 threads are created we end up getting our segfault and
the whole thing comes to a halt.

Why is this? Spoiler alert it's because of `--test-threads 1`, and I discovered
it completely by accident. I thought removing the test thread limit would
exacerbate the problem further and help me figure out why I couldn't see some
threads come into existence. I'd noticed from the test PID line that the first
line of the second test was hit before the threads all exited - eagle eyed
readers can see this point around sample 92 on the timeline.

This is the time to note `TryContinue` as an action exists for two reasons.
Sometimes after a thread exits you can get a signal from it which is no longer
valid. It's best to respond to it to keep everything balanced but if it fails
it's not an issue. The other instance is for moments when Tarpaulin has reached
a state I didn't expect so tries to continue to see if it's a blip.

But none of this explains why `--test-threads 1` would cause this! The answer is
naturally in libtest in the rust compiler.

```Rust
    if concurrency == 1 {
        while !remaining.is_empty() {
            let test = remaining.pop().unwrap();
            callback(TeWait(test.desc.clone()))?;
            run_test(opts, !opts.run_tests, test, run_strategy, tx.clone(), Concurrent::No);
            let (test, result, exec_time, stdout) = rx.recv().unwrap();
            callback(TeResult(test, result, exec_time, stdout))?;
        }
    } else {
        while pending > 0 || !remaining.is_empty() {
            while pending < concurrency && !remaining.is_empty() {
                let test = remaining.pop().unwrap();
                let timeout = Instant::now() + Duration::from_secs(TEST_WARN_TIMEOUT_S);
                running_tests.insert(test.desc.clone(), timeout);
                callback(TeWait(test.desc.clone()))?; //here no pad
                run_test(opts, !opts.run_tests, test, run_strategy, tx.clone(), Concurrent::Yes);
                pending += 1;
            }
        // More code handling timeouts etc
    }
```

This code in `libtest/lib.rs` at line 1201 (existing as of f2023ac). Is
different from when I first read libtest to figure out some issues. When I first
looked the `if concurrency == 1` didn't exist instead the logic in the `else`
statement was used for all the instances. There's also code further down that
launches tests in a subcommand or in-process. I haven't quite narrowed down
the exact reasoning behind why it doesn't work so if anyone has any insight
I'd appreciate it!

To avoid an anti-climatic ending I'll close with the news that Tarpaulin now
seems to work perfectly with projects using futures and the removal of 
`--test-threads 1` should see a speedup for all projects. I'll also add a
picture of the graph minitarp generated once the issue was fixed:

![A failing test](/assets/20191002/pass.png)

