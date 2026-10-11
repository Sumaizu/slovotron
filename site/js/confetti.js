const COLORS = ['#ffb547', '#f2dd6e', '#8fe3ae', '#7fd4ff', '#b7a6ff', '#ff9ad5', '#ff8f85', '#f4f0e8'];
const CANNONS = [{ x: 0.04, angle: -62 }, { x: 0.96, angle: -118 }];
const SHARPNESS = 1.5;
const GRAVITY = 1150;
const SLOWDOWN = 0.42;
const PER_SECOND = 42;
const BURST = 90;
const LIMIT = 340;
const LIFE_SECONDS = 4.2;
const FADE_SECONDS = 0.7;
const FRAME_LIMIT = 0.05;

const between = (min, max) => min + Math.random() * (max - min);

function piece(x, y, angle, speed) {
  const turn = angle * Math.PI / 180;
  return {
    x,
    y,
    vx: Math.cos(turn) * speed,
    vy: Math.sin(turn) * speed,
    width: between(7, 13),
    height: between(4, 8),
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    spin: between(-9, 9),
    angle: between(0, Math.PI * 2),
    flip: between(4, 11),
    age: 0,
  };
}

export class Confetti {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.pieces = [];
    this.until = 0;
    this.width = 0;
    this.height = 0;
    this._frame = 0;
    this._last = 0;
    this._owed = 0;
    this._step = (time) => this._advance(time);
  }

  get running() {
    return Boolean(this._frame);
  }

  start(seconds) {
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
    if (!this.width || !this.height) return;
    this.canvas.width = Math.round(this.width * SHARPNESS);
    this.canvas.height = Math.round(this.height * SHARPNESS);
    this.until = performance.now() + seconds * 1000;
    for (let i = 0; i < BURST; i++) {
      this.pieces.push(piece(this.width / 2, this.height * 0.3, between(-180, 180), between(160, 720)));
    }
    if (this._frame) return;
    this._last = performance.now();
    this._owed = 0;
    this._frame = requestAnimationFrame(this._step);
  }

  stop() {
    cancelAnimationFrame(this._frame);
    this._frame = 0;
    this.until = 0;
    this.pieces = [];
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  _fire(seconds) {
    this._owed += seconds * PER_SECOND;
    while (this._owed >= 1 && this.pieces.length < LIMIT) {
      this._owed -= 1;
      for (const cannon of CANNONS) {
        this.pieces.push(piece(this.width * cannon.x, this.height + 8, cannon.angle + between(-20, 20),
          between(820, 1380)));
      }
    }
  }

  _advance(time) {
    const seconds = Math.min(FRAME_LIMIT, (time - this._last) / 1000);
    this._last = time;
    if (time < this.until) this._fire(seconds);
    const slowdown = Math.pow(SLOWDOWN, seconds);
    this.pieces = this.pieces.filter((part) => {
      part.age += seconds;
      part.vx *= slowdown;
      part.vy = part.vy * slowdown + GRAVITY * seconds;
      part.x += part.vx * seconds;
      part.y += part.vy * seconds;
      part.angle += part.spin * seconds;
      return part.age < LIFE_SECONDS && part.y < this.height + 40;
    });
    this._draw();
    if (!this.pieces.length && time >= this.until) {
      this.stop();
      return;
    }
    this._frame = requestAnimationFrame(this._step);
  }

  _draw() {
    const context = this.context;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const part of this.pieces) {
      const turn = Math.cos(part.angle), tilt = Math.sin(part.angle);
      const squeeze = Math.cos(part.age * part.flip);
      context.setTransform(turn * SHARPNESS, tilt * SHARPNESS, -tilt * squeeze * SHARPNESS,
        turn * squeeze * SHARPNESS, part.x * SHARPNESS, part.y * SHARPNESS);
      context.globalAlpha = Math.min(1, (LIFE_SECONDS - part.age) / FADE_SECONDS);
      context.fillStyle = part.color;
      context.fillRect(-part.width / 2, -part.height / 2, part.width, part.height);
    }
    context.globalAlpha = 1;
  }
}
