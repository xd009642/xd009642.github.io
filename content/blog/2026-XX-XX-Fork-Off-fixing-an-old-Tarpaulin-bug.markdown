For a while using ptrace in Tarpaulin there's been potentially intermittent failures with
tests that spawn other processes or fork a process. These are mainly observed in CI and users
often can't recreate them. Often changing other parts of the Tarpaulin run configuration would
result in the issue going away completely and then it became easy to kick the can down the
road a bit. Indeed it happened in my Tarpaulin tests as well, but not that often maybe 1 in 50
runs initially. Recently it's become a lot more common (there might be conclusions to draw about
Github Actions from this but I'll leave that to you).

I can see where I added the code I fixed and it was 6 years ago, during that weird period where
I had a lot of time to work on Tarpaulin and not much else to do. At the time I was mainly working
on adding the LLVM coverage backend though to completely bypass some of these process tracing via
ptrace based errors.

# What is Ptrace?

I don't want to go too into the weeds on ptrace, but some level of explanation is required here.

Ptrace is a Unix system call for process tracing, it allows you to: attach to other processes, read
and write to their memory, send signals to them, intercept signals and syscalls. It's also the foundation
behind debuggers like GDB and tools like strace. It also kinda sucks, though there are some resources
that can help like [the strace docs on it](https://github.com/bnoordhuis/strace/blob/master/README-linux-ptrace).

One of the main reasons that it's annoying to use is that the process your tracing runs independently,
and you will be mutating it when it stops and signals to you and restarting it. This means doing things
like changing program counters, stepping forwards, backwards (used when you disable a breakpoint and want
to run that instruction). 

For an example of an issue if I call `waitpid` on my traced process and it tells me I've stopped at
breakpoint 1. I can disable the breakpoint (overwrite the `INT3` instruction with the original instruction
data), step back the program counter so that it's on the relevant instruction and can execute it and
then do a continue to execute the instruction and continue execution with the breakpoint disabled.

This behaviour will very easily cause a `SIGILL` (illegal instruction) to be raised by a program. If a program
is multithreaded (cargo test uses multiple threads by default), and another thread was stopped on the same
breakpoint the continue will continue that other thread but it will potentially be misaligned if the `INT3` was
on an instruction longer than 1 byte and attempt to execute the latter half of the instruction. If the other
half is a legal instruction you might just get a `SIGSEGV` later on as well.

Because of this when `waitpit` returns an event, I call it multiple times in a loop until I have a list of
all the events and then set about handling changes they all need and continuing/stepping them all at the end
as needed. Throw in forks and process execs and now you have even more things and sometimes those processes will
use signals to communicate to each other as well which have to be forwarded (some signals like segfaults Tarpaulin
will swallow and report as errors). This gives you all of fun of race conditions where the only way to avoid them
is just "get gud". 

# The issue

Sometimes, when running in CI we get a `SIGILL` from the test running on a forked process. This suggests that
it's down to continuing on a breakpoint without properly disabling it and stepping the program counter backwards
to reexecute the instruction.

When a process forks in ptrace we get all the changes to the instructions (so our breakpoints added) in
the child process. We also get a event stop in the parent to let us know the process has forked and what the
PID is. Plus the child's first event will be a `SIGSTOP` so we can continue it after it's started and
we've done some setup.

With a flaky test though, the first thing to do should be to recreate it. Searching online I found some
sources that said Github Actions Runners get 4 vCPU for open-source project. Github Actions runners in my
experience tend to have wild variance in times for the same CI job so we can assume the instances are often
fairly saturated with other jobs. To try and recreate the running environment I've ran the Rust bullseye docker
image with 0.25 CPU and then ran Tarpaulin with 4 test threads.

```
podman run --security-opt seccomp=unconfined --cpus="0.25" -it -v $PWD:/app:Z rust:1-bullseye /bin/bash
```

```
EXPORT RUST_TEST_THREADS=4
while cargo tarpaulin --engine ptrace --follow-exec --dump-traces --include-tests --skip-clean; do rm *json; done
```

Sure enough running this I get a failure after around 5-10 runs on average. I triggered a few just in 
case there was anything unclear in what could be the cause.

# Debugging

To debug this we go back to an old friend [tarpaulin-viewer](https://github.com/xd009642/tarpaulin-viewer) a
Qt app to visualise the dumped traces from Tarpaulin. In tarpaulin-viewer each horizontal line is a 
thread or process ID and events are blocks placed on the line. Anything that creates a new process or thread
ID is shown as a branch.

Scrolling over to the fork and screenshotting a subset showing the failure we get:

![failing_fork](/assets/2026XXXX/failing_fork.png)

And then for the passing case we get:

![passing_fork](/assets/2026XXXX/passing_fork.png)

Because ptrace is started with options to stop on forks etc we get a SIGSTOP as the first stop on the
forked process which is continued from. In the passing case this SIGSTOP comes the same time as the
ptrace fork event in the parent process. In the failing case the forked child is continued, hits a breakpoint 
which is continued and then the fork event arrives.

Looking at this it seems like a clear concurrency issue, the fork event is only delivered after the fork syscall
in the parent exits and during that time the child is able to progress arbitrarily far. But why would this cause a
SIGILL?

For each process being executed Tarpaulin maintains a map going from the process PID to the breakpoints we've
derived for it. Knowing the state of the program and the breakpoints is important. When things like fork events
come in or process spawns Tarpaulin will initialise the breakpoints for this process and add them into the map
so it can run as expected. As all events are processed before responding to them when the fork event comes and
the breakpoint map is initialised this is then used to continue the child process. This means if the fork event
comes in the same step as the initial child SIGSTOP or the first breakpoint hit it will respond correctly. However,
if it isn't available before the first breakpoint is hit we don't know we actually have a breakpoint there and we
just try to continue getting the SIGILL from a misaligned instruction.

# Fixing the Issue


```rust

fn get_parent(&self, pid: Pid) -> Option<Pid> {
    self.pid_map.get(&pid).copied().or_else(|| {
        let mut parent_pid = None;
        'outer: for k in self.processes.keys() {
            for tid in self.event_source.get_tids(*k) {
                if tid == pid {
                    parent_pid = Some(*k);
                    break 'outer;
                }
            }
        }
        if parent_pid.is_none() {
            parent_pid = self.get_ppid(pid);
        }
        parent_pid
    })
}

fn get_ppid(&self, pid: Pid) -> Option<Pid> {
    let proc = Process::new(pid.as_raw()).ok()?;
    if let Ok(status) = proc.status() {
        info!("Found potential parent");
        let pid = Pid::from_raw(status.ppid);
        Some(pid)
    } else {
        None
    }
}
```
