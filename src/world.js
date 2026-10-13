// The arena: hosts (people), repellent zones, and one mosquito whose
// body is driven entirely by the spiking brain in brain.js.
(function (root) {
  const { Brain } = root.MosquitoBrain || require('./brain');

  const ANT_LEN = 16;      // antenna length (px)
  const ANT_SPREAD = 1.0;  // antenna angle from heading (rad)
  const CO2_RANGE = 200;   // CO2 plume decay length (px)
  const ODOR_RANGE = 220;
  const HEAT_RANGE = 34;
  const DEET_RANGE = 55;
  const BITE_DIST = 22;

  const gauss = () => {
    let u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  class World {
    constructor(w, h) {
      this.w = w;
      this.h = h;
      this.params = { co2Gain: 1, turbulence: 0.4, noise: 0.15 };
      this.hosts = [];
      this.repellents = [];
      this.reset(false);
    }

    reset(keepScene = true) {
      const lesions = this.brain ? this.brain.neurons.filter((n) => n.lesioned).map((n) => n.id) : [];
      this.brain = new Brain();
      for (const id of lesions) this.brain.byId[id].lesioned = true;
      this.t = 0;
      this.bites = 0;
      this.firstBiteAt = null;
      this.events = [];
      this.flicker = { L: 1, R: 1 };
      this.bug = {
        x: this.w * 0.2, y: this.h * (0.3 + Math.random() * 0.4),
        a: Math.random() * Math.PI * 2, speed: 0,
        trail: [], trailClock: 0, satiety: 0, restUntil: 0,
        castPhase: Math.random() * 10, state: 'casting',
      };
      if (!keepScene) {
        this.hosts = [
          { x: this.w * 0.78, y: this.h * 0.32, bites: 0 },
          { x: this.w * 0.68, y: this.h * 0.74, bites: 0 },
        ];
        this.repellents = [];
      } else {
        for (const h of this.hosts) h.bites = 0;
      }
      this.sense();
    }

    resize(w, h) {
      const sx = w / this.w, sy = h / this.h;
      for (const p of [...this.hosts, ...this.repellents]) { p.x *= sx; p.y *= sy; }
      this.bug.x = clamp(this.bug.x * sx, 0, w);
      this.bug.y = clamp(this.bug.y * sy, 0, h);
      this.bug.trail = [];
      this.w = w;
      this.h = h;
    }

    antennae() {
      const b = this.bug;
      const tip = (side) => ({
        x: b.x + Math.cos(b.a + side * ANT_SPREAD) * ANT_LEN,
        y: b.y + Math.sin(b.a + side * ANT_SPREAD) * ANT_LEN,
      });
      return { L: tip(-1), R: tip(1) };
    }

    field(p, list, range) {
      let s = 0;
      for (const q of list) s += Math.exp(-Math.hypot(p.x - q.x, p.y - q.y) / range);
      return Math.min(1, s);
    }

    sense() {
      const { L, R } = this.antennae();
      const b = this.bug;
      let nearest = null, nd = Infinity;
      for (const h of this.hosts) {
        const d = Math.hypot(b.x - h.x, b.y - h.y);
        if (d < nd) { nd = d; nearest = h; }
      }
      this.s = {
        co2L: this.field(L, this.hosts, CO2_RANGE),
        co2R: this.field(R, this.hosts, CO2_RANGE),
        heatL: this.field(L, this.hosts, HEAT_RANGE),
        heatR: this.field(R, this.hosts, HEAT_RANGE),
        odor: this.field(b, this.hosts, ODOR_RANGE),
        deetL: this.field(L, this.repellents, DEET_RANGE),
        deetR: this.field(R, this.repellents, DEET_RANGE),
        nearest, nearestDist: nd,
      };
      return this.s;
    }

    step(dt) {
      this.t += dt;
      const b = this.bug, br = this.brain, P = this.params;
      const s = this.sense();

      // Plume intermittency: real CO2 plumes arrive as filaments, not smooth
      // gradients. Model each antenna's "hit" with an Ornstein-Uhlenbeck flicker.
      for (const k of ['L', 'R']) {
        const f = this.flicker[k];
        this.flicker[k] = clamp(f + (dt / 80) * (1 - f) + Math.sqrt(dt) * P.turbulence * 0.09 * gauss(), 0, 2);
      }

      // Feeding suppresses host-seeking (satiety), CO2-driven arousal gates heat.
      const appetite = 1 - b.satiety;
      const heatGate = 0.25 + Math.min(1, br.rate('ARM') / 30);
      br.step(dt, {
        CO2_L: 0.13 * P.co2Gain * s.co2L * this.flicker.L * appetite,
        CO2_R: 0.13 * P.co2Gain * s.co2R * this.flicker.R * appetite,
        ODOR: 0.09 * s.odor * appetite,
        HEAT_L: 0.18 * s.heatL * heatGate * appetite,
        HEAT_R: 0.18 * s.heatR * heatGate * appetite,
        DEET_L: 0.24 * s.deetL,
        DEET_R: 0.24 * s.deetR,
      }, P.noise);

      b.satiety = Math.max(0, b.satiety - dt / 9000);

      if (this.t < b.restUntil) {
        b.state = 'feeding';
        b.speed = 0;
        return;
      }

      // Decode motor neurons into flight.
      const rL = br.rate('TURN_L'), rR = br.rate('TURN_R');
      const arousal = Math.min(1, br.rate('ARM') / 25);
      b.castPhase += dt * 0.004;
      const cast = Math.sin(b.castPhase) * 1.6 * (1 - 0.85 * arousal);
      let omega = (rR - rL) * 0.4 + cast + gauss() * 0.9 / Math.sqrt(dt);

      // Mechanosensory wall reflex: steer back toward the middle.
      const m = 50;
      if (b.x < m || b.x > this.w - m || b.y < m || b.y > this.h - m) {
        const want = Math.atan2(this.h / 2 - b.y, this.w / 2 - b.x);
        const diff = Math.atan2(Math.sin(want - b.a), Math.cos(want - b.a));
        omega += diff * 4;
      }

      b.a += (omega * dt) / 1000;
      b.speed = 60 + Math.min(br.rate('FWD'), 60) * 2.2;
      b.x = clamp(b.x + (Math.cos(b.a) * b.speed * dt) / 1000, 2, this.w - 2);
      b.y = clamp(b.y + (Math.sin(b.a) * b.speed * dt) / 1000, 2, this.h - 2);

      b.trailClock += dt;
      if (b.trailClock > 30) {
        b.trailClock = 0;
        b.trail.push({ x: b.x, y: b.y });
        if (b.trail.length > 260) b.trail.shift();
      }

      const probe = br.rate('PROBE');
      const avoid = br.rate('AV_L') + br.rate('AV_R');
      if (probe > 20 && s.nearest && s.nearestDist < BITE_DIST) {
        this.bites++;
        s.nearest.bites++;
        if (this.firstBiteAt === null) this.firstBiteAt = this.t;
        this.events.push({ x: b.x, y: b.y, t: this.t });
        b.restUntil = this.t + 1500;
        b.satiety = 1;
        b.a += Math.PI + gauss() * 0.6;
        b.state = 'feeding';
      } else if (avoid > 25) b.state = 'avoiding';
      else if (probe > 8) b.state = 'landing';
      else if (arousal > 0.3) b.state = 'tracking';
      else b.state = 'casting';
    }
  }

  const api = { World };
  root.MosquitoWorld = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
