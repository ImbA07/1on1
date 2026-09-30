// Ton, komplett im Code erzeugt (WebAudio), ohne Sounddateien.
// Wird erst nach dem ersten Klick/Tastendruck aktiv (Browser-Regel).

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private ambientNodes: AudioNode[] = [];
  private ambientOn = false;
  muted = false;
  private volume = 0.75;

  /** Beim ersten Klick/Tastendruck aufrufen. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      // Weisses Rauschen (1,5 s) als Grundstoff
      const len = Math.floor(this.ctx.sampleRate * 1.5);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      if (this.ambientOn) this.startAmbient();
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  private ok(): boolean {
    return !!(this.ctx && this.master && this.noise && this.ctx.state === 'running' && !this.muted);
  }

  private out(pan: number): AudioNode {
    const ctx = this.ctx!;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.master!);
    return p;
  }

  private noiseSrc(dur: number): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise!;
    s.loop = true;
    s.start(this.ctx!.currentTime, Math.random());
    s.stop(this.ctx!.currentTime + dur);
    return s;
  }

  /** Gleitende Lautstaerke-Huellkurve. */
  private env(g: GainNode, t: number, peak: number, attack: number, dur: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  /** Schwerthieb: Zischen, das durch den Frequenzbereich zieht. */
  swoosh(pan = 0, power = 1): void {
    if (!this.ok()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = this.noiseSrc(0.5);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.4;
    f.frequency.setValueAtTime(450, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + 0.11);
    f.frequency.exponentialRampToValueAtTime(700, t + 0.32);
    const g = ctx.createGain();
    this.env(g, t, 0.55 * power, 0.07, 0.34);
    src.connect(f).connect(g).connect(this.out(pan));
  }

  /** Metall auf Metall. `perfect` = heller, laenger, mit Nachklang. */
  clang(pan = 0, perfect = false): void {
    if (!this.ok()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const out = this.out(pan);
    const base = (perfect ? 1250 : 880) + Math.random() * 220;
    const partials = [1, 2.32, 4.25, 6.63, 9.1];
    const gains = [0.5, 0.36, 0.24, 0.13, 0.07];
    const decays = [0.55, 0.42, 0.3, 0.2, 0.12];
    partials.forEach((r, i) => {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'triangle' : 'sine';
      o.frequency.value = base * r;
      const g = ctx.createGain();
      const d = decays[i]! * (perfect ? 2.4 : 1);
      this.env(g, t, gains[i]! * (perfect ? 0.85 : 0.65), 0.002, d);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + d + 0.05);
    });
    // Klick beim Aufprall
    const src = this.noiseSrc(0.1);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3200;
    const g = ctx.createGain();
    this.env(g, t, perfect ? 0.6 : 0.45, 0.001, 0.05);
    src.connect(hp).connect(g).connect(out);
  }

  /** Aufprall auf den Koerper (Treffer): dumpf, mit Rüstungsklank. */
  thud(pan = 0, zone = 1, heavy = false): void {
    if (!this.ok()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const out = this.out(pan);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(zone === 0 ? 170 : 130, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.2);
    const g = ctx.createGain();
    this.env(g, t, heavy ? 0.95 : 0.7, 0.004, heavy ? 0.5 : 0.3);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.6);
    const src = this.noiseSrc(0.2);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    const ng = ctx.createGain();
    this.env(ng, t, 0.5, 0.002, 0.12);
    src.connect(lp).connect(ng).connect(out);
    // Platte klirrt
    const c = ctx.createOscillator();
    c.type = 'square';
    c.frequency.value = 520 + Math.random() * 200;
    const cf = ctx.createBiquadFilter();
    cf.type = 'bandpass';
    cf.frequency.value = 1400;
    cf.Q.value = 3;
    const cg = ctx.createGain();
    this.env(cg, t, 0.16, 0.002, 0.14);
    c.connect(cf).connect(cg).connect(out);
    c.start(t);
    c.stop(t + 0.2);
  }

  /** Block durchbrochen: Krachen. */
  crack(pan = 0): void {
    if (!this.ok()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const out = this.out(pan);
    const src = this.noiseSrc(0.5);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.exponentialRampToValueAtTime(180, t + 0.35);
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    this.env(g, t, 0.8, 0.003, 0.4);
    src.connect(bp).connect(g).connect(out);
    this.clang(pan, false);
  }

  /** Tiefer Schlag, z. B. wenn jemand zu Boden geht. */
  boom(): void {
    if (!this.ok()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.7);
    const g = ctx.createGain();
    this.env(g, t, 0.9, 0.01, 0.9);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + 1);
  }

  /** Kurzer, steigender Ton (wieder aufgestanden). */
  rise(): void {
    if (!this.ok()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(440, t + 0.35);
    const g = ctx.createGain();
    this.env(g, t, 0.3, 0.03, 0.5);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + 0.6);
  }

  /** Trommelschlag (Countdown). */
  drum(strong = false): void {
    if (!this.ok()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(strong ? 110 : 90, t);
    o.frequency.exponentialRampToValueAtTime(strong ? 48 : 55, t + 0.25);
    const g = ctx.createGain();
    this.env(g, t, strong ? 0.85 : 0.55, 0.004, strong ? 0.7 : 0.4);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + 0.8);
  }

  /** Horn (Kampfbeginn, Rundenende). */
  horn(long = false, low = false): void {
    if (!this.ok()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const dur = long ? 1.9 : 1.1;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(600, t);
    lp.frequency.linearRampToValueAtTime(1500, t + 0.25);
    lp.frequency.linearRampToValueAtTime(700, t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.28, 0.12, dur);
    lp.connect(g).connect(this.master!);
    const notes = low ? [117, 175] : [233, 349];
    for (const f of notes) {
      for (const detune of [-6, 5]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = detune;
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 0.1);
      }
    }
  }

  /** Leiser Wind im Hintergrund. */
  setAmbient(on: boolean): void {
    this.ambientOn = on;
    if (!this.ctx) return;
    if (on) this.startAmbient();
    else this.stopAmbient();
  }

  private startAmbient(): void {
    if (!this.ctx || !this.noise || !this.master || this.ambientNodes.length) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    const g = ctx.createGain();
    g.gain.value = 0.07;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.035;
    lfo.connect(lfoGain).connect(g.gain);
    const hiss = ctx.createBiquadFilter();
    hiss.type = 'bandpass';
    hiss.frequency.value = 1300;
    hiss.Q.value = 0.6;
    const hg = ctx.createGain();
    hg.gain.value = 0.012;
    src.connect(lp).connect(g).connect(this.master);
    src.connect(hiss).connect(hg).connect(this.master);
    src.start();
    lfo.start();
    this.ambientNodes = [src, lfo, g, hg, lp, hiss, lfoGain];
  }

  private stopAmbient(): void {
    for (const n of this.ambientNodes) {
      try {
        (n as AudioScheduledSourceNode).stop?.();
      } catch {
        // war schon gestoppt
      }
      n.disconnect();
    }
    this.ambientNodes = [];
  }
}
