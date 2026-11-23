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

## Motion (stage 2, designed Nov 22 on the canvas)
- **Signature:** on the start page two pencils drop in tilted, straighten, and turn until their flat ends face you and become the eyes (~1.4 s), then blink. Later blinks every ~5.5 s.
- **Start page only:** pupils follow the cursor (max 9 units, throttled with requestAnimationFrame). Dragging a file over the sheet, or keyboard focus on it, makes both eyes look at the sheet with wide pupils.
- **Results:** the highlighter sweeps under each quote once; "Fixed it" strikes the card in pen; clearing everything thunks the red "clean copy" stamp and the header eyes close happily. Results never move on their own otherwise.
- **Reduced motion:** every animation off, eyes still, cursor following off.

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
