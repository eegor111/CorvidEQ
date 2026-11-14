# Analyzer calibration: brief

> **Done (2026-11-03).** What was measured and decided (pink noise, two
> seeds, de-tilted):
>
> | | before | after |
> |---|---|---|
> | -12 dBFS sine, 250 Hz | -26.6 | -13.0 (on a bin: -12.000) |
> | short − long, noise | +7.1 (trim was 4.5) | fixed per point |
> | slope 500 Hz–1 kHz | +2.44 dB/oct | -0.10 |
> | worst point 250 Hz–16 kHz | +4.0 (3.8 kHz) | -0.34 |
>
> The user chose "noise-flat everywhere" over "handover only": instead of
> one trim, each FFT measures white noise at startup and every grid point
> gets its own fix (`Resolution::fix` in `spectrum.rs`), because noise also
> rises where a point takes the loudest of many bins (+1.3 dB step at
> ~3.5 kHz, creeping to +2.7 at 16 kHz). Cost: lone tones read low (~3 dB
> at 700 Hz, ~7 at 2 kHz, ~10 at 16 kHz), and a tone between two bins up
> to 2 dB low. UI window now 0 … -84 dBFS, `HEAT_TOP_MIN` -56. Tests:
> `pink_reads_flat`, `sine_on_a_bin_reads_its_level`,
> `sine_reads_its_level_plus_fix`, `sine_levels_are_linear`; numbers:
> `cargo test --lib pink_report -- --nocapture`.
>
> **Planned, in this order:**
> 1. **Bars view** (done, `docs/bars-view.md`): the true meter (tones AND noise
>    read their real level), the one professionals trust for numbers.
> 2. **Single / dual FFT setting** (done: Settings → Analyzer; Single keeps the long FFT's own noise fix, checked by `pink_reads_flat` in both modes; user's idea): Settings →
>    Analyzer, a `Segmented` "Dual" (now: fast highs, tuned for dense
>    sound) / "Single" (8192 points everywhere: 4x finer detail in the mids
>    and highs, so chords separate in the line and the heat view, and tones
>    read their true level; highs react ~4x slower). Saved in
>    `state/settings.ts`, passed to `start_spectrum`; in Rust, single =
>    the long FFT only (`short_share` all 0). Open question for that task:
>    in Single, apply the long FFT's own noise fix (noise flat, tones up to
>    ~3 dB low toward 16 kHz) or none (tones true, noise ~3 dB high there);
>    measure both with `pink_report` / `sine_reads_its_level_plus_fix`
>    first. Bars could use the long FFT for every band in Single.
>
> The rest of this file is the original brief.

Goal: the analyzer reads true, standard levels, so a sine of X dBFS reads X
(the convention REW and pro analyzers use), and pink noise reads flat. It's
calibrated once, in code, and kept right by automated tests. There's no
calibrate button for users (decided): loopback is digital, so the correct
reading is the same on every PC, and a button could only record user setup
mistakes as "calibration".

**The user's requirement: real numbers, minimal effort on their end.** No
listening tests, no screenshots, no manual tools. Everything is measured in
code (Rust unit tests that generate the signals and run them through the
real analyzer code), and the agent runs the tests, reads the numbers and
reports them. This is as real as a measurement: loopback hands the analyzer
the exact digital samples, so a signal generated in code goes through
exactly the same math as music does. The user's only job is to look at the
app afterwards and say whether it looks right.

## Where things stand

The analyzer (`src-tauri/src/spectrum.rs`, see AGENTS.md "Spectrum") now has:

- two FFTs of the same samples at 60 fps: 8192 points for the bass, the
  newest 2048 for the mids and highs, blended in dB over 500 Hz–1 kHz
  (`HANDOVER_HZ`);
- lopsided Blackman windows (`NEWEST_FADE`, `SHORT_FADE`), instant rises,
  smoothed falls (`FALL_SMOOTHING`);
- `SHORT_TRIM_DB = -4.5`: the short FFT's noise read ~4.5 dB higher (4x wider
  bins), which drew a fake treble shelf on pink noise (seen in the app). The
  trim keeps dense sound one shape; the cost is that a lone tone at or above
  1 kHz reads 4.5 dB low;
- tests in `spectrum.rs` (`tone_reads_the_same`, `noise_difference`) that
  compare the two FFTs to each other, but not to absolute dBFS.

The UI adds a +3 dB/octave display tilt pivoting at 1 kHz
(`src/ui/graph/Spectrum.tsx`, `TILT_DB_PER_OCT` and the `tilt` in the
column setup), so pink noise reads flat. The left scale is labelled dBFS
(`AnalyzerScale` in `AxisStrips.tsx`).

## The expected error

`Resolution::new` scales magnitudes by `0.42 / sum(window)`. That copies the
browser's AnalyserNode: a sine of peak amplitude A reads A · 0.21, which is
**13.6 dB below its dBFS level**. A -12 dBFS sine reads about -25.6 on a
scale that says dBFS. This is worked out from the code, not measured yet;
manual check 2 below confirms it.

## Changes to make

0. **Measure the real trim (do this first).** `SHORT_TRIM_DB = -4.5` is a
   rough single number from the white-noise `noise_difference` test, which
   gave short minus long = +6.3 dB at 500 Hz–1 kHz, +4.4 at 1–4 kHz and +4.7
   at 4–16 kHz. The 6.3 in the blend zone matches the ~6–7 dB step the user
   saw on pink noise in the app, so one number leaves a ~2 dB bump around
   the handover. Replace the guess with a measurement:
   - generate **pink noise** in the test (white noise from the existing
     fixed-seed xorshift through a pinking filter, e.g. Paul Kellet's
     economy filter; no new dependency), long enough for a steady average
     (e.g. 10 s, skip the first frames while smoothing settles);
   - run it through both `Resolution`s exactly as `Analyzer::analyze` feeds
     them (same newest sample, 60 fps hop);
   - print short minus long **per third-octave band** from 400 Hz to 16 kHz
     (`cargo test --lib spectrum -- --nocapture`);
   - if the differences are flat within ~0.5 dB from 1 kHz up, set
     `SHORT_TRIM_DB` to their mean. If they vary (the 500 Hz–1 kHz figure
     suggests they do, because the long FFT switches from interpolating to
     "loudest bin" at ~870 Hz), replace the constant with a per-grid-point
     correction worked out by the same code (at startup, or as a table
     generated by the test), and check the blend zone reads flat;
   - **test the handover thoroughly** (the user's condition for option A):
     run pink noise through the full `Analyzer::analyze` (the blended,
     trimmed output the UI gets), average over frames, and look at every
     grid point from 250 Hz to 4 kHz, not just band averages. Pink noise
     on the untilted output falls 3 dB per octave, so subtract that
     (3·log2(f / 1 kHz)) and the rest must be flat. Check for both a
     **slope** (fit a straight line per octave across 500 Hz–1 kHz; it must
     be under ~0.5 dB per octave) and a **bump or step** (no point more
     than ~0.5 dB from the flat level). Also check the edges where each
     FFT switches from interpolating to "loudest bin" (~870 Hz long,
     ~3.5 kHz short): a jump there is the same kind of error;
   - correct whatever it finds (per-grid-point correction if needed) and
     re-run until it passes; repeat with a second noise seed to make sure
     the correction isn't fitted to one random signal;
   - keep these checks as tests that fail on a slope, bump or step over
     ~0.5 dB, so a later change to the windows, the trim or the grid can't
     silently break it.
   Report the measured numbers to the user in a short table (before and
   after the correction).

1. **Scale so a sine reads its dBFS level.** In `Resolution::new` use
   `scale = 2 / sum(window)` (a sine of amplitude A peaks at A·sum/2), so
   amplitude A reads 20·log10(A) dBFS. Everything moves up 13.6 dB. Then
   check what depends on absolute levels:
   - the line view's visible window (`Spectrum.tsx`, the "Visible level
     window of the line view" constant) and the analyzer scale's labels
     (-12 … -96): music must still fit;
   - `HEAT_TOP_MIN` and any other absolute dB constant in `Spectrum.tsx`;
   - `FLOOR_DB` (-160) is fine;
   - the "before" line (captured minus our curve) is relative, so unaffected.
2. **Tests for absolute levels** in the `spectrum.rs` tests module, going
   through `Analyzer::analyze` (the blended output, no tilt; the tilt lives
   in the UI):
   - a -12 dBFS sine at 250 Hz (long FFT only) reads -12 ± 1 dB;
   - a -12 dBFS sine at 4 kHz (short FFT only) reads -12 + `SHORT_TRIM_DB`
     ± 1 dB;
   - steps of -6 / -24 / -48 / -72 dBFS move the reading by exactly that
     much (linearity);
   - the pink-noise handover test from step 0.
   The ±1 dB is scalloping (a tone falling between bins), which both FFTs have.
   Expected tone readings in these tests are untilted: below 500 Hz the
   level itself, from 1 kHz up the level plus the measured trim.
3. **Document the convention** in one line of the README and in AGENTS.md:
   "A sine of X dBFS reads X below 500 Hz; the display tilts +3 dB/octave
   around 1 kHz so pink noise reads flat; above 1 kHz tones read 4.5 dB low
   so dense sound keeps one shape."

### Decided: A for the line, B for the bars

The 1 kHz pivot, the natural reference frequency, sits in the trimmed
region: a -12 dBFS sine at 1 kHz reads 12 dBFS plus the trim. Two ways to
handle it were weighed:

- **A. Accept and document it** (the convention above).
- **B. Fractional-octave power summation** (what REW's RTA mode does): each
  band sums the power of all bins in it instead of taking the loudest bin.
  A tone then reads its true level and noise its band power in BOTH FFT
  sizes, so no trim and no tilt are needed. The catch: the line's 512
  points are narrower than a bin over much of the range (below ~3.5 kHz in
  the short FFT, ~870 Hz in the long one), so there's nothing to sum.

**The line view uses A** (this task). **The bars visualizer** (being
designed in a separate conversation) **uses B**: bars are 1/3 or 1/6
octave wide, so every band holds several bins in both FFTs and summation
works cleanly there. It belongs in Rust (it needs the bins) and adds only
~30–60 numbers per frame. Consequence to document: a tone reads the same in
both views, but noise reads higher on the bars (a band sums many bins'
worth of power) than on the line (about one bin). That's normal (REW's RTA
and FFT views differ the same way); nobody should "fix" it.

**Condition from the user for A:** the handover must be tested thoroughly,
in code: the line must show no slope or bump across 500 Hz–1 kHz on pink
noise, and whatever the test finds gets corrected (see step 0).

## Optional manual check (NOT part of this task)

Only if the user asks for it later. The tests above already cover the
math; this would only confirm the Windows path (loopback, the left/right
average, the device) matches what they assume. Don't ask the user to do it.

Tools: **REW** (free; its generator plays exact dBFS sines, pink noise and
sweeps) or Audacity-generated 48 kHz 32-bit float WAVs. Not YouTube (lossy,
loudness-normalized, cut off ~16 kHz).

Setup: EQ bypassed (B); Windows and player volume 100%; output at 48 kHz;
enhancements / spatial sound off; **mono** signals (the noise fix was measured
on one signal, and the analyzer averages left and right by power); stay at or
below -1 dBFS (Windows' limiter).

| # | Signal | Checks | Correct result |
|---|---|---|---|
| 1 | 1 kHz sine, -12 dBFS | the chain, via the level meter (no FFT) | meter -12 dBFS |
| 2 | 250 Hz sine, -12 dBFS | absolute level | line peaks at -18 (-12, tilt -6) |
| 3 | 250 Hz sine at -6 / -24 / -48 / -72 dBFS | linearity | moves exactly that much |
| 4 | sines at octave centres, -12 dBFS | tone response | table below, ±1 dB |
| 5 | pink noise, -20 dBFS RMS | dense-sound response | level on average (it jitters) |

Expected readings for test 4 (OUTDATED: written for the 4.5 dB trim; the
real expectation is level + tilt + the point's fix, which
`sine_reads_its_level_plus_fix` prints):

| Hz | 31.5 | 63 | 125 | 250 | 500 | 1k | 2k | 4k | 8k | 16k |
|---|---|---|---|---|---|---|---|---|---|---|
| dB | -27 | -24 | -21 | -18 | -15 | -16.5 | -13.5 | -10.5 | -7.5 | -4.5 |

(Formula: level + 3·log2(f / 1000), plus `SHORT_TRIM_DB` from 1 kHz up,
blended in between 500 Hz and 1 kHz.)

Before the fix, test 2 should read about -31.6: that confirms the 13.6 dB
error.

## Things to watch

- The UI's neighbour smoothing (`Spectrum.tsx`, `shown[c] = 0.25·l + 0.5·c +
  0.25·r`, in dB) could lower a very narrow tone peak. Probably small (a grid
  point spans several pixel columns), but check it if test 4 reads low at
  high frequencies.
- Whether loopback includes Windows' volume depends on the device
  (`devices.rs`); the 100% volume setup step sidesteps it.
