//! Live spectrum of whatever the computer is playing, or of an input.
//!
//! How it works:
//! 1. Open an *output* device as an *input*. On Windows, cpal then records
//!    what that device plays ("WASAPI loopback"). Nothing is changed or
//!    written anywhere; we only listen. Which output: the one the user picked,
//!    or Windows' default, re-checked every second so the analyzer follows
//!    when the default changes. The Windows volume is undone as samples
//!    arrive, and mute reads as silence (`OutputVolume` in `devices.rs`).
//!    An input the user picked is simply recorded. Its volume stays in: a
//!    mic's slider often sets real gain before the sound is digitized, so it
//!    changes the recording itself.
//! 2. The audio callback keeps the newest `FFT_SIZE` samples of the left and
//!    the right side in a ring buffer. They are never added together: with a
//!    delay between the channels (balance and delay, `state/stereo.ts`) they
//!    would cancel at some frequencies and draw dips nobody hears.
//! 3. 60 times a second an analysis loop takes those samples and runs two
//!    FFTs per side: all of them (detail in the bass) and only the newest
//!    `SHORT_SIZE` (reacts sooner, for the mids and highs; Settings →
//!    Analyzer "Single" uses the long one everywhere). Each applies a
//!    lopsided Blackman window; the two sides' power is averaged per bin
//!    and turned into decibels.
//! 4. The bins are reduced to `GRID_POINTS` log-spaced frequencies (20 Hz to
//!    20 kHz, the same grid the UI uses), corrected so noise reads flat
//!    (`CALIBRATION_SECS`), the two FFTs blended around `HANDOVER_HZ`, and
//!    sent to the UI over a Tauri channel. A sine of X dBFS reads X in the
//!    bass (below `HANDOVER_HZ`), where no correction applies.
//! 5. The same two FFTs also feed the Bars view: the power of every bin in
//!    each ISO third-octave band (`BAR_BANDS`), summed, so a tone and noise
//!    both read their true level there (no noise fix, no tilt). Sent raw:
//!    the UI averages them over 125 ms (`smoothBars` in spectrum-source.ts).
//! 6. Alongside, the callback measures the left and right level (peak and RMS)
//!    since the previous frame, for the stereo level meter.

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU8, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, SizedSample};
use realfft::RealFftPlanner;
use tauri::ipc::Channel;
use tauri::State;

use crate::devices::OutputVolume;

/// FFT length: 8192 samples ≈ 170 ms at 48 kHz, ~6 Hz per bin.
/// Enough detail in the bass while still reacting quickly.
const FFT_SIZE: usize = 8192;
/// The window's fast fall at the newest end: 512 samples ≈ 11 ms at 48 kHz.
/// Smaller = new sound shows sooner, but loud peaks spread more.
const NEWEST_FADE: usize = 512;
/// The short snapshot for the mids and highs: 2048 samples ≈ 43 ms, ~23 Hz
/// per bin; shows a new hit ~4x sooner than the long one.
const SHORT_SIZE: usize = 2048;
/// The short window's fast fall, the same share of its length as `NEWEST_FADE`.
const SHORT_FADE: usize = 128;
/// Below the first frequency the long snapshot is drawn, above the second the
/// short one; in between (one octave) the two are blended.
const HANDOVER_HZ: (f32, f32) = (500.0, 1000.0);
/// Noise fix. Dense sound (music, pink noise) reads higher where bins are
/// wider (the short FFT: 4x wider, ~7 dB) and where a grid point takes the
/// loudest of several bins (more bins, higher: up to ~5 dB toward 20 kHz).
/// Uncorrected, that drew a fake treble shelf. So each FFT reads this much
/// white noise once, at startup, the way it reads music, and every grid point
/// is corrected to the long FFT's bass level (`Resolution::fix`): dense sound
/// keeps its true shape everywhere. The cost: a lone pure tone reads low
/// where the fix is big (~7 dB from 1 kHz, up to ~10 dB at the top).
/// Measured, not guessed: the `pink_*` tests check it with other noise.
const CALIBRATION_SECS: f32 = 20.0;
const CALIBRATION_SEED: u32 = 0x2545_F491;
/// Frames skipped while the fall smoothing settles when reading noise.
const SETTLE_FRAMES: usize = 20;
/// The fix is averaged over this many neighbours each side, so it follows
/// the trend, not one random signal's ups and downs.
const FIX_SPREAD: usize = 4;
/// Bins this close to 0 Hz are left out when measuring the fix (leakage).
const AWAY_FROM_DC: usize = 16;
/// Number of log-spaced points sent to the UI. Must match the UI (`SPECTRUM_POINTS`).
const GRID_POINTS: usize = 512;
/// The grid spans the graph: 20 Hz to the 20 kHz third-octave band's top
/// edge (22.4 kHz), so the last bar fits. Must match `SPECTRUM_MAX_HZ`.
const GRID_MIN_HZ: f32 = 20.0;
const GRID_MAX_HZ: f32 = 22_387.2;
/// Time between frames sent to the UI: 60 fps, the screen's own pace
/// (16 ms would be 62.5 fps and skip a screen frame every quarter second).
const FRAME_INTERVAL: Duration = Duration::from_micros(16_667);
/// Falling levels keep this much of the previous frame, so the display
/// flows down instead of flickering. Rising levels jump straight up: smoothing
/// those too made every hit show up ~200 ms late. 0.84 per 16 ms frame falls
/// as fast as the old 0.7 per 33 ms.
const FALL_SMOOTHING: f32 = 0.84;
/// Windows sends no loopback data while nothing plays. After this long
/// without data we feed silence so the display falls back down.
const SILENCE_AFTER: Duration = Duration::from_millis(150);
/// Lowest level reported, in dBFS.
const FLOOR_DB: f32 = -160.0;
/// A grid point reads "the loudest bin it covers" only once it is at least
/// this many bins wide (above ~870 Hz at 48 kHz); below, it interpolates.
const LOUDEST_MIN_BINS: f32 = 2.0;
/// Bars view: ISO third-octave bands, centre `1000 × 10^(n/10)` Hz for each
/// n here (25 Hz … 20 kHz, 30 bars, edges 22.4 Hz … 22.4 kHz: the graph's
/// range; the UI has the same list). The 25 Hz band is about one long-FFT
/// bin wide: noise reads right, a tone up to ~4 dB low. No 20 Hz band: it's
/// narrower than a bin and would fall below the graph's 22.4 Hz edge.
const BAR_BANDS: std::ops::RangeInclusive<i32> = -16..=13;
/// A bar reads the short FFT (sooner) once it spans this many of its bins
/// (from the 500 Hz band up at 48 kHz); below, the long one. Fewer bins and
/// a lone tone near the band's middle would lose its window's skirts.
const MIN_SHORT_BINS: f32 = 4.0;

/// Newest samples of each side, oldest overwritten first, plus the stereo
/// level measured since the last frame.
struct Ring {
    buf: [Vec<f32>; 2],
    pos: usize,
    last_data: Instant,
    meter: Meter,
}

/// Left/right level since the last frame: highest peak and sum of squares (for RMS).
#[derive(Default, Clone, Copy)]
struct Meter {
    peak: [f32; 2],
    sum_sq: [f64; 2],
    count: u32,
}

impl Meter {
    fn add(&mut self, left: f32, right: f32) {
        for (i, s) in [left, right].into_iter().enumerate() {
            self.peak[i] = self.peak[i].max(s.abs());
            self.sum_sq[i] += f64::from(s) * f64::from(s);
        }
        self.count += 1;
    }

    /// Peak and RMS per channel in dBFS (0 = full scale).
    fn levels(&self) -> ([f32; 2], [f32; 2]) {
        let db = |x: f32| (20.0 * x.max(1e-9).log10()).max(FLOOR_DB);
        let rms = |i: usize| {
            if self.count == 0 {
                0.0
            } else {
                (self.sum_sq[i] / f64::from(self.count)).sqrt() as f32
            }
        };
        ([db(self.peak[0]), db(self.peak[1])], [db(rms(0)), db(rms(1))])
    }
}

/// One message to the UI: the spectrum plus the stereo level.
#[derive(serde::Serialize)]
pub struct Frame {
    /// dBFS on the shared log grid.
    spectrum: Vec<f32>,
    /// Bars view: dBFS per third-octave band (`BAR_BANDS`), lowest first.
    bars: Vec<f32>,
    /// Left, right peak level in dBFS since the previous frame.
    peak: [f32; 2],
    /// Left, right RMS (average) level in dBFS since the previous frame.
    rms: [f32; 2],
    /// Which side was analyzed (`"L"`, `"R"`, or `None` for both), so the UI drops stale in-flight frames on a switch.
    side: Option<&'static str>,
    /// Which device was captured (id from `audio_devices`); None while none is open.
    device: Option<String>,
    /// Why nothing is captured, when `device` is None.
    problem: Option<String>,
}

impl Ring {
    fn new(len: usize) -> Self {
        Self { buf: [vec![0.0; len], vec![0.0; len]], pos: 0, last_data: Instant::now(), meter: Meter::default() }
    }

    fn push(&mut self, [left, right]: [f32; 2]) {
        self.buf[0][self.pos] = left;
        self.buf[1][self.pos] = right;
        self.pos = (self.pos + 1) % self.buf[0].len();
    }

    /// Copy out in time order (oldest first).
    fn snapshot(&self, out: &mut [Vec<f32>; 2]) {
        for (buf, out) in self.buf.iter().zip(out) {
            let (newer, older) = buf.split_at(self.pos);
            out[..older.len()].copy_from_slice(older);
            out[older.len()..].copy_from_slice(newer);
        }
    }
}

/// Lets a new `start_spectrum` call (e.g. after the UI reloads, or the user
/// picks another output) stop the old loop.
pub struct SpectrumState {
    stop: Mutex<Option<Arc<AtomicBool>>>,
    /// Which channels the analyzer reads (`BOTH`, `LEFT`, `RIGHT`). Here, not
    /// in the capture loop, so it survives a capture restart.
    side: Arc<AtomicU8>,
    /// Linear `[left, right]` gain applied only to analyzer samples before FFT,
    /// to undo speaker balance without altering the post-balance level meter.
    balance_gain: [Arc<AtomicU32>; 2],
}

impl Default for SpectrumState {
    fn default() -> Self {
        let one = || Arc::new(AtomicU32::new(1.0f32.to_bits()));
        Self { stop: Mutex::default(), side: Arc::default(), balance_gain: [one(), one()] }
    }
}

const BOTH: u8 = 0;
const LEFT: u8 = 1;
const RIGHT: u8 = 2;

fn side_name(side: u8) -> Option<&'static str> {
    match side {
        LEFT => Some("L"),
        RIGHT => Some("R"),
        _ => None,
    }
}

/// Analyze only one channel ("L" or "R"), or both when None. A split EQ shapes
/// each side differently, so the UI's "before" line (captured minus the curve)
/// only holds for the side whose curve is on screen. The level meter always
/// shows both. Takes effect on the next frame: no capture restart.
#[tauri::command]
pub fn set_analyzer_side(side: Option<String>, state: State<'_, SpectrumState>) {
    let value = match side.as_deref() {
        Some("L") => LEFT,
        Some("R") => RIGHT,
        _ => BOTH,
    };
    state.side.store(value, Ordering::Relaxed);
}

/// Undo speaker balance on analyzer samples before FFT so the analyzer acts as
/// if tapped pre-balance, leaving the level meter post-balance.
#[tauri::command]
pub fn set_analyzer_balance(left: f32, right: f32, state: State<'_, SpectrumState>) {
    for (dst, v) in state.balance_gain.iter().zip([left, right]) {
        let safe = if v.is_finite() && v >= 0.0 { v } else { 1.0 };
        dst.store(safe.to_bits(), Ordering::Relaxed);
    }
}

/// Start streaming spectrum frames (dB levels on the shared log grid) to the UI.
/// `device`: an id from `audio_devices`, or None to follow Windows' default
/// output (switching along when the default changes). `single`: the long
/// FFT everywhere instead of two (Settings → Analyzer; `Analyzer::single`).
/// Returns once audio capture is running, or with a readable error.
#[tauri::command]
pub fn start_spectrum(
    on_frame: Channel<Frame>,
    device: Option<String>,
    single: bool,
    state: State<'_, SpectrumState>,
) -> Result<(), String> {
    let stop = Arc::new(AtomicBool::new(false));
    if let Some(previous) = state.stop.lock().map_err(|e| e.to_string())?.replace(stop.clone()) {
        previous.store(true, Ordering::Relaxed);
    }

    // The capture stream lives on its own thread; it reports back once it's running.
    let (ready_tx, ready_rx) = mpsc::channel();
    let side = state.side.clone();
    let balance_gain = state.balance_gain.clone();
    thread::Builder::new()
        .name("spectrum".into())
        .spawn(move || run(on_frame, device, single, side, balance_gain, stop, ready_tx))
        .map_err(|e| e.to_string())?;

    ready_rx.recv().map_err(|_| "Audio capture thread stopped unexpectedly".to_string())?
}

#[tauri::command]
pub fn stop_spectrum(state: State<'_, SpectrumState>) {
    if let Ok(mut guard) = state.stop.lock() {
        if let Some(stop) = guard.take() {
            stop.store(true, Ordering::Relaxed);
        }
    }
}

/// How often to check whether the default output changed (or a lost device is back).
const RECHECK_EVERY: Duration = Duration::from_secs(1);

/// One open stream on one specific device: loopback on an output, a
/// recording on an input.
struct Capture {
    _stream: cpal::Stream,
    /// Which device this is (cpal id), sent with every frame.
    device: String,
    sample_rate: f32,
    /// Set by the stream's error callback (device unplugged, format changed…).
    failed: Arc<AtomicBool>,
    /// None on an input: its volume stays in the sound.
    volume: Option<OutputVolume>,
    /// What the audio callback multiplies samples by (an f32's bits; there is
    /// no atomic f32): the Windows volume undone. Re-read every frame.
    gain: Arc<AtomicU32>,
}

impl Capture {
    fn follow_volume(&self) {
        // Unreadable for a moment: keep the last gain.
        if let Some(gain) = self.volume.as_ref().and_then(OutputVolume::undo_gain) {
            self.gain.store(gain.to_bits(), Ordering::Relaxed);
        }
    }
}

fn run(
    on_frame: Channel<Frame>,
    choice: Option<String>,
    single: bool,
    side: Arc<AtomicU8>,
    balance_gain: [Arc<AtomicU32>; 2],
    stop: Arc<AtomicBool>,
    ready: mpsc::Sender<Result<(), String>>,
) {
    let host = cpal::default_host();
    let ring = Arc::new(Mutex::new(Ring::new(FFT_SIZE)));

    // Always open a specific device, even when following the default: then
    // we know exactly which output each frame came from, and its sample rate.
    let target = |host: &cpal::Host| choice.clone().or_else(|| crate::devices::default_output_id(host));

    // Not being able to open an output isn't fatal: the picked one may be
    // unplugged and come back. The loop keeps trying every second and tells
    // the UI why nothing is captured (`Frame::problem`).
    let mut capture: Option<Capture> = None;
    let mut problem: Option<String> = None;
    let mut analyzer = Analyzer::new(48_000.0, single);
    let mut current_side = side.load(Ordering::Relaxed);
    let mut samples = [vec![0.0f32; FFT_SIZE], vec![0.0f32; FFT_SIZE]];
    let mut last_check: Option<Instant> = None;
    // Frames are due on a fixed clock, not "sleep, then work": sleeping a
    // fixed time after the work let every frame run late by however long the
    // work took, so frames arrived unevenly and the display hitched.
    let mut next_frame = Instant::now();
    let _ = ready.send(Ok(()));

    while !stop.load(Ordering::Relaxed) {
        if last_check.is_none_or(|t| t.elapsed() >= RECHECK_EVERY) {
            last_check = Some(Instant::now());
            let broken = capture.as_ref().is_none_or(|c| c.failed.load(Ordering::Relaxed));
            let wanted = target(&host);
            let moved = wanted.as_deref() != capture.as_ref().map(|c| c.device.as_str());
            if broken || moved {
                capture = None; // close the old stream first
                let opened = wanted
                    .ok_or_else(|| "No audio output device found".to_string())
                    .and_then(|id| open(&host, &id, ring.clone()));
                match opened {
                    Ok(c) => {
                        if c.sample_rate != analyzer.sample_rate {
                            analyzer = Analyzer::new(c.sample_rate, single);
                        }
                        capture = Some(c);
                        problem = None;
                    }
                    Err(e) => problem = Some(e),
                }
            }
        }
        next_frame += FRAME_INTERVAL;
        let now = Instant::now();
        if next_frame > now {
            thread::sleep(next_frame - now);
        } else {
            // Fell behind (e.g. reopening a device): carry on from now
            // instead of firing a burst of frames to catch up.
            next_frame = now;
        }

        if let Some(c) = &capture {
            c.follow_volume();
        }

        let sample_rate = analyzer.sample_rate;
        let mut meter = Meter::default();
        if let Ok(mut r) = ring.lock() {
            if r.last_data.elapsed() > SILENCE_AFTER {
                // Nothing playing: shift in silence for one frame's worth of time.
                let n = (sample_rate * FRAME_INTERVAL.as_secs_f32()) as usize;
                for _ in 0..n {
                    r.push([0.0, 0.0]);
                }
            }
            r.snapshot(&mut samples);
            meter = std::mem::take(&mut r.meter);
        }

        let (peak, rms) = meter.levels();
        let device = capture.as_ref().map(|c| c.device.clone());
        // Undo Equalizer APO's speaker balance after reading the meter so the
        // analyzer reads pre-balance while the meter stays post-balance.
        for (buf, atomic) in samples.iter_mut().zip(&balance_gain) {
            let k = f32::from_bits(atomic.load(Ordering::Relaxed));
            if (k - 1.0).abs() > 1e-6 {
                for s in buf.iter_mut() {
                    *s *= k;
                }
            }
        }
        let [left, right] = [samples[0].as_slice(), samples[1].as_slice()];
        let next_side = side.load(Ordering::Relaxed);
        if next_side != current_side {
            current_side = next_side;
            analyzer.clear_smoothing();
        }
        let spectrum = match current_side {
            LEFT => analyzer.analyze(&[left]),
            RIGHT => analyzer.analyze(&[right]),
            _ => analyzer.analyze(&[left, right]),
        };
        let frame = Frame {
            spectrum,
            bars: analyzer.bars(),
            peak,
            rms,
            side: side_name(current_side),
            device,
            problem: problem.clone(),
        };
        // Sending fails once the UI is gone (window closed or reloaded): stop.
        if on_frame.send(frame).is_err() {
            break;
        }
    }
}

/// Open this device, feeding its samples into `ring`. `build_input_stream`
/// does the right thing for both: loopback on an output, a recording on an input.
fn open(host: &cpal::Host, id: &str, ring: Arc<Mutex<Ring>>) -> Result<Capture, String> {
    let device = crate::devices::find_device(host, id).ok_or("That audio device isn't available")?;
    let input = device.supports_input();
    let supported = if input { device.default_input_config() } else { device.default_output_config() };
    let supported = supported.map_err(|e| e.to_string())?;
    let sample_rate = supported.sample_rate() as f32;
    let channels = supported.channels() as usize;
    let config = supported.config();
    let failed = Arc::new(AtomicBool::new(false));
    let volume = if input { None } else { OutputVolume::open(&device) };
    let first_gain = volume.as_ref().and_then(OutputVolume::undo_gain).unwrap_or(1.0);
    let gain = Arc::new(AtomicU32::new(first_gain.to_bits()));

    let stream = match supported.sample_format() {
        SampleFormat::F32 => build::<f32>(&device, config, channels, ring, failed.clone(), gain.clone()),
        SampleFormat::I16 => build::<i16>(&device, config, channels, ring, failed.clone(), gain.clone()),
        SampleFormat::I32 => build::<i32>(&device, config, channels, ring, failed.clone(), gain.clone()),
        other => Err(format!("Unsupported sample format: {other:?}")),
    }?;
    stream.play().map_err(|e| e.to_string())?;
    Ok(Capture { _stream: stream, device: id.to_string(), sample_rate, failed, volume, gain })
}

fn build<T>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    channels: usize,
    ring: Arc<Mutex<Ring>>,
    failed: Arc<AtomicBool>,
    gain: Arc<AtomicU32>,
) -> Result<cpal::Stream, String>
where
    T: SizedSample + Send + 'static,
    f32: FromSample<T>,
{
    device
        .build_input_stream::<T, _, _>(
            config,
            move |data: &[T], _| {
                let gain = f32::from_bits(gain.load(Ordering::Relaxed));
                // Keep the lock short: just copy samples in.
                if let Ok(mut r) = ring.lock() {
                    for frame in data.chunks(channels) {
                        // Stereo: exactly left and right. Surround: every
                        // channel goes to one of the two, so all of it shows
                        // without an FFT per channel. Mono: both the same.
                        let mut side = [0.0f32; 2];
                        for (i, s) in frame.iter().enumerate() {
                            side[i % 2] += s.to_sample::<f32>() * gain;
                        }
                        if channels == 1 {
                            side[1] = side[0];
                        }
                        r.push(side);
                        // Meter: first two channels (mono devices: both sides the same).
                        let left = frame[0].to_sample::<f32>() * gain;
                        let right = frame.get(1).map_or(left, |s| s.to_sample::<f32>() * gain);
                        r.meter.add(left, right);
                    }
                    r.last_data = Instant::now();
                }
            },
            move |err| {
                // A gap in the captured audio, not a broken stream. Loopback
                // reports one whenever sound starts after silence (Windows
                // sends nothing while nothing plays), and the stream keeps
                // running. Reopening it would only blink the analyzer.
                if err.kind() == cpal::ErrorKind::Xrun {
                    return;
                }
                crate::errlog::write(&format!("Spectrum capture error: {err}"));
                // The run loop reopens the stream on its next check.
                failed.store(true, Ordering::Relaxed);
            },
            None,
        )
        .map_err(|e| e.to_string())
}

/// Two snapshots of the same sound, each with its own FFT: the long one
/// (`FFT_SIZE`) resolves the bass, the short one (`SHORT_SIZE`) reacts about
/// 4x sooner and draws the mids and highs. Grid points inside `HANDOVER_HZ`
/// blend the two (in dB), so the line has no step where they meet.
struct Analyzer {
    sample_rate: f32,
    long: Resolution,
    short: Resolution,
    /// Per grid point, how much of the short snapshot it shows (0…1).
    short_share: Vec<f32>,
    /// Single FFT (Settings → Analyzer): the long one everywhere, the short
    /// one unused: 4x finer detail in the mids and highs, slower there.
    single: bool,
    /// Bars view: which bins each bar sums, and its power in the last
    /// frame (raw: the UI averages it, `smoothBars`).
    bars: Vec<Bar>,
    bar_power: Vec<f32>,
}

/// One bar of the Bars view: the FFT bins its band covers, `lo..=hi`. A bin
/// is a slice of the spectrum one bin wide; the band's edges cut through the
/// first and last slice, and those count only by the share inside the band
/// (`lo_share`, `hi_share`). Counted whole, a band 1.25 bins wide summed 2
/// bins of noise (+2 dB). It reads one FFT only, so a bar never has a step
/// inside it.
struct Bar {
    lo: usize,
    hi: usize,
    lo_share: f32,
    hi_share: f32,
    short: bool,
}

/// Which FFT a bar of `width_hz` reads. The ONE place that decides it.
fn reads_short(width_hz: f32, sample_rate: f32, single: bool) -> bool {
    !single && width_hz / (sample_rate / SHORT_SIZE as f32) >= MIN_SHORT_BINS
}

/// Centre frequency of bar `n` (see `BAR_BANDS`).
fn bar_centre(n: i32) -> f32 {
    1000.0 * 10f32.powf(n as f32 / 10.0)
}

fn bar_bands(sample_rate: f32, single: bool) -> Vec<Bar> {
    BAR_BANDS
        .map(|n| {
            let centre = bar_centre(n);
            // Band edges: a sixth of an octave (in base-10 steps) each side.
            let (lo_hz, hi_hz) = (centre * 10f32.powf(-0.05), centre * 10f32.powf(0.05));
            let short = reads_short(hi_hz - lo_hz, sample_rate, single);
            let size = if short { SHORT_SIZE } else { FFT_SIZE };
            // Edges in bins; bin k covers k - 0.5 … k + 0.5.
            let (l, h) = (lo_hz * size as f32 / sample_rate, hi_hz * size as f32 / sample_rate);
            // Skip 0 Hz and the Nyquist bin (each counts half in a power sum).
            let last = size / 2 - 1;
            let lo = ((l + 0.5).floor() as usize).clamp(1, last);
            let hi = ((h + 0.5).floor() as usize).clamp(lo, last);
            // At most a whole bin: the 20 kHz band reaches past Nyquist at 44.1 kHz.
            let lo_share = ((lo as f32 + 0.5).min(h) - l).clamp(0.0, 1.0);
            let hi_share = (h - (hi as f32 - 0.5).max(l)).clamp(0.0, 1.0);
            Bar { lo, hi, lo_share, hi_share, short }
        })
        .collect()
}

/// One FFT size: its window, smoothing and reduction to the shared log grid.
struct Resolution {
    fft: Arc<dyn realfft::RealToComplex<f32>>,
    window: Vec<f32>,
    /// Turns FFT magnitudes into linear level (see `new`).
    scale: f32,
    /// Turns the sum of bins' |X|² into a band's power (see `new`).
    power_scale: f32,
    input: Vec<f32>,
    spectrum: Vec<realfft::num_complex::Complex<f32>>,
    /// |X|² per FFT bin in the last `levels` call, averaged over the channels.
    bin_power: Vec<f32>,
    /// Smoothed linear magnitude per FFT bin.
    smoothed: Vec<f32>,
    /// How each grid point is read from the FFT bins.
    points: Vec<GridPoint>,
    /// Per grid point, dB added so noise reads flat (`CALIBRATION_SECS`).
    fix: Vec<f32>,
}

/// Low down, grid points are closer together than FFT bins (~6 Hz apart in
/// the long FFT, ~23 Hz in the short one), so reading "the nearest bin" would
/// draw flat steps. There we interpolate between the two neighbouring bins;
/// higher up, where a point covers many bins, we take the loudest one so
/// narrow peaks aren't lost.
///
/// The switch happens at ONE frequency (where a point spans `LOUDEST_MIN_BINS`
/// bins). Mixing the two per point drew fake needles in the bass: every point
/// that happened to straddle a bin edge took the louder bin, while its
/// neighbours were interpolated, so a one-pixel spike appeared every ~6 Hz.
enum GridPoint {
    Between { bin: usize, frac: f32 },
    Loudest { lo: usize, hi: usize },
}

/// Frequency of grid point `i` (a fractional `i` lies between points).
fn grid_hz(i: f32) -> f32 {
    let ratio = (GRID_MAX_HZ / GRID_MIN_HZ).ln() / (GRID_POINTS - 1) as f32;
    GRID_MIN_HZ * (ratio * i).exp()
}

/// White noise from a fixed-seed xorshift: the same every time, no extra dependency.
fn white_noise(seed: u32, len: usize) -> Vec<f32> {
    let mut x = seed;
    (0..len)
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            (x as f32 / u32::MAX as f32) * 2.0 - 1.0
        })
        .collect()
}

impl Analyzer {
    fn new(sample_rate: f32, single: bool) -> Self {
        // Share of the short snapshot: 0 below the handover, 1 above, rising
        // evenly per octave in between.
        let (from, to) = HANDOVER_HZ;
        let short_share = (0..GRID_POINTS)
            .map(|i| ((grid_hz(i as f32) / from).log2() / (to / from).log2()).clamp(0.0, 1.0))
            .collect();
        let mut long = Resolution::new(FFT_SIZE, NEWEST_FADE, sample_rate);
        let mut short = Resolution::new(SHORT_SIZE, SHORT_FADE, sample_rate);

        // The noise fix (see `CALIBRATION_SECS`), ~50 ms. Target: the long
        // FFT's bass, where points read between two bins (no "loudest"), so
        // the bass needs no fix at all.
        let noise = white_noise(CALIBRATION_SEED, (sample_rate * CALIBRATION_SECS) as usize);
        let hop = (sample_rate * FRAME_INTERVAL.as_secs_f32()).round() as usize;
        let long_noise = long.noise_reading(&noise, hop);
        let short_noise = short.noise_reading(&noise, hop);
        let target = long.between_mean(&long_noise);
        long.set_fix(&long_noise, target);
        short.set_fix(&short_noise, target);

        let bars = bar_bands(sample_rate, single);
        let bar_power = vec![0.0; bars.len()];
        Self { sample_rate, long, short, short_share, single, bars, bar_power }
    }

    /// Drop prior channel's FFT smoothing so switching L/R never bleeds across sides.
    fn clear_smoothing(&mut self) {
        self.long.smoothed.fill(0.0);
        self.short.smoothed.fill(0.0);
    }

    /// `channels`: each one's newest `FFT_SIZE` samples, oldest first. Returns
    /// the line's levels; the bars are kept for `bars()`.
    fn analyze(&mut self, channels: &[&[f32]]) -> Vec<f32> {
        let long = self.long.levels(channels);
        if self.single {
            self.update_bars();
            // One decimal is plenty for drawing and keeps messages small.
            return long.iter().map(|db| (db * 10.0).round() / 10.0).collect();
        }
        let newest: Vec<&[f32]> = channels.iter().map(|c| &c[c.len() - SHORT_SIZE..]).collect();
        let short = self.short.levels(&newest);
        self.update_bars();
        long.iter()
            .zip(&short)
            .zip(&self.short_share)
            .map(|((l, s), share)| {
                let db = l + (s - l) * share;
                // One decimal is plenty for drawing and keeps messages small.
                (db * 10.0).round() / 10.0
            })
            .collect()
    }

    /// Bars: each band's summed power in this frame, unsmoothed.
    fn update_bars(&mut self) {
        for (bar, power) in self.bars.iter().zip(&mut self.bar_power) {
            let fft = if bar.short { &self.short } else { &self.long };
            *power = fft.power(bar);
        }
    }

    /// Bars view: dBFS per bar, from the last `analyze`.
    fn bars(&self) -> Vec<f32> {
        self.bar_power.iter().map(|p| ((10.0 * p.max(1e-16).log10()).max(FLOOR_DB) * 10.0).round() / 10.0).collect()
    }
}

impl Resolution {
    /// `fade`: how many of the newest samples the window falls over.
    fn new(size: usize, fade: usize, sample_rate: f32) -> Self {
        let fft = RealFftPlanner::<f32>::new().plan_fft_forward(size);
        let spectrum = fft.make_output_vec();
        let bin_count = spectrum.len();

        // Lopsided Blackman window: softens the edges of the snapshot so a
        // pure tone shows as one clean peak instead of smearing across the
        // spectrum. A symmetric one weighs the middle most (in the long
        // snapshot ~85 ms in the past), so a new hit took that long to show.
        // This one rises slowly over the older part and falls fast over the
        // newest `fade` samples (the snapshot is oldest first), so new sound
        // counts sooner.
        let blackman = |x: f32| 0.42 - 0.5 * x.cos() + 0.08 * (2.0 * x).cos();
        let rise = size - fade;
        let window: Vec<f32> = (0..size)
            .map(|i| {
                let pi = std::f32::consts::PI;
                if i < rise {
                    blackman(pi * i as f32 / rise as f32) // 0 → 1
                } else {
                    blackman(pi * (1.0 + (i - rise) as f32 / fade as f32)) // 1 → 0
                }
            })
            .collect();
        // A sine of amplitude A peaks at A·sum(window)/2, so 2/sum makes it
        // read A: a sine of X dBFS reads X (the convention pro analyzers use),
        // in both FFT sizes.
        let scale = 2.0 / window.iter().sum::<f32>();
        // Bars: a band's power is the sum of its bins' |X|². The window
        // spreads a tone over several bins and lets each bin take in noise
        // from a little more than its own width; dividing by size·Σw² counts
        // both exactly (Parseval). The 4 (2 for the missing negative
        // frequencies, 2 for "a sine of X dBFS reads X") matches the line.
        let power_scale = 4.0 / (size as f32 * window.iter().map(|w| w * w).sum::<f32>());

        // Each grid point covers the bins between its neighbours' geometric midpoints.
        let hz_per_bin = sample_rate / size as f32;
        let last = bin_count - 1;
        let points = (0..GRID_POINTS)
            .map(|i| {
                let lo_hz = grid_hz(i as f32 - 0.5);
                let hi_hz = grid_hz(i as f32 + 0.5);
                if (hi_hz - lo_hz) / hz_per_bin >= LOUDEST_MIN_BINS {
                    let lo = (lo_hz / hz_per_bin).floor() as usize;
                    let hi = (hi_hz / hz_per_bin).floor() as usize;
                    GridPoint::Loudest { lo: lo.min(last), hi: hi.min(last) }
                } else {
                    let pos = grid_hz(i as f32) / hz_per_bin;
                    let bin = (pos.floor() as usize).min(last - 1);
                    GridPoint::Between { bin, frac: pos - bin as f32 }
                }
            })
            .collect();

        Self {
            fft,
            window,
            scale,
            power_scale,
            input: vec![0.0; size],
            spectrum,
            bin_power: vec![0.0; bin_count],
            smoothed: vec![0.0; bin_count],
            points,
            fix: vec![0.0; GRID_POINTS],
        }
    }

    /// Mean level per grid point of `noise`, read the way `Analyzer::analyze`
    /// reads music: frames `hop` samples apart, all ending on the same newest
    /// sample as the long FFT's. Leaves the smoothing empty again.
    fn noise_reading(&mut self, noise: &[f32], hop: usize) -> Vec<f32> {
        let size = self.input.len();
        let mut sum = vec![0.0f32; GRID_POINTS];
        let mut count = 0;
        for (n, end) in (FFT_SIZE..=noise.len()).step_by(hop).enumerate() {
            let levels = self.levels(&[&noise[end - size..end]]);
            if n >= SETTLE_FRAMES {
                sum.iter_mut().zip(levels).for_each(|(s, l)| *s += l);
                count += 1;
            }
        }
        self.smoothed.fill(0.0);
        sum.iter().map(|s| s / count as f32).collect()
    }

    /// Mean of `noise` over the points read between two bins, away from the
    /// lowest bins (they pick up the window's leakage from 0 Hz). Noise reads
    /// the same at all of them, so one number fits them all.
    fn between_mean(&self, noise: &[f32]) -> f32 {
        let picked: Vec<f32> = self
            .points
            .iter()
            .zip(noise)
            .filter(|(p, _)| matches!(p, GridPoint::Between { bin, .. } if *bin >= AWAY_FROM_DC))
            .map(|(_, n)| *n)
            .collect();
        picked.iter().sum::<f32>() / picked.len() as f32
    }

    /// Sets the fix that brings `noise` (from `noise_reading`) to `target` dB.
    /// Points read between two bins share one fix: low down, several points
    /// share a bin, so a fix per point would copy one random signal's ups and
    /// downs. "Loudest" points rise with the bins they cover, so each gets
    /// its own, averaged over neighbours of that kind only: the switch
    /// between the two is a real step, and averaging across it would blur it.
    fn set_fix(&mut self, noise: &[f32], target: f32) {
        let between = target - self.between_mean(noise);
        let loudest: Vec<bool> = self.points.iter().map(|p| matches!(p, GridPoint::Loudest { .. })).collect();
        self.fix = (0..GRID_POINTS)
            .map(|i| {
                if !loudest[i] {
                    return between;
                }
                let near: Vec<f32> = (i.saturating_sub(FIX_SPREAD)..=(i + FIX_SPREAD).min(GRID_POINTS - 1))
                    .filter(|&j| loudest[j] == loudest[i])
                    .map(|j| noise[j])
                    .collect();
                target - near.iter().sum::<f32>() / near.len() as f32
            })
            .collect();
    }

    /// A bar's power in the last `levels` call (unsmoothed, no fix): its
    /// bins' |X|², the edge bins by their share, so a sine of amplitude A
    /// sums to A² and noise to its power over the band's exact width.
    fn power(&self, bar: &Bar) -> f32 {
        let p = |k: usize| self.bin_power[k];
        let sum = if bar.lo == bar.hi {
            p(bar.lo) * bar.lo_share // both edges inside one bin: their distance
        } else {
            let inner: f32 = (bar.lo + 1..bar.hi).map(p).sum();
            inner + p(bar.lo) * bar.lo_share + p(bar.hi) * bar.hi_share
        };
        sum * self.power_scale
    }

    /// Level in dB per grid point. `channels`: each one's samples, exactly
    /// this FFT's size, oldest first. Their power is averaged, not their
    /// samples: a delay moves a channel's phase but not its power, so it
    /// draws no dips. Two identical channels read like one of them.
    fn levels(&mut self, channels: &[&[f32]]) -> Vec<f32> {
        self.bin_power.fill(0.0);
        let share = 1.0 / channels.len() as f32;
        for samples in channels {
            for ((dst, s), w) in self.input.iter_mut().zip(samples.iter()).zip(&self.window) {
                *dst = s * w;
            }
            if self.fft.process(&mut self.input, &mut self.spectrum).is_err() {
                return vec![FLOOR_DB; GRID_POINTS];
            }
            for (p, c) in self.bin_power.iter_mut().zip(&self.spectrum) {
                *p += c.norm_sqr() * share;
            }
        }

        // Only falls are smoothed.
        for (s, p) in self.smoothed.iter_mut().zip(&self.bin_power) {
            let now = p.sqrt() * self.scale;
            *s = if now >= *s { now } else { FALL_SMOOTHING * *s + (1.0 - FALL_SMOOTHING) * now };
        }

        let s = &self.smoothed;
        self.points
            .iter()
            .zip(&self.fix)
            .map(|(p, fix)| {
                let magnitude = match *p {
                    GridPoint::Between { bin, frac } => s[bin] + (s[bin + 1] - s[bin]) * frac,
                    GridPoint::Loudest { lo, hi } => s[lo..=hi].iter().copied().fold(0.0f32, f32::max),
                };
                (20.0 * magnitude.max(1e-12).log10() + fix).max(FLOOR_DB)
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: f32 = 48_000.0;
    /// Samples between frames at 60 fps.
    const HOP: usize = 800;

    fn sine(hz: f32) -> Vec<f32> {
        (0..RATE as usize * 2).map(|i| 0.5 * (std::f32::consts::TAU * hz * i as f32 / RATE).sin()).collect()
    }

    /// A sine `dbfs` below full scale (amplitude 1 = 0 dBFS), 2 s long.
    fn sine_at(hz: f32, dbfs: f32) -> Vec<f32> {
        let amp = 10f32.powf(dbfs / 20.0);
        (0..RATE as usize * 2).map(|i| amp * (std::f32::consts::TAU * hz * i as f32 / RATE).sin()).collect()
    }

    /// Seeds for the checks: not `CALIBRATION_SEED`, so the fix is tested on
    /// noise it wasn't measured from.
    const SEEDS: [u32; 2] = [0x1234_5678, 0x9E37_79B9];

    /// Pink noise (-3 dB per octave): white noise through Paul Kellet's
    /// refined pinking filter, within ±0.05 dB of the ideal slope above ~10 Hz.
    fn pink(seed: u32, secs: f32) -> Vec<f32> {
        let mut b = [0.0f64; 7];
        white_noise(seed, (RATE * secs) as usize)
            .into_iter()
            .map(|w| {
                let w = f64::from(w);
                b[0] = 0.99886 * b[0] + w * 0.0555179;
                b[1] = 0.99332 * b[1] + w * 0.0750759;
                b[2] = 0.96900 * b[2] + w * 0.1538520;
                b[3] = 0.86650 * b[3] + w * 0.3104856;
                b[4] = 0.55000 * b[4] + w * 0.5329522;
                b[5] = -0.7616 * b[5] - w * 0.0168980;
                let out = b.iter().sum::<f64>() + w * 0.5362;
                b[6] = w * 0.115926;
                (out * 0.1) as f32
            })
            .collect()
    }

    /// Runs `signal` through the full analyzer (both FFTs, fixed, blended:
    /// what the UI gets, before its display tilt) and returns every frame.
    fn analyzed(a: &mut Analyzer, signal: &[f32]) -> Vec<Vec<f32>> {
        (FFT_SIZE..signal.len()).step_by(HOP).map(|end| a.analyze(&[&signal[end - FFT_SIZE..end]])).collect()
    }

    /// Per grid point, the mean level over the settled frames.
    fn mean_per_point(all: &[Vec<f32>]) -> Vec<f32> {
        let settled = &all[SETTLE_FRAMES..];
        (0..GRID_POINTS).map(|i| settled.iter().map(|f| f[i]).sum::<f32>() / settled.len() as f32).collect()
    }

    /// Pink noise falls 3 dB per octave; adding that back leaves what should be flat.
    fn detilt(per_point: &[f32]) -> Vec<f32> {
        per_point.iter().enumerate().map(|(i, db)| db + 3.0 * (grid_hz(i as f32) / 1000.0).log2()).collect()
    }

    fn band_mean(per_point: &[f32], lo_hz: f32, hi_hz: f32) -> f32 {
        let p = points_in(lo_hz, hi_hz);
        p.iter().map(|&i| per_point[i]).sum::<f32>() / p.len() as f32
    }

    /// ISO third-octave centres (1000·10^(n/10)) from `lo` to `hi` Hz.
    fn third_octaves(lo: f32, hi: f32) -> Vec<f32> {
        (-20..=13).map(|n| 1000.0 * 10f32.powf(n as f32 / 10.0)).filter(|&c| c > lo * 0.99 && c < hi * 1.01).collect()
    }

    /// Runs `signal` through one resolution at 60 fps and returns every frame's levels.
    fn frames(signal: &[f32], size: usize, fade: usize) -> Vec<Vec<f32>> {
        let mut r = Resolution::new(size, fade, RATE);
        // Both resolutions see the same newest sample in each frame.
        (FFT_SIZE..signal.len()).step_by(HOP).map(|end| r.levels(&[&signal[end - size..end]])).collect()
    }

    fn points_in(lo_hz: f32, hi_hz: f32) -> Vec<usize> {
        (0..GRID_POINTS).filter(|&i| (lo_hz..hi_hz).contains(&grid_hz(i as f32))).collect()
    }

    /// One side 1 ms late must not draw dips. Added together, the two sides
    /// would cancel at 500 Hz; the neighbouring octave below shows the true level.
    #[test]
    fn delay_between_channels_draws_no_dips() {
        let late = (RATE / 1000.0) as usize;
        let noise = pink(SEEDS[0], 8.0);
        let mut a = Analyzer::new(RATE, false);
        let all: Vec<Vec<f32>> = (FFT_SIZE + late..noise.len())
            .step_by(HOP)
            .map(|end| a.analyze(&[&noise[end - FFT_SIZE..end], &noise[end - late - FFT_SIZE..end - late]]))
            .collect();
        let line = detilt(&mean_per_point(&all));
        let dip = band_mean(&line, 250.0, 350.0) - band_mean(&line, 470.0, 530.0);
        eprintln!("500 Hz vs 250-350 Hz: {dip:.2} dB");
        assert!(dip.abs() < 1.0);
    }

    /// Two identical channels read exactly like one.
    #[test]
    fn identical_channels_read_like_one() {
        let tone = sine_at(250.0, -12.0);
        let signal = &tone[..FFT_SIZE];
        let one = Analyzer::new(RATE, false).analyze(&[signal]);
        let two = Analyzer::new(RATE, false).analyze(&[signal, signal]);
        assert_eq!(one, two);
    }

    /// A pure tone must peak at the same level in both resolutions.
    #[test]
    fn tone_reads_the_same() {
        for hz in [700.0, 2000.0, 5000.0] {
            let near = points_in(hz * 0.95, hz * 1.05);
            let peak = |size, fade| {
                let all = frames(&sine(hz), size, fade);
                let last = all.last().unwrap();
                near.iter().map(|&i| last[i]).fold(FLOOR_DB, f32::max)
            };
            let (long, short) = (peak(FFT_SIZE, NEWEST_FADE), peak(SHORT_SIZE, SHORT_FADE));
            eprintln!("sine {hz} Hz: long {long:.2} dB, short {short:.2} dB");
            assert!((long - short).abs() < 1.5);
        }
    }

    /// Where the line strays most from its own 250-500 Hz level between `lo`
    /// and `hi` Hz: (Hz, dB off). Each point is averaged with two neighbours
    /// each side, so one random signal's jitter doesn't count as a bump.
    fn worst_off(line: &[f32], lo: f32, hi: f32) -> (f32, f32) {
        let reference = band_mean(line, 250.0, 500.0);
        points_in(lo, hi)
            .into_iter()
            .map(|i| (grid_hz(i as f32), line[i - 2..=i + 2].iter().sum::<f32>() / 5.0 - reference))
            .fold((0.0, 0.0f32), |a, b| if b.1.abs() > a.1.abs() { b } else { a })
    }

    /// Least-squares slope across the handover (500 Hz-1 kHz), dB per octave.
    fn handover_slope(line: &[f32]) -> f32 {
        let pts: Vec<(f32, f32)> =
            points_in(500.0, 1000.0).into_iter().map(|i| ((grid_hz(i as f32) / 1000.0).log2(), line[i])).collect();
        let n = pts.len() as f32;
        let (mx, my) = (pts.iter().map(|p| p.0).sum::<f32>() / n, pts.iter().map(|p| p.1).sum::<f32>() / n);
        pts.iter().map(|p| (p.0 - mx) * (p.1 - my)).sum::<f32>() / pts.iter().map(|p| (p.0 - mx).powi(2)).sum::<f32>()
    }

    /// Measurement, not a check: how pink noise reads per third octave,
    /// de-tilted (flat = right): each FFT without the fix, and the line the
    /// UI gets. `cargo test --lib pink_report -- --nocapture`
    #[test]
    fn pink_report() {
        let mut a = Analyzer::new(RATE, false);
        for seed in SEEDS {
            let signal = pink(seed, 20.0);
            let long = detilt(&mean_per_point(&frames(&signal, FFT_SIZE, NEWEST_FADE)));
            let short = detilt(&mean_per_point(&frames(&signal, SHORT_SIZE, SHORT_FADE)));
            let line = detilt(&mean_per_point(&analyzed(&mut a, &signal)));
            let reference = band_mean(&line, 250.0, 500.0);
            eprintln!("
pink, seed {seed:#x}, de-tilted dB
  centre  long raw  short raw  s - l  line vs 250-500 Hz");
            for c in third_octaves(31.5, 16000.0) {
                let (lo, hi) = (c * 10f32.powf(-0.05), c * 10f32.powf(0.05));
                let (l, s, b) = (band_mean(&long, lo, hi), band_mean(&short, lo, hi), band_mean(&line, lo, hi));
                eprintln!("{c:>8.0} {l:>8.2} {s:>10.2} {:>+6.2} {:>+10.2}", s - l, b - reference);
            }
            let (hz, off) = worst_off(&line, 250.0, 16000.0);
            eprintln!("line, 250 Hz-16 kHz: worst {off:+.2} dB at {hz:.0} Hz, slope 500 Hz-1 kHz {:+.2} dB/oct", handover_slope(&line));
        }
    }

    /// The line's promise for dense sound: pink noise (not the calibration's
    /// noise) reads flat once its -3 dB/octave is taken out. No stretch more
    /// than 0.5 dB off, no slope across the handover, no step where an FFT
    /// switches to "loudest bin" (~870 Hz long, ~3.5 kHz short). Below
    /// 250 Hz a few points share one bin, so 20 s of noise jitters more than
    /// that point to point; there whole third octaves are checked.
    #[test]
    fn pink_reads_flat() {
        for single in [false, true] {
            let mut a = Analyzer::new(RATE, single);
            for seed in SEEDS {
                let line = detilt(&mean_per_point(&analyzed(&mut a, &pink(seed, 20.0))));
                let (hz, off) = worst_off(&line, 250.0, 16000.0);
                assert!(off.abs() < 0.5, "single {single}, seed {seed:#x}: {hz:.0} Hz reads {off:+.2} dB off flat");
                let reference = band_mean(&line, 250.0, 500.0);
                for c in third_octaves(31.5, 200.0) {
                    let off = band_mean(&line, c * 10f32.powf(-0.05), c * 10f32.powf(0.05)) - reference;
                    assert!(off.abs() < 0.5, "single {single}, seed {seed:#x}: third octave at {c:.0} Hz reads {off:+.2} dB off flat");
                }
                let slope = handover_slope(&line);
                assert!(slope.abs() < 0.5, "single {single}, seed {seed:#x}: handover slope {slope:+.2} dB/oct");
            }
        }
    }

    /// The scale: a sine centred on a bin reads its dBFS level in that bin,
    /// in both FFTs (before the fix and the reduction to the grid).
    #[test]
    fn sine_on_a_bin_reads_its_level() {
        for (size, fade, bin) in [(FFT_SIZE, NEWEST_FADE, 43), (SHORT_SIZE, SHORT_FADE, 171)] {
            let hz = bin as f32 * RATE / size as f32;
            let mut r = Resolution::new(size, fade, RATE);
            r.levels(&[&sine_at(hz, -12.0)[..size]]);
            let db = 20.0 * r.smoothed[bin].log10();
            eprintln!("-12 dBFS sine at {hz:.1} Hz, {size}-point FFT: {db:.3} dB");
            assert!((db + 12.0).abs() < 0.05);
        }
    }

    /// Through the whole analyzer: a -12 dBFS sine peaks at -12 plus the
    /// noise fix there (0 in the bass). Up to 2 dB lower is allowed, never
    /// higher: a tone between two bins reads a bit low where grid points
    /// interpolate between bins (measured: up to ~1.9 dB in the short FFT).
    #[test]
    fn sine_reads_its_level_plus_fix() {
        let mut a = Analyzer::new(RATE, false);
        for hz in [40.0, 250.0, 700.0, 2000.0, 4000.0, 10000.0, 16000.0] {
            let last = analyzed(&mut a, &sine_at(hz, -12.0)).pop().unwrap();
            let i = points_in(hz * 0.95, hz * 1.05).into_iter().max_by(|&x, &y| last[x].total_cmp(&last[y])).unwrap();
            let fix = a.long.fix[i] + (a.short.fix[i] - a.long.fix[i]) * a.short_share[i];
            let off = last[i] - fix + 12.0;
            eprintln!("-12 dBFS sine at {hz} Hz reads {:.1} dB (fix {fix:+.1}, off {off:+.2})", last[i]);
            assert!((-2.0..0.3).contains(&off));
        }
    }

    /// Runs `signal` through the full analyzer and returns every frame's bars.
    fn bar_frames(a: &mut Analyzer, signal: &[f32]) -> Vec<Vec<f32>> {
        (FFT_SIZE..signal.len())
            .step_by(HOP)
            .map(|end| {
                a.analyze(&[&signal[end - FFT_SIZE..end]]);
                a.bars()
            })
            .collect()
    }

    /// Per bar, the mean POWER over the frames, in dB: the bars are sent
    /// raw, and their true level is the average power (what the UI's
    /// averaging shows).
    fn mean_per_bar(all: &[Vec<f32>]) -> Vec<f32> {
        (0..all[0].len())
            .map(|b| 10.0 * (all.iter().map(|f| 10f32.powf(f[b] / 10.0)).sum::<f32>() / all.len() as f32).log10())
            .collect()
    }

    fn bar_centres() -> Vec<f32> {
        BAR_BANDS.map(bar_centre).collect()
    }

    /// Per bar, a -12 dBFS sine at its centre: what that bar reads.
    fn bar_sines(a: &mut Analyzer) -> Vec<f32> {
        bar_centres().iter().enumerate().map(|(b, &hz)| bar_frames(a, &sine_at(hz, -12.0)).pop().unwrap()[b]).collect()
    }

    /// White noise (uniform, -1…1: power 1/3, spread evenly up to Nyquist)
    /// has this much power in a band, on the sine scale (×2), in dB.
    fn white_band_db(centre: f32) -> f32 {
        let width = centre * (10f32.powf(0.05) - 10f32.powf(-0.05));
        10.0 * (2.0 / 3.0 * width / (RATE / 2.0)).log10()
    }

    /// Measurement, not a check, for both FFT modes: per bar, which FFT and
    /// how many bins, what a -12 dBFS sine at its centre reads, white noise
    /// vs its true band power, and pink noise vs the 250 Hz-2 kHz bars
    /// (flat = right). Noise is averaged in power, as "true level" shows it.
    /// `cargo test --lib bars_report -- --nocapture`
    #[test]
    fn bars_report() {
        for single in [false, true] {
            let mut a = Analyzer::new(RATE, single);
            let sines = bar_sines(&mut a);
            let white = mean_per_bar(&bar_frames(&mut a, &white_noise(SEEDS[0], (RATE * 20.0) as usize)));
            let pinks: Vec<Vec<f32>> = SEEDS.iter().map(|&s| mean_per_bar(&bar_frames(&mut a, &pink(s, 20.0)))).collect();
            eprintln!("
bars, {} FFT: centre  fft    bins  sine(-12)  white-true  pink seed 1, 2 (vs 250 Hz-2 kHz)", if single { "single" } else { "dual" });
            for (b, c) in bar_centres().into_iter().enumerate() {
                let bar = &a.bars[b];
                eprintln!(
                    "{c:>11.0}  {:<5} {:>5}  {:>9.2}  {:>+10.2}  {:>+6.2} {:>+6.2}",
                    if bar.short { "short" } else { "long" },
                    bar.hi - bar.lo + 1,
                    sines[b],
                    white[b] - white_band_db(c),
                    pinks[0][b] - pink_reference(&pinks[0]),
                    pinks[1][b] - pink_reference(&pinks[1]),
                );
            }
        }
    }

    /// Mean of the bars from 250 Hz to 2 kHz: both FFTs, many bins each.
    fn pink_reference(per_bar: &[f32]) -> f32 {
        let picked: Vec<f32> =
            bar_centres().iter().zip(per_bar).filter(|(c, _)| (240.0..2100.0).contains(*c)).map(|(_, l)| *l).collect();
        picked.iter().sum::<f32>() / picked.len() as f32
    }

    /// The bars' promise for tones: a -12 dBFS sine at a band's centre reads
    /// -12 in that bar, in both FFTs. Below 100 Hz a band holds only 1-3
    /// long-FFT bins, too few for the window's skirts, so it reads low (25 Hz:
    /// about one bin, up to ~4 dB).
    #[test]
    fn bar_sine_reads_its_level() {
        let mut a = Analyzer::new(RATE, false);
        for (c, db) in bar_centres().into_iter().zip(bar_sines(&mut a)) {
            let off = db + 12.0;
            if c >= 99.0 {
                assert!(off.abs() < 0.5, "-12 dBFS sine at {c:.0} Hz reads {db:.2}");
            } else {
                assert!((-5.0..0.5).contains(&off), "-12 dBFS sine at {c:.0} Hz reads {db:.2}");
            }
        }
    }

    /// The bars' promise for dense sound: pink noise (equal power per third
    /// octave) reads level across the bars, with no step where they switch
    /// to the short FFT; white noise reads its true band power. Below
    /// 100 Hz 20 s of noise holds too few independent samples per band to
    /// check this closely.
    #[test]
    fn bar_noise_reads_its_level() {
        for single in [false, true] {
            let mut a = Analyzer::new(RATE, single);
            for seed in SEEDS {
                let bars = mean_per_bar(&bar_frames(&mut a, &pink(seed, 20.0)));
                let reference = pink_reference(&bars);
                for (c, db) in bar_centres().into_iter().zip(&bars).filter(|(c, _)| *c >= 99.0) {
                    let off = db - reference;
                    assert!(off.abs() < 0.5, "single {single}, seed {seed:#x}: pink at {c:.0} Hz reads {off:+.2} dB off level");
                }
            }
            let white = mean_per_bar(&bar_frames(&mut a, &white_noise(SEEDS[0], (RATE * 20.0) as usize)));
            for (c, db) in bar_centres().into_iter().zip(white).filter(|(c, _)| *c >= 99.0) {
                let off = db - white_band_db(c);
                assert!(off.abs() < 0.5, "single {single}: white noise at {c:.0} Hz reads {off:+.2} dB off its band power");
            }
        }
    }

    /// Level steps move the reading by exactly that much.
    #[test]
    fn sine_levels_are_linear() {
        let mut a = Analyzer::new(RATE, false);
        let mut peak = |db: f32| {
            let last = analyzed(&mut a, &sine_at(250.0, db)).pop().unwrap();
            points_in(240.0, 260.0).into_iter().map(|i| last[i]).fold(FLOOR_DB, f32::max)
        };
        let base = peak(-12.0);
        for db in [-6.0, -24.0, -48.0, -72.0] {
            let moved = peak(db) - base;
            assert!((moved - (db + 12.0)).abs() < 0.2, "{db} dBFS moved {moved:+.2} dB");
        }
    }
}
