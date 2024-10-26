Sometimes, you may end up in a situation where you have a big project to test
in CI. Maybe you have some data that is processed or loaded or test outputs
that clog up a bunch of disk. And github actions starts failing, out of disk
space yada yada. Irritated you start a barrage of `fix ci` commits trying to
reduce the amount of data you generate and slim it down but it's to no avail.

Then you look to the base images, the ubuntu-latest that you're building on top
of. Can you slim down some stuff in this? Maybe, what does it come installed
with?

Android, Haskell, .NET, docker images? 55GB of storage taken up in a 75GB
container!

Will no one rid me of these meddlesome files?

In steps [free-disk-space](https://github.com/jlumbroso/free-disk-space). It
looks okay and someones gone to the trouble. You sit back and relax as
unprompted it visits all these files you had no idea existed and rids you of
them.

A few months pass, the seasons change, cherry blossoms bloom and fall as
spring turns to summer turns to winter. The days grow shorter, and so should
your CI time. Are there any wins to be had here? Looking in the logs there's
alarm free-disk-space takes up 3-5 minutes. Bloody 'ell.

So here I am, about to embark on my own voyage. Part shitpost, part CI bill
reduction. 

With free-disk-space lets take a look at the disk stats it prints out:

Before running:

```
Filesystem      Size  Used Avail Use% Mounted on
/dev/root        73G   55G   18G  76% /
```

After removing **everything**:

```
Filesystem      Size  Used Avail Use% Mounted on
/dev/root        73G   33G   41G  45% /

Saved 23GiB
```

How well does a simple rm fair? Adding the following command to CI took
1 minute 15 seconds. However, looking at a more recent run it only took 16
seconds which kind of kills my motivation for this tool in retrospect...

```
sudo rm -rf /opt/ghc /usr/local/.ghcup /usr/local/lib/android /usr/share/dotnet
```

Okay, well we can still pretend it takes 1 minute all the time to not make it
seem like I've wasted my time!

Plus, free-disk-space does more than this. It runs a bunch of apt-get remove
commands, does a docker image prune and removes swap storage. Sure those rm's
were enough to speed up my CI but you never know...

Naturally, as bash has failed us it's time to use Rust and because it's my go
to language. I can add in the folder paths to delete, delete them in parallel
via rayon and do the docker command in a separate thread.

But what about those apt-get commands? I probably can't parallelise them because
of the package lock. And here comes a suggestion from a friend:

> cursed idea for apt, if you really wanted to go zoom. you could run the apt
> command with strace in your CI to generate a list of files it deletes, and then
> download this list and delete them in parallel as fast as you can, since i assume
> apt is going to be pretty slow for a file deletion tool

That's right! apt-get is just a shitty rm in this case. I know, I'll run a CI
job that does the apt-get commands, parse the strace output and build up a file
list. This file list will then be committed into the code and a PR opened if it
changes. And then my tool will use the list to just push more files and paths
into my rayon deleting iterator.

I've not used strace before so a quick skim of the man page to and I've figured
out a command that should work and have the following code:

```rust
fn remove_packages(packages: &[&str]) -> Vec<String> {
    let strace_out = Command::new("strace")
        .args(["-e", "trace=%file", "-f", "apt-get", "remove", "-y"])
        .args(packages)
        .arg("--fix-missing")
        .output()
        .expect("Failed to strace apt-get");

    process_strace_output(&strace_out.stderr)
}

fn cleanup() -> Vec<String> {
    let strace_out = Command::new("strace")
        .args(["-e", "trace=%file", "-f", "apt-get", "autoremove", "-y"])
        .output()
        .expect("Failed to strace apt-get");

    process_strace_output(&strace_out.stderr)
}
```

`process_strace_output` is a bit more fiddly. We have to grab just the syscalls
we care about. Then the arguments from them and then get the arguments that are
files. Some of the syscalls also seem to have optional arguments that get missed
off. Also, if a remove doesn't work we don't want to list that file. So our hacky
start of processing output to get the list of files is:

```rust
fn process_strace_output(output: &[u8]) -> Vec<String> {
    let string = String::from_utf8_lossy(output);
    let mut result = vec![];

    for line in string.lines() {
        if line.ends_with("= 0") && (line.contains("unlink") || line.contains("rmdir")) {
            let mut tmp = line.to_string();
            let mut keep = false;
            tmp.retain(|c| {
                if c == '(' {
                    keep = true;
                    false
                } else if c == ')' {
                    keep = false;
                    false
                } else {
                    keep
                }
            });
            for maybe_path in tmp.split(",").filter(|x| x.contains(MAIN_SEPARATOR_STR)) {
                let tmp = maybe_path
                    .trim()
                    .trim_start_matches("\"")
                    .trim_end_matches("\"")
                    .to_string();

                // Do a cheeky filter out of files in directory
                if line.contains("rmdir") {
                    result.retain(|x: &String| !x.starts_with(&tmp));
                }
                if !tmp.is_empty() {
                    result.push(tmp);
                }
            }
        }
    }
    result.dedup();
    result
}
```

Here I'm trying to be extra-lazy and avoid Regex to get the arguments, by
being a bit tricksy with retain. Also, assuming that `,` isn't in a path or
other argument is a bit rubbish of me. But it does hold true for ubuntu-latest
github actions runner (don't change this GitHub, it's now a characteristic of
your images people rely on /s).

All the paths I saw were absolute, and I saw the syscalls `unlink`, `unlinkat`
and `rmdir` are used for deleting things. Try and avoid files that are in paths
and bish bash bosh.

This list was still really big, so further compression was needed:

```rust
fn compress_deletions(inputs: Vec<String>) -> Vec<String> {
    let mut set = BTreeSet::new();
    set.insert("/var/cache".to_string());

    for file in inputs.iter() {

        let path = Path::new(&file);
        if set.iter().any(|x| path.starts_with(x)) {
            continue;
        }

        let mut parent = match path.parent() {
            Some(s) => s,
            None => continue,
        };
        if parent.exists() {
            let parent_is_empty = fs::read_dir(parent).map(|mut x| x.next().is_none()).unwrap_or(false);
            if parent_is_empty {
                println!("Removing parent: {}", parent.display());
                set.insert(parent.display().to_string());
            } else {
                println!("Removing file: {}", file);
                set.insert(file.clone());
            }
        } else {
            while let Some(new_parent) = parent.parent() {
                if new_parent.exists() {
                    println!("Reduced {} to {}", path.display(), parent.display());
                    set.insert(parent.display().to_string());
                    break;
                } else {
                    println!("Going from {} to {}", parent.display(), new_parent.display());
                    parent = new_parent
                }
            }
        }
    }
    set.into_iter().collect()
}
```

I just go up the parents until I find a parent folder that exists and then
delete the child as it's clear apt-get remove deleted the folder! A bit of
special `/var/cache` handling and we're good to go. Just save it as a RON
and piss off.

I won't bother showing the end tools code, but it's really short like <150
lines. You can read it [here](https://github.com/xd009642/ci-hoover/blob/main/src/main.rs)
if you're interested. And it takes about 15-20s to run.

## Publishing It.

Now seems like a good time to figure out a way to put this on the Github
marketplace. First off doing an actual release of the binary including
a github release will be needed. This is because we don't want to build
the code via `cargo install` in CI because that'll just be a bit too slow.
Instead I plan on using `cargo-binstall` which will download a binary from
a Github release page.

Going into settings/actions and changing workflow permissions to allow writing,
then adding a crates.io API token to the environment secrets means I can
use this simplified release CI from tarpaulin:

```yml
{% raw %}
name: Release
on:
  push:
    tags:
      - '[0-9]+.*'
jobs:
  create-release:
    name: "Create GitHub release"
    # only publish from the origin repository
    if: github.repository_owner == 'xd009642'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: taiki-e/create-gh-release-action@v1
        with:
          changelog: CHANGELOG.md
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  crates:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: publish package to crates
        run: |
          cargo package
          cargo publish --token ${{ secrets.CARGO_TOKEN }}

  binaries:
    name: "Upload release binaries"
    needs:
      - create-release
    strategy:
      fail-fast: false
      matrix:
        include:
          - target: x86_64-unknown-linux-gnu
            os: ubuntu-latest
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v3
      - uses: dtolnay/rust-toolchain@stable
      - uses: taiki-e/upload-rust-binary-action@v1
        with:
          bin: ci-hoover
          target: ${{ matrix.target }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
{% endraw %}
```

Next up, Github actions marketplace things have an `action.yml`, so I'll just
initially pinch the one from free-disk-space and change the running part to
install ci-hoover with cargo-binstall and run it. I'll skip most of the args
for some brevity:

```yml
{% raw %}
name: "ci-hoover"
description: "A configurable GitHub Action to free up disk space on an Ubuntu GitHub Actions runner. Inspired by free-disk-space."

# See: https://docs.github.com/en/actions/creating-actions/metadata-syntax-for-github-actions#branding
branding:
  icon: "trash-2"
  color: "orange"

inputs:
  android:
    description: "Remove Android runtime"
    required: false
    default: "true"

# More args

runs:
  using: "composite"
  steps:
    - uses: cargo-bins/cargo-binstall@main
      run: |
        set -eu
        export ANDROID = ${{ inputs.android }}
        export DOT_NET = ${{ inputs.dot_net }}
        export HASKELL = ${{ inputs.haskell }}
        export LARGE_PACKAGES = ${{ inputs.large_packages }}
        export DOCKER_IMAGES = ${{ inputs.docker_images }}
        export TOOLS_CACHE = ${{ inputs.tools_cache }}
        export SWAP_STORAGE = ${{ inputs.swap_storage }}

        cargo binstall ci-hoover

        sudo ci-hoover
{% endraw %}
```

I'm using envy to get the configuration from environment variables which seemed
a bit nicer than doing things like `--android true|false`. 

Time to publish to marketplace, but this then involves going into the release
page generated and editing it to publish to the marketplace... I should fix
that. But it doesn't look like there's a way in the action for making release
pages and looking at some of the maintained ones I don't see an option so I'll
just leave it for now. After all this may be my only release this is a bit of
a shitpost.

Bad Github UI alert, I do the draft release, edit the existing release notes.
Then realising I have to accept the terms and conditions go onto that popup and
accept. Then all my categories/tag stuff for the marketplace entry are wiped, c'mon
Github be chill.

Add a lil action just to try this action via the marketplace and it doesn't work.

```
Error: xd009642/ci-hoover/0.1.0/action.yml (Line: 51, Col: 7): Unexpected value 'run'
```

hmm maybe before the run I need a `- shell: bash`. Google seems to suggest that's
the syntax to use bash in an action. Gosh if only there was a way to test this
which doesn't involve creating a release page on github and publishing a pre-release...

Well I'll just draft a release and give it a tag that won't trigger a cargo publish
and then just force my way through it like I'm bludgeoning my face with a hammer
repeatedly. Because that's what CI is like.

```
/home/runner/work/_temp/a5d46914-9fa4-4f1f-a508-7b131608f423.sh: line 2: export: `=': not a valid identifier
```

Ah fuck spaces between equals in exports. I don't know why I did that. If this
was a normal tool I would have ran the equivalent bash script on my machine
but this deletes a ton of stuff so I didn't want to.

Okay third times the charm right? Yeah third, it didn't take six goes to do it...

This is the final run part of the action:

```yml
{% raw %}
runs:
  using: "composite"
  steps:
    - uses: cargo-bins/cargo-binstall@main
    - shell: bash
      run: |
        set -eu
        export ANDROID=${{ inputs.android }}
        export DOT_NET=${{ inputs.dot_net }}
        export HASKELL=${{ inputs.haskell }}
        export LARGE_PACKAGES=${{ inputs.large_packages }}
        export DOCKER_IMAGES=${{ inputs.docker_images }}
        export TOOLS_CACHE=${{ inputs.tools_cache }}
        export SWAP_STORAGE=${{ inputs.swap_storage }}

        cargo binstall -y ci-hoover
        sudo mv $HOME/.cargo/bin/ci-hoover /bin

        sudo ci-hoover
{% endraw %}
```

And this is the action which uses it in an image to clean it up:

```yml
name: Marketplace
on:
  push:
    branches:
      - "main"
  pull_request:
jobs:
  linux:
    runs-on: ubuntu-latest
    steps:
      - name: ci-hoover
        uses: xd009642/ci-hoover@0.1.1
```

And some output from ci-hoover:

```
Name	Total	Used	Available
"/dev/root"	77.9 GB	55.5 GB	22.3 GB
"/dev/sda15"	109.4 MB	6.3 MB	103.1 MB
"/dev/sdb1"	78.7 GB	8.3 GB	70.3 GB
Deleting things!
Name	Total	Used	Available
"/dev/root"	77.9 GB	24.2 GB	53.7 GB
"/dev/sda15"	109.4 MB	6.3 MB	103.1 MB
"/dev/sdb1"	78.7 GB	4.0 GB	74.6 GB
Finished in 63.809372 seconds
```

I should really make those ascii tables look a bit nicer... But I
have clawed back more than free-disk-space 53.7GB free instead of 41GB.

## All Done

Not quite. For some reason when doing this from the marketplace it always
takes about 1 minute. But when installing release in my CI and running it I
get times of about 16s. Why is it slower as a Github marketplace action?

Actually, no I'm tired and I'll leave that as a question for the reader.

Here's the project if you want a look [ci-hoover](https://github.com/xd009642/ci-hoover)
as well as the [marketplace page](https://github.com/marketplace/actions/ci-hoover)
