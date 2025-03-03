This is an announcement blogpost for [wiremocket](https://docs.rs/wiremocket/latest/wiremocket/index.html)
a [wiremock](https://github.com/LukeMathWalker/wiremock-rs) influenced library for mocking websocket servers.

# The Motivation

At Dayjob™ we have a number of websocket APIs, this is because they offer bidirectional
streaming where the client can send a stream of data and the server at the same time
can stream back data. We do this because we work with audio APIs and real time audio/visual
systems.

When testing these systems it's too heavy to run multiple docker images with AI models
in CI meaning for an application which interacts with multiple websocket connections
we have a few options for testing:

1. Split out functionality to allow for testing the meat of it without the client connection
2. Replace the websocket client type with some trait abstraction and in tests inject an in-memory alternative
3. Implement a bespoke websocket server just for this projects tests
4. Don't test it

Well today I've published a 5th option, use a mocking library to help generate a server
quickly and ensure requests match what are expected.

# Why Not PR Wiremock?

There's an [issue](https://github.com/LukeMathWalker/wiremock-rs/issues/113) for this in wiremock opened
by a colleague. I'm not saying this won't go into wiremock eventually in some form, but it is a
big change and the two domains dissimilar enough the overlap could confuse existing users.

# What's So Difficult?

Streaming. Streaming is always difficult. 

Given a server we may want to match on information available when the connection is established
such as:

1. HTTP headers
2. The URL path
3. The URL query parameters

But we may also have things like different input formats available and want to match on
the messages coming over the connection. 

To explain these difficulties perhaps an example will be clearer.

# A Big Example

In addition, with the responses we want the ability for the input messages to impact
the responses.

As an example of the capabilities let's look at the process for testing some code
using websockets where we have a few requirements:

1. When the client requests to `/api/binary_stream` 
2. The first message is valid json
3. The last message before closing is valid json
4. All messages between these are binary data
5. A close frame is sent

We can set this up by implementing our own temporal matcher and using some already provided
matchers. Try not to focus too much on the implemented matcher as this is where most of the
complexity will lie and the docs explain a lot about how this works.

```rust
impl Match for BinaryStreamMatcher {
    fn temporal_match(&self, match_state: &mut MatchState) -> Option<bool> {
        let json = ValidJsonMatcher;
        let len = match_state.len();
        let last = match_state.last();
        if len == 1 && json.unary_match(last).unwrap() {
            match_state.keep_message(0);
            Some(true)
        } else if last.is_binary() {
            // We won't keep any binary messages!
            if len > 1 && match_state.get_message(len - 2).is_none() {
                Some(true)
            } else {
                Some(false)
            }
        } else if last.is_close() {
            if len == 1 {
                None
            } else {
                let message = match_state.get_message(len - 2);
                if let Some(message) = message {
                    json.unary_match(message)
                } else {
                    Some(false)
                }
            }
        } else if last.is_text() {
            let res = json.unary_match(last);
            match_state.keep_message(len - 1);
            res
        } else {
            None
        }
    }
}

#[tokio::test]
async fn binary_stream_matcher_passes() {
    let server = MockServer::start().await;

    // So our pretend API here will send off a json and then after that every packet will be binary
    // and then the last one a json followed by a close
    server
        .register(
            Mock::given(path("api/binary_stream"))
                .add_matcher(BinaryStreamMatcher)
                .add_matcher(CloseFrameReceivedMatcher)
                .expect(1);
        )
        .await;

    println!("connecting to: {}", server.uri());
    
    let (mut stream, response) = connect_async(format!("{}/api/binary_stream", server.uri()))
        .await
        .unwrap();

    let data: Vec<u8> = vec![0, 1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7];

    let val = json!({"command": "start"});
    stream.send(Message::text(val.to_string())).await.unwrap();
    stream.send(Message::Binary(data.into())).await.unwrap();
    let val = json!({"command": "stop"});
    stream.send(Message::text(val.to_string())).await.unwrap();
    stream.send(Message::Close(None)).await.unwrap();

    std::mem::drop(stream);

    // Asserts the match conditions were met.
    server.verify().await;
}
```

Ignoring the details of the matcher implementation, the code with-in the test should 
look familiar to any wiremock users. We add matchers to a mock, an expected number of calls
and send off requests and assert on them. 

But we can also see the extra complexity that matching on streams and looking at
sequence based behaviour causes.

# What's Next?

I've been so deep in the sauce I haven't yet used this in anger. So that will be
my next step. However, the code I'll be using it on is all closed source meaning whether
it works well or not is going to be a "trust me bro" until people use it.

There's also a few things I haven't implemented that are in wiremock. Things like:

* Storing all the requests received by the server during a test
* Connection pooling
* Fancier reports
* Some ergonomic improvements (my mock construction should really use a builder)
* More matchers
* More out-of-the-box responders
* Stare intensely at grpc and wonder if I want to make a mockery of myself

