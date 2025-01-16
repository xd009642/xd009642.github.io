This post is going to go through my process of PRing something to the fake
crate. I'd done it before in a different part of the crate so assumed this
would be easy but it took me a bit more time than expected so figured 
that's a good reason to write.

For anyone who hasn't seen it before [fake](https://crates.io/crates/fake)
is a crate for generating fake values for the purposes of testing. It's
mentioned in [zero2prod](https://github.com/cksac/fake-rs) for generating
fake sign-ups to the service and this is where I first heard of it. But,
when generating fake API values for testing you sometimes get many more
types that need faking than are currently implemented. 

When this happens there are three choices:

1. Implement it in your crate
2. PR to the fake crate
3. Give up

Option 1 means if we need to fake this type in a different project we
have to copy our implementation around which is a bit of a drag.
And option 3 is never an option here (or at least for things that should be
this easy). This just leaves us with option 2.

So what are we faking? This time it is base64 strings. I'm dealing with an API
which makes the decision to encode some binary data as base64 in a JSON.

# Where to put our code

Typically, we also don't want
to implement things in fake if there's crates that do them (or types in crates
we want to fake). I'm going to use the [base64](https://crates.io/crates/base64).

Starting off, going into the `fake` folder in the root of the repo to add to
the crate:

```
cd fake
cargo add base64 --optional
```

Now lets look at the folder structure in src to see where we might put our code:

```
├── src
│   ├── bin
│   ├── faker
│   ├── impls
│   │   ├── base64
│   │   ├── bigdecimal
│   │   ├── bson_oid
│   │   ├── chrono
│   │   ├── chrono_tz
│   │   ├── color
│   │   ├── decimal
│   │   ├── geo
│   │   ├── glam
│   │   ├── http
│   │   ├── indexmap
│   │   ├── semver
│   │   ├── serde_json
│   │   ├── std
│   │   ├── time
│   │   ├── ulid
│   │   ├── url
│   │   ├── uuid
│   │   └── zerocopy_byteorder
│   └─── locales
```

Looking at where to add our code it can be hard to figure out between the
`faker` and `impl` modules. But in `impls` we see there's folders for a bunch
of 3rd party crates. Making that the perfect place to start.

Adding a `base64` module into `impls` I can start to implement the fake stuff.

# Implementing it

The core of the fake implementations is the 
[Dummy](https://docs.rs/fake/latest/fake/trait.Dummy.html) trait. For those who
don't want to leave this post I'll share the trait definition (minus a method
with a default impl).

```rust
pub trait Dummy<T>: Sized {
    // Required method
    fn dummy_with_rng<R: Rng + ?Sized>(config: &T, rng: &mut R) -> Self;
}
```

The config type `T` is often used in a type-state manner. Looking at the `uuid`
fake impl we can see types for `UUIDv8` etc which are provided like
`impl Dummy<UUIDv8> for Uuid`.

There's not that many variants in base64, looking at the engine the main things
we can vary are:

1. The data being encoded as base64
2. Whether we pad the data or not.

To vary these we'll use the `Faker` type to generate random data and a random
boolean and then encode the base64 using these. My initial errors all boiled 
down to not using the cheaply constructed `Faker` type. But once I realised
that it felt pretty simple.

In the new `fake/src/impls/base64/mod.rs` the initial implementation looks
something like:

```rust
use crate::{Dummy, Fake, Faker};
use base64::prelude::*;

pub struct Base64;

impl Dummy<Base64> for String {
    fn dummy_with_rng<R: rand::Rng + ?Sized>(_: &Base64, rng: &mut R) -> Self {
        let data: Vec<u8> = Faker.fake_with_rng(rng);
        let padding = Faker.fake_with_rng(rng);
        let encoded = if padding {
            BASE64_STANDARD.encode(&data)
        } else {
            BASE64_STANDARD_NO_PAD.encode(&data)
        };
        encoded
    }
}
```

Here we can use this as follows:

```rust
let fake_base64: String = String::dummy_with_rng(&Base64, rng);
```

Which isn't super ergonomic but it serves a purpose. We ideally want to implement 
for `Dummy<Faker>` because then we can use the cheaply constructed `Faker` type to
generate base64 values.

If we do this our code can look like:

```rust
let fake_base64: String = Base64.fake();
```

Right, so we need to implement `Dummy<Faker>` for something, and we can't
implement it for a `String` directly because `fake` can already generate
fake strings. This means we need some intermediate wrapper type and then
all our generics should just flow together.

With this in mind I added this to the file after some fiddling:

```rust
pub struct Base64Value(pub String);

impl Dummy<Faker> for Base64Value {
    fn dummy_with_rng<R: rand::Rng + ?Sized>(config: &Faker, rng: &mut R) -> Self {
        let s = String::dummy_with_rng(&Base64, rng);
        Base64Value(s)
    }
}
```

A bunch of the fiddling was whether the previous code should live in this impl
and the implementation on `String` use it or vice versa. I struggled a bit to
get that working with the trait bounds and ultimately it doesn't matter which
way round and this way is the path of least resistance.

With these two in place we can look at adding a test. The majority of the fake
tests are determinism tests ensuring that with the same seed we get the same
faked values. There's a number of macros to define these but if you look at 
the file you can just copy the pattern. Our test then looks like so:

```rust
#[cfg(feature = "base64")]
mod base64 {
    use fake::base64::*;
    use fake::{Fake, Faker};
    use rand::SeedableRng as _;

    check_determinism! { one fake_base64, Base64Value, Faker }
    check_determinism! { one fake_url_safe_base64, UrlSafeBase64Value, Faker }
}
```

Add the public re-exports and mod statements matching the patterns as well and we
have a working implementation! 

The only other thing is to look at the `base64` crate and see if there's any
other configurations we should look at supporting. I saw there were engines to
generate URL safe base64 so implemented them much the same and then called it a
day!

This is the implementation I opened [the PR](https://github.com/cksac/fake-rs/pull/216)
with which was ultimately merged:

```rust
use crate::{Dummy, Fake, Faker};
use base64::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, Ord, PartialOrd, Hash)]
pub struct UrlSafeBase64Value(pub String);

#[derive(Clone, Debug, PartialEq, Eq, Ord, PartialOrd, Hash)]
pub struct Base64Value(pub String);

pub struct Base64;

pub struct UrlSafeBase64;

impl Dummy<Base64> for String {
    fn dummy_with_rng<R: rand::Rng + ?Sized>(_: &Base64, rng: &mut R) -> Self {
        let data: Vec<u8> = Faker.fake_with_rng(rng);
        let padding = Faker.fake_with_rng(rng);
        let encoded = if padding {
            BASE64_STANDARD.encode(&data)
        } else {
            BASE64_STANDARD_NO_PAD.encode(&data)
        };
        encoded
    }
}

impl Dummy<UrlSafeBase64> for String {
    fn dummy_with_rng<R: rand::Rng + ?Sized>(_: &UrlSafeBase64, rng: &mut R) -> Self {
        let data: Vec<u8> = Faker.fake_with_rng(rng);
        let padding = Faker.fake_with_rng(rng);
        let encoded = if padding {
            BASE64_URL_SAFE.encode(&data)
        } else {
            BASE64_URL_SAFE_NO_PAD.encode(&data)
        };
        encoded
    }
}

impl Dummy<Faker> for Base64Value {
    fn dummy_with_rng<R: rand::Rng + ?Sized>(config: &Faker, rng: &mut R) -> Self {
        let s = String::dummy_with_rng(&Base64, rng);
        Base64Value(s)
    }
}

impl Dummy<Faker> for UrlSafeBase64Value {
    fn dummy_with_rng<R: rand::Rng + ?Sized>(config: &Faker, rng: &mut R) -> Self {
        let s = String::dummy_with_rng(&UrlSafeBase64, rng);
        UrlSafeBase64Value(s)
    }
}
```

And here is a small test program showing it being used including with the
`derive` feature:

```rust
use fake::{Dummy, Fake, Faker};
use fake::base64::Base64;

#[derive(Debug, Dummy)]
pub struct FakeMe {
    #[dummy(faker =  "Base64")]
    base64: String,
}


fn main() {
    let f: FakeMe = Faker.fake();
    println!("{:?}", f);

    let fake_string: String = Base64.fake();
    println!("{}", fake_string);

    let fake_string: String = String::dummy(&Base64);
    println!("{}", fake_string);
}
```
