While working on speech/language technology for other languages sometimes I come
across linguistic diversions which are endlessly fascinating. I also quite
enjoy reading things where people investigate and learn about a topic
unfamiliar to them and feel I should get into the habit of writing more things
so here we go. I hope you enjoy reading a bit about sign language and related
linguistics 

Disclaimer: I've never formally studied linguistics or any sign language so I
may make mistakes. Feel free to reach out to me on any communication channel if
you have some corrections or comments on what I've written!

## Initial Glances

Sometimes customers have asked about automatically generating sign language
animations for some text output of an NLP system as an accessibility feature
instead of using subtitles. I have a feeling this is more complicated than simply
mapping each word to it's literal sign and playing them back in order. But this
isn't how spoken or signed communication works
either. We have the whole range of expressiveness of body language, facial
expressions and tone. It only makes sense that sign languages would take
advantage of that to make communication simpler and more effective.

And from an initial investigation this proves true. Sign languages often use
spatial grammars, body language and expressions to communicate. We
can see that with Arabic sign languages how the hand positions differ can
be used to communicate whether one object is in front of or behind another[^1].
You don't sign the literal sentence for a person being in front of a car,
you do the person sign with a hand in front of a hand doing the car sign.

There's also one interesting definition mentioned in the source, that signed
Arabic unlike spoken Arabic isn't diglossic. And deaf speakers may not be
aware of the different forms of Arabic that the non-Deaf community use. 

_Note "not aware" seems to be because the study of Arabic Sign Languages and
accommodating the Arabic Deaf community in education and general life seems
to be a more recent effort._

## Diglossia

Wait what is diglossia? Well a language is diglossic when there's two
forms of a language a High and Low form. So in Arabic the High form is
Modern Standard Arabic, whereas Low forms are the local/regional dialects.
This is kind of like register and it's a bit confusing reading things online on
how to make the judgement on when a difference is a change in register or a
language being diglossic. 

Changing register of speech based on context is often called code-switching and
we all do it sometimes e.g. when changing between formal and informal settings. I know I
don't speak in a job interview the same way I speak with friends in terms of language
but that's a register shift not English being diglossic.

How can I mentally define diglossia then? Well here's an attempt based on things
I read here[^2]:

> Diglossia is when the gap between the two forms of the language are so wide
they are both distinct varieties of the language in their own right. Often
one form is used typically for writing and the other form is typically for speaking.

This matches well with Arabic, from our work with the language the vast
majority of text data is Modern Standard Arabic, whereas speech data you
only tend to find it with some TV and Movie data not in casual speech. _There
are Arabic dialects closer to MSA than others but that's a bit of a diversion._

One thing I saw was some resources saying British Sign Language is diglossic
and a suggestion that diglossic languages tend to have non-diglossic sign
languages and vice versa. But reading further [^3] it seems this doesn't hold
up. The research that said BSL was diglossic seems flawed/outdated.

## Village Sign Languages

In places where a large Deaf community have gathered either due to a
concentration of Deaf people either schools or institutions, or a high
prevalence of genetic deafness.

There's likely a number of Arabic Sign Languages which are village sign languages 
and most definitely undocumented. For a documented one I found out
about Mardin Sign Language[^4]. A sign language with ~40 speakers currently,
it evolved in a family with a lot of Deaf members and arose as a way for
the family to communicate.

A lot of resources I wanted to read on this were paywalled so I've not really
got much other than they exist and I'm curious on how they've evolved and
any examples where they've evolved beyond a village sign language to something
more widely spoken. Is BSL an example of this? It seems to have evolved from
the 15th Century to the present day with a clear Northern and Southern dialect.

## Concluding Thoughts

So using your whole body to sign and combining all of that together to
create meaning I have vague thoughts on detecting the timestamps of sign 
boundaries. Tokenising the human form and creating systems to aid in sign
translation. Identifying when some motion or component is a modifier on a
meaning and when it applies seems insanely difficult. I'm probably going to
try and read up on what people in computer vision and machine translation
communities are doing with sign language.

As someone just standing at the entryway peeking curiously in it feels like
encoding a sign language in a way it could be an output or input to computer
translation systems you'll encounter a complexity that makes unicode look
simple.

Also, we've seen LLMs are great at taking all written language and creating
links and transformations between them via glorified pattern matching. Part
of me wonders if similar unsupervised learning on the signed languages of the
world with a visual model could lead to interesting insights or exploration
of signed language.

One thing is clear though. All languages are interesting to study and figure
out a bit about how they work. I spent about 4 hours reading up on things
which is barely any time and I'll probably spend more time on it. I just
wanted to capture some initial learnings.

## References

1. [Abdel-Fattah, Mahmoud. (2005). Arabic Sign Language: A Perspective. Journal of deaf studies and deaf education. 10. 212-21. 10.1093/deafed/eni007. ](https://www.researchgate.net/publication/7957263_Arabic_Sign_Language_A_Perspective)
2. [Preston So (2021). Register, diglossia, and why it's important to distinguish spoken from written conversational interfaces](https://preston.so/writing/register-diglossia-and-why-its-important-to-distinguish-spoken-from-written-conversational-interfaces)
3. [Linda Day (2000). British Sign Language in its Social Context](https://www.bristol.ac.uk/Depts/DeafStudiesTeaching/bslsoc/Sessions/s3.htm)
4. [Ulrike Zeshan. Signing in a ‘deaf family’ – documentation of the Mardin Sign Language, Turkey](https://www.elararchive.org/dk0134)
