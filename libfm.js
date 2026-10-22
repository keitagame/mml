/**
 * OPN Synth & VGM Player Library
 * High-quality YM2203 / YM2608 (OPN / OPNA) Emulator & VGM Player for Web Audio API.
 */

// =====================================================================
//  定数 & エミュレーション設定
// =====================================================================
const FM_GAIN = 1.8 / 32768;     // FM 1ch 最大 ≒ 0.2
const SSG_GAIN = 0.3;            // SSG 1ch 最大 ≒ 0.2

// デチューン (キーコード 0~31 × DT1 の強度 0~3)
const DETUNE_TABLE = (() => {
  const c1 = [0,0,0,0,1,1,1,1,1,1,1,1,2,2,2,2,2,3,3,3,4,4,4,5,5,6,6,7,8,8,8,8];
  const c2 = [1,1,1,1,2,2,2,2,2,3,3,3,4,4,4,5,5,6,6,7,8,8,9,10,11,12,13,14,16,16,16,16];
  const c3 = [2,2,2,2,2,3,3,3,4,4,4,5,5,6,6,7,8,8,9,10,11,12,13,14,16,17,19,20,22,22,22,22];
  const t = [];
  for (let k = 0; k < 32; k++) t.push([0, c1[k], c2[k], c3[k]]);
  return t;
})();

// 対数サイン表 / 指数表
const SIN_ATT = new Uint16Array(256);
const POW_TAB = new Uint16Array(256);
for (let i = 0; i < 256; i++) {
  SIN_ATT[i] = Math.round(-Math.log2(Math.sin(((2 * i + 1) * Math.PI) / 1024)) * 256);
  POW_TAB[i] = Math.round((Math.pow(2, (255 - i) / 256) - 1) * 1024);
}

// エンベロープ増分テーブル
const EG_INC = (() => {
  const t = [
    0x00000000, 0x00000000, 0x10101010, 0x10101010,
    0x10101010, 0x10101010, 0x11101110, 0x11101110,
  ];
  for (let i = 0; i < 10; i++) t.push(0x10101010, 0x10111010, 0x11101110, 0x11111110);
  t.push(0x11111111, 0x21112111, 0x21212121, 0x22212221);
  t.push(0x22222222, 0x42224222, 0x42424242, 0x44424442);
  t.push(0x44444444, 0x84448444, 0x84848484, 0x88848884);
  t.push(0x88888888, 0x88888888, 0x88888888, 0x88888888);
  return new Uint32Array(t);
})();

const EG_ATT = 0, EG_DEC = 1, EG_SUS = 2, EG_REL = 3;
const AMS_SHIFT = [8, 3, 1, 0];
const LFO_PERIOD = [109, 78, 72, 68, 63, 45, 9, 6];
const PMS_CENTS = [0, 3.4, 6.7, 10, 14, 20, 40, 80];
const OP_ORDER = [0, 2, 1, 3];

const HQ = {
  fmOversample: 4,        // FM オーバーサンプリング倍率
  fmLowpassHz: 14000,     // FM 高域カットオフ周波数
  fmShelfHz: 4500,        // FM ハイシェルフ開始周波数
  fmShelfDb: -4,          // FM ハイシェルフ量 [dB]
  ssgLowpassHz: 15000,    // SSG 高域カットオフ周波数
};
const FM_OS = Math.max(2, Math.min(8, HQ.fmOversample | 0));

const SIN_N = 4096;
const SIN_TAB = new Float64Array(SIN_N + 1);
for (let i = 0; i <= SIN_N; i++) SIN_TAB[i] = Math.sin((2 * Math.PI * i) / SIN_N);

const ENV_AMP = new Float64Array(0x400);
for (let e = 0; e < 0x400; e++) ENV_AMP[e] = 8176 * Math.pow(2, -e / 64);
ENV_AMP[0x3ff] = 0;

const FB_SCALE = [0, 0, 0, 0, 0, 0, 0, 0];
for (let f = 1; f < 8; f++) FB_SCALE[f] = Math.pow(2, f - 10);

// SSG レベル表
const SSG_LEVELS = (() => {
  const t = new Float64Array(32);
  for (let i = 1; i < 32; i++) t[i] = Math.pow(2, -(31 - i) / 4);
  return t;
})();

// YM2608 内蔵リズム ROM データ (Base64)
const YM2608_ROM_B64 = "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";

const YM2608_RHYTHM_ROM = (() => {
  const s = typeof atob !== 'undefined' ? atob(YM2608_ROM_B64) : Buffer.from(YM2608_ROM_B64, 'base64').toString('binary');
  const r = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) r[i] = s.charCodeAt(i);
  return r;
})();

const YM2608_RHYTHM_ADDR = [
  [0x0000, 0x01bf], [0x01c0, 0x043f], [0x0440, 0x1b7f],
  [0x1b80, 0x1cff], [0x1d00, 0x1f7f], [0x1f80, 0x1fff],
];

const ADPCMA_STEPS = [
  16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97,
  107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449,
  494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552,
];
const ADPCMA_STEP_INC = [-1, -1, -1, -1, 2, 5, 7, 9];
const DELTAT_STEP_SCALE = [57, 57, 57, 57, 77, 102, 128, 153];

// =====================================================================
//  ヘルパー関数 & フィルター
// =====================================================================
function softClip(x) {
  const T = 6000, M = 8191;
  if (x > T) return T + (M - T) * Math.tanh((x - T) / (M - T));
  if (x < -T) return -T - (M - T) * Math.tanh((-x - T) / (M - T));
  return x;
}

function cubic(a, b, c, d, t) {
  return 0.5 * ((2 * b) + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
}

function softOut(x) {
  const T = 0.85;
  if (x > T) return T + (1 - T) * Math.tanh((x - T) / (1 - T));
  if (x < -T) return -T - (1 - T) * Math.tanh((-x - T) / (1 - T));
  return x;
}

class Biquad {
  constructor() {
    this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0;
    this.z1 = 0; this.z2 = 0;
  }
  setLowpass(fs, fc, q) {
    const w0 = 2 * Math.PI * fc / fs, cs = Math.cos(w0), al = Math.sin(w0) / (2 * q);
    const a0 = 1 + al;
    this.b0 = (1 - cs) / 2 / a0; this.b1 = (1 - cs) / a0; this.b2 = this.b0;
    this.a1 = -2 * cs / a0; this.a2 = (1 - al) / a0;
  }
  setHighShelf(fs, fc, db) {
    const A = Math.pow(10, db / 40), w0 = 2 * Math.PI * fc / fs;
    const cs = Math.cos(w0), sn = Math.sin(w0);
    const beta = 2 * Math.sqrt(A) * (sn / 2) * Math.SQRT2;
    const a0 = (A + 1) - (A - 1) * cs + beta;
    this.b0 = A * ((A + 1) + (A - 1) * cs + beta) / a0;
    this.b1 = -2 * A * ((A - 1) + (A + 1) * cs) / a0;
    this.b2 = A * ((A + 1) + (A - 1) * cs - beta) / a0;
    this.a1 = 2 * ((A - 1) - (A + 1) * cs) / a0;
    this.a2 = ((A + 1) - (A - 1) * cs - beta) / a0;
  }
  process(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

const BUTTER8_Q = [1, 2, 3, 4].map(k => 1 / (2 * Math.sin(((2 * k - 1) * Math.PI) / 16)));

class OutFilter {
  constructor() {
    this.s0 = new Biquad(); this.s1 = new Biquad(); this.s2 = new Biquad(); this.s3 = new Biquad();
    this.shelf = new Biquad();
    this.useShelf = false;
  }
  design(fs, fcLow, shelfHz, shelfDb) {
    this.s0.setLowpass(fs, fcLow, BUTTER8_Q[3]);
    this.s1.setLowpass(fs, fcLow, BUTTER8_Q[2]);
    this.s2.setLowpass(fs, fcLow, BUTTER8_Q[1]);
    this.s3.setLowpass(fs, fcLow, BUTTER8_Q[0]);
    this.useShelf = !!shelfDb && shelfHz > 0 && shelfHz < fs / 2;
    if (this.useShelf) this.shelf.setHighShelf(fs, shelfHz, shelfDb);
  }
  process(x) {
    x = this.s3.process(this.s2.process(this.s1.process(this.s0.process(x))));
    return this.useShelf ? this.shelf.process(x) : x;
  }
}

// =====================================================================
//  FM 音源コア (FMOperator / FMChannel)
// =====================================================================
class FMOperator {
  constructor() {
    this.phase = 0;
    this.phaseInc = 0;
    this.phaseStep = 0;
    this.fnum = 0;
    this.block = 0;
    this.kc = 0;
    this.ksr = 0;
    this.pmMul = 1;
    this.mul2 = 1;
    this.det = 0;
    this.tl = 127;
    this.ks = 0;
    this.ar = 0;
    this.dr = 0;
    this.sr = 0;
    this.rr = 15;
    this.sl = 0;
    this.am = 0;
    this.ssg = 0;
    this.ssgInv = false;
    this.state = EG_REL;
    this.att = 0x3ff;
    this.keyOn = false;
  }

  setFreq(fnum, block) {
    this.fnum = fnum;
    this.block = block;
    const f11 = (fnum >> 10) & 1, f10 = (fnum >> 9) & 1, f9 = (fnum >> 8) & 1, f8 = (fnum >> 7) & 1;
    const n3 = f11 ? (f10 | f9 | f8) : (f10 & f9 & f8);
    this.kc = (block << 2) | (f11 << 1) | n3;
    this.updateKsr();
  }

  updateKsr() {
    this.ksr = this.kc >> (3 - this.ks);
    this.recalc();
  }

  recalc() {
    let fn = this.fnum;
    if (this.pmMul !== 1) fn *= this.pmMul;
    let inc = fn * (1 << this.block) * 0.5;
    const mag = this.det & 3;
    if (mag) {
      const d = DETUNE_TABLE[this.kc][mag];
      inc += (this.det & 4) ? -d : d;
    }
    if (inc < 0) inc = 0;
    this.phaseInc = inc * this.mul2 * 0.5;
    this.phaseStep = this.phaseInc / FM_OS;
  }

  _rate(state) {
    let base;
    switch (state) {
      case EG_ATT: base = this.ar * 2; break;
      case EG_DEC: base = this.dr * 2; break;
      case EG_SUS: base = this.sr * 2; break;
      default: base = this.rr * 4 + 2; break;
    }
    if (base === 0) return 0;
    const r = base + this.ksr;
    return r > 63 ? 63 : r;
  }

  setKey(on) {
    if (on === this.keyOn) return;
    this.keyOn = on;
    if (on) {
      this.phase = 0;
      this.state = EG_ATT;
      this.ssgInv = (this.ssg & 8) !== 0 && (this.ssg & 4) !== 0;
      if (this._rate(EG_ATT) >= 62) {
        this.att = 0;
        this.state = EG_DEC;
      }
    } else if (this.state !== EG_REL) {
      this.state = EG_REL;
      if ((this.ssg & 8) && this.ssgInv) {
        this.att = (0x200 - this.att) & 0x3ff;
      }
      this.ssgInv = false;
    }
  }

  _clockSsg() {
    if (!(this.ssg & 8) || this.att < 0x200) return;
    const mode = this.ssg & 7;
    if (mode & 1) {
      this.ssgInv = (((mode >> 2) ^ (mode >> 1)) & 1) === 1;
      if (this.state !== EG_ATT) this.att = this.ssgInv ? 0x200 : 0x3ff;
    } else {
      if (mode & 2) this.ssgInv = !this.ssgInv;
      else this.phase = 0;
      if (this.state !== EG_ATT) {
        if (this._rate(EG_ATT) < 62) {
          this.state = EG_ATT;
        } else {
          this.att = 0;
          this.state = EG_DEC;
        }
      }
    }
  }

  clockEnv(cnt) {
    if (this.state < EG_REL) this._clockSsg();

    if (this.state === EG_ATT && this.att === 0) this.state = EG_DEC;
    if (this.state === EG_DEC) {
      const sl = this.sl === 15 ? 0x3e0 : (this.sl << 5);
      if (this.att >= sl) this.state = EG_SUS;
    }

    const rate = this._rate(this.state);
    if (rate === 0) return;
    const sh = rate >> 2;
    let idx;
    if (sh <= 11) {
      const s = 11 - sh;
      if (cnt & ((1 << s) - 1)) return;
      idx = (cnt >> s) & 7;
    } else {
      idx = cnt & 7;
    }
    const inc = (EG_INC[rate] >>> (idx * 4)) & 15;
    if (inc === 0) return;

    if (this.state === EG_ATT) {
      if (rate < 62) this.att += ((~this.att) * inc) >> 4;
    } else {
      if (!(this.ssg & 8)) this.att += inc;
      else if (this.att < 0x200) this.att += 4 * inc;
      if (this.att >= 0x400) this.att = 0x3ff;
    }
    if (this.att < 0) this.att = 0;
  }

  calc(mod, am) {
    let e = this.att;
    if ((this.ssg & 8) && this.ssgInv) e = (0x200 - e) & 0x3ff;
    if (this.am) e += am;
    e += this.tl << 3;
    if (e > 0x3ff) e = 0x3ff;
    const t = this.phase * (SIN_N / 1048576) + mod * (SIN_N / 1024) + 65536;
    const i = t | 0;
    const f = t - i;
    const k = i & (SIN_N - 1);
    const a = SIN_TAB[k];
    return (a + (SIN_TAB[k + 1] - a) * f) * ENV_AMP[e];
  }
}

class FMChannel {
  constructor() {
    this.ops = [new FMOperator(), new FMOperator(), new FMOperator(), new FMOperator()];
    this.algorithm = 0;
    this.feedback = 0;
    this.fnum = 0;
    this.block = 0;
    this.ams = 0;
    this.pms = 0;
    this.panLeft = true;
    this.panRight = true;
    this.fb0 = 0;
    this.fb1 = 0;
  }

  render(lfoAm) {
    const o1 = this.ops[0], o2 = this.ops[1], o3 = this.ops[2], o4 = this.ops[3];

    if (o1.att >= 0x3ff && o2.att >= 0x3ff && o3.att >= 0x3ff && o4.att >= 0x3ff &&
        o1.state === EG_REL && o2.state === EG_REL && o3.state === EG_REL && o4.state === EG_REL &&
        !((o1.ssg | o2.ssg | o3.ssg | o4.ssg) & 8)) {
      this.fb0 = this.fb1 = 0;
      return 0;
    }

    const am = lfoAm >> AMS_SHIFT[this.ams];
    const fbMod = this.feedback ? (this.fb0 + this.fb1) * FB_SCALE[this.feedback] : 0;
    const v1 = o1.calc(fbMod, am);
    this.fb0 = this.fb1;
    this.fb1 = v1;

    let out, v2, v3;
    switch (this.algorithm) {
      case 0:
        v2 = o2.calc(v1 * 0.5, am);
        v3 = o3.calc(v2 * 0.5, am);
        out = o4.calc(v3 * 0.5, am);
        break;
      case 1:
        v2 = o2.calc(0, am);
        v3 = o3.calc((v1 + v2) * 0.5, am);
        out = o4.calc(v3 * 0.5, am);
        break;
      case 2:
        v2 = o2.calc(0, am);
        v3 = o3.calc(v2 * 0.5, am);
        out = o4.calc((v1 + v3) * 0.5, am);
        break;
      case 3:
        v2 = o2.calc(v1 * 0.5, am);
        v3 = o3.calc(0, am);
        out = o4.calc((v2 + v3) * 0.5, am);
        break;
      case 4:
        v2 = o2.calc(v1 * 0.5, am);
        v3 = o3.calc(0, am);
        out = v2 + o4.calc(v3 * 0.5, am);
        break;
      case 5: {
        const m = v1 * 0.5;
        out = o2.calc(m, am) + o3.calc(m, am) + o4.calc(m, am);
        break;
      }
      case 6:
        v2 = o2.calc(v1 * 0.5, am);
        out = v2 + o3.calc(0, am) + o4.calc(0, am);
        break;
      default:
        out = v1 + o2.calc(0, am) + o3.calc(0, am) + o4.calc(0, am);
        break;
    }

    let p;
    p = o1.phase + o1.phaseStep; o1.phase = p >= 1048576 ? p - 1048576 : p;
    p = o2.phase + o2.phaseStep; o2.phase = p >= 1048576 ? p - 1048576 : p;
    p = o3.phase + o3.phaseStep; o3.phase = p >= 1048576 ? p - 1048576 : p;
    p = o4.phase + o4.phaseStep; o4.phase = p >= 1048576 ? p - 1048576 : p;

    if (out > 6000 || out < -6000) out = softClip(out);
    return out;
  }
}

// =====================================================================
//  SSG (PSG) 音源
// =====================================================================
class SSG {
  constructor() {
    this.regs = new Uint8Array(16);
    this.toneCnt = [0, 0, 0];
    this.tonePos = [0, 0, 0];
    this.noiseCnt = 0;
    this.noiseShift = 1;
    this.envCnt = 0;
    this.envLevel = 0;
    this.envDir = 1;
    this.envHold = true;
  }

  write(addr, v) {
    if (addr > 15) return;
    switch (addr) {
      case 1: case 3: case 5: v &= 0x0f; break;
      case 6: v &= 0x1f; break;
      case 8: case 9: case 10: v &= 0x1f; break;
      case 13: v &= 0x0f; break;
    }
    this.regs[addr] = v;
    if (addr === 13) this._envRestart();
  }

  _envRestart() {
    const shape = this.regs[13];
    this.envDir = (shape & 4) ? 1 : -1;
    this.envLevel = (shape & 4) ? 0 : 31;
    this.envHold = false;
    this.envCnt = 0;
  }

  _envStep() {
    const shape = this.regs[13];
    let lvl = this.envLevel + this.envDir;
    if (lvl < 0 || lvl > 31) {
      const endVal = this.envDir > 0 ? 31 : 0;
      if (!(shape & 8)) {
        lvl = 0;
        this.envHold = true;
      } else if (shape & 1) {
        lvl = (shape & 2) ? (31 - endVal) : endVal;
        this.envHold = true;
      } else if (shape & 2) {
        this.envDir = -this.envDir;
        lvl = endVal;
      } else {
        lvl = (shape & 4) ? 0 : 31;
      }
    }
    this.envLevel = lvl;
  }

  clock() {
    const r = this.regs;
    for (let ch = 0; ch < 3; ch++) {
      let p = r[ch * 2] | (r[ch * 2 + 1] << 8);
      if (p === 0) p = 1;
      if (++this.toneCnt[ch] >= p) {
        this.toneCnt[ch] = 0;
        this.tonePos[ch] ^= 1;
      }
    }

    let np = r[6];
    if (np === 0) np = 1;
    if (++this.noiseCnt >= np * 2) {
      this.noiseCnt = 0;
      const bit = (this.noiseShift ^ (this.noiseShift >> 3)) & 1;
      this.noiseShift = (this.noiseShift >> 1) | (bit << 16);
    }
    const noiseOut = this.noiseShift & 1;

    let ep = r[11] | (r[12] << 8);
    if (ep === 0) ep = 1;
    if (++this.envCnt >= ep) {
      this.envCnt = 0;
      if (!this.envHold) this._envStep();
    }

    const mixer = r[7];
    let sum = 0;
    for (let ch = 0; ch < 3; ch++) {
      const toneOut = ((mixer >> ch) & 1) | this.tonePos[ch];
      const nOut = ((mixer >> (ch + 3)) & 1) | noiseOut;
      if (toneOut & nOut) {
        const v = r[8 + ch];
        let idx;
        if (v & 0x10) idx = this.envLevel;
        else {
          const a = v & 0x0f;
          idx = a ? (a * 2 + 1) : 0;
        }
        sum += SSG_LEVELS[idx];
      }
    }
    return sum;
  }
}

// =====================================================================
//  YM2608 リズム / ADPCM 音源
// =====================================================================
class YM2608Rhythm {
  constructor(outRate, fmRate) {
    this.outRate = outRate;
    this.rom = YM2608_RHYTHM_ROM;
    this.regs = new Uint8Array(0x20);
    this.regs[0x11] = 0x00;
    for (let i = 0; i < 6; i++) this.regs[0x18 + i] = 0xdf;
    this.tl = 0;
    this.ch = [];
    for (let i = 0; i < 6; i++) {
      this.ch.push({
        active: false, addr: 0, acc: 0, step: 0, out: 0, phase: 0,
        il: 0, left: true, right: true, mul: 0, shift: 0,
        h0: 0, h1: 0, h2: 0, h3: 0,
      });
      this._updateLevel(i);
    }
    this.setFmRate(fmRate || 55466);
  }

  setFmRate(fmRate) { this.nibStep = (fmRate / 3) / this.outRate; }

  _updateLevel(i) {
    const c = this.ch[i];
    const vol = this.tl + c.il;
    if (vol >= 63) { c.mul = 0; c.shift = 0; }
    else { c.mul = 15 - (vol & 7); c.shift = 1 + (vol >> 3); }
  }

  write(addr, data) {
    if (addr < 0x20) this.regs[addr] = data;
    if (addr === 0x10) {
      if (data & 0x80) {
        for (let i = 0; i < 6; i++) if (data & (1 << i)) this.ch[i].active = false;
      } else {
        for (let i = 0; i < 6; i++) {
          if (data & (1 << i)) {
            const c = this.ch[i];
            c.addr = YM2608_RHYTHM_ADDR[i][0] * 2;
            c.acc = 0; c.step = 0; c.out = 0; c.phase = 0;
            c.h0 = c.h1 = c.h2 = c.h3 = 0;
            c.active = true;
          }
        }
      }
    } else if (addr === 0x11) {
      this.tl = (data & 0x3f) ^ 0x3f;
      for (let i = 0; i < 6; i++) this._updateLevel(i);
    } else if (addr >= 0x18 && addr <= 0x1d) {
      const i = addr - 0x18, c = this.ch[i];
      c.il = (data & 0x1f) ^ 0x1f;
      c.left = (data & 0x80) !== 0;
      c.right = (data & 0x40) !== 0;
      this._updateLevel(i);
    }
  }

  _decode(c, idx) {
    const endNib = (YM2608_RHYTHM_ADDR[idx][1] + 1) * 2;
    if (c.addr >= endNib) { c.active = false; return; }
    const b = this.rom[c.addr >> 1];
    const nib = (c.addr & 1) ? (b & 0x0f) : (b >> 4);
    c.addr++;
    let d = ((2 * (nib & 7) + 1) * ADPCMA_STEPS[c.step]) >> 3;
    if (nib & 8) d = -d;
    c.acc = (((c.acc + d) + 2048) & 0xfff) - 2048;
    c.step += ADPCMA_STEP_INC[nib & 7];
    if (c.step < 0) c.step = 0; else if (c.step > 48) c.step = 48;
    c.out = (c.acc * c.mul) / (1 << c.shift);
  }

  render() {
    let sumL = 0, sumR = 0;
    for (let i = 0; i < 6; i++) {
      const c = this.ch[i];
      if (!c.active) continue;
      c.phase += this.nibStep;
      while (c.phase >= 1 && c.active) {
        c.phase -= 1;
        this._decode(c, i);
        c.h0 = c.h1; c.h1 = c.h2; c.h2 = c.h3; c.h3 = c.out;
      }
      const s = cubic(c.h0, c.h1, c.h2, c.h3, c.phase) * 1.5 * FM_GAIN;
      if (c.left) sumL += s;
      if (c.right) sumR += s;
    }
    return [sumL, sumR];
  }
}

class YM2608ADPCM {
  constructor(outRate, clock) {
    this.outRate = outRate;
    this.clock = clock;
    this.fmRate = clock / 144;
    this.ram = new Uint8Array(256 * 1024);
    this.regs = new Uint8Array(0x20);
    this.regs[0x01] = 0xc0;

    this.playing = false;
    this.writePtr = 0;
    this.nibblePos = 0;
    this.acc = 0;
    this.step = 127;
    this.phase = 0;
    this.h0 = this.h1 = this.h2 = this.h3 = 0;
  }

  loadRam(src) {
    if (!src) return;
    this.ram.set(src.subarray(0, this.ram.length));
  }

  _start() { return ((this.regs[3] << 8) | this.regs[2]) << 5; }
  _end() { return (((this.regs[5] << 8) | this.regs[4]) << 5) | 0x1f; }

  _resetDecoder() {
    this.acc = 0;
    this.step = 127;
    this.h0 = this.h1 = this.h2 = this.h3 = 0;
    this.phase = 0;
  }

  write(addr, data) {
    if (addr < 0x20) this.regs[addr] = data;
    if (addr === 0x00) {
      if (data & 0x01) this.playing = false;
      if ((data & 0x60) === 0x60) {
        this.writePtr = this._start();
      } else if ((data & 0x80) && !(data & 0x40)) {
        this.nibblePos = this._start() * 2;
        this._resetDecoder();
        this.playing = true;
      }
    } else if (addr === 0x08) {
      if ((this.regs[0x00] & 0x60) === 0x60) {
        if (this.writePtr < this.ram.length) this.ram[this.writePtr] = data;
        this.writePtr++;
      }
    }
  }

  _decodeNibble() {
    const byteAddr = this.nibblePos >> 1;
    if (byteAddr > this._end() || byteAddr >= this.ram.length) {
      if (this.regs[0x00] & 0x10) {
        this.nibblePos = this._start() * 2;
        this.acc = 0;
        this.step = 127;
      } else {
        this.playing = false;
        return this.acc;
      }
    }
    const b = this.ram[this.nibblePos >> 1];
    const nib = (this.nibblePos & 1) ? (b & 0x0f) : (b >> 4);
    this.nibblePos++;

    let delta = (((nib & 7) * 2 + 1) * this.step) >> 3;
    if (nib & 8) delta = -delta;
    this.acc += delta;
    if (this.acc > 32767) this.acc = 32767;
    if (this.acc < -32768) this.acc = -32768;

    this.step = Math.floor((this.step * DELTAT_STEP_SCALE[nib & 7]) / 64);
    if (this.step < 127) this.step = 127;
    if (this.step > 24576) this.step = 24576;
    return this.acc;
  }

  render() {
    if (!this.playing) return [0, 0];

    const deltaN = (this.regs[0x0a] << 8) | this.regs[0x09];
    const nibRate = (deltaN / 65536) * this.fmRate;
    this.phase += nibRate / this.outRate;
    while (this.phase >= 1) {
      this.phase -= 1;
      this.h0 = this.h1; this.h1 = this.h2; this.h2 = this.h3;
      this.h3 = this._decodeNibble();
      if (!this.playing) break;
    }

    const panReg = this.regs[0x01];
    const level = this.regs[0x0b];
    const s = (cubic(this.h0, this.h1, this.h2, this.h3, this.phase) * level / 512) * FM_GAIN;
    return [(panReg & 0x80) ? s : 0, (panReg & 0x40) ? s : 0];
  }
}

// =====================================================================
//  OPN チップ本体 (OPNChip / YM2203 / YM2608)
// =====================================================================
class OPNChip {
  constructor(type, outRate, clock) {
    this.is2608 = (type === 2608);
    this.outRate = outRate;
    this.clock = clock || (this.is2608 ? 7987200 : 3993600);

    this.channels = Array.from({ length: this.is2608 ? 6 : 3 }, () => new FMChannel());
    this.ssg = new SSG();
    if (this.is2608) {
      this.rhythm = new YM2608Rhythm(outRate, this.clock / 144);
      this.adpcm = new YM2608ADPCM(outRate, this.clock);
    }

    this.prescale = 6;
    this.presSel = 2;
    this.egSub = 0;
    this.egCnt = 0;
    this.fnLatch = 0;
    this.ch3Fn = [0, 0, 0];
    this.ch3Blk = [0, 0, 0];
    this.ch3Latch = 0;
    this.ch3Special = false;

    this.lfoOn = false;
    this.lfoFreq = 0;
    this.lfoSub = 0;
    this.lfoCnt = 0;
    this.lfoAm = 0;

    this.fmL = 0; this.fmR = 0;
    this.osSub = 0;
    this.fmAcc = 0;
    this.fmPrevL = 0; this.fmPrevR = 0; this.fmCurL = 0; this.fmCurR = 0;
    this.fmFiltL = new OutFilter();
    this.fmFiltR = new OutFilter();

    this.ssgAcc = 0;
    this.ssgPrev = 0; this.ssgCur = 0;
    this.ssgFilt = new OutFilter();

    this.dcCoef = Math.pow(0.9995, 44100 / outRate);
    this.dcL = 0; this.dcR = 0; this.prevL = 0; this.prevR = 0;
    this._o = [0, 0];

    this._updateRates();
  }

  setAdpcmRam(ram) {
    if (this.adpcm) this.adpcm.loadRam(ram);
  }

  _updatePrescale() {
    this.prescale = [2, 2, 6, 3][this.presSel & 3];
    this._updateRates();
  }

  _updateRates() {
    const div = this.prescale;
    this.fmRate = this.clock / (this.is2608 ? div * 24 : div * 12);
    const ssgDiv = div === 6 ? 4 : div === 3 ? 2 : 1;
    this.ssgRate = (this.clock * 2) / (this.is2608 ? ssgDiv * 2 : ssgDiv) / 8;
    this.fmHiStep = (this.fmRate * FM_OS) / this.outRate;
    if (this.adpcm) this.adpcm.fmRate = this.fmRate;
    if (this.rhythm) this.rhythm.setFmRate(this.fmRate);
    this.ssgStep = this.ssgRate / this.outRate;
    this._designFilters();
  }

  _designFilters() {
    const nyq = this.outRate / 2;
    const fmFs = this.fmRate * FM_OS;
    this.fmFiltL.design(fmFs, Math.min(HQ.fmLowpassHz, nyq * 0.9), HQ.fmShelfHz, HQ.fmShelfDb);
    this.fmFiltR.design(fmFs, Math.min(HQ.fmLowpassHz, nyq * 0.9), HQ.fmShelfHz, HQ.fmShelfDb);
    this.ssgFilt.design(this.ssgRate, Math.min(HQ.ssgLowpassHz, nyq * 0.9), 0, 0);
  }

  write(port, addr, data) {
    addr &= 0xff;
    data &= 0xff;

    if (port === 0) {
      if (addr < 0x10) { this.ssg.write(addr, data); return; }
      if (this.is2608 && addr <= 0x1d) { this.rhythm.write(addr, data); return; }
      switch (addr) {
        case 0x22:
          if (this.is2608) this._writeLfo(data);
          return;
        case 0x27:
          this._writeMode(data);
          return;
        case 0x28:
          this._writeKey(data);
          return;
        case 0x2d: this.presSel |= 2; this._updatePrescale(); return;
        case 0x2e: this.presSel |= 1; this._updatePrescale(); return;
        case 0x2f: this.presSel = 0; this._updatePrescale(); return;
      }
    } else {
      if (!this.is2608) return;
      if (addr < 0x20) { this.adpcm.write(addr, data); return; }
    }

    if (addr >= 0x30 && addr < 0xa0) {
      const c = addr & 3;
      if (c === 3) return;
      const idx = c + port * 3;
      if (idx >= this.channels.length) return;
      const ch = this.channels[idx];
      const op = ch.ops[OP_ORDER[(addr >> 2) & 3]];
      switch (addr & 0xf0) {
        case 0x30:
          op.det = (data >> 4) & 7;
          op.mul2 = (data & 0x0f) ? (data & 0x0f) * 2 : 1;
          op.recalc();
          break;
        case 0x40: op.tl = data & 0x7f; break;
        case 0x50:
          op.ks = (data >> 6) & 3;
          op.ar = data & 0x1f;
          op.updateKsr();
          break;
        case 0x60:
          op.dr = data & 0x1f;
          op.am = (data >> 7) & 1;
          break;
        case 0x70: op.sr = data & 0x1f; break;
        case 0x80:
          op.sl = (data >> 4) & 0x0f;
          op.rr = data & 0x0f;
          break;
        case 0x90:
          op.ssg = data & 0x0f;
          if (!(op.ssg & 8)) op.ssgInv = false;
          break;
      }
      return;
    }

    switch (addr) {
      case 0xa0: case 0xa1: case 0xa2: {
        const idx = (addr - 0xa0) + port * 3;
        if (idx >= this.channels.length) return;
        const ch = this.channels[idx];
        ch.fnum = ((this.fnLatch & 7) << 8) | data;
        ch.block = (this.fnLatch >> 3) & 7;
        this._applyChFreq(idx);
        break;
      }
      case 0xa4: case 0xa5: case 0xa6:
        this.fnLatch = data & 0x3f;
        break;
      case 0xa8: case 0xa9: case 0xaa: {
        if (port !== 0) return;
        const n = addr - 0xa8;
        this.ch3Fn[n] = ((this.ch3Latch & 7) << 8) | data;
        this.ch3Blk[n] = (this.ch3Latch >> 3) & 7;
        this._applyChFreq(2);
        break;
      }
      case 0xac: case 0xad: case 0xae:
        if (port === 0) this.ch3Latch = data & 0x3f;
        break;
      case 0xb0: case 0xb1: case 0xb2: {
        const idx = (addr - 0xb0) + port * 3;
        if (idx >= this.channels.length) return;
        const ch = this.channels[idx];
        ch.algorithm = data & 7;
        ch.feedback = (data >> 3) & 7;
        break;
      }
      case 0xb4: case 0xb5: case 0xb6: {
        if (!this.is2608) return;
        const idx = (addr - 0xb4) + port * 3;
        if (idx >= this.channels.length) return;
        const ch = this.channels[idx];
        ch.panLeft = (data & 0x80) !== 0;
        ch.panRight = (data & 0x40) !== 0;
        ch.ams = (data >> 4) & 3;
        ch.pms = data & 7;
        this._updatePm();
        break;
      }
    }
  }

  _applyChFreq(idx) {
    const ch = this.channels[idx];
    const ops = ch.ops;
    if (idx === 2 && this.ch3Special) {
      ops[0].setFreq(this.ch3Fn[1], this.ch3Blk[1]);
      ops[1].setFreq(this.ch3Fn[2], this.ch3Blk[2]);
      ops[2].setFreq(this.ch3Fn[0], this.ch3Blk[0]);
      ops[3].setFreq(ch.fnum, ch.block);
    } else {
      for (let i = 0; i < 4; i++) ops[i].setFreq(ch.fnum, ch.block);
    }
  }

  _writeMode(data) {
    const special = (data & 0xc0) !== 0;
    if (special !== this.ch3Special) {
      this.ch3Special = special;
      this._applyChFreq(2);
    }
  }

  _writeKey(data) {
    const cb = data & 7;
    if ((cb & 3) === 3) return;
    const idx = ((cb & 4) ? 3 : 0) + (cb & 3);
    if (idx >= this.channels.length) return;
    const ops = this.channels[idx].ops;
    for (let i = 0; i < 4; i++) ops[i].setKey((data & (0x10 << i)) !== 0);
  }

  _writeLfo(data) {
    const on = (data & 8) !== 0;
    this.lfoFreq = data & 7;
    if (!on) {
      this.lfoCnt = 0;
      this.lfoSub = 0;
      this.lfoAm = 0;
    }
    this.lfoOn = on;
    this._updatePm();
  }

  _updatePm() {
    let tri = 0;
    if (this.lfoOn) {
      const t = this.lfoCnt & 0x7f;
      tri = (t < 32 ? t : t < 96 ? 64 - t : t - 128) / 32;
    }
    for (const ch of this.channels) {
      const mul = (this.lfoOn && ch.pms) ? Math.pow(2, (tri * PMS_CENTS[ch.pms]) / 1200) : 1;
      for (const op of ch.ops) {
        if (op.pmMul !== mul) {
          op.pmMul = mul;
          op.recalc();
        }
      }
    }
  }

  _nativeTick() {
    if (this.lfoOn) {
      if (++this.lfoSub >= LFO_PERIOD[this.lfoFreq]) {
        this.lfoSub = 0;
        this.lfoCnt = (this.lfoCnt + 1) & 0x7f;
        const t = this.lfoCnt;
        this.lfoAm = ((t & 0x40) ? (t & 0x3f) : (0x3f - (t & 0x3f))) * 2;
        this._updatePm();
      }
    }

    if (++this.egSub >= 3) {
      this.egSub = 0;
      this.egCnt = (this.egCnt + 1) & 0xfffff;
      const cnt = this.egCnt;
      for (const ch of this.channels) {
        for (const op of ch.ops) op.clockEnv(cnt);
      }
    }
  }

  _genFMHi() {
    if (++this.osSub >= FM_OS) { this.osSub = 0; this._nativeTick(); }

    let l = 0, r = 0;
    const am = this.lfoAm;
    const chs = this.channels;
    for (let i = 0; i < chs.length; i++) {
      const ch = chs[i];
      const s = ch.render(am);
      if (ch.panLeft) l += s;
      if (ch.panRight) r += s;
    }
    this.fmL = l;
    this.fmR = r;
  }

  renderSample() {
    this.fmAcc += this.fmHiStep;
    while (this.fmAcc >= 1) {
      this.fmAcc -= 1;
      this._genFMHi();
      this.fmPrevL = this.fmCurL; this.fmPrevR = this.fmCurR;
      this.fmCurL = this.fmFiltL.process(this.fmL);
      this.fmCurR = this.fmFiltR.process(this.fmR);
    }
    const ft = this.fmAcc;
    const fmL = this.fmPrevL + (this.fmCurL - this.fmPrevL) * ft;
    const fmR = this.fmPrevR + (this.fmCurR - this.fmPrevR) * ft;

    this.ssgAcc += this.ssgStep;
    while (this.ssgAcc >= 1) {
      this.ssgAcc -= 1;
      this.ssgPrev = this.ssgCur;
      this.ssgCur = this.ssgFilt.process(this.ssg.clock());
    }
    const ssgOut = (this.ssgPrev + (this.ssgCur - this.ssgPrev) * this.ssgAcc) * SSG_GAIN;

    let mixL = fmL * FM_GAIN + ssgOut;
    let mixR = fmR * FM_GAIN + ssgOut;

    if (this.is2608) {
      const [rl, rr] = this.rhythm.render();
      const [al, ar] = this.adpcm.render();
      mixL += rl + al;
      mixR += rr + ar;
    }

    const k = this.dcCoef;
    const oL = mixL - this.prevL + k * this.dcL;
    const oR = mixR - this.prevR + k * this.dcR;
    this.prevL = mixL; this.prevR = mixR;
    this.dcL = oL; this.dcR = oR;

    const o = this._o;
    o[0] = oL; o[1] = oR;
    return o;
  }
}

class YM2203 extends OPNChip {
  constructor(sampleRate, clock) { super(2203, sampleRate, clock); }
}

class YM2608 extends OPNChip {
  constructor(sampleRate, clock) { super(2608, sampleRate, clock); }
}

// =====================================================================
//  VGM パーサ
// =====================================================================
class VGMParser {
  constructor(arrayBuffer) {
    this.buf = new Uint8Array(arrayBuffer);
    this.view = new DataView(arrayBuffer);
    this.header = {};
    this.gd3 = null;
    this.events = [];
    this.totalSamples = 0;
    this.loopSampleOffset = -1;
    this.adpcmRam = null;
    this._parse();
  }

  _readU32(off) { return this.view.getUint32(off, true); }
  _readU16(off) { return this.view.getUint16(off, true); }

  _magic(off) {
    return String.fromCharCode(this.buf[off], this.buf[off + 1], this.buf[off + 2], this.buf[off + 3]);
  }

  _parse() {
    if (this._magic(0) !== 'Vgm ') {
      throw new Error('VGMファイルではありません (シグネチャ不一致)');
    }
    const h = this.header;
    h.eofOffset = this._readU32(0x04);
    h.version = this._readU32(0x08);
    h.gd3Offset = this._readU32(0x14);
    h.totalSamples = this._readU32(0x18);
    h.loopOffset = this._readU32(0x1c);
    h.loopSamples = this._readU32(0x20);

    h.ym2203Clock = 0;
    h.ym2608Clock = 0;
    h.dataOffset = 0x40;

    if (h.version >= 0x150) {
      const dataOff = this._readU32(0x34);
      h.dataOffset = dataOff !== 0 ? dataOff + 0x34 : 0x40;
    }
    if (h.version >= 0x151 && h.dataOffset >= 0x4c && this.buf.length >= 0x4c) {
      h.ym2203Clock = this._readU32(0x44) & 0x3fffffff;
      h.ym2608Clock = this._readU32(0x48) & 0x3fffffff;
    }

    this.totalSamples = h.totalSamples;
    this.loopByteOffset = h.loopOffset ? h.loopOffset + 0x1c : -1;

    if (h.gd3Offset) {
      this._parseGD3(h.gd3Offset + 0x14);
    }

    this._parseCommands();
  }

  _parseGD3(off) {
    try {
      if (this._magic(off) !== 'Gd3 ') return;
      let p = off + 12;
      const strs = [];
      let cur = [];
      while (p < this.buf.length - 1) {
        const code = this._readU16(p);
        p += 2;
        if (code === 0) {
          strs.push(cur.join(''));
          cur = [];
          if (strs.length >= 11) break;
        } else {
          cur.push(String.fromCharCode(code));
        }
      }
      this.gd3 = {
        trackNameEn: strs[0] || '',
        trackNameJp: strs[1] || '',
        gameNameEn: strs[2] || '',
        gameNameJp: strs[3] || '',
        systemNameEn: strs[4] || '',
        systemNameJp: strs[5] || '',
        authorEn: strs[6] || '',
        authorJp: strs[7] || '',
        releaseDate: strs[8] || '',
        vgmBy: strs[9] || '',
        notes: strs[10] || '',
      };
    } catch (e) {
      this.gd3 = null;
    }
  }

  _parseCommands() {
    const buf = this.buf;
    let p = this.header.dataOffset;
    const end = this.header.gd3Offset ? Math.min(buf.length, this.header.gd3Offset + 0x14) : buf.length;
    let sampleOffset = 0;
    const loopStartByte = this.loopByteOffset;

    while (p < end && p < buf.length) {
      const cmd = buf[p];

      if (loopStartByte >= 0 && p === loopStartByte) {
        this.loopSampleOffset = sampleOffset;
      }

      if (cmd === 0x66) {
        this.events.push({ sampleOffset, type: 'end' });
        break;
      } else if (cmd === 0x55) {
        this.events.push({ sampleOffset, type: 'ym2203', addr: buf[p + 1], data: buf[p + 2] });
        p += 3;
      } else if (cmd === 0x56 || cmd === 0x57) {
        this.events.push({ sampleOffset, type: 'ym2608', port: cmd === 0x57 ? 1 : 0, addr: buf[p + 1], data: buf[p + 2] });
        p += 3;
      } else if (cmd === 0x61) {
        sampleOffset += this._readU16(p + 1);
        p += 3;
      } else if (cmd === 0x62) {
        sampleOffset += 735;
        p += 1;
      } else if (cmd === 0x63) {
        sampleOffset += 882;
        p += 1;
      } else if (cmd >= 0x70 && cmd <= 0x7f) {
        sampleOffset += (cmd & 0x0f) + 1;
        p += 1;
      } else if (cmd >= 0x80 && cmd <= 0x8f) {
        sampleOffset += (cmd & 0x0f);
        p += 1;
      } else if (cmd === 0x67) {
        const dataType = buf[p + 2];
        const size = this._readU32(p + 3);
        if (dataType === 0x81) {
          const romSize = this._readU32(p + 7);
          const startAddr = this._readU32(p + 11);
          const data = buf.subarray(p + 15, p + 7 + size);
          if (!this.adpcmRam) this.adpcmRam = new Uint8Array(Math.max(256 * 1024, Math.min(romSize, 16 * 1024 * 1024)));
          if (startAddr < this.adpcmRam.length) {
            this.adpcmRam.set(data.subarray(0, this.adpcmRam.length - startAddr), startAddr);
          }
        }
        p += 7 + size;
      } else if (cmd === 0x68) {
        p += 12;
      } else if (cmd === 0x64) {
        p += 4;
      } else if ((cmd >= 0x30 && cmd <= 0x3f) || cmd === 0x4f || cmd === 0x50) {
        p += 2;
      } else if ((cmd >= 0x40 && cmd <= 0x4e) || (cmd >= 0x51 && cmd <= 0x5f) || (cmd >= 0xa0 && cmd <= 0xbf)) {
        p += 3;
      } else if (cmd >= 0x90 && cmd <= 0x95) {
        if (cmd === 0x90 || cmd === 0x91 || cmd === 0x95) p += 5;
        else if (cmd === 0x92) p += 6;
        else if (cmd === 0x93) p += 11;
        else p += 2;
      } else if (cmd >= 0xc0 && cmd <= 0xdf) {
        p += 4;
      } else if (cmd >= 0xe0) {
        p += 5;
      } else {
        p += 1;
      }
    }

    if (this.events.length === 0 || this.events[this.events.length - 1].type !== 'end') {
      this.events.push({ sampleOffset, type: 'end' });
    }
  }
}

// =====================================================================
//  VGM Player (Web Audio API ScriptProcessorNode)
// =====================================================================
class VGMPlayer {
  constructor(audioCtx, vgmSampleRate = 44100) {
    this.audioCtx = audioCtx;
    this.vgmRate = vgmSampleRate;
    this.chip2203 = null;
    this.chip2608 = null;
    this.cfg = null;
    this.events = [];
    this.eventIndex = 0;
    this.totalSamples = 0;
    this.loopSampleOffset = -1;
    this.currentSample = 0;
    this.playing = false;
    this.loopEnabled = true;
    this.ended = false;

    this.outRate = audioCtx.sampleRate;
    this.vgmPerOut = this.vgmRate / this.outRate;
    this._posCounter = 0;

    this.onPosition = null;
    this.onEnded = null;
    this.onLooped = null;

    this.node = this.audioCtx.createScriptProcessor(8192, 0, 2);
    this.node.onaudioprocess = (e) => this._process(e);
  }

  connect(destination) { this.node.connect(destination); }
  disconnect() { try { this.node.disconnect(); } catch (e) { /* ignore */ } }

  _createChips() {
    const c = this.cfg;
    if (!c) return;
    this.chip2203 = c.ym2203Clock ? new OPNChip(2203, this.outRate, c.ym2203Clock) : null;
    this.chip2608 = c.ym2608Clock ? new OPNChip(2608, this.outRate, c.ym2608Clock) : null;
    if (this.chip2608 && c.adpcmRam) this.chip2608.setAdpcmRam(c.adpcmRam);
  }

  load(vgmParser) {
    this.events = vgmParser.events;
    this.totalSamples = vgmParser.totalSamples;
    this.loopSampleOffset = vgmParser.loopSampleOffset;
    this.eventIndex = 0;
    this.currentSample = 0;

    const h = vgmParser.header;
    let c2203 = h.ym2203Clock, c2608 = h.ym2608Clock;
    if (!c2203 && !c2608) {
      const has2608 = this.events.some(e => e.type === 'ym2608');
      const has2203 = this.events.some(e => e.type === 'ym2203');
      if (has2608) c2608 = 7987200;
      if (has2203 || !has2608) c2203 = 3993600;
    }
    this.cfg = { ym2203Clock: c2203, ym2608Clock: c2608, adpcmRam: vgmParser.adpcmRam };
    this._createChips();
    this.ended = false;
    this.playing = false;
  }

  play() { this.playing = true; }
  pause() { this.playing = false; }

  stop() {
    this.playing = false;
    this.currentSample = 0;
    this.eventIndex = 0;
    this._createChips();
  }

  _dispatch(ev) {
    if (ev.type === 'ym2203') {
      if (this.chip2203) this.chip2203.write(0, ev.addr, ev.data);
    } else if (ev.type === 'ym2608') {
      if (this.chip2608) this.chip2608.write(ev.port, ev.addr, ev.data);
    }
  }

  seekSample(targetSample) {
    this._createChips();
    let i = 0;
    while (i < this.events.length && this.events[i].sampleOffset <= targetSample) {
      this._dispatch(this.events[i]);
      i++;
    }
    this.eventIndex = i;
    this.currentSample = targetSample;
  }

  setLoop(enabled) { this.loopEnabled = enabled; }

  _renderChips() {
    let l = 0, r = 0;
    if (this.chip2203) { const s = this.chip2203.renderSample(); l += s[0]; r += s[1]; }
    if (this.chip2608) { const s = this.chip2608.renderSample(); l += s[0]; r += s[1]; }
    return [l, r];
  }

  _renderOneOut() {
    while (this.eventIndex < this.events.length && this.events[this.eventIndex].sampleOffset <= this.currentSample) {
      const ev = this.events[this.eventIndex];
      if (ev.type === 'end') {
        if (this.loopEnabled && this.loopSampleOffset >= 0) {
          this.currentSample = this.loopSampleOffset;
          let li = 0;
          while (li < this.events.length && this.events[li].sampleOffset < this.loopSampleOffset) li++;
          this.eventIndex = li;
          if (this.onLooped) this.onLooped();
          continue;
        }
        this.ended = true;
        this.playing = false;
        if (this.onEnded) this.onEnded();
        return null;
      }
      this._dispatch(ev);
      this.eventIndex++;
    }
    const sample = this._renderChips();
    this.currentSample += this.vgmPerOut;
    return sample;
  }

  _process(e) {
    const left = e.outputBuffer.getChannelData(0);
    const right = e.outputBuffer.getChannelData(1);

    for (let i = 0; i < left.length; i++) {
      if (!this.playing || this.ended) {
        left[i] = 0;
        right[i] = 0;
        continue;
      }
      const s = this._renderOneOut();
      if (!s) { left[i] = 0; right[i] = 0; continue; }
      left[i] = softOut(s[0]);
      right[i] = softOut(s[1]);
    }

    this._posCounter += left.length;
    if (this._posCounter > 4096) {
      this._posCounter = 0;
      if (this.onPosition) {
        this.onPosition({ sample: Math.floor(this.currentSample), total: this.totalSamples });
      }
    }
  }
}

// ユーティリティ: Gzip（.vgz）解凍
async function decompressVgz(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!isGzip) return arrayBuffer;

  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream 非対応ブラウザのため .vgz の解凍ができません');
  }
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return await new Response(stream).arrayBuffer();
}

// =====================================================================
//  エクスポート定義 (ESM & Node.js & Browser Global)
// =====================================================================
export {
  VGMParser,
  OPNChip,
  YM2203,
  YM2608,
  VGMPlayer,
  decompressVgz
};

if (typeof window !== 'undefined') {
  window.OPNSynth = {
    VGMParser,
    OPNChip,
    YM2203,
    YM2608,
    VGMPlayer,
    decompressVgz
  };
}