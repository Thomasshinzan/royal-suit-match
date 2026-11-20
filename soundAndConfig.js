/**
 * 1. 設定フォールバックデータ & 効果音エンジン (soundAndConfig.js)
 */
const DEFAULT_GAME_CONFIG = {
  boardConfig: {
    rows: 8,
    cols: 8,
    minMatchLength: 3,
    initialMoves: 25,
    baseMatchScore: 100,
    comboMultiplierStep: 0.5,
    timingsMs: {
      swap: 220,
      matchPop: 300,
      fall: 340
    }
  },
  tiles: [
    { id: "spade", name: "スペード", symbol: "♠", cornerIndex: "♠", cssClass: "suit-spade", scoreWeight: 1.0, spawnWeight: 23, type: "standard" },
    { id: "heart", name: "ハート", symbol: "♥", cornerIndex: "♥", cssClass: "suit-heart", scoreWeight: 1.0, spawnWeight: 23, type: "standard" },
    { id: "diamond", name: "ダイヤ", symbol: "♦", cornerIndex: "♦", cssClass: "suit-diamond", scoreWeight: 1.0, spawnWeight: 23, type: "standard" },
    { id: "club", name: "クラブ", symbol: "♣", cornerIndex: "♣", cssClass: "suit-club", scoreWeight: 1.0, spawnWeight: 23, type: "standard" },
    { id: "joker", name: "バイオレットスター", symbol: "★", cornerIndex: "★", cssClass: "suit-joker", scoreWeight: 1.0, spawnWeight: 20, type: "standard" }
  ],
  specialCards: [
    { id: "line_4", rank: "J", icon: "💥", name: "ボム (J)", condition: "直線に4個", description: "タップまたは隣と入替で周囲8個を爆破", tapActivatable: true, bonusScore: 250, color: "#38bdf8" },
    { id: "line_5", rank: "Q", icon: "↕", name: "縦アロー (Q)", condition: "直線に5個", description: "タップまたは隣と入替で縦1列をすべて消去", tapActivatable: true, bonusScore: 500, color: "#fbbf24" },
    { id: "lt_5", rank: "K", icon: "↔", name: "横アロー (K)", condition: "T字・L字に5個", description: "タップまたは隣と入替で横1行をすべて消去", tapActivatable: true, bonusScore: 500, color: "#c084fc" },
    { id: "mega_6", rank: "A", icon: "⚡", name: "サンダー (A)", condition: "6個以上つなぐ", description: "隣のタイルと入替で同じ種類のタイルをすべて消去", tapActivatable: false, bonusScore: 1000, color: "#fb7185" }
  ],
  stages: [
    {
      stageNumber: 1,
      title: "STAGE 1 : ロイヤル・イントロ",
      description: "スペードとハートを規定数集めよう！",
      moves: 20,
      objectives: [
        { type: "collect_suit", suitId: "spade", target: 25, label: "♠ を消す" },
        { type: "collect_suit", suitId: "heart", target: 25, label: "♥ を消す" }
      ]
    },
    {
      stageNumber: 2,
      title: "STAGE 2 : 木箱ブレイカー",
      description: "隣接マッチやスキルで8個の木箱をすべて壊そう！",
      moves: 22,
      crateMap: [
        [0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 1, 0, 0, 1, 0, 0],
        [0, 0, 0, 1, 1, 0, 0, 0],
        [0, 0, 0, 1, 1, 0, 0, 0],
        [0, 0, 1, 0, 0, 1, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0]
      ],
      objectives: [
        { type: "destroy_crates", target: 8, label: "木箱を破壊" },
        { type: "collect_suit", suitId: "diamond", target: 20, label: "♦ を消す" }
      ]
    },
    {
      stageNumber: 3,
      title: "STAGE 3 : 鉄枠木箱の要塞",
      description: "2回攻撃で壊れる鉄枠木箱を含む全12個を砕け！",
      moves: 25,
      crateMap: [
        [0, 0, 0, 0, 0, 0, 0, 0],
        [0, 1, 0, 0, 0, 0, 1, 0],
        [0, 0, 2, 0, 0, 2, 0, 0],
        [0, 0, 0, 2, 2, 0, 0, 0],
        [0, 0, 0, 2, 2, 0, 0, 0],
        [0, 0, 1, 0, 0, 1, 0, 0],
        [0, 1, 0, 0, 0, 0, 1, 0],
        [0, 0, 0, 0, 0, 0, 0, 0]
      ],
      objectives: [
        { type: "destroy_crates", target: 12, label: "木箱を破壊" },
        { type: "use_special", target: 3, label: "J/Q/K/A発動" }
      ]
    },
    {
      stageNumber: 4,
      title: "STAGE 4 : センターホール",
      description: "中央の2×2の穴に気をつけて、スペードとハートを24個ずつ集めよう！",
      moves: 25,
      holeMap: [
        [0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 1, 1, 0, 0, 0],
        [0, 0, 0, 1, 1, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0]
      ],
      objectives: [
        { type: "collect_suit", suitId: "spade", target: 24, label: "♠ を消す" },
        { type: "collect_suit", suitId: "heart", target: 24, label: "♥ を消す" }
      ]
    },
    {
      stageNumber: 5,
      title: "STAGE 5 : スコアアタック",
      description: "20手で15000点を目指そう！コンボをつなげて稼げ！",
      moves: 20,
      objectives: [
        { type: "score", target: 15000, label: "スコア 15000" }
      ]
    }
  ]
};

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }

  playTone(freq, type = 'sine', duration = 0.12, gainVal = 0.12, delay = 0) {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(gainVal, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  playSelect() { this.playTone(580, 'triangle', 0.07, 0.08); }
  playSwap() {
    this.playTone(340, 'sine', 0.09, 0.1);
    this.playTone(460, 'sine', 0.1, 0.1, 0.05);
  }
  playInvalid() {
    this.playTone(210, 'sawtooth', 0.11, 0.08);
    this.playTone(170, 'sawtooth', 0.14, 0.08, 0.08);
  }
  playMatch(combo = 1) {
    const baseFreq = 440 * Math.pow(1.09, Math.min(combo - 1, 10));
    this.playTone(baseFreq, 'triangle', 0.16, 0.14, 0);
    this.playTone(baseFreq * 1.25, 'sine', 0.18, 0.12, 0.05);
    this.playTone(baseFreq * 1.5, 'sine', 0.24, 0.14, 0.1);
  }
  playSkill(skillId) {
    if (skillId === 'mega_6' || skillId === 'combo') {
      this.playTone(523.25, 'sawtooth', 0.22, 0.14, 0);
      this.playTone(659.25, 'triangle', 0.25, 0.15, 0.06);
      this.playTone(783.99, 'triangle', 0.28, 0.15, 0.12);
      this.playTone(1046.5, 'sine', 0.4, 0.18, 0.18);
    } else if (skillId === 'line_5' || skillId === 'lt_5') {
      this.playTone(587.33, 'triangle', 0.18, 0.14, 0);
      this.playTone(880, 'sine', 0.28, 0.15, 0.07);
      this.playTone(1174.66, 'sine', 0.32, 0.14, 0.14);
    } else {
      this.playTone(659.25, 'triangle', 0.15, 0.13, 0);
      this.playTone(987.77, 'sine', 0.24, 0.14, 0.06);
    }
  }
  playDrop() { this.playTone(190, 'sine', 0.06, 0.05); }
  playStageClear() {
    this.playTone(523.25, 'triangle', 0.18, 0.16, 0);
    this.playTone(659.25, 'triangle', 0.18, 0.16, 0.12);
    this.playTone(783.99, 'triangle', 0.18, 0.16, 0.24);
    this.playTone(1046.5, 'sine', 0.45, 0.2, 0.36);
  }
  playCrateHit(destroyed = false) {
    if (destroyed) {
      this.playTone(150, 'sawtooth', 0.14, 0.16, 0);
      this.playTone(260, 'triangle', 0.16, 0.14, 0.05);
    } else {
      this.playTone(180, 'square', 0.1, 0.12, 0);
    }
  }
}