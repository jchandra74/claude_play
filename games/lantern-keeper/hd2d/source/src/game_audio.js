// Synthesised music + SFX, ported verbatim from the original 2D Lantern Keeper (WebAudio step sequencer).
const qs = new URLSearchParams(location.search);
const NOTE_I = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
function noteFreq(n) {
  const m = /^([A-G][#b]?)(-?\d)$/.exec(n);
  if (!m) return 0;
  const midi = (parseInt(m[2], 10) + 1) * 12 + NOTE_I[m[1]];
  return 440 * Math.pow(2, (midi - 69) / 12);
}
function parseChord(tok) { return (tok.match(/[A-G][#b]?-?\d/g) || []).map(noteFreq); }

const audio = {
  ctx: null, master: null, music: null, sfx: null, noise: null, verb: null,
  muted: qs.has('mute'), song: null, songName: '', step: 0, nextT: 0, timer: 0, musicVol: 0.55,
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(c.destination);
    this.music = c.createGain(); this.music.gain.value = this.musicVol; this.music.connect(this.master);
    this.sfx = c.createGain(); this.sfx.gain.value = 0.7; this.sfx.connect(this.master);
    /* small feedback delay as a cheap "room" */
    const d = c.createDelay(); d.delayTime.value = 0.23;
    const fb = c.createGain(); fb.gain.value = 0.32;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    this.verb = c.createGain(); this.verb.gain.value = 0.5;
    this.verb.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(this.master);
    const len = c.sampleRate;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const ch = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    this.timer = setInterval(() => this.tick(), 25);
    if (this.pending) { const p = this.pending; this.pending = null; this.play(p); }
  },
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05); },
  play(name) {
    if (name === this.songName) return;
    this.songName = name;
    if (!this.ctx) { this.pending = name; return; }
    const c = this.ctx, t = c.currentTime;
    this.music.gain.cancelScheduledValues(t);
    this.music.gain.setValueAtTime(this.music.gain.value, t);
    this.music.gain.linearRampToValueAtTime(0.0001, t + 0.25);
    setTimeout(() => {
      if (this.songName !== name) return;
      this.song = SONGS[name] || null; this.step = 0; this.nextT = this.ctx.currentTime + 0.06;
      this.music.gain.cancelScheduledValues(this.ctx.currentTime);
      this.music.gain.setValueAtTime(this.musicVol * (this.song && this.song.vol || 1), this.ctx.currentTime);
    }, 270);
  },
  stopMusic() { this.songName = ''; this.song = null; },
  tick() {
    const s = this.song;
    if (!s || !this.ctx) return;
    const stepDur = 60 / s.bpm / 2;
    while (this.nextT < this.ctx.currentTime + 0.12) {
      for (const tr of s.tracks) {
        const tok = tr.seq[this.step % tr.seq.length];
        if (!tok || tok === '.' || tok === '-') continue;
        let len = 1;
        while (tr.seq[(this.step + len) % tr.seq.length] === '-' && len < tr.seq.length) len++;
        const dur = len * stepDur;
        if (tr.inst === 'drum') { this.drum(tok, this.nextT, tr.vol); continue; }
        for (const f of parseChord(tok)) this.voice(tr.inst, f, this.nextT, dur, tr.vol, this.music);
      }
      this.nextT += stepDur;
      this.step++;
      if (s.once && this.step >= s.tracks[0].seq.length) { this.song = null; break; }
    }
  },
  env(g, t, a, peak, dec, sus, dur, rel) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * sus), t + a + dec);
    g.gain.setValueAtTime(Math.max(0.0001, peak * sus), t + Math.max(a + dec, dur));
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a + dec, dur) + rel);
    return t + Math.max(a + dec, dur) + rel + 0.05;
  },
  voice(inst, f, t, dur, vol, out) {
    const c = this.ctx;
    const g = c.createGain(); g.connect(out);
    let end;
    if (inst === 'bell') {
      const o = c.createOscillator(), m = c.createOscillator(), mg = c.createGain();
      o.type = 'sine'; m.type = 'sine'; o.frequency.value = f; m.frequency.value = f * 3.5;
      mg.gain.setValueAtTime(f * 1.4, t); mg.gain.exponentialRampToValueAtTime(f * 0.05, t + 0.6);
      m.connect(mg); mg.connect(o.frequency); o.connect(g);
      const send = c.createGain(); send.gain.value = 0.5; g.connect(send); send.connect(this.verb);
      end = this.env(g, t, 0.004, vol, 0.9, 0.12, Math.min(dur, 0.4), 0.6);
      o.start(t); m.start(t); o.stop(end); m.stop(end);
    } else if (inst === 'pluck' || inst === 'lead') {
      const o = c.createOscillator(), lp = c.createBiquadFilter();
      o.type = inst === 'lead' ? 'square' : 'triangle';
      o.frequency.value = f;
      lp.type = 'lowpass'; lp.frequency.setValueAtTime(inst === 'lead' ? 2600 : 3800, t);
      lp.frequency.exponentialRampToValueAtTime(inst === 'lead' ? 1200 : 900, t + 0.3);
      if (inst === 'lead') {
        const v = c.createOscillator(), vg = c.createGain();
        v.frequency.value = 5.5; vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(f * 0.012, t + 0.25);
        v.connect(vg); vg.connect(o.frequency); v.start(t); v.stop(t + dur + 0.4);
      }
      o.connect(lp); lp.connect(g);
      const send = c.createGain(); send.gain.value = 0.35; g.connect(send); send.connect(this.verb);
      end = this.env(g, t, 0.006, vol, inst === 'lead' ? 0.12 : 0.25, inst === 'lead' ? 0.55 : 0.2, dur * 0.9, 0.12);
      o.start(t); o.stop(end);
    } else if (inst === 'bass') {
      const o = c.createOscillator(), o2 = c.createOscillator(), lp = c.createBiquadFilter();
      o.type = 'triangle'; o2.type = 'sine'; o.frequency.value = f; o2.frequency.value = f / 2;
      lp.type = 'lowpass'; lp.frequency.value = 900;
      o.connect(lp); o2.connect(lp); lp.connect(g);
      end = this.env(g, t, 0.005, vol, 0.2, 0.55, dur * 0.85, 0.08);
      o.start(t); o2.start(t); o.stop(end); o2.stop(end);
    } else if (inst === 'pad') {
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100; lp.Q.value = 0.5;
      lp.connect(g);
      const send = c.createGain(); send.gain.value = 0.4; g.connect(send); send.connect(this.verb);
      end = this.env(g, t, 0.35, vol, 0.4, 0.75, dur, 0.6);
      for (const det of [-7, 6]) {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
        o.connect(lp); o.start(t); o.stop(end);
      }
    }
  },
  drum(tok, t, vol) {
    const c = this.ctx;
    if (tok === 'k') {
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g); g.connect(this.music); o.start(t); o.stop(t + 0.25);
    } else {
      const s = c.createBufferSource(); s.buffer = this.noise;
      const f = c.createBiquadFilter(), g = c.createGain();
      f.type = tok === 'h' ? 'highpass' : 'bandpass';
      f.frequency.value = tok === 'h' ? 7000 : 1800;
      const d = tok === 'h' ? 0.04 : 0.16;
      g.gain.setValueAtTime(vol * (tok === 'h' ? 0.5 : 1), t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      s.connect(f); f.connect(g); g.connect(this.music);
      s.start(t, Math.random() * 0.5); s.stop(t + d + 0.02);
    }
  },
  /* one-off sound effects */
  tone(f, dur, type = 'square', vol = 0.2, slide = 0, delay = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f * slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + dur + 0.02);
  },
  hiss(dur, freq = 2000, vol = 0.3, type = 'bandpass', delay = 0, sweep = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; f.type = type; f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(freq * sweep, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.sfx); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  },
  sfxPlay(name, p = 1) {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case 'blip': this.tone(520 * p, 0.035, 'square', 0.05); break;
      case 'move': this.tone(880, 0.04, 'square', 0.06); break;
      case 'ok': this.tone(660, 0.06, 'square', 0.08); this.tone(990, 0.08, 'square', 0.08, 0, 0.05); break;
      case 'back': this.tone(440, 0.07, 'square', 0.07, 0.7); break;
      case 'bump': this.tone(110, 0.06, 'triangle', 0.15); break;
      case 'hit': this.hiss(0.12, 1400, 0.45, 'bandpass', 0, 0.4); this.tone(180, 0.1, 'square', 0.12, 0.5); break;
      case 'weak': this.hiss(0.16, 2600, 0.5, 'bandpass', 0, 0.3); this.tone(300, 0.14, 'sawtooth', 0.14, 0.4); this.tone(1200, 0.08, 'square', 0.06); break;
      case 'break':
        this.hiss(0.6, 5000, 0.6, 'highpass', 0, 0.3); this.tone(90, 0.5, 'sawtooth', 0.3, 0.4);
        for (let i = 0; i < 6; i++) this.tone(1800 + Math.random() * 2400, 0.12, 'triangle', 0.08, 0.6, i * 0.04);
        break;
      case 'fire': this.hiss(0.45, 600, 0.4, 'lowpass', 0, 4); this.tone(200, 0.3, 'sawtooth', 0.08, 2); break;
      case 'sass': for (let i = 0; i < 3; i++) this.tone(700 - i * 150, 0.09, 'square', 0.08, 0.8, i * 0.07); break;
      case 'sling': this.tone(1400, 0.1, 'triangle', 0.14, 0.3); this.hiss(0.06, 3000, 0.25); break;
      case 'heal': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.1, 1, i * 0.06)); break;
      case 'boost': this.tone(330 * p, 0.18, 'sawtooth', 0.08, 2); this.tone(660 * p, 0.15, 'triangle', 0.08, 1.5, 0.03); break;
      case 'enemyAtk': this.tone(160, 0.18, 'sawtooth', 0.14, 0.5); this.hiss(0.12, 900, 0.3); break;
      case 'die': this.tone(600, 0.5, 'square', 0.1, 0.1); this.hiss(0.5, 1200, 0.2, 'bandpass', 0, 0.2); break;
      case 'encounter':
        for (let i = 0; i < 10; i++) this.tone(200 + i * 90, 0.07, 'square', 0.07, 1, i * 0.035);
        this.hiss(0.5, 400, 0.3, 'bandpass', 0, 8);
        break;
      case 'gate': this.tone(90, 0.4, 'sawtooth', 0.1, 0.6); this.hiss(0.4, 500, 0.2); break;
      case 'item': [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.09, 1, i * 0.08)); break;
      case 'levelup': [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this.tone(f, 0.16, 'square', 0.07, 1, i * 0.08)); break;
      case 'whoosh': this.hiss(0.5, 300, 0.35, 'bandpass', 0, 10); break;
      case 'ignite':
        this.hiss(1.6, 200, 0.5, 'lowpass', 0, 20); this.tone(60, 1.4, 'sine', 0.4, 2);
        [523, 659, 784, 1046, 1318, 1568].forEach((f, i) => this.tone(f, 0.6, 'triangle', 0.07, 1, 0.6 + i * 0.08));
        break;
      case 'lampon': this.tone(1200 + Math.random() * 600, 0.12, 'triangle', 0.05); break;
      case 'flap': this.hiss(0.12, 500, 0.25, 'lowpass'); break;
      case 'save': [659, 784, 1046].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.08, 1, i * 0.1)); break;
    }
  },
};
const sfx = (n, p) => audio.sfxPlay(n, p);

/* songs: 8th-note steps; '.' rest, '-' hold; chords are concatenated notes */
function seq(s) { return s.replace(/\|/g, ' ').trim().split(/\s+/); }
function padBars(chords) { return chords.map(ch => [ch, '-', '-', '-', '-', '-', '-', '-'].join(' ')).join(' '); }
const SONGS = {
  title: {
    bpm: 78, vol: 0.9, tracks: [
      { inst: 'bell', vol: 0.16, seq: seq('A4 - C5 - F5 - E5 D5 | C5 - A4 - D5 - - . | D5 - C5 Bb4 A4 - G4 - | G4 - A4 Bb4 C5 - - . | A4 - C5 - F5 - G5 A5 | G5 - E5 - C5 - E5 - | D5 - F5 - E5 - G5 - | F5 - - - - . . .') },
      { inst: 'pad', vol: 0.05, seq: seq(padBars(['F3A3C4', 'D3F3A3', 'Bb2D3F3', 'C3E3G3', 'F3A3C4', 'A2C3E3', 'Bb2D3F3', 'F3A3C4'])) },
      { inst: 'bell', vol: 0.06, seq: seq('F3 . C4 . A3 . C4 . | D3 . A3 . F3 . A3 . | Bb2 . F3 . D3 . F3 . | C3 . G3 . E3 . G3 . | F3 . C4 . A3 . C4 . | A2 . E3 . C3 . E3 . | Bb2 . F3 . C3 . G3 . | F3 . C4 . F4 . . .') },
    ],
  },
  town: {
    bpm: 104, vol: 0.85, tracks: [
      { inst: 'bell', vol: 0.15, seq: seq('A4 - C5 - F5 - E5 D5 | C5 - A4 - D5 - - . | D5 - C5 Bb4 A4 - G4 - | G4 - A4 Bb4 C5 - - . | A4 - C5 - F5 - G5 A5 | G5 - E5 - C5 - E5 - | D5 - F5 - E5 - G5 - | F5 - - - - . C5 . | Bb4 - D5 - F5 - D5 - | A4 - C5 - F5 - - . | G4 - Bb4 - D5 - C5 Bb4 | A4 - G4 - F4 - - . | Bb4 - D5 - F5 - A5 - | G5 - F5 - E5 - D5 - | E5 - - G5 - - E5 - | C5 - - - . . . .') },
      { inst: 'pluck', vol: 0.11, seq: seq('F2 . C3 . F2 . C3 . | D2 . A2 . D2 . A2 . | Bb1 . F2 . Bb1 . F2 . | C2 . G2 . C2 . G2 . | F2 . C3 . F2 . C3 . | A1 . E2 . A1 . E2 . | Bb1 . F2 . C2 . G2 . | F2 . C3 . F2 . C2 . | Bb1 . F2 . Bb1 . F2 . | F2 . C3 . F2 . C3 . | G1 . D2 . G1 . D2 . | F2 . C3 . F2 . C3 . | Bb1 . F2 . Bb1 . F2 . | Bb1 . F2 . G1 . D2 . | C2 . G2 . C2 . G2 . | C2 . G2 . C2 . E2 .') },
      { inst: 'pad', vol: 0.035, seq: seq(padBars(['F3A3C4', 'D3F3A3', 'Bb2D3F3', 'C3E3G3', 'F3A3C4', 'A2C3E3', 'Bb2D3F3', 'F3A3C4', 'Bb2D3F3', 'F3A3C4', 'G2Bb2D3', 'F3A3C4', 'Bb2D3F3', 'G2Bb2D3', 'C3E3G3', 'C3E3G3Bb3'])) },
      { inst: 'drum', vol: 0.12, seq: seq('k . h . k h h . | k . h . k h h h') },
    ],
  },
  forest: {
    bpm: 84, vol: 0.9, tracks: [
      { inst: 'bell', vol: 0.13, seq: seq('E5 - - A4 C5 - B4 - | A4 - - - F4 - - . | G4 - B4 - D5 - C5 B4 | B4 - - - . . . . | E5 - - A5 G5 - E5 - | F5 - E5 - C5 - - . | D5 - F5 - E5 - D5 C5 | B4 - - - G#4 - - .') },
      { inst: 'pad', vol: 0.05, seq: seq(padBars(['A2C3E3', 'F2A2C3', 'G2B2D3', 'E2G2B2', 'A2C3E3', 'F2A2C3', 'D2F2A2', 'E2G#2B2'])) },
      { inst: 'bass', vol: 0.12, seq: seq('A1 - - - - - E2 - | F1 - - - - - C2 - | G1 - - - - - D2 - | E1 - - - - - B1 - | A1 - - - - - E2 - | F1 - - - - - C2 - | D2 - - - - - A1 - | E1 - - - E2 - - -') },
    ],
  },
  battle: {
    bpm: 150, vol: 0.85, tracks: [
      { inst: 'lead', vol: 0.06, seq: seq('G4 - C5 - Eb5 - D5 C5 | D5 - Bb4 - G4 - - . | Ab4 - C5 - Eb5 - F5 Eb5 | D5 - Bb4 - F5 - D5 - | G5 - Eb5 - C5 - G4 - | Ab4 G4 F4 - Eb4 - G4 - | C5 - Ab4 - Eb5 - C5 - | B4 - D5 - G5 - F5 D5') },
      { inst: 'bass', vol: 0.16, seq: seq('C2 C3 C2 C2 Bb1 C2 Eb2 C2 | C2 C3 C2 C2 G1 Bb1 C2 D2 | Ab1 Ab2 Ab1 Ab1 G1 Ab1 C2 Ab1 | Bb1 Bb2 Bb1 Bb1 F1 Bb1 D2 Bb1 | C2 C3 C2 C2 Bb1 C2 Eb2 C2 | C2 C3 C2 C2 G1 Bb1 C2 D2 | Ab1 Ab2 Ab1 Ab1 Eb2 Ab1 C2 Ab1 | G1 G2 G1 G1 D2 G1 B1 D2') },
      { inst: 'pad', vol: 0.03, seq: seq(padBars(['C3Eb3G3', 'C3Eb3G3', 'Ab2C3Eb3', 'Bb2D3F3', 'C3Eb3G3', 'C3Eb3G3', 'Ab2C3Eb3', 'G2B2D3'])) },
      { inst: 'drum', vol: 0.16, seq: seq('k h s h k k s h | k h s h k h s s') },
    ],
  },
  boss: {
    bpm: 164, vol: 0.85, tracks: [
      { inst: 'lead', vol: 0.065, seq: seq('D5 - F5 - A5 - G5 F5 | G5 - F5 - D5 - - . | E5 - G5 - C6 - Bb5 A5 | A5 - - - C#5 - E5 - | D5 - A4 D5 F5 - E5 D5 | Bb4 - D5 - F5 - G5 F5 | G5 - Bb5 - A5 - G5 F5 | E5 - - - A5 - C#5 -') },
      { inst: 'bass', vol: 0.17, seq: seq('D2 D3 D2 A1 D2 D3 C2 A1 | Bb1 Bb2 Bb1 F1 Bb1 Bb2 A1 F1 | C2 C3 C2 G1 C2 C3 Bb1 G1 | A1 A2 A1 E1 A1 A2 C#2 E2 | D2 D3 D2 A1 D2 D3 C2 A1 | Bb1 Bb2 Bb1 F1 Bb1 Bb2 A1 F1 | G1 G2 G1 D2 G1 G2 Bb1 D2 | A1 A2 A1 E1 A1 E2 C#2 A1') },
      { inst: 'pad', vol: 0.035, seq: seq(padBars(['D3F3A3', 'Bb2D3F3', 'C3E3G3', 'A2C#3E3', 'D3F3A3', 'Bb2D3F3', 'G2Bb2D3', 'A2C#3E3'])) },
      { inst: 'bell', vol: 0.05, seq: seq('. . A5 . . . A5 . | . . F5 . . . F5 . | . . G5 . . . G5 . | . . E5 . . . E5 . | . . A5 . . . A5 . | . . F5 . . . F5 . | . . G5 . . . Bb5 . | . . A5 . . . E5 .') },
      { inst: 'drum', vol: 0.17, seq: seq('k h s h k h s h | k h s h k k s s') },
    ],
  },
  victory: {
    bpm: 150, vol: 1, once: true, tracks: [
      { inst: 'lead', vol: 0.07, seq: seq('C5 C5 C5 - G4 - A4 - | C5 - A4 C5 - - - - | - - . . . . . .') },
      { inst: 'bell', vol: 0.12, seq: seq('E5 E5 E5 - B4 - C5 - | E5 - C5 E5 - - - - | - - . . . . . .') },
      { inst: 'bass', vol: 0.15, seq: seq('C2 . C2 . G1 . F1 . | C2 - - - - - - - | . . . . . . . .') },
    ],
  },
  fanfare: {
    bpm: 96, vol: 1, tracks: [
      { inst: 'bell', vol: 0.16, seq: seq('F5 - A5 - C6 - - A5 | Bb5 - A5 - G5 - F5 - | G5 - A5 - Bb5 - D6 - | C6 - - - - - . . | F5 - A5 - C6 - - A5 | D6 - C6 - Bb5 - A5 - | G5 - - A5 Bb5 - G5 - | F5 - - - - - . .') },
      { inst: 'lead', vol: 0.035, seq: seq('C5 - F5 - A5 - - F5 | F5 - F5 - D5 - D5 - | E5 - F5 - G5 - Bb5 - | A5 - - - - - . . | C5 - F5 - A5 - - F5 | Bb5 - A5 - G5 - F5 - | E5 - - F5 G5 - E5 - | C5 - - - - - . .') },
      { inst: 'pad', vol: 0.05, seq: seq(padBars(['F3A3C4', 'Bb2D3F3', 'C3E3G3', 'F3A3C4', 'F3A3C4', 'Bb2D3F3', 'C3E3G3Bb3', 'F3A3C4'])) },
      { inst: 'bass', vol: 0.14, seq: seq('F2 - - - F2 - - - | Bb1 - - - Bb1 - - - | C2 - - - C2 - - - | F2 - - - C2 - - - | F2 - - - F2 - - - | Bb1 - - - G1 - - - | C2 - - - C2 - - - | F2 - - - F1 - - -') },
      { inst: 'drum', vol: 0.12, seq: seq('k . h . s . h . | k . h k s . h h') },
    ],
  },
};
export { audio, sfx, SONGS };
