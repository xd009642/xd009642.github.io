+++
title = "LLMs are Pattern Amplifiers"
date = "2026-11-XX"
path = "2026/11/XX/LLMs-Are-Pattern-Amplifiers"
aliases = ["/2026/11/10/LLMs-Are-Pattern-Amplifiers.html"]
+++
It shouldn't be a surprise to anyone that the world of software has changed a lot recently.
We're experiencing an unprecedented increase in the speed people are outputting software with
impacts seen all over. This has been an exponential jump in the ability to automate the production
of software and outputting of code to the point where a lot of people say they don't write a
single line of code themselves anymore. We've also seen agents perform a number of impressive feats
and find issues that have lain dormant in software for decades without humans ever finding them.

With all this progress, why are so many of us not seeing the quality of software improve?
You would think given the ease of generating tests, finding faults and then patching them that
we wouldn't keep seeing the same old mistakes. I have a belief that this is because of how LLMs
function as pattern amplifiers, both within your code and the context you give it and the culture
of your workplace.

## Pattern Amplifiers?

If you bring an agent into your codebase and ask it to do a task it will read files and hold an
amount of that data in its context. If it has to add a test your existing tests are in the
context and it will often carry on with that same pattern of testing. Of course things like
prompting, a global agents file etc can push it in other directions, but generally it will amplify
the patterns already present. If you start a completely greenfield project and you're not establishing
those patterns yourself, it will (from what I've seen) tend towards slop. 

If things aren't possible to test with the interfaces provided and the instructions stress avoiding
breaking changes you can see all sorts of weird code golf to try and bend or break the interfaces
in order to let it test what it wants to test. This is where culture plays a part. 
How much you care about the quality of the craftsmanship impacts a lot. If you're in an organisation
which prioritises faster turnarounds and has historically sacrificed QA effort in favour of features
you'll find your LLM output mirrors those sensibilities. And as the speed and volume of the output
increases your engineers will find themselves overwhelmed and unable to maintain whatever level of quality
they had fought for previously.

## An Example

This example is anecdotal. I won't be mentioning the company just for my own peace and quiet but
if you ask me privately I'll probably tell you if I know you.

I've been observing some work on a new product for a customer that is completely vibecoded. The
organisation has committed to 100% LLM generated code as fast as possible in the name of securing
revenue. As expected it's a flashy demo in a short amount of time but there's definite quality issues.

One glaring issue, in order to make the customer feel more comfortable in the platform it's moving
from the standard [LLM slopstrap style](https://slopstrap.mikelacher.com/) to a light theme site.
When I open the website, I see the new light theme is deployed. I click around a few pages seeing
how it's been updated and then I click on the second page in the vertical menu. 

Instantly, I'm catapulted into the old dark-theme slopstrap-esque site. The vertical menu bar has
also changed size and has different items. The fonts and colours are completely different. If I click
home I'm back on the light theme site. Additionally, not all the old pages are in the light theme menu 
and none of the new ones are in the dark theme menu. This leads to a scenario where some pages I can
only access through the UI by first going to a page without the updated style.

This is something that very few engineers doing a demo for a startup would have deployed pre-LLM.
Maybe if they had, there would normally be some slightly obfuscated reason for it, e.g. an iframe with different
styling from a different repo not yet updated. Not something that is all in a fairly simple single site
with no external dependencies for the frontend. For changing the style we would have changed a global
stylesheet to the new colours and then gradually changed the designs on the individual pages as we
got to them.

Instead here, a design was provided for a handful of pages they intended to show in the demo. This
was given to an agent which then changed the hardcoded style present in every page for those pages.
From my perspective this felt irredeemably sloppy. I have a menu and half the links on it lead to 
a website where every element is completely different and the styling is completely opposite.

Another issue is that the product is bad. No one really understands it or knows what it should do. Product
managers can't explain it. And when the customer feeds back a product manager might feed that into an
LLM to create a 30+ page planning document to "help" steer the devs to delivering what the customer wants.

But this is done at the cost to understanding the product. If you sit someone down and ask them to explain
part of it and what the customer wants. Often they'll fall short of demonstrating anything beyond a surface
level feeling. As the scope of the product increases this lack of understanding becomes "load bearing" and
the quality gets worse. In favour of fast turnarounds ownership of the product and responsibility for the
outcomes have been outsourced and there's nothing in it's place.

## Conclusion

The last point is probably the most damning. Without clear understanding of what problems a product solves
you can't vibecode your way into something of quality. This should be a universally acknowledged truth.
Instead of the product managers understanding the product or discourse between them and the devs to fall on
a shared understanding there's nothing of value output.

But if we did have a clarity of vision and an understanding of what product we wanted to make, how the users
would use it and how it would improve their lives. Surely we can do better than this disjointed mismash of
stylings and apps glued together as an affront to consistency? I am not a frontend person at all, it's definitely
not my wheelhouse, but if I was attempting to do a project like this fully with LLMs I would:

1. Define a design system and have it live within the repo
2. Instruct the agent that all pages in the app must follow the design system
3. Have shared resources that encode that in CSS etc
4. Apply design changes to the design system when they're at a global level and also to the shared resources
5. Edit individual pages as needed, confident that the styling is consistent

These feel like fairly minor steps that shouldn't cost any real time to the project. But when you're
provided with the machine god and are pushed to deliver results as fast as possible things change.
When you're prodded for estimates on every change and a "Not sure yet let me get back to you" or an
estimate deemed too long gets instant pushback that you're somehow doing things wrong things change.
I've seen organisations that put a lot of pressure on people to deliver fast at the expense of policy
double down in a way that is turning this automation into an instrument of burnout for those who care
and the road to apathy from those who can stop caring.

Why spend time thinking about the ways the vibe-coding can fail and putting barriers in place if they
just want it faster? Why not just wait till they raise an issue and paste it into a chat box and then
deploy within a minute or two with "I've got a fix up now"?

In an organisation that values speed over quality responding so quickly to a bug with a new version
can be seen as more impressive than never creating the issue in the first place.
