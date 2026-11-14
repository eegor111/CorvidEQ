# Brief: a third analyzer view, Bars

A plan agreed in conversation, to implement in a fresh session. Read
`AGENTS.md` (analyzer, display modes, theme) and `docs/analyzer.md` first.

## What it is

A real-time analyzer in **1/3-octave bars**, the standard studio kind. Each bar
is the **total energy** in its band, so a tone reads its true level and music
(or pink noise) reads level, with **no tilt and no trim**. It's the most honest
of the three views: coarser than the line, but nothing in it is made up.

## Bands

- ISO 266 / IEC 61260 third-octave bands. Exact centres `1000 × 10^(n/10)`,
  edges `centre × 10^(±1/20)`; labels use the nominal names
  (31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800,
  1k, 1.25k, 1.6k, 2k, 2.5k, 3.15k, 4k, 5k, 6.3k, 8k, 10k, 12.5k, 16k, 20k).
- **Start at 31.5 Hz** (or 25). The 20 Hz band is narrower than one FFT bin
  (~4.6 Hz vs ~5.9 Hz), so it would be guessed, not measured. The lowest
  bands kept still span only 1–2 bins: fine, but say so in `docs/analyzer.md`.
- Compute edges from the device's real sample rate (44.1 vs 48 kHz changes
  bin spacing).

## Measurement (Rust, `spectrum.rs`)

- **Sum power** (|X|² of every bin whose centre lies inside the band's edges),
  never take the loudest bin or the average. Then dB.
- **Both FFTs, chosen per band, no blend.** A band needs several bins:
  long FFT (8192, ~5.9 Hz bins) for low bands, short FFT (2048, ~23 Hz) once
  a band spans at least ~4 short bins (third-octave width ≈ 0.23 × centre,
  so from about 400 Hz up). Each band reads from one FFT only, so there's no
  step inside a bar.
- **Power-correct normalisation** for each window (divide by the sum of the
  window's squared values, i.e. account for its noise bandwidth). Done right,
  both FFTs give the same band level for tones AND noise, so the line view's
  noise fix (`Resolution::fix`, per grid point) must NOT apply here: sum
  the raw bins. The pink-noise and sine helpers in `spectrum.rs`'s tests
  can be reused for the checks. Verify with a synthetic sine at a
  known dBFS (reads that level in its band) and pink noise (reads level
  across bands).
- No +3 dB/octave tilt.
- Rise instant, fall smoothed with the same `FALL_SMOOTHING` as the line.
- Send ~29 band values per frame alongside the 512-point grid (cheap), e.g.
  a new field in `Frame`.

## Drawing (TS, `ui/graph/Spectrum.tsx` or a sibling)

- Smooth bars (not LED segments: the output meter stays the app's one LED,
  classic-mixer-colors element), a small gap between bars, each bar spanning
  its band on the log frequency axis.
- **Peak cap** = Hold: a thin marker at each bar's recent maximum, falling
  slowly.
- Colors from the fixed analyzer palette (`spectrumColor()`, `afterColor()`,
  `sharedColor()` in `ui/theme/active.ts`), never the UI theme.
- **Pre / Post / Overlay** (the existing `lines` button, shown when our EQ is
  applied): before = red bars, after = cyan bars. Overlay: the shared part
  (up to the shorter bar) violet, the tip above it cyan where the EQ boosts,
  red where it cuts, the same meaning as the line overlay. Peak caps follow
  the bars shown: both in overlay, the cyan one fainter.
- "Before" per band = captured band level − the EQ's gain over that band
  (bands + preamp; average the curve's LINEAR power across the band's
  frequencies, then dB). Note in the docs: the tip is essentially the EQ
  curve in bar form, weighted by where the music sits in the band.
- The left analyzer scale and the pointer's level readout must show the bars'
  own scale (true dBFS, no tilt) while Bars is on.

## Controls

- Its own button in `GraphTools`, next to Line and Heat (a new
  `BarsViewIcon` in `ui/common/icons.tsx`). `display` in the store gains
  `'bars'`.
- Split = Heat in one half plus **whichever of Line or Bars was used last**
  (store it, e.g. `levelView: 'line' | 'bars'`); clicking Split again still
  swaps the halves. Line and Bars never share a split (both show level as
  height).
- Options that apply: Hold (peak caps), Pre / Post / Overlay.

## Done when

- `npm run build` passes; Rust changes compile (let the user's `tauri dev`
  build it).
- A synthetic sine and pink noise read as described above.
- `AGENTS.md` (display modes, UI folders) and `docs/analyzer.md` (a Bars
  section: what it promises, the lowest bands, hard band edges vs analogue
  filters ≈ a fraction of a dB) are updated.

## Not part of this

- Pre / Post for the heat view (cheap, agreed it's possible; separate task).
- An analyzer "response" setting (fast / smooth fall); separate idea.
- The single / dual FFT setting (planned next, see the top of
  `docs/analyzer-calibration.md`). Keep the per-band FFT choice in one
  place so that setting can later switch every band to the long FFT.

## Already done (calibration, 2026-11-03)

Levels are true dBFS now (a sine of X dBFS reads X on a bin), the line has
a per-point noise fix (`Resolution::fix`), and `spectrum.rs`'s tests have
a pink-noise generator (`pink`), a sine generator (`sine_at`) and helpers
(`analyzed`, `mean_per_point`, `third_octaves`) to reuse for the bars'
checks. The UI's level window is 0 … -84 dBFS.
