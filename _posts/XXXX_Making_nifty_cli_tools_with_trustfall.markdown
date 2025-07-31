For those who aren't aware, [Trustfall](https://github.com/obi1kenobi/trustfall)
is a pretty cool tool. From the repo about section it says:

> A query engine for any combination of data sources. Query your files and APIs
> as if they were databases!

And this is pretty powerful as a tool, and I've read blogposts - mostly
by Predrag (blog [here](https://predr.ag/blog/)), I've seen a talk or two. And
after this I've been looking for a place to play with Trustfall.

Well, I've finally done it and here's my writeup of the general experience and
how to use Trustfall yourself. But before I get into that it would be remiss
to not mention there's already a nifty CLI tool using Trustfall and that's
[cargo-semver-checks](https://github.com/obi1kenobi/cargo-semver-checks). If you
haven't seen it before check it out it's very useful.

# The Tool

Docker. It bloats up my storage, I have tons of images as part of work with
dev builds and for some projects they're around 7GB an image. It's not great.
And I've been suffering, bash functions to grep all the images and remove
ones with a certain substring in the name, attempts to delete anything over a
size. It ends up fiddly and a bit annoying.

But each image has a bunch of data associated with it, it seems reasonable to
query it and print information or delete images that match a query. Looks like
I've got a reason to use trustfall.

_Side note I do also use podman on some machines, this will be relevant later._

Okay, the start of a plan. I'll make a tool that can query the docker images on
my system and retrieve the images that match some predicates and delete them!

# Getting Started with Trustfall

Trustfall uses a GraphQL-esque language to your schema and query. First off we
need to create a schema to describe the shape of our data - similar to the
relational model. To help create this schema it can be helpful to think of
the queries that we want to represent.

Using the following CLI command I get can get a list of all the docker images
on my machine in an easy to parse format:

```
$ docker image ls --format=json
{"Containers":"N/A","CreatedAt":"2024-06-07 13:00:09 +0100 BST","CreatedSince":"13 months ago","Digest":"\u003cnone\u003e","ID":"35a88802559d","Repository":"ubuntu","SharedSize":"N/A","Size":"78.1MB","Tag":"latest","UniqueSize":"N/A","VirtualSize":"78.05MB"}
```

Looking at this data, and thinking about what I want to do I can end
up with some queries:

1. Finding docker images withing a size range (min, max optional)
2. Docker images older or younger than some date
3. Ones with an exact name match (not using tag)
4. Ones with a name that matches a regex
5. Ones with a name containing a substring

This is just driven off what data I can get via `docker image ls --format=json`.
There is a possibility to get more data, but that would need another call to
`docker inspect <IMAGE>`.

From this I've made this schema in the end:

```graphql
schema {
  query: Query
}

type Query {
  Image: [Image!]!
}

type Image {
  repo: String,
  tag: String,
  size: Int!,
  created: String!

  # Filtering via edges (with parameters)
  size_in_range(min: Int!, max: Int!): [Image!]!
  created_after(timestamp: String!): [Image!]!
  created_before(timestamp: String!): [Image!]!
  has_name(name: String!): [Image!]!
  name_matches(regex: String!): [Image!]!
  name_contains(substring: String!): [Image!]!
}
```

Why is there `size_in_range` but `created_after` and `created_before`? Mainly just
laziness and what looks natural in a written query. Internally they can map to the
same code and could add a `created_in_range`.

# From Schema to Code

Firstly, we want to install `trustfall_stubgen`. This will take our schema and
generate some starting code with `todo!` stubs dotted around and some boilerplate
we'd rather not write ourselves.

To install it:

```sh
cargo install trustfall_stubgen
```

Then I'll make a temp directory and generate the code into it so I can have
a look at it:

```
mkdir tmp
trustfall_stubgen --schema schema.graphql --target tmp/
```

In this there's an `adapter` folder with our generated code, plus our schema is
included in the folder as it neededs to be outputted as a string by one method.
I tend to generate it into a separate folder instead of directly into my source
folder just to avoid potentially overwriting something and not noticing. Which
is definitely a bit paranoid given I'm using version control but nevertheless.

In our brand new adapter module we have:

* adapter\_impl.rs
* edges.rs
* entrypoints.rs
* mod.rs
* properties.rs
* schema.graphql
* tests.rs
* vertex.rs

We don't have to touch all of these, edges.rs, entrypoints.rs, properties.rs and
vertex.rs are the only files I've had to edit. So one by one, let's go through
and fill in this code! I'm going to present these in an order which builds things
up gradually and (in my opinion) is the clearest order to implement.

## Writing Your vertex.rs

In the Trustfall model a vertex is like a table in SQL, this will contain our parsed
docker image data, we don't really any any other relations in application. It's also
an enum and this is provided in the file for us to fill in as so:

```rust
#[non_exhaustive]
#[derive(Debug, Clone, trustfall::provider::TrustfallEnumVertex)]
pub enum Vertex {
}
```

Now I typically don't like putting my data definitions in here and instead define
them outside of the adapter and import them in. So in my `src/image.rs` I add
a type definition for the `Image` and any methods, conversions or other utilities
that I need for it. That way my vertex.rs is just vertex related stuff. My image
definition is as follows, taking all the useful data from the inspected image in
useful form: 

```rust
#[derive(Debug, Clone, Eq, Hash, PartialEq, Ord, PartialOrd)]
pub struct Image {
    pub hash: String,
    pub repository: String,
    pub tag: String,
    pub size: usize,
    pub created_at: Timestamp,
}
```

And then my vertex.rs I update to be:

```rust
use std::sync::Arc;

#[non_exhaustive]
#[derive(Debug, Clone, trustfall::provider::TrustfallEnumVertex)]
pub enum Vertex {
    Image(Arc<crate::Image>),
}
```

The eagle-eyed amongst you may realise this `Image` type doesn't match the
schema:

```graphql
type Image {
  repo: String,
  tag: String,
  size: Int!,
  created: String!
}
```

It mostly does, it's just created is a different type. This is because trustfall
doesn't (yet) have a timestamp type and I'm also using `jiff::Timestamp`. Later
on when going between the Trustfall queries and my types there'll have to be
some conversion between the two. There is a clear difference between Rust
types that are nice to work with, and queries that are nice to work with. At times
these can clash and then you get these small differences.

## Writing Your entrypoints.rs

An entrypoint is where you populate your data to query, it outputs a `VertexIterator`.
Here we want to take our data source and output our vertices. This could be
calling an API, loading a file and deserializing it, calling a CLI and parsing it's
output. 

Here is where podman becomes relevant, because the `docker image ls --format=json`
output is different between the two. Docker outputs a newline delimited json objects,
whereas podman outputs a json list. Additionally, the fields in each object vary (fun).

With this in mind I made an `ImageOutput` type and a conversion to my `Image` type
used in my `Vertex` as follows:

```rust
#[derive(Deserialize)]
#[serde(untagged)]
pub enum ImageOutput {
    Podman(podman::Image),
    Docker(docker::Image),
}

impl From<ImageOutput> for Image {
    fn from(x: ImageOutput) -> Self {
        match x {
            ImageOutput::Podman(p) => p.into(),
            ImageOutput::Docker(d) => d.into(),
        }
    }
}

impl From<podman::Image> for Image {
    fn from(img: podman::Image) -> Self {
        // SNIP
    }
}

impl From<docker::Image> for Image {
    fn from(img: docker::Image) -> Self {
        // SNIP
    }
}
```

With that boilerplate out of the way here is my entrypoint:

```rust
pub(super) fn image<'a>(_resolve_info: &ResolveInfo) -> VertexIterator<'a, Vertex> {
    let version = Command::new("docker")
        .args(["--version"])
        .output()
        .expect("couldn't get docker version");
    let version = String::from_utf8_lossy(&version.stdout);
    let is_podman = version.contains("podman");

    let images = Command::new("docker")
        .args(["image", "ls", "--format", "json"])
        .output()
        .expect("failed to run docker");

    let images: Vec<ImageOutput> = if is_podman {
        serde_json::from_slice(&images.stdout).expect("couldn't deserialize the json output")
    } else {
        let s = String::from_utf8_lossy(&images.stdout);
        let mut v = vec![];
        for line in s.lines() {
            v.push(serde_json::from_str(line).expect("couldn't deserialize the json output"));
        }
        v
    };

    Box::new(
        images
            .into_iter()
            .map(|x| Vertex::Image(Arc::new(x.into()))),
    )
}
```

This is all relatively simple code, some code to detect if it's docker or a
podman alias, deserialization and then return a type that meets the requirements
of `VertexIterator` which is a `Box<dyn Iterator<Item = VertexT> + 'vertex>`.

As a side, you can also just remove this file. And instead in `adapter_impl.rs`
have the type which the `trustfall::provider::Adapter` is implemented for
generate your `Vertex`. This might be easier than getting data into the `ResolveInfo`
type to resolve to different sources - I'm not sure. For this project I have one
source and that's the docker images on my machine, there's no fancy configuration.

## Writing Your properties.rs

Now we have a `Vertex`, and we have the means to get a sequence of vertices into
the query engine. The only things missing to execute queries is extracting data
from the vertex and running our defined queries. First, let's get the data out.
That way we can run simple queries with no filtering like print every docker
image.

The starting point that `trustfall_stubgen` gives us is as follows:

```rust
use trustfall::{FieldValue, provider::{AsVertex, ContextIterator, ContextOutcomeIterator, ResolveInfo}};

use super::vertex::Vertex;

pub(super) fn resolve_image_property<'a, V: AsVertex<Vertex> + 'a>(
    contexts: ContextIterator<'a, V>,
    property_name: &str,
    _resolve_info: &ResolveInfo,
) -> ContextOutcomeIterator<'a, V, FieldValue> {
    match property_name {
        "created" => {
            todo!("implement property 'created' in fn `resolve_image_property()`")
        }
        "repo" => todo!("implement property 'repo' in fn `resolve_image_property()`"),
        "size" => todo!("implement property 'size' in fn `resolve_image_property()`"),
        "tag" => todo!("implement property 'tag' in fn `resolve_image_property()`"),
        _ => {
            unreachable!(
                "attempted to read unexpected property '{property_name}' on type 'Image'"
            )
        }
    }
}
```

Here we have a `ContextIterator` and we want to transform that into a
`ContextOutcomeIterator`. These type aliases with some simplification
look as follows:

```rust
pub type ContextIterator<VertexT> = Box<dyn Iterator<Item = DataContext<VertexT>>>;
pub type ContextOutcomeIterator<VertexT, OutcomeT> = Box<dyn Iterator<Item = (DataContext<VertexT>, OutcomeT)>>;
```

The contexts are what we want to resolve, so for eaech property name I'll create a
mapping from that context and property to the same context paired with the value of
that property. I believe this all came together from looking at some example
trustfall adapter implementations from Predrag's blog and talks but it was a while
ago so I can't trace back to exactly how I learned this.

Just implementing this for the `created` property looks as follows:

```
pub(super) fn resolve_image_property<'a, V: AsVertex<Vertex> + 'a>(
    contexts: ContextIterator<'a, V>,
    property_name: &str,
    _resolve_info: &ResolveInfo,
) -> ContextOutcomeIterator<'a, V, FieldValue> {
    let func = match property_name {
        "created" => |v: DataContext<V>| match v.active_vertex() {
            Some(Vertex::Image(img)) => (
                v.clone(),
                FieldValue::String(Arc::from(img.created_at.to_string().as_str())),
            ),
            None => (v, FieldValue::Null),
        },
        "repo" => todo!("implement property 'repo' in fn `resolve_image_property()`"),
        "size" => todo!("implement property 'size' in fn `resolve_image_property()`"),
        "tag" => todo!("implement property 'tag' in fn `resolve_image_property()`"),
        _ => {
            unreachable!(
                "attempted to read unexpected property '{property_name}' on type 'Image'"
            )
        }
    };
    Box::new(contexts.map(func))
}
```

Here I have to convert my `jiff::Timestamp` to a string and then wrap it in a `FieldValue`,
for types with no conversion this is a bit simpler. But generally speaking this is reasonably
straightforward. Get the active vertex (of which we only have one potential type), extract the
property and return it.

## Writing Your Edges.rs

Last is edges, here we have the most generated code and we implement the queries in our 
schemas. If you scroll right down to the bottom you'll see a function for each query like:

```rust
pub(super) fn created_after<'a, V: AsVertex<Vertex> + 'a>(
    contexts: ContextIterator<'a, V>,
    timestamp: &str,
    _resolve_info: &ResolveEdgeInfo,
) -> ContextOutcomeIterator<'a, V, VertexIterator<'a, Vertex>> {
    resolve_neighbors_with(
        contexts,
        move |vertex| {
            let vertex = vertex
                .as_image()
                .expect("conversion failed, vertex was not a Image");
            todo!("get neighbors along edge 'created_after' for type 'Image'")
        },
    )
}
```

