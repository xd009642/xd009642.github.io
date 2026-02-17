Given a Rust project using workspaces with potentially a large amount of packages
how can we make it quicker to run tests or other tooling when the project changes.
Using build systems like Bazel and Buck2 you can use the build dependency graph and
only rerun relevant things. But I've touched Bazel briefly when I was a C++ developer
and I swore never again for my own mental health. Buck2 looks intriguing and I might
look at it in the future if I have some stupid big project to work on - but for Rust
projects it's gonna be hard to beat the developer experience of just using Cargo.

Authors disclaimer: this project isn't a serious project I expect people to use. I had
an idea and I implemented it because it felt interesting and possible with a low time
commitment.

# Implementation Plan

The idea is simple at it's core. If we look at the files changed in a commit and can correlate
them to packages in the workspace we can run our commands just on those packages which have
changed. If we can build a dependency graph between packages in the workspace we can also run
our commands on dependents of changed packages to ensure that changing a dependency doesn't
change how it's users work.

One of the things that first drew me to this was that I could use a trie to represent workspace
paths and check which package a file exists in by looking for the strongest prefix match in the
trie. I hadn't used a trie in anger before, only in University style assignments, so using one
for a real project seemed like something that might be entertaining.

The next part of the plan was using Minijinja for templating to allow any command to be ran like
this - on the changed packages only. I've been using it recently for some work projects so it was
in my mind.

With this rough idea we have 4 components:

1. Git based identification of what's changed
2. Building a dependency graph of the workspace, likely via cargo metadata
3. Finding each files owned package (if there is one)
4. Generating a command and executing it

Steps 1-3 are really just "identifying relevant packages" and 4 is creating/running command. I've
fleshed out 1-3 more already in my head just because that's the area my mind went to first. I know
this is due to a bias on what's more interesting to me but I felt it correlated well with the difficulty.
Spoiler alert: it did correlate well.

We can also special case some commands we already know we'll use to make it more ergonomic. Running
something like `dc --template "cargo test {% for package in packages %} -p {{package}} {% endfor %}`
is definitely not as friendly as `dc test`.

# Identifying Impacted Packages

## Finding Changes via Git2

My first thought here is we don't want to run on a package if any file in it has changed. That would
be safer but we can probably ignore anything that's not a source file, manifest or clearly generating
code. A fairly simple function provides this check:

```rust
use std::path::Path; 

pub fn is_considered(path: &Path) -> bool {
    let ext = match path.extension().and_then(|e| e.to_str()) {
        Some(e) => e.to_ascii_lowercase(),
        None => return path.is_dir(),
    };
    matches!(
        ext.as_str(),
        "rs" | "c" | "cpp" | "h" | "hpp" | "cc" | "cxx" | "toml" | "pb"
    )
}
```

Then after that, given the path to the root repository as we might want to run on
a different folder than our working directory. We can use [git2](https://crates.io/crates/git2)
to identify the files that changed between the current commit and the parent commit.

```rust
use git2::{DiffOptions, Repository};
use std::path::PathBuf;

pub fn get_changed_source_files(root: &Path) -> anyhow::Result<Vec<PathBuf>> {
    let repo = Repository::open(root)?;

    let head = repo.head()?;
    let commit = head.peel_to_commit()?;

    // Last commit should have at least one parent (could look further back as well)
    let parent = commit.parent(0)?;

    let commit_tree = commit.tree()?;
    let parent_tree = parent.tree()?;

    let mut diff_opt = DiffOptions::new();

    let diff =
        repo.diff_tree_to_tree(Some(&parent_tree), Some(&commit_tree), Some(&mut diff_opt))?;

    let mut considered_files = vec![];
    diff.foreach(
        &mut |delta, _| {
            if let Some(path) = delta.new_file().path().or_else(|| delta.old_file().path()) {
                if is_considered(&root.join(path)) {
                    considered_files.push(path.to_path_buf());
                }
            }
            true
        },
        None,
        None,
        None,
    )?;

    Ok(considered_files)
}
```

This wasn't too hard, the library maps well to a knowledge of git and there's also
[helpful examples](https://github.com/rust-lang/git2-rs/blob/master/examples/diff.rs) to get me
looking in the right places.

For a more fully featured one I'd include dirty changes (or have the option to include
them), as well as allowing comparisons between more than the current head and parent.
But this is intended to run in CI and I'm happy running on every commit - for now.

## Working out Workspace Packages

## Trie Stuff

# Generating Commands


