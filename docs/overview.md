# CorvidEQ in one page

## What it is

A visual equalizer for Windows. You shape your computer's sound by dragging
points on a curve and watching the music react behind it.

It doesn't process audio itself. **Equalizer APO**, a free system-wide audio
engine, does that. CorvidEQ is the face: it writes Equalizer APO's settings
and shows you what you hear.

## Who it's for

People who love sound but aren't engineers. It should feel like play (big
targets, instant feedback, colors that tell you what's what) and teach
along the way (named frequency regions, plain explanations).

It should also satisfy audiophiles: the curve is mathematically identical to
what Equalizer APO applies, nothing is hidden, and comparisons are honest.

## What it's trying to be

- **Delightful:** crisp, fast, a cyberpunk look made of many simple parts,
  each with one job and one color.
- **Trustworthy:** it touches as little of your computer as possible and
  says exactly what it touches. AI-generated, and open about it.
- **Lean:** no bloat, no performance cost; every feature has to earn its place.
- **Self-documenting:** the docs are written to be shown inside the app.

## How it works, in one breath

A React interface (TypeScript) runs inside a small native shell (Tauri +
Rust). TypeScript does the thinking: the EQ, the math, the config format.
Rust does only what a web page can't: listen to the system's audio for the
analyzer, and write files in Equalizer APO's folder. It's a desktop app
only.

## What it touches on your PC

- One file of its own in Equalizer APO's config folder.
- When you switch it on: an exact backup of Equalizer APO's main config,
  plus one line pointing to CorvidEQ's file. Switching off restores the
  backup byte for byte.
- It listens to the output you pick, for the analyzer. It records nothing.
- Network: only a check for updates on GitHub shortly after start; an
  update downloads only when you click Update. The full list is in the
  README ("What it touches on your PC").

The EQ keeps working after the app closes, because Equalizer APO is the one
running it.

## Where it stands

The core works and feels good: up to 20 bands, presets and import, undo,
a live analyzer (line or heat view), a level meter, a source picker with
facts about each output, and safe on/off switching.

Now: polishing the base EQ. Later, maybe: an activity bar with more places
(mixer, plugins, devices, learn).

## Read next

- `AGENTS.md`: the rules, architecture and conventions (for anyone changing code)
- `docs/v1-sketch.md`: the plan for v1 and the ideas beyond it
- `docs/analyzer.md`: what the curve, analyzer and meter promise, and what they don't
