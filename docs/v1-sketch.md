# CorvidEQ v1: sketch

A rough plan for the first complete version. Not a promise: ideas get
tried by using the app daily and writing down every moment of friction.
Written so it can later be shown inside the app (Learn / About).

## Principles

- **One job per part, one role color per job.** The cyberpunk feel comes
  from many simple parts working together, not from more effects.
- **Nothing moves on its own.** A control never shifts under the cursor.
- **Scroll changes whatever is under the cursor.** Generous hover zones:
  being near a node is enough, not exactly on it.
- **One modifier means the same thing everywhere:** Shift = fine,
  Alt = solo / listen, Ctrl = select several bands.
- **Right-click = menu, double-click = reset**, everywhere.
- **Honest listening:** comparisons are level-matched; the analyzer says
  what it shows.
- **Small footprint, stated plainly** (see "About / trust").

## Layout

```
+----------------------------------------------------------------+
| top bar: power · wordmark · presets · A/B · output device       |
+----+-----------------------------------------+-----------------+
|    |                                         | bands +/-       |
| a  |  graph (readout top-left,               +-----------------+
| c  |  analyzer controls top-right overlay)   | band panel      |
| t  |                                         | (faders, knobs) |
| i  |                                         |                 |
| v  +-----------------------------------------+                 |
|    | frequency scale                         |                 |
+----+-----------------------------------------+-----------------+
| bottom bar: meter · bypass (level-matched) · amount · undo/redo |
+----------------------------------------------------------------+
```

Exact sizing comes later. Known: the band count stepper moves to the space
above the faders (top right), so it stops sliding away when the band panel
grows.

### Top bar: system and presets

- Power button, wordmark, preset picker, Save, Import (as now)
- **A/B slots:** two EQ states to flip between instantly
- **Output / source device** (the picker moves up from the bottom bar)

### Graph: everything about seeing

- Readout of the touched / selected band, top-left (as now)
- **Analyzer controls in a small overlay, top-right** (mode, hold,
  sensitivity, later speed / freeze), dim until hovered
- **Note names in the crosshair** (440 Hz = A4)
- **Double-click empty graph adds a band there**
- A note on the display tilt ("+3 dB/oct") so experts read it right

### Bottom bar: everything about listening

- Level meter
- **Level-matched bypass:** EQ off and on at equal loudness, because
  louder always sounds "better"
- **Amount knob (gain scale):** 0–200 % of the whole curve
  ("70 % of this headphone correction")
- Undo, redo, reset

### Band panel

As now. Up to **20 bands** (Equalizer APO has no limit; measurement-based
presets found online mostly use 10, some up to 20). Default stays 7.
Columns must stay grabbable on a laptop screen at 20.

## Activity bar

Far left, full height between top and bottom bar, ~48 px. **It switches
places, it never holds controls**: each icon swaps what the big area shows.
Controls for a place live inside that place.

Start with EQ, Settings and About, so the layout is final; later places
are just more icons.

| Place | What it shows | When |
|---|---|---|
| EQ | the equalizer (home) | v1 |
| Settings | UI scale, theme, startup behaviour (pinned at the bottom) | v1 |
| About / trust | exactly what the app touches on your PC | v1 |
| Learn | the regions, the filter types, what a cut at 3 kHz *does*; these docs | later |
| Presets library | browse, organize, import; the top bar dropdown stays for quick switching | later |
| Devices | which outputs have Equalizer APO, per-device presets, point to the Device Selector | later |
| Mixer | per-app volume | later |
| Plugins | VST chain inside Equalizer APO | later |

### About / trust (v1)

What CorvidEQ does on your computer, nothing more:

- Writes one file of its own: `corvid-eq.txt` in Equalizer APO's config folder.
- On power on, saves an exact copy of `config.txt` and adds one line to it;
  on power off, puts the copy back byte for byte.
- Listens to the output you pick, for the analyzer and meter. Records nothing.
- No network access.

### An AI helper?

Best use: explaining ("why does this sound boomy?") and turning "warmer,
less harsh" into band moves. Needs network and an API key, which breaks the
"no network" promise, so: opt-in, off by default, under Learn. Undecided.

## Later (v1.5+)

- **Band solo / listen:** hold Alt to hear only a band's region (needs the
  band-pass filter type, not supported yet)
- Per-channel EQ (left / right), for speaker and room correction
- Slope-based shelves (`LSC 12dB`)
- Typing an exact value (for copying filters from a measurement)

## Under the hood

- **Tests** for the config format (parse → save → parse = same EQ) and the
  DSP (curve points against the RBJ cookbook formulas). They prove the
  "identical to Equalizer APO" claim.
- Draw the curve at the output's real sample rate (44.1 / 48 / 96 kHz
  differ near the top). The source picker already knows the rate.
- Overlapping nodes: the hovered / selected one draws on top.

## Inspiration (not planned)

- Plugins inside Equalizer APO (`VSTPlugin:`): any VST2 effect on system
  audio, still running after the app closes. Note: third-party plugins run
  inside Windows' audio process, so a buggy one affects all sound.
- A "tap" plugin for true before / after analyzer signals.
- Per-app mixer.
