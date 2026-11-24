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
- **Small details (Nov 23):** a pen underline draws itself under "twice." once after the headline rises; a hand-drawn squiggle grows under the top link you point at; the drop sheet straightens and lifts under the cursor; the sticky note has a strip of tape, a corner that lifts, and a "ready" dot that breathes; binder holes in the left margin; each promise has a pen doodle (laptop, receipt, speech bubble) that draws itself as it scrolls into view; at the very bottom the two eyes peek up over the footer line. All off or static with reduced motion.
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

## The journey (Nov 23, real app)
Five phases, one page. A phase strip in the header ("Your PDF", "Second read", "Fix list") always says where you are.
1. **Your PDF:** the start page. "Where do I get the PDF?" opens the real Common App clicks.
2. **Hand it over:** dropping or choosing a PDF is a view transition: the drop sheet carries over into the reading card,
   and the rest of the start page steps back.
3. **The second read:** named stages tick off in pen (read the PDF, find each part, compare in code, ask Gemini Nano,
   put the list together), each with its real numbers. Gemini Nano gets a real progress bar from the comparison count.
   Two small eyes read along, left to right. "Skip Gemini Nano" stays available.
4. **Fix list:** a stack of index cards, one at a time, sure ones first, then the maybes; "Sure ones: 2 of 4". Fixed it
   or On purpose moves on to the next card after a beat. Arrow keys flip cards. Show all turns it back into a list. A
   closing card invites the re-check.
5. **Re-check:** checking a new PDF in the same tab compares it with the last check: "Since your last check: 3 fixed,
   1 still there, 0 new." "On purpose" choices carry over; "Fixed it" doesn't (the check decides). Nothing is stored
   beyond the tab.
Reduced motion: no transitions, no scanning eyes, no card animations; everything else works the same.

## Nov 24: fitting the device, and a student's pass
- Big screens: `html { zoom: var(--z) }` steps from 1.1 (1360 wide) to 1.3 (1840 wide) and 1.55 (2400 wide). Phones and tablets stay at 1. Anything sized in `vh` divides by `--z`, because zoom scales viewport units too. Scripts measure with `getBoundingClientRect`, which includes zoom.
- The pen and pencil legend is gone. Each card says what it is: "Sure. Code found both quotes, word for word." or "Maybe. Gemini Nano's reading, so give it a look."
- The stack count is "Card 2 of 4" with one tick per card (filled when decided, click to jump). Show all deals the cards out with a view transition, and "One at a time" gathers them back. Only the cards move (html.vt-stack turns off the page fade).
- Fact-check the names moved from the sidebar into the main column. It now has a status line with small reading eyes, a box that grows instead of jumping, staggered rows with drawn tick boxes, a highlighter sweep over names while Google answers, and answers marked Worth a look, Looks right or Couldn't confirm.
- Binder holes repeat down the whole page. The header is three columns, so the phase tabs don't jump between phases. The reading card is centered, and the footer sits at the bottom.
- Receipt rows that could only say 0 (Nano not here) now say why. The reCAPTCHA footer links point at Google's real policy pages.
- Every control shares one motion language: a small lift on hover, a press-in, and colors that blend. Disclosures (the PDF guide, "See exactly what was sent", background mentions) grow open with `::details-content` and `interpolate-size`.
- The footer eyes are gone: they had no job. The reading pencil now rides on top of the lines, eraser up and to the right, like a hand writing.
- The page never shows a PDF's file name (it can be anything). It says "Your University of Michigan PDF", or Riley's name for the sample.
- Name check sources sit inside the answer they back up (from Google's groundingSupports, `sourcesByAnswer`). Any left over are listed under "Other sources Google used".
- Google's search suggestions must be shown as sent, so they stay. They're in a sandboxed frame at the bottom with a line saying what they are. In dark mode, Google's own dark version shows, and we may not restyle it.

## Nov 24, evening
- Faces (src/ui/face.js): happy is a cheek that rises to leave a thin upturned arch; worried is a tilted top lid, higher on the inside. No mouth. The logo is pleased when everything is handled, smiles briefly on "Fixed it", worries on a reading error or a name worth a look. The reading card smiles when done. The start page eyes brighten when you point at anything that starts a check.
- The reading pencil loops on its 3.05 s cycle until the work is done, then every line stays marked.
- The phase tabs are buttons: Your PDF, Second read (how the last read went, with Back to your fix list) and Fix list.
- The fold has Back, Next and "Skip this part". A Back to top button (the eyes looking up) shows once the top is out of sight. The page ends with "Your turn." and the two ways to start.
- Checks for real applications: a start grade earlier than the grades listed ("since freshman year" with 10, 11, 12), counts that differ ("14 tutors" and "20 tutors"), hours flagged at a 2x gap instead of 3x, and an honor level question in the name check. Held-out totals stayed at 1 false alarm; a "for four years" rule was tried and dropped because it added one.

## Nov 24, late: premium sweep
- Reading: a magnifying glass (pencil-yellow handle) moves along the lines instead of the pencil.
- Happy eyes add an ink arch so the smile reads even on the small logo. Click a start-page eye and it winks.
- Easter eggs are now for students: after midnight the handwritten note says the time and suggests sleep, and in the three days before Nov 1, Nov 15, Jan 1 and Jan 15 it counts down (src/core/margin-note.js). The logo triple-click, the footer and receipt hover notes are gone.
- The logo always goes home. The receipt no longer follows the page.
- Gemini Nano: the sticky note says what it adds and offers "Download Gemini Nano" when Chrome can get it. Results without it show what it would have added; skipping it yourself is worded as such.
- Hybrid name check: after Google answers, Gemini Nano reads each name in the student's own sentences, on the laptop, and points at a detail that disagrees (src/core/name-context.js). Its words must be in the application or nothing is shown.
- Sweep fixes: "1 page", a red mark on the step that stopped, "Try another PDF" opens the file picker, the stack opens on the first card still to decide, page titles follow the phase, the drop sheet opens up while a file is dragged over the page, "Fixed it" strikes the title line by line, header button never wraps, and the fix list prints cleanly (Print or save as PDF on the last card).

## Nov 24: motion system (from research)
Sources: Emil Kowalski's animation standards (emilkowal.ski, his skills repo), Vercel's Web Interface Guidelines, Rauno Freiberg's "Invisible Details of Interaction Design".
- Ease-out for anything entering or answering a click, never ease-in. UI motion stays under 300 ms; presses 140 ms; phase changes are the one longer moment.
- Every press scales down a little. Hover lifts only on devices that really hover.
- Nothing pops in: banners, tips, errors and lists fade and settle in with CSS @starting-style. Changing text (headline, counts, statuses) swaps with 2px of blur.
- Keyboard actions are instant: arrows move between cards, F marks fixed, P marks on purpose.
- Every decision shows a toast with Undo.
- The fix list header stays on top, frosted, with a hairline once you scroll.
- Small targets are at least 32px. Counts use tabular figures. Text selection is highlighter yellow. Reduced motion keeps fades and drops movement.
- The reading steps are about 40% faster (staged waits trimmed), so a rushing student isn't kept waiting for show.
