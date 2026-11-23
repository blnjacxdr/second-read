# Second Read design system

Approved on the design canvas, Nov 22: https://claude.ai/artifact/RUTa8SpPQE3ChTodc6pecf
Values live in `src/styles/tokens.css`. Use the variables, never raw hex codes.

## The idea
A student's notebook page, read twice. Faint blue ruled lines, a red margin line, one ballpoint-blue ink.
**Pen vs pencil** carries the product's honesty: code checks are drawn in pen (solid, sure),
Gemini Nano's flags in pencil (dashed, graphite highlight, "double-check these").

## Logo (assets/logo-mark.svg)
The flat end of a pencil looks like an eye: yellow hexagon, wood ring (iris), graphite dot (pupil).
| Mark | Job |
|---|---|
| A. Two pencil-end eyes + "second read" | Header, app icon, browser tab (16 px = one eye) |
| B. Wordmark with the hexagon as the o in "second" | Footer, receipt, inside text; only at 18 px or larger |
| C. Poster: yellow field, white eyes, hexagon pupils | Devpost cover, video title card, social |
| E. Sticker: A as a tilted die-cut sticker | Landing page, celebrations |

## Type
One family, **Gabarito** (Google Fonts), 400 to 900. Display 900 with tight tracking, body 400 at 18 px.
Handwritten Nanum Pen Script only for short margin notes. Monospace only on the privacy receipt.
Geist, Inter, Space Grotesk and Bricolage were removed: they read as AI defaults.

## Rules (from the frontend-design and accessibility skills)
- No single italic or colored accent word in headlines. No numbered markers unless it is a real sequence.
- No "A · B" middle-dot strings, no arrows tacked onto buttons, no all-caps eyebrow labels, no code font for labels.
- Every text color passes 4.5:1; borders that identify a control pass 3:1.
- Every clickable thing is a real button, link or labeled input, at least 44 px tall, with a visible focus ring.
- The file picker is the whole paper sheet (a label for a visually hidden file input), not Chrome's default button.
- Animations respect prefers-reduced-motion. Results never move on their own.

## Voice
Plain, a bit wry, never writes for the student. "6 spots where your application argues with itself."
"Fixed it" / "That's on purpose". "thanks for not uploading".

## Motion (stage 2, reworked Nov 23 on the canvas)
- **Tokens:** `--spring` and `--spring-bouncy` are damped springs sampled into CSS `linear()` (they overshoot and settle; plain cubic-bezier can't). `--ease-out` is cubic-bezier(.23,1,.32,1). Animate only transform/translate/rotate/scale and opacity. Generators live in the canvas notes; regenerate rather than hand-edit the stops.
- **Eyes:** the flat pencil ends from the logo (a 3D-pencil version was tried Nov 22 and dropped: it looked clunky). Intro: each eye pops in on a spring with its lids shut, the lids open, a look left, a look right, then they find the cursor (~3 s). The lid is a yellow shape clipped to the wood circle that slides down from the top to blink. Pupils follow the cursor on a spring loop (stiffness 220, damping 21), each eye from its own spot. Dragging a file over the sheet makes them look down at it with wider pupils. Asleep (20 s idle): lids half shut, three z's float up one after another.
- **Signature, the fold (below the drop zone, so a student in a rush never has to see it):** the application is one long sheet: Activities (p. 3), two in-between pages, Personal essay (p. 14). As you scroll, the in-between pages fold up like an accordion until "6 hr/wk, 30 wk/yr" sits right on top of "Every day after school, I stayed in the robotics lab until seven". A big counter runs from 11 pages apart to 0, a pen brace joins the two lines, and a handwritten "6 hours a week, or every day?" appears. Accordion math: the middle panels turn -t and +2t, the last turns -t back so it stays flat; the gap closes as 2 x 150 x cos(t), and the sheet shifts by 150(1 - cos t) to stay centered (keyframes are sampled from that formula). The counter is a registered integer custom property shown with counter(). Pure CSS view timeline; the plain CSS is the folded end state, so with no support, reduced motion or a narrow screen you see the two lines together. Replaced the Nov 22 pinned-captions story, which looked like every Apple page.
- **The fold moves in steps:** inside the fold, one wheel tick or arrow/space/page key plays one whole step right away (steps: both lines highlighted, folded with the brace, done; scrolling up goes back). Extra input while a step plays, and for 280 ms after, is swallowed so a trackpad's coasting can't skip a step. Outside the fold, scrolling is untouched. The glide is ease-in-out, 480 ms plus a bit per pixel, max 1.3 s. A `scrollend` backup finishes the step after scrollbar drags. Off with reduced motion and on narrow screens.
- **"See how it works"** sits above the fold with a pen-drawn arrow that bobs gently; clicking it glides straight to the first step.
- **Top links glide** to their section with the same curve instead of jumping.
- **Text motion:** the headline rises in word by word out of a soft blur (once, on load); the eye card drifts up as the page scrolls; the three promises rise in as they come into view (scroll timelines).
- **Signature feature, the reading pencil:** while Second Read checks the application, a pencil tip writes along each line as it highlights it, then hops to the next line (0.3 s per line, in step with the list of what it found).
- **Results:** the highlighter sweeps under each quote once; "Fixed it" strikes the card in pen; clearing everything thunks the red "clean copy" stamp and the header eyes close happily. Results never move on their own otherwise.
- **Reduced motion:** no intro, no scroll story motion, no reading pencil; the eyes are open and stay still (they still look at a dragged file); highlights show at once.
- **Receipt:** feeds out smoothly (slides down while its edge is revealed), no stepped printing.

## Error states (board "4 · When something goes sideways")
No Gemini Nano (sleepy eyes), still downloading (eyes look up), picture PDF (squint, with the 3 steps to get Common App's own PDF), not a Common App PDF (confused), partly read (one eyebrow up, what was skipped), nothing found (happy eyes, "not a promise it's perfect").
Errors give direction, never apologize, and never fall back to the cloud.

## Easter eggs (stage 3)
On the canvas:
- Click the logo three times fast: the eyes do a double take and the name reads "wait, what?".
- Leave the mouse alone for 20 s on the start page: the eyes doze off ("z z z"); any movement wakes them.
- Hover the footer credit: "this was his procrastination".
- Hover "sent to the internet: 0" on the receipt: "seriously, zero".
- Mark every spot "That's on purpose": "all six on purpose? bold strategy. respect."
Real app only (build these):
- **DevTools console greeting**, for judges who check our privacy claim: a short styled console.log saying the Network tab should stay empty while your application is read, signed by the builder.
- **Konami code** (up up down down left right left right b a) on the start page: the pencils sharpen and a few shavings fall. One keydown listener, removed on leaving the page, off with reduced motion.
