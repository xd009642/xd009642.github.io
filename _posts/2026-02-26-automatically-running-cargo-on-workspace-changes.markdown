---
render_with_liquid: false
---
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

The idea is simple at it's core. If we look at the files changed in a commit and can
correlate them to packages in the workspace we can run our commands just on those
packages which have changed. If we can build a dependency graph between packages in
the workspace we can also run our commands on dependents of changed packages to ensure
that changing a dependency doesn't change how it's users work.

One of the things that first drew me to this was that I could use a trie to represent
workspace paths and check which package a file exists in by looking for the strongest
prefix match in the trie. I hadn't used a trie in anger before, only in University style
assignments, so using one for a real project seemed like something that might be
entertaining.

The next part of the plan was using [Minijinja](https://crates.io/crates/minijinja)
for templating to allow any command to be ran like this - on the changed packages only.
I've been using it recently for some work projects so it was in my mind.

With this rough idea we have 4 components:

1. Git based identification of what's changed
2. Building a dependency graph of the workspace, likely via cargo metadata
3. Finding each files owned package (if there is one)
4. Generating a command and executing it

Steps 1-3 are really just "identifying relevant packages" and 4 is creating/running command.
I've fleshed out 1-3 more already in my head just because that's the area my mind went to
first. I know this is due to a bias on what's more interesting to me but I felt it
correlated well with the difficulty. Spoiler alert: it did correlate well.

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

## Trie Stuff

A trie is a tree structure also called a prefix tree, the [wikipedia](https://en.wikipedia.org/wiki/Trie)
is a reasonably good resource if you've not heard of it before. The reason I'm using a trie
for prefix matching is to get ergonomic checks on if something is within a directory tree.
To visualise this here's a potential trie we might construct from a cargo workspace:

![image info](/assets/20260226/trie.png)

Notice I say ergonomic not fast. While tries are used to speed up prefix based matching, we
don't really know if it'll impact things at this scale. The trie is going to be constructed
when the program runs and used. But depending on the number of changes and the size of the
project it might always be faster to just loop through the packages and do `file.starts_with(package_root)`
for all the packages in the workspace. If this was for a server or something long running
the cost of trie creation could be amortized and we could be more sure of savings. But
that's not the case here.

When selecting a trie library I vaguely recalled a Cloudflare blog on a trie library they wrote
[trie-hard](https://blog.cloudflare.com/pingora-saving-compute-1-percent-at-a-time/). In the
blog they mentioned [rafix_trie](https://crates.io/crates/radix_trie) as the fastest existing
implementation before theirs and in the readme for trie-hard it also mentions radix_trie as
more robust and fully featured. Also, radix_trie was updated more recently whereas trie-hard
seems to have not been touched since their blogpost. With that in mind I chose radix_trie.

## Working out Workspace Packages

In my experience, whenever you write a dev-tool that works on Rust projects you will reach
for [cargo_metadata](http://crates.io/crates/cargo_metadata). This is a minimal library that
takes the json structured `cargo metadata` output and gives you Rust types for it. From that
we can we the metadata for the package, loop over the workspace members, find out what
dependencies they have (and which ones are in our workspace as well). 

This code once again feels straightforward to the point I'll just paste it all in here.
We construct a metadata command that points to the project root. We then iterate over
the workspace members and for each member iterate over it's dependencies keeping ones
which exist within our project root. We then construct a package type with the name
of the package, manifest path and the list of dependencies.

This is inserted into a trie that maps from the workspace path to the package and 
the trie is returned - with a result if the metadata command fails.

```rust
use cargo_metadata::MetadataCommand;
use radix_trie::Trie;
use std::path::{Path, PathBuf};

#[derive(Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct Package {
    pub name: String,
    pub manifest: PathBuf,
    pub dependencies: Vec<PathBuf>,
}

fn check_path(root: &Path, path: Option<&Path>) -> bool {
    match path {
        Some(p) => p.starts_with(root),
        None => false,
    }
}

pub fn find_packages(root: &Path) -> anyhow::Result<Trie<PathBuf, Package>> {
    let metadata = MetadataCommand::new().current_dir(root).exec()?;

    let mut packages = Trie::new();

    for package in &metadata.workspace_members {
        let package = &metadata[package];

        let dependencies = package
            .dependencies
            .iter()
            .filter(|x| check_path(root, x.path.as_ref().map(|x| x.as_std_path())))
            .map(|x| x.path.clone().unwrap().into_std_path_buf())
            .collect();

        let pack = Package {
            name: package.name.to_string(),
            manifest: package.manifest_path.clone().into_std_path_buf(),
            dependencies,
        };
        packages.insert(
            package
                .manifest_path
                .parent()
                .unwrap()
                .as_std_path()
                .to_path_buf(),
            pack,
        );
    }

    Ok(packages)
}
```

# Generating Commands

As mentioned before I'm going to use minijinja for this. The motivation is that we have a list
of packages, we'll have a list of changed packages and probably a list of other arguments to apply
to the command. Depending on the command we might have different ways of providing those lists as
arguments and a Minijinja tempalte lets us express things like loops to generate our command string.

Off the bat I created this template for a simple `cargo test -p package_1 -p package_2` given a list
of those two packages:

<pre>
```
cargo test {% for pkg in packages %} -p {{ pkg }} {% endfor %}
```
</pre>

This can easily be expanded to add a list of other arguments as well or changed from `-p` to `-e` to
exclude packages. To aid in writing templates, Minijinja has a
[playground](https://mitsuhiko.github.io/minijinja-playground/) as well!

I'm also then using [shell-words](https://crates.io/crates/shell-words) to take the command string
and split it up into the command name and args so I can construct a `std::process::Command`. Rules on
splitting arguments involves handling things like quotes and I didn't want to roll that myself - and
knowing the world there's probably some cursed edge-cases.

With Minijinja we start by creating an environment and adding our template. We then get the template
out and can see what undeclared variables are present. These will be where we insert things like our
packages or args. This does rely on us having some reserved names for certain things which the user
will make use of. I've gone for `packages` for the packages to include and `args` for the other args.

We could also not use undeclared variables and just insert all the variables available to us. But why
do extra work when it's trivial to avoid it? Minijinja uses json interally a lot, and the Minijinja
value type is analogous to the `serde_json::Value`. This also means we can create Mininja values from
types that implement `Serialize` and we don't have to worry too much as long as things all look like
they'd serialize into json without a care. 

After that we render the expression, split using shell-words and execute the command.

```rust
use minijinja::{Environment, Value};

fn generate_command(
    template: &str,
    included_packages: &BTreeSet<&str>,
    args: &[String],
) -> anyhow::Result<Command> {
    let mut env = Environment::new();
    env.add_template("cmd", template)?;
    let expr = env.get_template("cmd")?;

    let variable_names = expr.undeclared_variables(true);
    let mut variables = HashMap::new();
    for var in variable_names.iter() {
        match var.as_str() {
            "packages" => {
                variables.insert("packages", Value::from_serialize(included_packages));
            }
            "args" => {
                variables.insert("args", Value::from_serialize(args));
            }
            s => anyhow::bail!("Unsupported variable `{}`", s),
        }
    }
    let result = expr.render(&variables)?;

    let parts = shell_words::split(result.as_str())?;
    let mut part_iter = parts.into_iter();
    let exe = part_iter.next().context("No program name")?;
    let mut cmd = Command::new(exe);

    cmd.args(part_iter)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    Ok(cmd)
}
```

For commands where we don't choose packages to include but also exclude I added another
allowed variable of `excludes`. Adding this to the code we change the function to add
an argument of `packages: &Trie<PathBuf, Package>`. This allows us to get the difference
between the set of packages and the included packages for excludes.
This changes the match on variable names to be as follows (adding the arg is omitted):

```rust
match var.as_str() {
    "packages" => {
        variables.insert("packages", Value::from_serialize(included_packages));
    }
    "excludes" => {
        variables.insert(
            "excludes",
            Value::from_serialize(generate_exclude_list(
                packages.values(),
                included_packages,
            )),
        );
    }
    "args" => {
        variables.insert("args", Value::from_serialize(args));
    }
    s => anyhow::bail!("Unsupported variable `{}`", s),
}
```

With `generate_exclude_list` defined as follows:

```rust
fn generate_exclude_list<'a>(
    packages: impl Iterator<Item = &'a Package>,
    included_packages: &BTreeSet<&str>,
) -> BTreeSet<&'a str> {
    packages
        .filter(|x| !included_packages.contains(x.name.as_str()))
        .map(|x| x.name.as_str())
        .collect::<BTreeSet<_>>()
}
```

# Integrating the Current Pieces

Given the root of the project, we can now:

1. Get the changes
2. Get the packages in the project

Using `radix_trie` if we do `trie.get_ancesntor_value(&changed_file)` it
will give us a package if one exists. Using the initial set of changes we
get the initial packages impacted. Then we can get these packages, check the
dependencies for ones in the workspace. Add it to the list of packages and then
repeat. Continue until no new packages are added.

An astute reader might think "couldn't we have constructed the dependency graph
and just do a graph traversal". And yes we could. But for the size of workspaces I
work with this felt like overkill. Plus I've only got 7 direct dependencies so far
and 3 of them are >1.0

```rust
let considered_files = repository::get_changed_source_files(&root)?;
let packages = cargo::find_packages(&root)?;
let mut changed_packages = BTreeSet::new();
let mut end_package_names = BTreeSet::new();

for file in &considered_files {
    if let Some(package) = packages.get_ancestor_value(&root.join(file)) {
        changed_packages.insert(root.join(file));
        end_package_names.insert(package.name.as_str());
    }
}

let mut changed_packages_previous = 0;

while changed_packages_previous != changed_packages.len() {
    changed_packages_previous = changed_packages.len();

    for (key, val) in packages.iter() {
        if val
            .dependencies
            .iter()
            .any(|x| changed_packages.contains(x))
        {
            if let Some(package) = packages.get_ancestor_value(&root.join(key)) {
                changed_packages.insert(root.join(key));
                end_package_names.insert(package.name.as_str());
            }
        }
    }
}
```

# Designing the CLI

The final step is to create the CLI, for this I'll be using [Clap](https://crates.io/crates/clap). 
Here we'll  create an enum of commands with some predefined ones so we can do `dc test`,
`dc nextest`, `dc build` and `dc run` where run is the only one without a presupplied
template. We'll pop some convenience methods on the arg types to get out the right templates,
paths, and other things depending on defaults or what the user supplies.

Aside from that every command will have a `--no-run` option and other args will be supplied
after `--`. Clap doesn't seem to allow me to grab all the unexpected args as a `Vec<String>`
or some sort of map otherwise, which makes sense but is a bit of added friction to the CLI.

```
dc test -- --all-features
```

That CLI interface defined with Clap is as follows::

<pre>
```rust
const CARGO_TEST_TEMPLATE: &'static str = "cargo test {% for pkg in packages %} -p {{ pkg }} {% endfor %} {% for arg in args %} {{ arg }} {% endfor %}";
const CARGO_NEXTEST_TEMPLATE: &'static str = "cargo nextest {% for pkg in packages %} -p {{ pkg }} {% endfor %} {% for arg in args %} {{ arg }} {% endfor %}";
const CARGO_BUILD_TEMPLATE: &'static str = "cargo build {% for pkg in packages %} -p {{ pkg }} {% endfor %} {% for arg in args %} {{ arg }} {% endfor %}";
const CARGO_BENCH_TEMPLATE: &'static str = "cargo build {% for pkg in packages %} -p {{ pkg }} {% endfor %} {% for arg in args %} {{ arg }} {% endfor %}";

#[derive(Debug, Parser)]
pub enum RunCommand {
    Test(RequiredArgs),
    Nextest(RequiredArgs),
    Build(RequiredArgs),
    Bench(RequiredArgs),
    Run(Args),
}

impl RunCommand {
    pub fn required_args(&self) -> &RequiredArgs {
        match self {
            Self::Test(a) | Self::Nextest(a) | Self::Build(a) | Self::Bench(a) => a,
            Self::Run(a) => &a.required,
        }
    }

    pub fn command(&self) -> Option<Cow<'_, str>> {
        match self {
            Self::Test(_) => Some(CARGO_TEST_TEMPLATE.into()),
            Self::Nextest(_) => Some(CARGO_NEXTEST_TEMPLATE.into()),
            Self::Build(_) => Some(CARGO_BUILD_TEMPLATE.into()),
            Self::Bench(_) => Some(CARGO_BENCH_TEMPLATE.into()),
            Self::Run(a) => a.command.as_ref().map(|x| x.into()),
        }
    }
}

#[derive(Debug, Parser)]
pub struct RequiredArgs {
    /// Get the project to run on, runs in current directory otherwise.
    #[arg(short, long)]
    input: Option<PathBuf>,
    /// Generate command but don't run it
    #[arg(long)]
    no_run: bool,
    /// These will be passed to the minijinja template as the args variable
    #[arg(last = true)]
    args: Vec<String>,
}

impl RequiredArgs {
    fn path(&self) -> PathBuf {
        match self.input.as_ref() {
            Some(s) => s.clone(),
            None => env::current_dir().unwrap(),
        }
    }
}

#[derive(Debug, Parser)]
pub struct Args {
    /// Run the following command. This accepts a minijinja template where `packages` is a list of
    /// packages that can be included and `excludes` is a list of packages that can be excluded.
    /// For a cargo test you can write the template `cargo test {% for pkg in packages %} -p {{ pkg
    /// }}{% endfor %}`
    #[arg(short, long)]
    command: Option<String>,
    #[command(flatten)]
    required: RequiredArgs,
}
```
</pre>

# Missing Pieces

With this the user can add their own `-p` or `-e` to the cargo test templates for things they
always want to test i.e. when things might break because of stuff not in the package workspace.
I haven't made any effort to remove conflicts in that case. There's also probably stuff with
propagating environment to the process which is easy enough to do but I don't have a need for it.

Another thing would be applying this to multiple commits or between branches. I'll likely look
into that the first moment I feel a need for it myself - I don't see it being too much extra
just maybe a bit of faff.

Overall, I've made something that works on my projects and I don't have a strong motiviation to
make into a more general project for a wider community. I have a feeling this is solved by other
systems better and that's fine - I don't do a lot of this stuff looking for users more to scratch
an itch.

# Will I Use This? 

Probably not, but maybe. Recently Github has been having "_issues_" as I'm sure a lot of people
are aware. Seems like they're targetting the lofty heights of one 9 of uptime. And during this at
$day_job we've seen CI pipelines in workspaces that normally take 4 minutes take upwards of 50
minutes. Maybe this would make them take more like 20 minutes when Github Actions are having
a moment. But then with degraded performance like that no bets are off. The main thing is I
got to do something a bit different and have fun so I'll chalk that up as a win and move on
with my life.
