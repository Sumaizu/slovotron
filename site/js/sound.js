const D5 = 587.3, FS5 = 740, A5 = 880, D6 = 1174.7, E6 = 1318.5, FS6 = 1480, A6 = 1760;
const LOUDNESS = 1.3;
const REVERB_SECONDS = 1.5;
const REVERB_LEVEL = 0.32;

const RECIPES = {
  tick(studio, at) {
    studio.pop(at, 900, 720, 0.05, 0.4);
  },
  start(studio, at) {
    studio.swish(at, 350, 3200, 0.42, 0.22);
    [D5, A5, E6].forEach((note, i) => studio.bell(at + 0.3 + i * 0.03, note, 0.95, 0.3));
  },
  best(studio, at) {
    studio.pop(at, 420, 860, 0.08, 0.3);
    studio.bell(at + 0.03, A5, 0.5, 0.42);
    studio.bell(at + 0.1, E6, 0.55, 0.3);
  },
  hint(studio, at) {
    studio.pop(at, 1050, 680, 0.1, 0.4);
    studio.bell(at + 0.05, E6, 0.45, 0.3, 2, 0.6);
    studio.bell(at + 0.16, A5, 0.6, 0.28, 2, 0.6);
  },
  win(studio, at) {
    [D5, FS5, A5, D6, FS6].forEach((note, i) => studio.bell(at + i * 0.065, note, 0.85, 0.32));
    studio.swish(at + 0.12, 1800, 6500, 0.5, 0.1);
    studio.pad(at + 0.26, [293.7, 440, FS5], 1.6, 0.1);
    [A5, D6, FS6, A6].forEach((note, i) => studio.bell(at + 0.75 + i * 0.09, note, 0.9, 0.24));
  },
  end(studio, at) {
    [A5, FS5, D5].forEach((note, i) => studio.bell(at + i * 0.15, note, 0.75, 0.3, 2, 0.7));
  },
};

export const SOUNDS = Object.keys(RECIPES);

function reverbImpulse(context) {
  const rate = context.sampleRate;
  const impulse = context.createBuffer(2, Math.floor(rate * REVERB_SECONDS), rate);
  for (let channel = 0; channel < 2; channel++) {
    const samples = impulse.getChannelData(channel);
    let smooth = 0;
    for (let i = 0; i < samples.length; i++) {
      smooth = smooth * 0.65 + (Math.random() * 2 - 1) * 0.35;
      samples[i] = smooth * Math.pow(1 - i / samples.length, 3);
    }
  }
  return impulse;
}

function whiteNoise(context) {
  const noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const samples = noise.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  return noise;
}

function createStudio(context) {
  const master = context.createGain(), limiter = context.createDynamicsCompressor();
  const bus = context.createGain(), reverb = context.createConvolver(), wet = context.createGain();
  const noise = whiteNoise(context);
  reverb.buffer = reverbImpulse(context);
  wet.gain.value = REVERB_LEVEL;
  limiter.threshold.value = -12;
  limiter.knee.value = 12;
  limiter.ratio.value = 4;
  bus.connect(master);
  bus.connect(reverb);
  reverb.connect(wet);
  wet.connect(master);
  master.connect(limiter);
  limiter.connect(context.destination);

  const envelope = (at, duration, level, attack) => {
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(level, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    gain.connect(bus);
    return gain;
  };

  return {
    master,
    bell(at, frequency, duration, level, ratio = 3.5, brightness = 1.1) {
      const carrier = context.createOscillator(), modulator = context.createOscillator();
      const depth = context.createGain();
      const amount = frequency * brightness * Math.min(1, 900 / frequency);
      carrier.frequency.value = frequency;
      modulator.frequency.value = frequency * ratio;
      depth.gain.setValueAtTime(amount, at);
      depth.gain.exponentialRampToValueAtTime(amount * 0.02, at + 0.14);
      modulator.connect(depth);
      depth.connect(carrier.frequency);
      carrier.connect(envelope(at, duration, level, 0.006));
      for (const oscillator of [carrier, modulator]) {
        oscillator.start(at);
        oscillator.stop(at + duration + 0.05);
      }
    },
    pop(at, from, to, duration, level) {
      const oscillator = context.createOscillator();
      oscillator.frequency.setValueAtTime(from, at);
      oscillator.frequency.exponentialRampToValueAtTime(to, at + duration);
      oscillator.connect(envelope(at, duration * 1.6, level, 0.004));
      oscillator.start(at);
      oscillator.stop(at + duration * 1.6 + 0.05);
    },
    swish(at, from, to, duration, level) {
      const source = context.createBufferSource(), filter = context.createBiquadFilter();
      source.buffer = noise;
      source.loop = true;
      filter.type = 'bandpass';
      filter.Q.value = 0.9;
      filter.frequency.setValueAtTime(from, at);
      filter.frequency.exponentialRampToValueAtTime(to, at + duration);
      source.connect(filter);
      filter.connect(envelope(at, duration, level, duration * 0.4));
      source.start(at);
      source.stop(at + duration + 0.05);
    },
    pad(at, frequencies, duration, level) {
      for (const frequency of frequencies) {
        const oscillator = context.createOscillator();
        oscillator.frequency.value = frequency;
        oscillator.connect(envelope(at, duration, level, 0.16));
        oscillator.start(at);
        oscillator.stop(at + duration + 0.05);
      }
    },
  };
}

const gainFor = (volume) => Math.max(0, Math.min(100, Number(volume) || 0)) / 100 * LOUDNESS;

let context = null, studio = null;

export function play(name, volume) {
  const recipe = RECIPES[name], gain = gainFor(volume);
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!recipe || !gain || !AudioContext) return;
  try {
    if (!context) {
      context = new AudioContext();
      studio = createStudio(context);
    }
    if (context.state === 'suspended') context.resume().catch(() => {});
    studio.master.gain.value = gain;
    recipe(studio, context.currentTime + 0.03);
  } catch (error) {
    context = null;
  }
}

export function playAll(volume) {
  const order = ['tick', 'start', 'best', 'hint', 'end', 'win'];
  order.forEach((name, i) => setTimeout(() => play(name, volume), i * 1100));
}

export async function measure(name, volume) {
  const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext, rate = 44100;
  const offline = new OfflineContext(2, rate * 4, rate);
  const rendering = createStudio(offline);
  rendering.master.gain.value = gainFor(volume);
  RECIPES[name](rendering, 0.05);
  const samples = (await offline.startRendering()).getChannelData(0);
  let peak = 0, power = 0, end = 0;
  for (let i = 0; i < samples.length; i++) {
    const level = Math.abs(samples[i]);
    if (level > peak) peak = level;
    if (level > 0.002) end = i;
    power += level * level;
  }
  return { peak, rms: Math.sqrt(power / samples.length), seconds: end / rate, samples };
}
