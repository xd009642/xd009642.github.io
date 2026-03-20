In the next release [cargo-tarpaulin](https://github.com/xd009642/tarpaulin) will
be changing (and simplifying) how it handles paths when running on your project.
This will remove some minor magic and should also improve some edge-cases in
reporting on mono-repo type projects.

# How Things Used to Work

When I started Tarpaulin it didn't exactly mirror the `cargo test` CLI, there was
also one difference a `--root` argument to specify the root of a project. This then
changed the current working directory (CWD) when running the tests to that location.
The motivation behind this was simple, I often run tarpaulin from inside it's project
directory when testing changes and a lot of tests in other projects rely on the test
command being ran from a specific folder.

Add in `--manifest-dir` and deriving the root directory of the project from that when
it's specified and using that to determine what files to report on and setting the CWD
and you end up with some unexpected behaviour when comparing tarpaulin's execution to
`cargo test`.

Adding in some magic now and then to make things easier for users is fine, the only issue
is when there's overlapping functionality and suddenly the magic becomes less intuitive
and you get some spooky magic at a distance.

# How Things Work Now

By default the current directory your tests are ran under is the current directory
you run tarpaulin from. We've also added a `--current-dir` flag to override it if you
rely on the current directory for your tests being different to the directory tarpaulin
runs under.
