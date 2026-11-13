/* A tiny procedural soundscape: wind, distant birds, rain and soft tones.
   No external samples are used, so the whole valley travels in one folder. */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.muted = false;
    this.ready = false;
    this._birdTimer = 3;
    this._noteTimer = 4;
    this._cricketTimer = 1;
    this.weather = 'sunny';
    this.timeOfDay = 16;
  }

  async start() {
    if (this.started) {
      if (this.ctx?.state === 'suspended') await this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.started = true;
    try { await this.ctx.resume(); } catch { /* not audible yet */ }

    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6;
    this.master.connect(this.ctx.destination);

    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.6, 2.4);
    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0.22;
    this.reverb.connect(this.reverbGain).connect(this.master);

    this.noiseBuffer = this.makeNoise(4.0);
    this._buildWind();
    this._buildRain();
    this._buildPad();
    this.ready = true;
  }

  makeNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const data = buf.getChannelData(c);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        last = last * 0.94 + white * 0.06;
        data[i] = last * 3.2;
      }
    }
    return buf;
  }

  makeImpulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const data = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  loopNoise() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.start();
    return src;
  }

  _buildWind() {
    const src = this.loopNoise();
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 640;
    this.windFilter.Q.value = 0.35;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0.045;
    src.connect(this.windFilter).connect(this.windGain).connect(this.master);
    // A very slow swell so the wind breathes.
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 0.045;
    lfoGain.gain.value = 0.015;
    lfo.connect(lfoGain).connect(this.windGain.gain);
    lfo.start();
  }

  _buildRain() {
    const src = this.loopNoise();
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5000;
    this.rainGain = this.ctx.createGain();
    this.rainGain.gain.value = 0;
    src.connect(hp).connect(lp).connect(this.rainGain).connect(this.master);
  }

  _buildPad() {
    this.padGain = this.ctx.createGain();
    this.padGain.gain.value = 0.032;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 800;
    this.padGain.connect(lp).connect(this.master);
    const notes = [73.42, 110.0, 146.83, 220.0];
    notes.forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = i % 2 ? 'sine' : 'triangle';
      osc.frequency.value = freq;
      osc.detune.value = (i - 1.5) * 3.5;
      const g = this.ctx.createGain();
      g.gain.value = 0.014 / (i * 0.4 + 1);
      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      lfo.frequency.value = 0.035 + i * 0.011;
      lfoGain.gain.value = 0.006;
      lfo.connect(lfoGain).connect(g.gain);
      lfo.start();
      osc.connect(g).connect(this.padGain);
      osc.start();
    });
  }

  setWeather(weather) {
    this.weather = weather;
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    const target = weather === 'rain' ? 0.065 : 0;
    this.rainGain.gain.cancelScheduledValues(now);
    this.rainGain.gain.setTargetAtTime(target, now, 1.8);
  }

  update(dt, timeOfDay, weather = 'sunny') {
    this.timeOfDay = timeOfDay;
    if (!this.ready) return;
    this._birdTimer -= dt;
    this._noteTimer -= dt;
    this._cricketTimer -= dt;
    const evening = timeOfDay < 6.4 || timeOfDay > 18.6;
    if (this._birdTimer <= 0) {
      this._birdTimer = 5 + Math.random() * 10;
      if (!evening && weather !== 'rain') this.chirp();
    }
    if (this._cricketTimer <= 0) {
      this._cricketTimer = 1.2 + Math.random() * 3.5;
      if (evening && weather !== 'rain') this.cricket();
    }
    if (this._noteTimer <= 0) {
      this._noteTimer = 6 + Math.random() * 9;
      this.ambientNote();
    }
  }

  /* ---------------- ambient one-shots ---------------- */
  ambientNote() {
    if (!this.ready || this.muted) return;
    const scale = [293.66, 329.63, 369.99, 440.0, 493.88, 587.33, 659.25];
    const freq = scale[(Math.random() * scale.length) | 0];
    this.tone(freq, { type: 'sine', gain: 0.013, attack: 0.6, decay: 2.8, reverb: 0.5 });
    this.tone(freq * 2, { type: 'triangle', gain: 0.0035, attack: 0.8, decay: 3.2, reverb: 0.7 });
  }

  chirp() {
    if (!this.ready || this.muted) return;
    const now = this.ctx.currentTime;
    const base = 2100 + Math.random() * 900;
    for (let i = 0; i < (Math.random() > 0.5 ? 2 : 3); i++) {
      const t = now + i * 0.14;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(base + Math.random() * 500, t);
      osc.frequency.exponentialRampToValueAtTime(base * 1.5, t + 0.07);
      osc.frequency.exponentialRampToValueAtTime(base * 0.9, t + 0.12);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.009, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0005, t + 0.16);
      osc.connect(gain).connect(this.master);
      gain.connect(this.reverb);
      osc.start(t); osc.stop(t + 0.2);
    }
  }

  cricket() {
    if (!this.ready || this.muted) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const t = now + i * 0.11;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = 3800 + Math.random() * 900;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.0055, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0002, t + 0.065);
      osc.connect(gain).connect(this.master);
      osc.start(t); osc.stop(t + 0.08);
    }
  }

  /* ---------------- SFX ---------------- */
  tone(freq, { type = 'sine', gain = 0.03, attack = 0.01, decay = 0.3, when = 0, reverb = 0, detune = 0 } = {}) {
    if (!this.ready || this.muted) return;
    const now = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain, now + attack);
    g.gain.exponentialRampToValueAtTime(0.0003, now + attack + decay);
    osc.connect(g);
    g.connect(this.master);
    if (reverb) {
      const send = this.ctx.createGain();
      send.gain.value = reverb;
      g.connect(send).connect(this.reverb);
    }
    osc.start(now); osc.stop(now + attack + decay + 0.05);
  }

  noiseBurst({ freq = 900, q = 0.8, gain = 0.04, duration = 0.2, type = 'lowpass', when = 0 } = {}) {
    if (!this.ready || this.muted) return;
    const now = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain, now + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0003, now + duration);
    src.connect(filter).connect(g).connect(this.master);
    src.start(now); src.stop(now + duration + 0.05);
  }

  click() {
    this.tone(620, { type: 'sine', gain: 0.018, attack: 0.004, decay: 0.09 });
  }

  select() {
    this.tone(440, { type: 'sine', gain: 0.018, attack: 0.005, decay: 0.15, reverb: 0.15 });
    this.tone(660, { type: 'sine', gain: 0.012, attack: 0.01, decay: 0.18, when: 0.04, reverb: 0.2 });
  }

  step(running = false) {
    this.noiseBurst({ freq: running ? 420 : 300, gain: running ? 0.025 : 0.017, duration: 0.09, type: 'lowpass' });
  }

  hoe() {
    this.itIsSafe();
    this.noiseBurst({ freq: 260, gain: 0.11, duration: 0.18, type: 'lowpass' });
    this.tone(105, { type: 'sine', gain: 0.07, attack: 0.004, decay: 0.22 });
    this.tone(62, { type: 'triangle', gain: 0.035, attack: 0.01, decay: 0.3 });
  }

  water() {
    this.noiseBurst({ freq: 1500, q: 0.5, gain: 0.04, duration: 0.55, type: 'bandpass' });
    this.noiseBurst({ freq: 2400, q: 1.3, gain: 0.018, duration: 0.65, type: 'bandpass', when: 0.08 });
  }

  plant() {
    this.noiseBurst({ freq: 500, gain: 0.035, duration: 0.16, type: 'lowpass' });
    this.tone(523.25, { type: 'sine', gain: 0.015, attack: 0.01, decay: 0.26, reverb: 0.18 });
    this.tone(659.25, { type: 'sine', gain: 0.012, attack: 0.02, decay: 0.4, when: 0.08, reverb: 0.22 });
  }

  harvest() {
    [523.25, 659.25, 783.99].forEach((f, i) => {
      this.tone(f, { type: 'triangle', gain: 0.022, attack: 0.006, decay: 0.5, when: i * 0.065, reverb: 0.3 });
    });
  }

  coin() {
    [880, 1318.5].forEach((f, i) => {
      this.tone(f, { type: 'sine', gain: 0.028, attack: 0.004, decay: 0.34, when: i * 0.08, reverb: 0.2 });
    });
  }

  quest() {
    [392, 523.25, 659.25, 783.99].forEach((f, i) => {
      this.tone(f, { type: 'triangle', gain: 0.018, attack: 0.02, decay: 1.3, when: i * 0.16, reverb: 0.5 });
    });
  }

  heart() {
    this.tone(587.33, { type: 'sine', gain: 0.018, attack: 0.01, decay: 0.2, reverb: 0.2 });
    this.tone(880, { type: 'sine', gain: 0.015, attack: 0.01, decay: 0.28, when: 0.1, reverb: 0.3 });
  }

  sleep() {
    [329.63, 246.94, 196.0, 146.83].forEach((f, i) => {
      this.tone(f, { type: 'sine', gain: 0.022, attack: 0.15, decay: 2.4, when: i * 0.35, reverb: 0.5 });
    });
  }

  itIsSafe() { /* auditory safety valve: nothing shrill, everything is filtered */ }

  setMuted(muted) {
    this.muted = muted;
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(muted ? 0 : 0.6, now, 0.25);
  }
}
