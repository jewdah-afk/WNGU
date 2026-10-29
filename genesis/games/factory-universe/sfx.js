// Procedural SFX (Web Audio). No samples: every sound is synthesised, so it
// ships with the code and can be retuned like any other parameter.
export class Sfx {
  constructor() { this.ctx = null; this.last = {}; this.hum = null; }
  unlock() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(this.ctx.destination);
      this.startHum();
    } catch (e) { this.ctx = null; }
  }
  noise(dur) {
    const b = this.ctx.createBuffer(1, Math.ceil(this.ctx.sampleRate * dur), this.ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = this.ctx.createBufferSource(); s.buffer = b; return s;
  }
  env(node, t, a, peak, dec) {
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
    node.connect(g); return g;
  }
  out(node, pan = 0) {
    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (p) { p.pan.value = pan; node.connect(p); p.connect(this.master); } else node.connect(this.master);
  }
  tone(type, f0, f1, t, dur, peak, pan) {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    this.out(this.env(o, t, 0.005, peak, dur), pan); o.start(t); o.stop(t + dur + 0.05);
  }
  play(kind, pan = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const gap = { smelt: 0.18, craft: 0.09, build: 0.03, remove: 0.03, click: 0.03, research: 0.5 }[kind] || 0.05;
    if (this.last[kind] && t - this.last[kind] < gap) return;
    this.last[kind] = t;
    if (kind === "build") {
      this.tone("square", 180, 70, t, 0.09, 0.18, pan);
      const n = this.noise(0.08), f = this.ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 1400; n.connect(f);
      this.out(this.env(f, t, 0.002, 0.3, 0.07), pan); n.start(t);
    } else if (kind === "remove") {
      this.tone("triangle", 260, 520, t, 0.08, 0.15, pan);
    } else if (kind === "click") {
      this.tone("square", 900, 600, t, 0.025, 0.06, pan);
    } else if (kind === "craft") {
      // ratchet click + small metallic ping
      this.tone("square", 1400 + Math.random() * 300, 900, t, 0.03, 0.05, pan);
      this.tone("sine", 2100 + Math.random() * 200, 2000, t + 0.01, 0.12, 0.035, pan);
    } else if (kind === "smelt") {
      const n = this.noise(0.25), f = this.ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 500; f.Q.value = 0.7; n.connect(f);
      this.out(this.env(f, t, 0.02, 0.06, 0.22), pan); n.start(t);
    } else if (kind === "research") {
      [523, 659, 784, 1046].forEach((fq, i) => this.tone("triangle", fq, fq, t + i * 0.09, 0.35, 0.12, 0));
    }
  }
  startHum() {
    const c = this.ctx;
    const n = this.noise(2); n.loop = true;
    const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 220;
    const o = c.createOscillator(); o.type = "sawtooth"; o.frequency.value = 55;
    const of = c.createBiquadFilter(); of.type = "lowpass"; of.frequency.value = 160;
    const g = c.createGain(); g.gain.value = 0;
    n.connect(f); f.connect(g); o.connect(of); of.connect(g); g.connect(this.master);
    n.start(); o.start();
    this.hum = g;
  }
  // factory hum follows the number of working machines (real sim state)
  ambient(st) {
    if (!this.hum || !this.ctx) return;
    let n = 0; for (const id of st.order) { const e = st.ents.get(id); if (e.working && e.type !== "belt") n++; }
    const target = Math.min(0.12, 0.012 * Math.sqrt(n));
    this.hum.gain.setTargetAtTime(target, this.ctx.currentTime, 0.4);
  }
}
