# CorvidEQ: instructions for AI agents

CorvidEQ is a visual, FL Studio–style parametric EQ front-end for
Equalizer APO on Windows.
Equalizer APO does the actual audio processing system-wide; CorvidEQ only
edits its text config and visualizes the result.

Status: **desktop app, step 3** (Tauri). The same React UI runs in a browser
(no sound: for working on the UI) or as a Windows app whose analyzer shows the system's
audio. There is no song player (removed as bloat, user's choice). The desktop app writes its OWN file, `corvid-eq.txt`, into Equalizer
APO's config folder on every EQ change (throttled to ~15/s,
`state/eq-file.ts` + `src-tauri/src/eapo.rs`).

`config.txt` is only written when the user presses the power button (top
bar, left; `PowerButton`): ON saves the exact `config.txt` as
`config-before-corvideq.txt` (verified), then writes `Include: corvid-eq.txt`;
OFF writes the saved copy back byte for byte (verified), then deletes it. If
another app changed `config.txt` meanwhile, OFF refuses and keeps the copy.
If another app replaced it, CorvidEQ simply reads as off, and the next ON saves
that config instead: power off always brings back what was there when you
pressed on (user's choice: stay out of the way, don't manage this).
CorvidEQ's EQ keeps working after the app closes (user's choice). If the app
crashes (Rust panic), the panic hook in `lib.rs` logs it and records it for
next launch (`record_crash()` → `CrashModal`) without touching `config.txt`, so
sound keeps running undisturbed. Uninstalling switches it off and removes the Windows startup `Run` entry (`windows/hooks.nsh`,
set in `tauri.conf.json`, runs `--release-eapo`; not on an update). Hard kills can't be
caught; then the EQ stays as it was. No "restore on next start after an
unclean exit": Windows shutdowns would trigger it after every reboot.

## Commands

```bash
npm install
npm run dev          # browser version at http://localhost:1420 (hot reload)
npm run tauri dev    # desktop app window (same hot reload; Rust rebuilds on change)
npm run tauri build  # Windows installer (NSIS) in src-tauri/target/release/bundle
npm run build        # type-check (tsc -b) + production build of the UI
npm run lint         # oxlint
npm test             # file format and curve tests (vitest; `*.test.ts` beside the code)
cd src-tauri && cargo clippy   # Rust lint
cd src-tauri && cargo test     # power on / off, uninstall, analyzer (temp folders only; stop `tauri dev` first)
```

Always run `npm run build` (and `cargo check` in `src-tauri/` if Rust changed)
before finishing a task. Prerequisites on Windows: Rust (rustup, MSVC
toolchain) and the "Desktop development with C++" build tools.

## Architecture

Strict layers. Lower layers never import from higher ones.

| Layer | Path | Responsibility | May import |
|---|---|---|---|
| Model | `src/eapo/types.ts` | `Band`, `EqSettings`, filter type metadata, `LIMITS` | nothing |
| Format | `src/eapo/format.ts` | Parse / serialize Equalizer APO config text | model |
| DSP | `src/dsp/` | Biquad coefficients (RBJ Audio EQ Cookbook), frequency response, auto preamp | model |
| Audio | `src/audio/` | `spectrum-source.ts`: the analyzer's data, from Rust (desktop); the browser has none | model, dsp |
| State | `src/state/` | `params.ts` (how every parameter moves), `store.ts` (the EQ, undo/redo, UI focus), `presets.ts` (named presets, built-in Default), `split.ts` (left / right EQ), `bypass.ts` (B: hear without the EQ on screen, per device), `stereo.ts` (balance and delay, per output), `eq-file.ts` (desktop: keeps `corvid-eq.txt` in sync, the on/off switch, status re-read every 3 s), `output-eqs.ts` (desktop: one EQ per output), `audio-source.ts` (desktop: the outputs and inputs, which one you listen to), `settings.ts` (persisted preferences: theme, font, custom config dir, FFT mode, tray/startup), `window-idle.ts` (desktop: pauses capture and polling while hidden in tray/minimized), `updater.ts` (desktop: checks GitHub Releases `latest.json` via `tauri-plugin-updater`, installs & relaunches), `error-log.ts` (forwards UI errors to Rust) | all of the above |
| UI | `src/ui/`, `src/App.tsx` | React components (see below) | everything above |
| Desktop backend | `src-tauri/` | Rust: only what a web page can't do. `spectrum.rs` = audio capture (cpal: loopback on an output, a recording on an input) + FFT + stereo peak/RMS, streamed to the UI over a Tauri `Channel` (one `Frame` = spectrum + level); `devices.rs` = audio device enumeration, Windows volume, EAPO registry slots; `eapo.rs` = write `corvid-eq.txt`, switch `config.txt` on/off with an exact backup (all writes: temp file + rename), open fixed external URLs; `tray.rs` = system tray icon, close/minimize-to-tray, Windows startup `Run` key (`--minimized`); `errlog.rs` = the error log, `%LOCALAPPDATA%\com.igormitrovic.corvideq\logs\corvid-eq.log`, ~1 MB then `corvid-eq.old.log`, std only (crashes, capture errors, the UI's errors via `state/error-log.ts`, failed file writes; Settings → Equalizer APO → Error log opens the folder). Release workflow: `.github/workflows/release.yml` (signed NSIS + `latest.json` + `SHA256SUMS.txt`). | (separate crate) |

UI folders:

| Folder | Contents |
|---|---|
| `ui/graph/` | `EqGraph` (interaction state) composed of `GraphGrid`, `BandDot`, `Spectrum` (line, heat), `Bars` (third-octave bars; both draw with `analyzerStyle.ts`: the red / cyan strokes, glow fills, peak hold, so they look alike), `Readout` (band values, crosshair), `GraphTools` (analyzer buttons in a row along the inside top edge); `AxisStrips.tsx` (region names, frequency scale, dB scale, red analyzer scale, split view's heat strip); `geometry.ts` (value <-> pixel), `useCurves.ts` |
| `ui/panel/` | `BandPanel` (Level column + one column per band), `controls.tsx` (`Knob`, `Fader`) |
| `ui/bar/` | `TopBar` (`PowerButton`, `Brand`: the app's icon and name, opens the About window, `SourcePicker`, file problems, `DeviceWarning`, `UpdateButton` when an update is found, undo/redo, `BandCount`, Settings), `BottomBar` (presets, Bypass button, A/B, L/R, `StereoControls`), `PairSwitch` (two letters on one button: A/B, L/R), `BandCount` (one number field, − and + inside its box), `LevelMeter` (vertical stereo LED meter, input or output, canvas), `StereoControls` (balance knob between the two delay fields), `SourcePicker` + `SplitButton` (a row in its list; `SplitButton.tsx` also has `UnsplitModal`), `HeatSensitivity`, `CrashModal` (shown once on launch after a Rust crash) |
| `ui/presets/` | `PresetPicker` (current preset + list to load), `SaveModal` (save / overwrite / delete) |
| `ui/settings/` | `SettingsPage` (full-window page over the app: categories left, one column of at most 900 px that leans left (centers, but never more than one nav width from the nav) categories and column share a top edge that moves down in a taller window (40 → 240 px, `--top`; the column's scrolls away); Esc / back arrow closes; last category and scroll remembered while the app runs, not saved), `primitives.tsx` (`Page`, `Section`, `Row`, `Segmented`, `Select`, `Action`, `Value`, `Keys`, `Note`), Equalizer APO, Appearance (theme + font), Analyzer (FFT Dual/Single + Veritasium link), Window & tray (tray toggles + Windows startup), Controls (keyboard/mouse/analyzer reference), About (`AboutContent`) |
| `ui/common/` | Shared pieces: `ErrorBoundary` (around each settings page: a page that fails to draw shows its error instead of blanking the window), `Modal` (shared modal backdrop + Esc capture), `About` (`AboutContent` shared by `Brand` modal and Settings → About), `Button` (THE boxed button: every `.btn` in the app renders through it; `on` prop, variants are modifier classes styled where used), `FilterMenu` (shape dropdown, used by the graph and the panel), `icons.tsx`, `useWheelSteps`, `useElementSize`, `NumberField`, `useMenuClose` + `usePlaceInWindow` (every popup menu: close on Esc / outside click; measured and kept inside the window, scrolls if taller) |
| `ui/theme/` | `theme.ts` (the UI themes, the fixed analyzer and band colors, hex helpers; pure), `active.ts` (CSS variables, `bandColor`, `spectrumColor`, `afterColor`, `heatColor`) |
| `ui/tooltips.ts` | Centralized `TOOLTIPS` copy across the UI |
| `ui/useShortcuts.ts` | Global keyboard shortcuts |

Rules:

- `eapo/` and `dsp/` are **pure TypeScript**: no React, no DOM, no side effects.
- **TypeScript is the main language.** Rust stays small and only does what the
  web view cannot (file access in Program Files, audio capture). UI logic,
  state, DSP math and the config format live in TypeScript.
- Desktop vs browser: check `isDesktop` (`audio/spectrum-source.ts`). Save file… (in the preset Save window, `ui/presets/exportFile.ts`) works in both
  (desktop: Windows' Save window via `tauri-plugin-dialog`, Rust
  `export_config` writes it, `.txt` only). B = bypass in both; on desktop
  it writes a `corvid-eq.txt` with no filters, only a preamp at the EQ's overall loudness (`loudnessGain()` in `dsp/response.ts`: K-weighted pink noise, never above 0 dB), while on, for the EQ on screen only (one bypass per device, user's choice: comparing headphones must not change a mic on a call; config.txt untouched;
  saved, so closing while bypassed reopens bypassed: `state/bypass.ts`)
  and the Bypass button in the bottom bar (after the preset; icon: the signal line jumping over the EQ box; just the icon like the power button, `.icon-toggle`) does the same, lit yellow while on.
  While bypassed (`.app.bypassed`) the curve, its fill, band areas, nodes and
  every fader are gray and dim (`filter: grayscale`, not a blur, only then).
  Desktop power off (`.app.eq-off`): no curve, nodes, band crosshairs or
  readout at all; the panel stays editable.
- One EQ per output (desktop, `state/output-eqs.ts`; user's choice: no shared
  EQ, no binding, so nobody has to think about what follows what): every
  output has its own, a new one starts flat on Default, and the same sound
  elsewhere = load the same preset there. The editor (`useEq`) always holds the
  EQ of the output you're listening to (picker choice, else Windows' default;
  outputs re-read every 3 s) and swaps with `replace()` (no undo step, history
  starts over). Every EQ is remembered as it is, saved as a preset or not; only
  undo history ends with the app. `serializeOutputs()` writes one
  `Device: {guid}` section per output with an EQ; any other output plays flat.
  Older saved state: each output keeps the EQ it played (`fromSharedEq()`).
- Inputs (source picker's "Inputs" group; `DeviceInfo.input`): a mic or line in
  is a device like an output: its own EQ, preset, A/B and bypass, written as a
  `Device: {guid}` section (Equalizer APO's default stages include capture), and
  it plays while the app is closed. Listening opens it (`build_input_stream`
  without loopback), so Windows shows the mic as in use and a Bluetooth headset
  drops to call quality; that's why the pick isn't saved (`input` in
  `state/audio-source.ts`, user's choice) and the app starts on the output
  again. No "Windows default" row for inputs. Power acts on every device, inputs
  too. The Windows volume stays in the analyzer on an input (see the note on
  `OutputVolume`).
- Device warning (`ui/bar/DeviceWarning`, top bar), first match wins:
  "Equalizer APO not found" (no config folder) or "Device Selector not found"
  (the tool is missing, the tooltip names the path tried); else a "Not installed" button, whose
  small window (`SetupHelp`, the About window's colors) says which tool to run
  and from which folder. The tool is `DeviceSelector.exe` (1.4.2) or
  `Configurator.exe` (older), `DEVICE_TOOLS` in `eapo.rs`, looked for in the
  registry's `InstallPath` first, checked with every status read. The app only
  names it and never starts it (user's choice: no Windows prompts coming from
  CorvidEQ; it also needs its own folder as working directory, or Qt can't find
  `qt\platforms`). The user runs it, ticks the device and restarts Windows. The
  app never restarts Windows (user's choice): it may only suggest it, and it
  never downloads or links to external Equalizer APO pages.
  "Not installed" is read per device from the registry (`Render` or `Capture`,
  `eapo_slots()`). A device that gets it while the app runs shows "Restart
  Windows" (`restartNeeded`, not saved): the registry changes at once,
  Equalizer APO only runs after the restart.
- The spectrum grid (512 log-spaced points, 20 Hz–22.4 kHz) is shared:
  `SPECTRUM_POINTS` in TS must equal `GRID_POINTS` in `spectrum.rs`, and
  `SPECTRUM_MIN_HZ` / `SPECTRUM_MAX_HZ` the grid's range.
- The graph's frequency axis is that same range, 20 Hz–22.4 kHz (the top
  third-octave bar's upper edge, so every bar fits; `geometry.ts`). Nodes
  stay within 20 Hz–20 kHz (`LIMITS.freq`). Above 20 kHz the graph is
  shaded (`.beyond-hearing`, "beyond hearing"; region strip divider, 20k
  label); a dashed line marks the captured output's Nyquist (half its
  sample rate) when inside the graph (44.1 kHz: 22.05 kHz; `GraphGrid`).
  The output's sample rate sits faint beside the source picker in the top bar (`SourceRate`, `.source-rate`; from `audio_devices`' format; `capturedRate()`). A cut-off name shows whole while the button is hovered (`.source-full`, a copy on top that ignores the mouse).
- **Each parameter is defined once** in `state/params.ts`: its scale (log or
  linear), how one wheel notch / key press moves it, and rounding. Controls,
  the graph, and shortcuts never hard-code steps; they call store actions
  (`stepParam`, `setParamNorm`, `resetParam`, `setType`, `cycleType`).
- `Knob` and `Fader` are dumb: they get a 0…1 position and callbacks.
  `bandControl()` in `BandPanel` wires a band parameter to them.
- All EQ edits go through store actions. Components never mutate settings directly.
- Non-React code (the file writer) follows the
  store with `useEq.subscribe(...)` (see `connectEqFile()` in `state/eq-file.ts`).
- One user gesture = one undo step: `checkpoint()` once at the start of a drag
  or edit. Wheel bursts are handled by `useWheelSteps` (use it for any new
  scrollable control, never a raw wheel listener).
- Store actions clamp values via `LIMITS`; don't duplicate clamping in UI code.
- Between 1 and 20 bands (`MIN_BANDS`, `MAX_BANDS`; Default preset = 7).
  Loading a preset, an import or an older saved state keeps the first 20.
  Band counter: at the top bar's right end, before Settings
  (a `NumberField` with a small − and + inside its box: one band per click, scroll = one band per notch, or type it;
  `setBandCount`, one undo step per click / burst / typed number). Adding puts a bell in the widest gap of the spectrum (slotted in by
  frequency, so numbers read left to right); the field removes from the end.
  Removing a chosen band: right-click menu "Remove band", Delete key (the selected band).
  Band number = position in the list. Double-click Freq resets to the band's
  home frequency (`homeFreq()`: the classic 7 layout, or spread evenly).
- Band colors are generated: first band → last band (`BANDS`, fixed), spread over
  the band count in OKLCH (equal-looking steps), the long way round the color
  wheel. First = last (both built-ins) means the whole wheel: neighbours
  360°/count apart, the maximum spread. `setBandCount()` (main.tsx follows the store) + `bandColor(i)`.
- Panel width: up to 7 band columns per row are 48 px; 8-10 get narrower
  (`columnWidth()` in BandPanel → `--col-w`), the graph gives up the rest.
  Never by window width (user's choice: spacing stays put while resizing).
  The Level column never narrows (`--level-w`); its fader sits centered
  between the panel edge and its divider. Its "Freq" label is centered, "Q"
  right-aligned under it (`.label-under`).
- 11-20 bands (user's choice): the band columns split into two decks
  stacked beside the Level column (`.band-decks`; bands split evenly, the top row gets the odd one: 11 = 6 + 5, 20 = 10 + 10,
  same column template in both rows), each deck with its own
  heads, faders and knobs. Those faders are about half the graph's height
  and do NOT line up with its dB lines (travel still spans the same dB
  range); the Level column stays full height and aligned. Up to 10 bands
  the rule below holds.
- A/B (bottom bar, after Bypass; `PairSwitch`: ONE button, a click anywhere
  switches to the other slot, the current letter lit; `state/ab.ts`, `swapAb` in the
  store): two EQs to flip between; B starts as a copy of A; each slot keeps
  its own undo history and preset name. Not saved, not level-matched (user's choice: each slot has its own Level, match by hand), and
  reset to A when another output's EQ comes in (`replace()`).
- Dragging a fader moves its thumb exactly with the mouse (travel measured
  from the track, `faderTravel`); knobs use a fixed 220 px for the full range.
- Every band control edits exactly ONE parameter. Wheel, vertical drag and
  double-click-to-reset must behave the same on every control (`ui/panel/controls.tsx`).
- Numbers stay out of the way: scales, ONE band readout and the crosshair.
  Typeable numbers: only the readout's Hz / dB / Q (below), the band
  counter's number and the delays, all `NumberField` (`ui/common`; every one
  also scrolls and drags up / down like every control: both walk `onStep`,
  a drag = one undo step, `dragPx` pixels per step: 4 by default, delay 1,
  band count 12; a press that moves under 4 px is a click = type. No
  double-click reset: the first click already opens typing). Touching any band control lights up that band on the
  graph (`focusId` in the store).
- Precise values (`ui/graph/Readout.tsx`): the top edge of the graph shows
  the touched band's values, else the selected band's (type, Hz, dB, Q).
  Touched: the normal look. Selected (also while hovered or dragged): bright like the
  selected node (`.readout.bright`: color toward white, full outline).
  The selected band's Hz, dB and Q can be clicked and typed ("1.2k" works;
  Enter / click away = apply, Esc = cancel; `setParam`, one undo step,
  rounding from `params.ts`).
  Crosshairs (`BandCross`): the selected band's node and the touched band's
  node each get one in the band's color, with the band's exact frequency on
  the bottom edge and gain on the right edge (no gain line for cuts/notch).
  Over empty graph a cyan crosshair follows the pointer (`Crosshair`).
- Layout (`App.tsx`): the top bar runs the full width (`TopBar`, slimmer padding than the
  bottom bar: its height comes off the graph). Under it, four
  columns, named grid lines: analyzer scale | graph | dB scale | band panel
  (at the right edge). Four rows:
  region names · shape buttons | graph · faders | frequency scale · Freq knobs |
  bottom bar · Q knobs. The first of those is only as tall as the taller of the
  two, so the graph and the faders start at the same height. The band panel
  spans the rows with `subgrid`.
- Each fader bar is exactly as tall as the graph; its circle travels between
  the graph's top and bottom dB lines (`--gain-margin` in from each end).
  The graph is exactly the gain range plus `GAIN_MARGIN` (`ui/graph/geometry.ts`,
  passed to CSS as `--gain-margin`), so each fader's travel matches the graph's
  dB range. Don't hard-code that margin in CSS.
- Region names (`RegionStrip`) and frequency labels (`FreqAxis`) are separate
  strips (`ui/graph/AxisStrips.tsx`) with the same side borders as the graph,
  so labels line up with grid lines.
- Panel order: Level column first (its foot carries the "Freq" and "Q" row
  labels, written once), then one column per band. Q knobs sit beside the bottom bar.
- The dB scale has its own narrow column between the graph and the band
  panel (`DbScale` in `AxisStrips.tsx`, width `--scale-w`). Its box has the
  graph's height and border width, so labels line up with the grid lines;
  the ends (±12 / ±24) are labelled too. Clicking it is the zoom switch
  (`viewDb` in the store). Gain faders and the Level fader span the current zoom (`paramDef`).
  No labels are drawn inside the graph. Scale labels are HTML, not SVG text
  (crisper on Windows).
- The region names sit above the graph, outside any box (higher contrast).
- A faint cyan line marks 8 kHz on the graph, unlabelled: just a hint (`HINT_HZ` in `GraphGrid`, `.grid line.hint`).
- Top bar left: the power button (just the icon, no box; off = dim, on = yellow).
  Power = "is CorvidEQ shaping
  my sound?": desktop = Equalizer APO switch, browser = bypass on/off (B; no sound there).
- App icon: `public/icon.svg` (a `#FFF000` triangle, point down, with a
  `#1a1a1a` outline and a `#1a1a1a` corvid on it, on a transparent background;
  the canvas must stay square for `npx tauri icon`). The PNG/ICO set in `src-tauri/icons/` is generated from
  it: run `npx tauri icon public/icon.svg --output <temp folder>` and copy only
  the six files already there (it also makes Android, iOS and Store sets we
  don't use). Used for the window, taskbar, installer and favicon.
- Everything about what you see sits as buttons on the graph's inside edges
  (`GraphTools`): one row along the top edge, left aligned: a power icon (lit while any view is on; click = all off, again = the last view back) / Line / Bars / Heat,
  Split, then the options of what's in the graph's upper part (line or bars:
  Pre / Post / Overlay, then Hold, each only where it applies; heat: its own
  Pre / Post, then the heat sensitivity, just its curve icon: scroll or drag,
  double-click = linear).
  Split view stacks the lower half's options up the left edge from the
  bottom left corner (Pre / Post lowest, Hold or the sensitivity above it),
  so swapping the halves swaps their controls too.
  Bottom right corner: Fullscreen (`.graph-fullscreen`, a plain `.btn`): the `.graph` element via the Fullscreen API; desktop also sets
  the window fullscreen (`core:window:allow-set-fullscreen`); Esc or the
  button again leaves. The left analyzer scale's labels and the
  region names are `--text-dim` (experiment). The pointer level label (`.crosshair-label.level`) is `--text-dim` too: the color of the scale it reads off. The band readout sits top right.
- The top bar holds, from the left: power, the app's icon and name (`Brand`, always
  Oxanium: `--font-brand`, not `--font`; no box until hovered; a click opens the About
  window, shared with Settings → About (`About.tsx`): version from `getVersion()`,
  updater check/install controls, heads-up, credits, MIT license, the
  Image-Line nod, links through fixed addresses in `eapo.rs` (`open_source_website`,
  `open_issues_website`; plus `open_fft_video` for Settings → Analyzer)),
  source (is it on, which output and so which EQ). Then desktop problems
  writing to Equalizer APO's folder, the device warning, and at its right end
  (`.bar-end`, `margin-left: auto`) Undo, Redo, the band counter and Settings
  (an outline gear, `.icon-toggle` like the power button, same size). The
  source list opens downward. If the bar wraps it only costs the graph height.
- The bottom bar (under the graph, beside the Q knobs) holds the preset (which sound on this output), then Bypass and A/B (comparing),
  and at its right end (`.bar-end`, `margin-left: auto`, also when the bar wraps)
  L/R (`LrSwitch`, only while the EQ is split), then
  balance and delay. The preset list opens upward. The preset picker shrinks before
  the bar wraps (260 down to a 140 px basis: `flex: 1 1 140px`, the size wrapping
  is checked at). It shares its row with the Q knobs, so it must stay on one
  line: wrapped, it makes that row taller and spreads the knobs apart. New
  controls go in the top bar when they can. Keep targets large (≥ 42px tall).
- Balance and delay (`state/stereo.ts`, `ui/bar/StereoControls`): left delay,
  balance knob, right delay. They fit speakers to a room, so one set per output
  (GUID). Not in presets, A/B, undo or Save
  file; Bypass and solo leave them on. Written after the EQ in `corvid-eq.txt`,
  one `Device: {guid}` block per output that isn't flat (`stereoLines()` in
  `eapo/format.ts`, `Channel: L` / `R` with `Preamp:` and `Delay:`), so the EQ's
  own sections don't change. Balance only turns a side down (never boosts: no
  clipping, Auto stays right), stored in dB, 0.1 dB steps; the knob follows the
  classic law (far side's loudness moves evenly), its far end = silent; its
  value is in the tooltip. Delay: `+0.00 ms` (the + says time is added; never
  negative), 0 to 200 ms, wheel 0.1 ms, Shift 0.01 ms. No third "both channels"
  field: the same value in both does that (user's choice). Hidden on a mono
  device: its one channel is `C`, so `Channel: L` / `R` would match nothing.
- Meter: one, the output (after the EQ), under the cyan dB scale. Click it
  to switch it off (all segments dark, `meterOn` in the store) or back on. (The
  input meter is gone; `LevelMeter which="input"` still works if it's
  wanted back.) Units: the red analyzer scale is labelled every 12 dB (0 … -72;
  split view: every 24, 0 / -24 / -48 / -72) with "dB" at the floor (-84); a cyan "Hz" for the frequency scale far left, right under that "dB" (`FreqUnit`). The bottom bar spans analyzer scale + graph.
- Level meters: vertical stereo LED segments, -48…-3 dBFS green → yellow
  (-18; both just mean "how loud", nothing wrong), then three red LEDs per
  channel (user's choice), each lit above its level: -3 and -1 dBFS (past
  Auto's 3 / 1 dB headroom) and -0.5 dBFS = Windows' limiter at work (the
  "clipping" LED, stays lit 2 s). Hovering the red LEDs lists their levels
  (`.meter-red`, an invisible box over the canvas, for its title). Why not 0 dBFS: Windows runs
  every output through its limiter (CAudioLimiter) after all effects, and
  loopback captures after it. Measured with a -12 dBFS 1 kHz sine and the
  preamp raised: exact up to the ceiling, then stuck at 0.985 (-0.13 dBFS),
  and pushed harder it got turned DOWN (to about -1.8). Nothing reaches
  0 dBFS here; the sound gets squashed instead. Bar = peak (falls smoothly), lit segment = held peak. Its green is the
  band rainbow's green.
  (Not RMS: music's average sits 10-20 dB below its peaks, so the hold
  would always float far above the bar.) Colors via `meterColor()` (yellow =
  Primary, red = the analyzer's red). It's the one place with
  classic mixer colors.
- Split EQ ("Split left / right EQ" in the source picker's list, sources with
  exactly 2 channels only, `canSplit()`; `SplitEq` in `eapo/types.ts`,
  `state/split.ts`): a left and a right EQ for that output. On a surround
  output a split preset plays its side on screen as one EQ (`loadPreset()`), so
  every speaker keeps an EQ. `settings.bands` is always the side on screen and `settings.split`
  holds the other, so undo, A/B, per-output EQs and presets carry both without
  knowing. One `preamp` for both (separate ones would shift the balance); Auto
  follows the side that peaks higher (`autoLevel()`). Split: R starts as a copy.
  L/R (`flipSide`) only picks the side on screen: no undo step, solo cleared,
  and undo can flip back to show what it undid. Unsplit (one undo step): the
  side on screen plays on both, the other is kept (`on: false`, even through
  loading a preset) and comes back on the next split; if the sides differ,
  `UnsplitModal` asks first. Each side has its own preset name and dot
  (`otherPreset`). The file: `Channel: L` and `Channel: R` sections
  (`eqLines()`). The analyzer reads only the side on screen (`connectSplit()`,
  Rust `set_analyzer_side`), as "before" = captured minus that side's curve; the
  level meter still shows both.
- Presets (`state/presets.ts`): "Default" (all bands at 0 dB) is built in, always
  first, never stored, never overwritten or deleted. A split EQ saves both sides, and such a preset brings both back (and splits); a normal preset loads into the side on screen. "Save what you hear…" (top of the preset list) opens a window:
  an existing name overwrites, a new name saves a new preset; delete asks
  once more; "Save file…" (bottom left) saves the EQ as an Equalizer APO
  .txt instead. Loading is one undo step. Back to flat = load Default (no Reset button). The preset list gives every saved preset a small trash can (click, then "Delete?"; Default has none). The bottom bar
  shows the current preset (cyan, in the dark `.num-field`-style box), dimmer with a cyan dot on the right (`.preset-dot`; "New…" if there's no preset to name) the moment the
  sound differs from it (undo back and the dot goes). Saving an edited
  EQ starts with an empty name: type a new one or pick a preset to overwrite. "Import files…" / "Import folder…" (bottom of the preset list) read
  Equalizer APO .txt files and JSON presets ({ preAmp, filters }) as other
  front-ends save them (`parsePresetFile()` in `eapo/format.ts`); never
  overwrites (name clashes get "(2)"), keeps the first 20 filters, and keeps
  Auto on only when the file's preamp equals the auto value (with no headroom, or the current one).
- Selected band (`selectedId`): clicking its node or touching any of its
  panel controls selects it; clicking empty graph or Esc deselects. Shown by
  a bright node, a filled shape button, its fader (full bright red outline,
  bright circle and fill) and the readout. Hover/drag (`focusId`)
  lights a band up temporarily and takes over the readout. Hovering or
  dragging a node also lights up its fader exactly as a fader hover does
  (`graphHotId` in the store → `.band-col.graph-hot`).
- The Level column is Equalizer APO's preamp. "Auto" keeps the curve's peak at
  0 dB minus the headroom (`headroom` in the store: 0 / 1 / 3 dB, default 1,
  Level menu; one setting for every EQ, no undo step, persisted;
  `autoPreamp(bands, headroom)`). Headroom keeps loud songs clear of Windows'
  limiter (see the meter). EQs outside the editor (other outputs, the other
  A/B slot) get Auto re-applied when they're written or swapped in
  (`autoLevelled()`), so a headroom change reaches them too. Touching the
  Level fader switches Auto off. (The column has no clip light;
  the dashed "what you hear" curve shows when the peak goes above 0 dB.)
- Nodes (the draggable dots on the graph) are numbered rings, twice the size
  of a fader circle (`--thumb-r` = 9 px, node disc r = 18). Three looks,
  dimmest to brightest: flat (gain-type band at 0 dB, does nothing), shaping,
  selected (pushed toward white, thicker ring, fuller disc). Overlap: higher
  number over lower, the selected node above all (`drawOrder` in `EqGraph`;
  the move drops pointer capture, so a press takes it again). Switched-off bands have no
  node, crosshair or curve on the graph, except while their panel column is
  hovered (dimmed node, their shape as if on); "Unmute" in the band menu turns them back on.
- Solo (`soloId`, "Solo" in the band menu (right-click a shape button or fader) or a node's right-click menu): hear one band alone. A listening aid,
  not an edit: no undo step, presets never see it, but saved like bypass
  (the file keeps playing it after the app closes, so the app reopens
  soloed; no special close step, user's choice), cleared by loading a preset or by
  clicking any band's number (on/off would otherwise do nothing during a solo).
  `appliedSettings()` (store) is the EQ as applied: other bands off, the soloed
  one on, Auto re-levelled. `corvid-eq.txt`, the graph's
  curves and the analyzer's "before" line use it; presets and Save use
  `settings`. Soloed column: yellow fader outline; the others dim (`muted`),
  and their nodes stay on the graph, dimmed. The two arcs around a ring (top and bottom) show Q:
  they grow symmetrically as Q rises (fuller = narrower band).

## Domain notes

- The app **owns its own config file** (`corvid-eq.txt`) and the user's
  `config.txt` points at it with `Include: corvid-eq.txt`. There is no import
  of other configs, except as presets: `parsePresetFile` imports Equalizer
  APO text or JSON preset files and reports unsupported lines as warnings,
  never silently.
- Supported filter types (Equalizer APO codes): `PK`, `LSC`, `HSC`, `HPQ`,
  `LPQ`, `NO`, `BP` (band-pass: the cookbook's 0 dB peak form, no gain, Q sets
  the width). Shelves use the *center-frequency* variants (`LSC`/`HSC`) with Q.
  "More…" in the shape picker (`MORE_TYPES`, off the wheel; `FilterMenu`) has
  the rest: `AP` (all-pass: phase only, flat curve, Q sets the width) and the
  corner-frequency shelves `LS 6dB`, `LS` (10.8 dB), `LS 12dB` and their `HS`
  twins. In Equalizer APO every shelf is the same biquad: S = dB per octave /
  12 (6 dB = a true first-order shelf), and `LS`/`HS` move Fc from the corner
  to the shelf's middle (`cornerShift()`). Their slope is fixed, so no Q knob,
  no Q in the file, no Q arcs (`hasQ()`). Equalizer APO doesn't stop any
  filter at Nyquist, and past it the filter is unstable, so `fileFreq()` keeps
  each filter's middle under 20 kHz and, in the file, under that device's
  Nyquist (`highestFilterHz()`, the limit the curves already use; last known
  rate per device: `rates` in `state/output-eqs.ts`; Save file: 20 kHz). Import
  keeps those names; other shelf mixes (`LS ... Q`, `LSC 6 dB`, no Q) become
  `LSC`/`HSC` with the same curve at the file's gain (`readShelf()`). A line
  without Q takes Equalizer APO's default: `NO` 30, `BP` 0.707, shelves S 0.9.
  Cuts have a slope (`Band.slope`: 12 / 24 / 48 dB/oct; 24 and 48 are written
  as 2 or 4 `HPQ`/`LPQ` lines, Butterworth Qs, the band's Q scaling the last
  one: `bandStages()` in `eapo/types.ts`, used by the file and the curves).
  A `# CorvidEQ slope N` comment before the chain lets import fold it back
  into one band. The slope is a button in the readout (where dB would be):
  all three numbers, the one in use yellow, click = next (`setSlope`, one undo step).
  `IIR`, `GraphicEQ` (skipped with a warning, user's choice) and channel
  sections other than left and right (import makes those a split preset, one preamp:
  the lower one, with a warning; balance and delay are only written, never
  imported) are not supported yet; per-device sections only as CorvidEQ writes them
  (one EQ per output), not when importing.
- Curve math must stay identical to Equalizer APO (RBJ cookbook, alpha = sin(w0)/(2Q)).
- Curves are drawn at the captured output's sample rate (`curveRate()` in
  `state/audio-source.ts`, as Equalizer APO designs its filters for it;
  48 kHz in the browser or before the list is read; Auto's preamp always
  at 48 kHz; flat above Nyquist). The main curve is the EQ's shape (bands only)
  and passes through the nodes. A fainter dashed curve shows what you hear:
  the shape plus the preamp (Level), shown only when the preamp isn't 0.
  It lights up while the pointer is on the Level column and has an on/off
  item in the Level fader's right-click menu ("Show / Hide the level line"; `showHeard` in the store).
  Nodes can't follow the preamp (with Auto on, raising a band lowers the
  preamp, so the node would barely move under the mouse).
- Gain is limited to ±24 dB (`LIMITS.gain`), which is also exactly the graph's
  vertical range, so every node is always on screen. Big moves: drag the node;
  fine moves: scroll a fader (0.5 dB, Shift 0.1 dB). Preamp: ±24 dB.
- The analyzers and the meter ignore the Windows volume (user's choice):
  `OutputVolume` in `devices.rs`, read every frame, gives the gain the capture
  callback multiplies samples by. Measured on a software-volume output:
  loopback follows the slider, but muted it delivers the sound at full level
  (Windows mutes when the slider reaches 0), in normal packets, not flagged
  silent. So: muted or at 0 = gain 0, hardware volume = 1, else the slider's dB
  undone. Master volume only, not Windows' per-channel balance. Outputs only:
  an input's slider often sets real gain before the sound is digitized, so it
  changes the recording and the analyzer should show it.
- Left and right are analyzed separately, always, and averaged by power per
  bin (`Resolution::levels`), never added as samples: a delay between them
  would cancel at some frequencies and draw dips nobody hears (test
  `delay_between_channels_draws_no_dips`). Surround: even channels count as
  left, odd as right. Always on, not only while a delay is set, so readings
  never jump with a setting. Only a split EQ changes this: then one side alone.
- Spectrum: two FFTs of the same samples, 60 fps: 8192 points (~6 Hz per
  bin) for the bass, the newest 2048 (~23 Hz, reacts ~4x sooner) for the
  mids and highs, blended in dB over 500 Hz–1 kHz (`HANDOVER_HZ`). Lopsided
  Blackman windows (fast fall over the newest samples) so new sound shows
  sooner. Levels are true dBFS: a sine of X dBFS reads X in the bass.
  Noise fix (user's choice, "noise-flat everywhere"): at startup each FFT
  reads 20 s of white noise and every grid point gets a fix
  (`Resolution::fix`, `CALIBRATION_SECS`) so dense sound reads the long
  FFT's bass level everywhere: pink noise reads flat within ±0.35 dB, no
  slope across the handover (tests `pink_reads_flat` etc. in
  `spectrum.rs`). The cost: a lone tone reads low where the fix is big
  (~3 dB at 700 Hz, ~7 at 2 kHz, ~10 at 16 kHz). Rises are instant,
  only falls are smoothed. +3 dB/octave display tilt. Settings → Analyzer →
  FFT "Single": the long FFT everywhere (`Analyzer::single`, the short one
  skipped), with its own noise fix; tests run both modes.
  Grid points interpolate between bins below the frequency where a point
  spans 2 bins, and take the loudest bin above it; ONE switch point, never
  mixed per point (mixing drew fake needles in the bass). This lives in Rust
  (`spectrum.rs`).
  Display modes (top edge of the graph, after the input; Split is its own
  toggle after Heat; clicking it again while on swaps the halves,
  `splitSwapped` in the store): `off`, `line` (level = height, with a glow
  under it and a peak-hold line, switchable with Hold; the hold line is a
  smooth envelope over the peaks: local max, then a moving average), `bars`
  (`ui/graph/Bars.tsx`: 30 ISO third-octave bars, 25 Hz–20 kHz, each the
  band's summed power from Rust (`Frame.bars`, `BAR_BANDS` in both
  `spectrum.rs` and `spectrum-source.ts`; the band's edge bins count by
  their share inside it): tones AND noise read true dBFS,
  no tilt, no noise fix; a bar reads the short FFT once its band spans 4 of
  its bins (500 Hz up; never in Single), decided only in `reads_short()`;
  sent raw, averaged in TS (`smoothBars`): power over 125 ms, rising and
  falling alike (sound level meters' Fast), so noise reads true; no "rise
  at once, fall slowly" like the line (artificial: rests ~1 dB high on
  noise; removed, user's choice); peak caps = Hold;
  Pre / Post / Overlay as on the line, "before" = level minus the EQ's
  power-averaged gain over the band; tests `bar_*` in `spectrum.rs`), `heat` (level =
  brightness of a full-height stripe), `split` (inside the graph, nothing moves: the line or the bars
  (whichever of the two was picked last, `levelView` in the store; never both) above the 0 dB middle
  line, heat below it, or the other way round when swapped; `lineBox()`). The graph
  always has a red dBFS scale on its left (`AnalyzerScale`, never hidden);
  in split view it covers only the line's half. Bars use the same 0 … -84
  window (untilted; only the scale's title changes). In line and bars view (and split's
  line half) the pointer crosshair shows that level in red. Before/after (line view): the captured
  sound is AFTER Equalizer APO (measured: a cut shows in the analyzer). When
  our EQ is the one applied (desktop: CorvidEQ on and not bypassed), "before"
  = captured − our curve (bands + preamp) per column. Drawn: before = red
  line, after = cyan line, shared area = violet (`sharedColor()`, red and
  cyan blended the long way round, through magenta), cyan band where the EQ
  boosts, red band where it cuts (`lines` = overlay). With Auto on, after
  never rises above before (the preamp keeps the curve's peak below 0 dB): a
  boost is a smaller gap, and the gap is exactly the dashed "what you hear"
  curve. Tried and rejected (user's choice): an azure "after" line as the main
  one, with red stepping back. A Pre / Post / Overlay
  button (one box, click = next; `lines` in the store, shown only while our EQ is applied, line and
  split views) picks before only, after only, or both; peak hold follows the
  lines shown (overlay: a red and a cyan hold line). Otherwise a single red line.
  After the mode buttons and Pre / Post: Hold (line, split) and the heat sensitivity
  (`HeatSensitivity`, heat and split: a power curve `heatCurve()`, middle =
  linear, down = only strong parts glow, up = quiet parts lifted; the control
  is a tiny plot of it). Heat has its own Pre / Post button before that
  (`heatLines` in the store, default post; only while our EQ is applied). It
  picks the sound only, never the palette (user's choice: in heat, color isn't
  pre or post, unlike the lines). No overlay: a stripe has one color per
  frequency. Relative, not absolute (user's choice): pre and post share one
  window, topped by whichever of the two is louder, so flipping them shows
  exactly what the EQ did (a cut dimmer, a boost brighter, Auto's headroom a
  touch dimmer overall) and the louder one still reaches the top color.
  View settings aren't EQ edits: controls take `undoable={false}`, so they
  never add undo steps.

## UI interaction contract

| Input | Effect |
|---|---|
| Drag dot | left/right = frequency (log), up/down = gain; Shift = fine |
| Wheel on dot | Q; Shift = fine |
| Double-click dot | reset gain to 0 and frequency to its home (`resetGainFreq`, Q kept) |
| Click dot / empty graph | select band / deselect (Esc too) |
| Right-click dot | menu: filter type, on/off, solo, reset gain / gain + frequency / band, remove |
| Band panel: fader / Freq knob / Q knob | wheel = step, drag up/down = sweep, double-click = reset; Shift = fine |
| Band panel: shape button | click = dropdown of filter types (More… = the rest); wheel = cycle the main list |
| Band panel: right-click shape button or fader | band menu (`BandMenu`): solo, mute, move left / right, reset gain, reset band (gain 0, home Hz, default Q), remove |
| Level column: fader / AUTO | preamp (wheel, drag; double-click = back to Auto) / auto level on/off |
| Level column: right-click fader | menu (`LevelMenu`): show / hide the level line (dashed "what you hear" curve), Auto on/off, Auto headroom (0 / 1 / 3 dB), set to 0 dB |
| Band counter (top bar) | − / + inside the box = one band per click, wheel or drag up/down = add / remove from the end, click the number = type (1…20 bands) |
| Readout Hz / dB / Q (selected band) | wheel or drag up/down = step (Shift = fine), click = type |
| Delay fields (bottom bar) | wheel or drag up/down = step (Shift = fine), click = type |
| Balance knob (bottom bar) | wheel, drag up/down; double-click = center; Shift = fine |
| Delete | remove the selected band |
| Power button (top bar, left) | CorvidEQ on/off (desktop: Equalizer APO switch; browser: bypass) |
| Ctrl+Z / Ctrl+Y | undo / redo · B = bypass on/off (also the Bypass button, bottom bar, desktop) |
| Heat button, while Heat is on | switch palette: Fire (red to yellow) / Ice (blue to white) |
| Split left / right EQ (source picker's list, desktop) | a left and a right EQ / back to one (asks first if they differ) |

## Design language

Audience: non-experts who should have fun shaping sound; the app is also
meant to teach (e.g. the region names: Sub bass … Air).

### Theme

Colors live in `src/ui/theme/theme.ts` (pure data), in three groups. Only
the UI theme is pickable (Settings → Appearance: Dark (default) or CorvidEQ,
`uiTheme` in `state/settings.ts`). The analyzer and the band rainbow are
fixed, the same in every theme (`ANALYZER`, `BANDS`; user's choice). There
is no palette editor, no palette files and no import / export (removed,
user's choice: not essential to an EQ). A new theme = one more entry in
`UI_THEMES`. Older saved state: the old palette store's UI pick
(`corvid-eq-palettes`) is read once, `legacyUiTheme()`.

- **UI theme** (a mode + 3): Mode (Dark / Light, `UiMode`), Neutral,
  Primary accent, Secondary accent (keys `neutral`, `primary`, `secondary`).
  Everything else is worked out by `resolveUi()` (`active.ts`), the way
  Material Design builds a theme from one seed color: the neutral's hue and
  colorfulness (its lightness doesn't count) give the window and surfaces
  and the three text tones (fixed lightness per mode, a tint: text 10% of
  its colorfulness, surfaces 3% (`SURFACE_TINT`), the window 0, a plain
  gray (`BACKGROUND_TINT`), so a colorful neutral doesn't flood the big
  areas) and the frame (full colorfulness). Dark's neutral is a pure gray
  (borders, grid, surfaces and text without any color; its cyan is its own,
  `secondaryHue: 'own'`, since a gray has no hue); CorvidEQ's is red. Danger is a fixed red
  (`DANGER`; like Material's error color, not themed). The accents, too,
  give only hue and colorfulness: the mode sets their lightness, so they
  always stand out from the window (each hue at its most vivid lightness,
  kept in the mode's readable range, `accentTone()`). `secondaryHue:
  'opposite'`: the secondary accent's hue is the neutral's + 180°, its
  colorfulness its own (`secondaryKey()`).
- **Analyzer** (fixed; the lines and the heat view are fully separate,
  user's choice): `analyzer` (the spectrum / "before" line, the meter's red
  LEDs, its labels), `afterEq` (the "after" line), `heat` (quiet and medium
  heat), `loudest` (near the top of the heat ramp, `SIGNATURE_YELLOW`),
  `hottest` (its very top, a warm white), `heatIce` (the heat view's Ice
  palette).
- **Bands** (fixed): first = last band color, so the whole wheel is spread
  over the band count (up to 20: neighbours get close, hover tells them
  apart). Rainbow (band colors) is only for band identity: node, thumb,
  fill, number, shape icon.

| Role (key) | CSS | CorvidEQ | Used for |
|---|---|---|---|
| Frame (from Neutral) | `--base-rgb` | red | edges (incl. fader outlines), grid, scrollbars, hover |
| Secondary accent (`secondary`) | `--accent-rgb` | cyan | EQ curve, keyboard focus, editable numbers, scales (dB, frequency), preset name |
| Primary accent (`primary`) | `--selected-rgb` | yellow (`#F3F200`; the signature `#FFF000`, `SIGNATURE_YELLOW`, is the icon's and sits near the top of the heat's Fire palette) | on / chosen / main action |
| Danger (worked out, fixed red) | `--danger-rgb`, `--warning` | red | warnings and errors only: delete confirmations, Restore, error dots, device / file warnings |
| Neutral (`neutral`) | `--bg`, `--surface`, `--surface-raised`, `--text*`, `--base-rgb` | red | the key color: tints panels (level 1: bottom bar, band panel, settings sections), things on a panel (level 2: buttons, inputs, fader bars) and text; is the frame. The window (level 0) is plain gray. |

- Clickable things get a slightly brighter red outline (`--edge-button`)
  than boxes that only frame (`--edge`).
- Everything else is DERIVED (border strengths, hover, grid, number fields,
  tints, curve and scale shades, faint text, the violet shared area,
  heat-ramp middle), in `index.css` (`:root` block) and `ui/theme/active.ts`.
  Don't add a theme color when it can be derived; never hard-code a color.
- Derived by OKLCH math (`active.ts`, set by `applyTheme`; results go through
  `fitGamut()`: too colorful for the screen = less colorful, same hue and
  lightness, never clamped per channel):
  - Outlines `edgeColor()`: opaque, frame laid over the surface, `--edge`
    0.24 < `--edge-button` 0.34 < `--edge-strong` 0.43 < `--hover` 0.75 of the
    way. Grid lines stay see-through (`--grid*`, `--zero-line`): they're drawn
    over the analyzer.
  - Colored small text `labelColor()`: lightened toward the text's lightness,
    85% colorfulness, hue turned toward yellow (`--scale` 35% / 4°,
    `--curve` 25% / 4°).
  - `--text-faint` `faintText()`: halfway between background and text.
- `applyTheme()` writes the colors as CSS variables before first paint
  (`main.tsx`; `setUiTheme()` re-applies on change).
  Code that draws colors itself uses `bandColor()`, `spectrumColor()`,
  `afterColor()`, `sharedColor()`, `heatColor()`, `heatIceColor()` from `ui/theme/active.ts`.
- Heat ramps, two palettes (`heatPalette` in the store, default Ice; clicking
  the Heat button while it's on switches): Fire: invisible → Heat → Heat:
  loudest (red → orange → yellow), blended in OKLCH (`mixLch()`: hue the short
  way, through orange), then a warm white (`hottest`) from 97% up, where Ice
  reaches white too. Fire climbs in even-looking steps. Ice (`heatIce`, `heatIceColor()`): deep blue → azure →
  icy blue → white. It avoids cyan on purpose: a ramp through cyan made the EQ
  curve (cyan) nearly vanish. The heat window follows the loudest recent level,
  so the loudest part always reaches the top color.
- **No glows, no decorative effects** (user's choice): no glow strokes,
  glowing `box-shadow` / `text-shadow`, no background gradients. The window
  background is flat `--bg`. States show through color and line weight
  (pushed toward white, thicker outline, fuller fill). **No blur filters**
  (`filter: drop-shadow`, `blur`, `backdrop-filter`): Chromium draws them on
  the CPU and the graph repaints on every hover and drag. (One exception:
  `grayscale` while bypassed, see above. Menus keep a plain drop shadow.)
- The analyzer's colors are its own, not the UI theme's; in CSS
  `--analyzer-rgb`.
- Tones (`tonesFor()` in `active.ts`): every worked-out UI color has a
  fixed OKLCH lightness per mode. Dark: window 0.145, `--surface` 0.175,
  `--surface-raised` 0.215 (wide enough steps to tell the levels apart), frame 0.62, text 0.93, secondary text 0.75,
  danger 0.68. Light: 0.97, 0.94, 0.91 (levels get darker going up,
  Material's way), frame 0.5, text 0.25 / 0.45, danger 0.52. Accents
  (`accentTone()`): the lightness where their hue can be most colorful (the
  gamut's cusp, `cuspLightness()`: yellow nearly white, blue quite dark),
  clamped to 0.7…0.931 (dark) or 0.45…0.6 (light). One fixed tone for all
  hues left everything but yellow and cyan pastel. A color moved to another
  tone keeps its hue and its colorfulness as a share. Outlines follow
  by themselves (`edgeColor()`, surface → frame): lighter than the panel in
  dark mode, darker in light (true of both kinds of theme, hence the mode).
  `--on-selected` (text on a yellow button) = window or text, whichever
  differs more in lightness from the primary accent (`farther()`). Not yet
  light-proof: CSS mixes toward black or white in `:root` (`--field-bg`,
  "toward white" states). `glassFor()` turns each surface level into the
  most see-through color that looks exactly like it on the level below, so
  panels stay translucent over the graph and never stack. Controls use
  level 2, big areas level 1.

### Interaction states (one standard everywhere)

- Outlines are `--line` thick (2px).
- Corners are sharp everywhere (boxes, buttons, menus, the graph). Only
  fader parts, knobs and the power button are round.
- Band head: just the shape button, 8px above the fader top (no number
  button: on/off is "Mute" in the band menu; user's choice).
- Hover: the outline turns a slightly brighter red (`--hover`, the same as a fader bar's hover; user's choice); backgrounds don't
  brighten. On/chosen: outline in `selected` (yellow).
- Band controls never get a hover outline. Band columns: no hover outline
  (the band lights up on the graph instead). Fader bar: its red outline gets
  a little brighter (the dB scale does the same). Knobs: no outline.
- Faders: plain background, subdued red outline like every edge. Only the
  thumb and the fill (distance from 0 dB) use the band's color.
- Hover on any band control (shape button, number, fader, knob): its
  rainbow parts get brighter (`--band-hot`); the same effect on all of them. Shared rules
  in the "Hover on a band control" block of `index.css`.
- Normal buttons use `--text-dim` text.
- Panel controls have no dead space: each knob/fader's hit area fills its
  whole cell and half the gap around it; the visible part sits inside.
- Reuse the shared rules in the "Interaction states" block of `index.css`
  for new controls instead of inventing new ones.
- Settings page: every setting is a `Row` (label + one-line description
  left, control right) inside a `Section`: one large surface box per
  category (`--surface`, no outline, yellow `selected` heading inside). No
  lines between rows or sections (user's choice), no badges. Buttons there are the app's one boxed button
  (`common/Button`), exactly as in the bottom bar. While it's open the EQ view is unmounted
  and the capture paused (`setCapturePaused`). 2–3 choices = `Segmented`, 4+ = `Select`. Sentence
  case. New settings use the primitives, never bespoke CSS.
- Editable numbers have ONE look (`.num-field`, "Editable numbers" block in
  `index.css`, component `NumberField`): a dark box (`--field-bg`) with cyan
  digits; hover = the box turns dark cyan, NO cyan outline (user's choice;
  the one place a background changes on hover, on purpose: it says "you
  can type here"); typing = yellow outline. Any new typeable number uses
  it. (The readout's band number is NOT typeable: user's choice.)

### Shapes and type

- Shapes are translucent; only the colored marks (rings, arcs, icons, thumb
  outlines) are fully opaque.
- Knobs are a 270° arc only (no pointer, no cap). Faders are a wide
  translucent bar with a circle inside; the whole bar is the hit area.
- Font: Segoe UI by default (Windows' own). Settings → Appearance also offers
  Oxanium (bundled via `@fontsource`, OFL; always used for the app's name,
  `--font-brand`) and Cascadia Code (Consolas fallback); Segoe UI and Cascadia
  Code come installed with Windows, each listed by its real name (`ui/theme/fonts.ts`;
  no custom font, user's choice). Sentence case labels.
  Fonts must be OFL or similar: freeware "desktop" licenses usually forbid
  embedding in apps. Sizes are tokens: `--fs-label`, `--fs-body`, `--fs-node`.

## Conventions

- TypeScript strict + `noUncheckedIndexedAccess`. No `any`.
- Comments explain *why*, aimed at a reader learning the codebase.
- Do not name other Equalizer APO front-ends anywhere in code, UI or docs.
- License: MIT. Don't add dependencies with incompatible licenses.
