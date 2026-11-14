/**
 * Hover tooltips (`title` attributes) across the UI, gathered in one place so
 * their wording—teaching sound physics, acoustics, and production—is easy to
 * review, edit, and keep consistent.
 */
import type { FILTER_TYPES, FilterType } from '../eapo/types';
import type { HeatLines, SpectrumDisplay, SpectrumLines } from '../state/store';
import type { REGIONS } from './graph/geometry';

const EVERYDAY_SHAPES: Record<(typeof FILTER_TYPES)[number], string> = {
  PK: 'Bell: boosts or cuts a slice around one frequency—like turning up a single piano key or a singer\'s voice.',
  LSC: 'Low shelf: raises or lowers all bass frequencies together below this point, like a bass tone knob.',
  HSC: 'High shelf: raises or lowers all treble frequencies together above this point—great for adding air or taming harshness.',
  HPQ: 'Low cut: steeply removes sub-bass rumble below this frequency (footsteps, wind, mic bumps) while keeping voices clear.',
  LPQ: 'High cut: steeply rolls off high hiss or fizz above this frequency for a warmer, softer sound.',
  NO: 'Notch: cuts one tiny sliver out—great for erasing a steady whistle, mic feedback, or electric hum.',
  BP: 'Band-pass: lets only one slice of frequencies through, muting everything lower and higher (like a telephone or megaphone).',
};

const HEAT_BASE =
  'Heat: a scrolling waterfall (spectrogram) where brightness = loudness over time, great for catching brief clicks, "S" sounds, or melodies.';

const RED_LEDS =
  'Red LEDs = risk of Windows limiter (squashes sound above −0.13 dBFS):\n1 > −3 dBFS\n2 > −1 dBFS\n3 > −0.5 dBFS';

type RegionName = (typeof REGIONS)[number]['name'];

export const TOOLTIPS = {
  numberField: {
    default: 'Scroll, drag, or click to type a value',
    freq: 'Scroll, drag, or click to type a frequency ("1.2k" works)',
  },

  filterMenu: {
    shape: (type: FilterType): string => {
      if (type in EVERYDAY_SHAPES) return EVERYDAY_SHAPES[type as keyof typeof EVERYDAY_SHAPES];
      if (type === 'AP') return 'Equalizer APO: AP. Turns the phase around its frequency; the curve stays flat';
      return `Equalizer APO: ${type}. Frequency = the shelf's corner, fixed slope, no Q`;
    },
    resetGainFreq: 'Gain 0 dB and its home frequency (the same as double-clicking the node)',
    resetBand: 'Gain 0 dB, its home frequency and the shape\'s usual Q',
  },

  bandPanel: {
    shapeButton: (index: number, label: string, enabled: boolean) =>
      `Band ${index + 1}, ${label}${enabled ? '' : ' (muted)'}: choose the filter shape. Different shapes sculpt sound like wide brushes or fine pencils.\nClick for shapes, scroll to cycle, right-click for solo, mute, move…`,
    faderCell: 'Right-click: solo, mute, move, reset…',
    gainFader:
      'How much to boost (+) or cut (−) in dB. Cutting problem frequencies often sounds cleaner than boosting everything else.\nDrag or scroll (Shift = fine). Double-click = 0 dB. Right-click: solo, mute, move…',
    freqKnob:
      'Frequency in Hz—how fast the air vibrates per second. Left is deep bass (slow waves), right is high treble (fast waves).\nDrag or scroll (Shift = fine). Double-click = home frequency.',
    qKnob:
      'Q (width): how wide or narrow this band reaches. Low Q is a wide brush across whole regions; high Q is a laser for one single note.\nDrag or scroll (Shift = fine). Double-click = default Q.',
    autoButton:
      'Auto level: shifts the whole volume down so the loudest boost stays below 0 dBFS (minus headroom)—preventing digital clipping.\nRight-click the fader for headroom options.',
    levelCell: 'Right-click: the level line, Auto, headroom, 0 dB',
    levelFader:
      'Overall level (preamp) before your speakers. Turn down if boosts push the meter into red.\nDrag or scroll (Shift = fine). Double-click = Auto. Right-click: level line, Auto, headroom, 0 dB.',
  },

  levelMenu: {
    levelLine: 'The dashed line on the graph: the EQ\'s shape plus Level, what you actually hear (shown when Level isn\'t 0 dB)',
    auto: 'Auto keeps the loudest point of the curve at 0 dB minus the headroom, so nothing clips',
    headroom:
      'How far below 0 dB Auto keeps the curve\'s peak. Windows turns down anything that reaches about -0.13 dBFS (its limiter), which squashes loud songs; '
      + 'headroom keeps them below it. Costs that much loudness: turn the volume up to make up for it',
    zero: 'Level to exactly 0 dB (switches Auto off)',
  },

  regions: {
    'Sub bass': 'Sub bass (20–60 Hz): deep rumble you feel in your chest more than you hear—kick drum weight, thunder, and bass drops. Tiny speakers can\'t play it.',
    Bass: 'Bass (60–250 Hz): warmth and punch of bass guitar, kick, and low notes. Too much here sounds boomy or muddy.',
    'Low mids': 'Low mids (250–500 Hz): body and fullness of voices and guitars—and where rooms often sound boxy or congested.',
    Mids: 'Mids (500 Hz–2 kHz): where human ears are sharpest, carrying most melodies, speech, and snare snap. Too much sounds nasal or honky.',
    'Upper mids': 'Upper mids (2–4 kHz): consonant attack, guitar bite, and vocal edge. Harshness here causes ear fatigue fast.',
    Presence: 'Presence (4–6 kHz): clarity and closeness—makes vocals and instruments feel right in front of you, or sharp on "S" sounds.',
    Air: 'Air (6–20 kHz): shimmer, breath, cymbal sparkle, and room space. High frequencies fade naturally with distance and age.',
    'Beyond hearing': 'Above 20 kHz: ultrasound—beyond human hearing (and our upper limit drops as we get older).',
  } satisfies Record<RegionName, string>,

  graph: {
    beyondHearing: 'Above 20 kHz: ultrasound—beyond human hearing (and our upper limit drops as we get older).',
    nyquist: (rateHz: number) =>
      `Nyquist: ${rateHz / 2000} kHz—the highest frequency a ${rateHz / 1000} kHz sample rate can capture (half the snapshots per second).`,
    freqUnit:
      'Frequency in Hertz (Hz): vibrations per second. Each octave doubles the Hz (100 → 200 → 400) and spans the same width, matching how our ears hear pitch.',
    dbScale: (db: number) =>
      `Showing ±${db} dB. Decibels measure sound on a scale that matches how ears hear loudness. Use ±12 dB for subtle shaping, ±24 dB for big fixes.\nClick to zoom ${db === 24 ? 'in to ±12' : 'out to ±24'} dB.`,
    analyzerScale: (bars: boolean) =>
      bars
        ? 'Bars level in dBFS (0 is the digital ceiling): true energy per third-octave band with no tilt—matching how human ears group frequencies.'
        : 'Analyzer level in dBFS (0 is the digital ceiling): tilted +3 dB per octave around 1 kHz so balanced music (pink noise) reads roughly flat.',
    slope:
      'Slope in dB per octave: how steeply a cut fades sound away. One octave = doubling or halving frequency. 12 dB sounds natural; 48 dB is a brick wall.\nClick for the next slope.',
    display: {
      line: 'Line: detailed frequency curve (FFT). Great for spotting narrow ringing notes or harmonics.',
      bars: 'Bars: third-octave energy bands—closer to how human ears actually hear loudness across bass, mids, and treble.',
      heat: `${HEAT_BASE} (click again to switch colors)`,
    } satisfies Record<Exclude<SpectrumDisplay, 'off' | 'split'>, string>,
    heatPalette: (palette: 'ice' | 'fire') =>
      `${HEAT_BASE} (click: ${palette === 'ice' ? 'red to yellow' : 'blue to white'})`,
    lines: {
      pre: 'Before the EQ (red): the raw incoming sound before your filters touch it.',
      post: 'After the EQ (cyan): the shaped sound you actually hear.',
      overlay: 'Overlay: red = before EQ, cyan = after EQ. The shaded gap shows exactly what your EQ boosted or cut.',
    } satisfies Record<SpectrumLines, string>,
    heatLines: {
      pre: 'Heat shows the sound before the EQ (raw input).',
      post: 'Heat shows the sound after the EQ (what you hear).',
    } satisfies Record<HeatLines, string>,
    peakHold: (bars: boolean) =>
      bars
        ? 'Peak hold: caps each bar at its recent high so fast drum hits don\'t vanish before you spot them.'
        : 'Peak hold: a thin line remembering recent highs so fast drum hits and spikes don\'t vanish before you spot them.',
    analyzerPower: (on: boolean) =>
      on ? 'Analyzer on: click to switch it off' : 'Analyzer off: click to switch it back on',
    split: (on: boolean, levelView: 'line' | 'bars') =>
      on
        ? `Swap the halves: ${levelView} and heat change places`
        : `Split: ${levelView} (the last used of line and bars) in one half of the graph, heat in the other (click again to swap them)`,
    fullscreen: (full: boolean) =>
      full ? 'Back to the window (Esc)' : 'Fullscreen: the graph fills the screen',
    heatSensitivity:
      'Heat sensitivity: reveals faint room hum, breath, or harmonics (up) or keeps only loud hits glowing (down).\nScroll or drag (double-click: linear).',
  },

  topBar: {
    power: (isDesktop: boolean, on: boolean, where: string) =>
      !isDesktop
        ? `EQ ${on ? 'on' : 'off'} (B). The browser version has no sound; the desktop app shapes your system audio.`
        : on
          ? `CorvidEQ is on: Equalizer APO uses it, also when the app is closed.\nClick to go back to your previous setup (restored exactly).\n${where}`
          : `CorvidEQ is off: your previous Equalizer APO setup is in use.\nClick to switch to CorvidEQ (your config.txt is saved first and comes back exactly when you switch off).\n${where}`,
    brand: 'About CorvidEQ',
    sourcePicker: 'Which device the analyzer and level meter listen to, and whose EQ you\'re editing (and what Windows says about it)',
    sourceRate: (khz: string) =>
      `Sample rate: ${khz}—thousands of snapshots of the sound wave per second. Half of it (Nyquist) is the highest pitch this device can carry.\nChange in Windows' sound settings.`,
    sourceDefault: 'Listen to whatever Windows plays to; switches along when the default changes',
    sourceInput:
      'Listening opens this input, so Windows shows it as in use. The app starts on an output again next time; this input\'s EQ keeps working.',
    splitButton: (on: boolean) =>
      on
        ? 'Click: back to one shared EQ for both channels.'
        : 'Click: split into separate left and right EQs (starting as copies). Helpful if one speaker sits near a wall and sounds bass-heavier.',
    bandCount: (min: number, max: number) =>
      `Bands (${min}–${max}): each band is one filter shaping part of the sound. Fewer bands keep changes smooth; more bands fix tiny room peaks.\nScroll or drag, or click to type.`,
    bandRemove: 'Remove the last band',
    bandAdd: 'Add a band (placed in the widest empty stretch of the spectrum)',
    undo: 'Undo (Ctrl+Z)',
    redo: 'Redo (Ctrl+Y)',
    update: (version: string) => `Update CorvidEQ to v${version}`,
    settings: 'Settings',
  },

  bottomBar: {
    bypass:
      'Bypass (B): hear without the EQ, loudness-matched (never louder than 0 dB) so louder volume doesn\'t trick your ears into sounding "better".\nBalance and delay stay on.',
    ab: (slot: 'A' | 'B') =>
      `You're hearing EQ ${slot}. Click to switch to ${slot === 'A' ? 'B' : 'A'}.\nFlip between two EQs instantly to compare—the first time B opens, it starts as a copy of A.`,
    lr: (side: 'L' | 'R') =>
      `You're editing the ${side === 'L' ? 'left' : 'right'} EQ. Click to edit the ${side === 'L' ? 'right' : 'left'} one.\nUseful when your room or speakers sound uneven left vs right.`,
    delay: (sideName: string) =>
      `Delay the ${sideName.toLowerCase()} speaker if it's closer to you so both reach your ears together.\nSound travels about 34 cm in 1 ms.`,
    balance: (balanceText: string) =>
      `${balanceText}\nTurns the louder side down so the center image sits right in front of you (never boosts, so it won't clip).\nScroll (Shift = fine) or drag. Double-click = center.`,
  },

  levelMeter: {
    body:
      `Output peak meter in dBFS (0 is the digital ceiling). Green and yellow are healthy; peaks jump on drum hits.\n${RED_LEDS}\nClick to switch meter on/off.`,
    red: RED_LEDS,
  },

  presets: {
    picker: 'Load a preset (Default = every band flat, no changes)',
    unsavedDot: 'Changed since this preset: not saved',
    saveMenuItem: 'Save what you hear as a preset',
    deletePreset: 'Delete this preset',
    importFiles: 'One or several preset files: Equalizer APO .txt, or JSON presets from other Equalizer APO apps',
    importFolder: 'Every preset file in a folder',
    builtInLocked: 'Built in: can\'t be overwritten or deleted',
    overwritePick: 'Use this name (overwrites this preset)',
    exportFile: 'Save the EQ as an Equalizer APO config file (to share, or to keep a copy)',
  },
} as const;
