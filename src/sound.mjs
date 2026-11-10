// Key and click sounds, synthesised and mixed into one track for the film.
// Nothing is sampled: a key is a short filtered noise burst, a click is two.
const RATE = 48_000;

// Seeded, so the same cut always sounds the same.
function noise(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2147483648 - 1;
  };
}

/** Add one burst at `at` seconds: noise through a low-pass, with a fast decay. */
function burst(samples, random, at, { level, decay, tone }) {
  const start = Math.round(at * RATE), length = Math.round(decay * 6 * RATE);
  let low = 0;
  for (let i = 0; i < length && start + i < samples.length; i++) {
    low += tone * (random() - low);
    const attack = Math.min(1, i / (0.0015 * RATE));
    samples[start + i] += low * attack * Math.exp(-i / (decay * RATE)) * level;
  }
}

/** The sounds of a film as mono 16-bit WAV bytes. `sounds` is [{ t, kind }] in film time. */
export function mixSounds(sounds, duration, seed = 7) {
  const samples = new Float32Array(Math.ceil(duration * RATE));
  const random = noise(seed);
  for (const sound of sounds) {
    // No two keys sound alike under a hand.
    const vary = 0.8 + (random() + 1) * 0.2;
    if (sound.kind === "click") {
      burst(samples, random, sound.t, { level: 0.5, decay: 0.004, tone: 0.55 });
      burst(samples, random, sound.t + 0.075, { level: 0.32, decay: 0.004, tone: 0.6 });
    } else burst(samples, random, sound.t, { level: 0.42 * vary, decay: 0.009, tone: 0.22 + 0.1 * vary });
  }
  const data = Buffer.alloc(44 + samples.length * 2);
  data.write("RIFF", 0); data.writeUInt32LE(36 + samples.length * 2, 4); data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(RATE, 24); data.writeUInt32LE(RATE * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write("data", 36); data.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return data;
}
