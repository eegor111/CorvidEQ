# What you're looking at

CorvidEQ shows two kinds of things: the **EQ curve** (what the app tells
Equalizer APO to do) and the **analyzer** (the sound itself). They make very
different promises, and this page says exactly which ones.

## The EQ curve: exact

The curve uses the same filter math as Equalizer APO (the RBJ Audio EQ
Cookbook), so what you see is the shape that gets applied.

- **Drawn at your output's sample rate** (shown faint under its name, top
  left), as Equalizer APO computes its filters for it: at 44.1 kHz a filter
  set very high (above ~15 kHz) comes out slightly differently than at 48.
  In the browser version, 48 kHz.
- **The graph runs to 22.4 kHz,** a little past the 20 kHz where hearing
  ends (shaded above it), so the top analyzer bar fits. A dashed line marks
  half the output's sample rate (Nyquist, 22.05 kHz at 44.1 kHz) when it
  falls inside the graph: nothing above it can exist in that stream.
- **Two curves.** The solid one is the EQ's shape (bands only) and runs
  through the nodes. The dashed one is what you actually hear: the shape plus
  the Level (preamp). Auto keeps that curve's peak just under 0 dB, so
  boosting doesn't push the sound into Windows' limiter.

## The analyzer: honest, not a measuring instrument

### Where the sound comes from

The analyzer listens to Windows' **loopback** for the output you picked: the
digital mix of every app, after Equalizer APO and after Windows' own limiter,
just before it goes to your speakers or headphones.

The Windows volume slider doesn't move the picture: on outputs where Windows
scales the samples, the app undoes that scaling, so the analyzer and meter read
the same at 10% as at 100%. Muted, or with the slider at zero, they read
silence.

So it shows the signal, **not what reaches your ears.** Your headphones,
speakers and room change the sound after this point, and nothing here can see
that (that would take a measurement microphone).

### How the picture is made

- **Two FFTs of the same audio, 60 times a second.** A long one (8192
  samples, about 6 Hz per step) for the bass, where detail matters, and a
  short one (2048 samples) for the mids and highs, where speed matters: it
  reacts about four times sooner. They're blended over 500 Hz – 1 kHz.
- **Tilted +3 dB per octave** (around 1 kHz). Music has much more energy in
  the bass than in the treble. Without the tilt, every song would slope
  steeply down to the right and the highs would be hard to read. With it,
  typical music (and pink noise) looks roughly level. The left scale's
  numbers include the tilt.
- **Real levels.** A sine of X dBFS reads X in the bass (below 500 Hz),
  before the tilt; checked by tests that generate the sines in code.
- **Tuned for music, not test tones.** Dense sound (music, noise) reads
  higher where the FFT's steps are wider (the short FFT: about 7 dB) and
  where one point of the line covers many steps and shows the loudest
  (rising toward 20 kHz). When the app starts, the analyzer measures this
  on 20 s of noise and corrects every point, so dense sound keeps its
  true shape across the whole range: pink noise reads flat within about
  ±0.35 dB, with no step or slope where the two FFTs meet. The price:
  **a single pure tone reads lower than its true level above 500 Hz:**
  about 3 dB at 700 Hz, 7 dB at 2 kHz, 10 dB at 16 kHz. A tone between two
  FFT steps can also read up to 2 dB low. No one line is right for both
  tones and music at once; this one chooses music.
- **Rises are instant, falls are smoothed**, so hits show at once and the
  picture doesn't flicker.
- **Peak hold** (Hold) is a smoothed outline over recent peaks, a guide for
  the eye, not a precise maximum.

### Before and after

The captured sound is always **after** the EQ. When CorvidEQ's EQ is the one
applied (on, not bypassed), the "before" line is **worked out**: the captured
sound minus our curve. It's an estimate, exact only if nothing else (other
Equalizer APO effects, Windows enhancements) is changing the sound.

### Bars view

Bars is the standard studio analyzer: one bar per **ISO third-octave band**
(25 Hz … 20 kHz, 30 bars, filling the graph), each the **total energy** in its band. That
makes it the one view that reads true numbers for everything: a tone of
X dBFS reads X in its bar, and pink noise reads level across all the bars.
No +3 dB/octave tilt and no noise fix are needed, because summing a band's
power counts a tone and noise the same way in either FFT size. Coarser
than the line, but nothing in it is made up.

- **Which FFT:** a bar reads the long FFT until its band spans at least 4
  bins of the short one (from the 500 Hz band up at 48 kHz), then the
  short one, which reacts sooner (with Settings → Analyzer → FFT "Single":
  the long one for every bar). Each bar reads one FFT only, so there's no
  step inside a bar.
- **Band edges cut through bins:** the first and last bin of a band count
  by the share of them inside it, so noise reads the band's exact width.
- **The lowest bars** (25–80 Hz) hold only 1–3 bins of the long FFT (25 Hz:
  about one). A tone there loses part of its window's skirts outside the
  band and can read up to ~3 dB low (25 Hz: ~4); noise is fine. Boosting
  them would make noise read high, so they're left as measured. There's no
  20 Hz bar: that band is narrower than one bin and would fall below the
  graph's edge.
- **Hard band edges:** a bin belongs to one bar or the next, where a real
  analogue filter bank fades from one into the other. The difference is a
  fraction of a dB; a tone right on an edge splits between two bars, as
  it does with real filters.
- **Noise reads higher on the bars than on the line.** A bar sums many
  bins' worth of noise, the line shows about one bin. A tone reads the
  same in both. That's normal (studio analyzers' third-octave and fine
  views differ the same way), not something to fix.
- **Response:** each bar averages power over 125 ms, rising and falling
  at the same pace (the "Fast" time weighting of sound level meters, as
  studio analyzers do), so tones and noise read their real level. Hits
  show a little later than on the line. The line's "rise at once, fall
  slowly" was left out on purpose: it's a display effect that makes
  flickering sound (noise) rest up to ~1 dB above its real level.
  **Peak caps** (Hold) mark each bar's recent high and fall slowly.
- **Before and after** work as on the line. The "before" bar is the
  captured level minus the EQ's gain over that band (its power averaged
  across the band), so the tip between the two is essentially the EQ
  curve in bar form, weighted by where the music sits in the band.

### Heat view

Heat shows how loud each frequency is **compared to the loudest recent
sound**, not an absolute level: the loudest part is always yellow, whether
the music is quiet or loud. The sensitivity control changes how quiet parts
are lit, not what's measured.

## The level meter

- Shows **peaks** (the bar) and a held peak (the lit segment), after the EQ.
- Never reaches 0 dBFS. Windows runs every output through a limiter after all
  effects, and the loopback is taken after it. Pushed too hard, the sound
  gets squashed (and even turned down) instead of clipping. So the top red
  LED (-0.5 dBFS) means "Windows' limiter is at work", not clipping in the
  usual sense.
- The -3 and -1 dBFS LEDs match Auto's headroom choices (3 and 1 dB).

## In short

- The **curve** is exact.
- The **analyzer** is consistent, fast and tuned to make music easy to read.
  It never invents detail that isn't there, but its numbers aren't lab
  measurements and it can't see your headphones or room.
