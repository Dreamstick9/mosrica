// A tiny leaky integrate-and-fire (LIF) network, loosely modelled on the
// mosquito host-seeking circuit: antenna / palp sensors -> antennal lobe
// -> premotor / motor outputs. Pure JS, no DOM, so it also runs in Node.
(function (root) {
  const TAU = 20;        // membrane time constant (ms)
  const V_TH = 1;        // spike threshold
  const REFRACT = 2;     // refractory period (ms)
  const TRACE_TAU = 200; // firing-rate estimator time constant (ms)

  // group: s = sensory, i = interneuron, m = motor. bias = tonic drive.
  const NEURONS = [
    { id: 'CO2_L',  group: 's', label: 'CO₂ left', bias: 0.042 },
    { id: 'CO2_R',  group: 's', label: 'CO₂ right', bias: 0.042 },
    { id: 'ODOR',   group: 's', label: 'Lactic acid', bias: 0.042 },
    { id: 'HEAT_L', group: 's', label: 'Heat left', bias: 0.025 },
    { id: 'HEAT_R', group: 's', label: 'Heat right', bias: 0.025 },
    { id: 'DEET_L', group: 's', label: 'DEET left', bias: 0.02 },
    { id: 'DEET_R', group: 's', label: 'DEET right', bias: 0.02 },

    { id: 'PN_L',   group: 'i', label: 'Relay left', bias: 0.02 },
    { id: 'PN_R',   group: 'i', label: 'Relay right', bias: 0.02 },
    { id: 'ARM',    group: 'i', label: 'Arousal', bias: 0.0 },
    { id: 'LN',     group: 'i', label: 'Inhibitor', bias: 0.0 },
    { id: 'AV_L',   group: 'i', label: 'Avoid left', bias: 0.0 },
    { id: 'AV_R',   group: 'i', label: 'Avoid right', bias: 0.0 },

    { id: 'TURN_L', group: 'm', label: 'Turn left', bias: 0.035 },
    { id: 'TURN_R', group: 'm', label: 'Turn right', bias: 0.035 },
    { id: 'FWD',    group: 'm', label: 'Speed up', bias: 0.03 },
    { id: 'PROBE',  group: 'm', label: 'Bite', bias: 0.0 },
  ];

  // [pre, post, weight] — weight is the voltage jump per presynaptic spike.
  const SYNAPSES = [
    ['CO2_L', 'PN_L', 0.45], ['CO2_R', 'PN_R', 0.45],
    ['CO2_L', 'ARM', 0.18],  ['CO2_R', 'ARM', 0.18],
    ['ODOR', 'ARM', 0.25],
    ['ODOR', 'PN_L', 0.15],  ['ODOR', 'PN_R', 0.15],
    ['HEAT_L', 'PN_L', 0.5], ['HEAT_R', 'PN_R', 0.5],
    ['HEAT_L', 'PROBE', 0.3], ['HEAT_R', 'PROBE', 0.3],
    ['DEET_L', 'AV_L', 0.55], ['DEET_R', 'AV_R', 0.55],

    ['PN_L', 'PN_R', -0.6], ['PN_R', 'PN_L', -0.6],
    ['PN_L', 'LN', 0.3],     ['PN_R', 'LN', 0.3],
    ['LN', 'PN_L', -0.3],    ['LN', 'PN_R', -0.3],
    ['AV_L', 'LN', 0.8],     ['AV_R', 'LN', 0.8],

    ['PN_L', 'TURN_L', 0.5], ['PN_R', 'TURN_R', 0.5],
    ['PN_L', 'FWD', 0.15],   ['PN_R', 'FWD', 0.15],
    ['ARM', 'FWD', 0.35],    ['ARM', 'PROBE', 0.1],
    ['AV_L', 'TURN_R', 1.0], ['AV_R', 'TURN_L', 1.0],
    ['AV_L', 'PROBE', -1.5], ['AV_R', 'PROBE', -1.5],
  ];

  class Brain {
    constructor() {
      this.t = 0;
      this.neurons = NEURONS.map((n, idx) => ({
        ...n, idx, v: 0, inbox: 0, refUntil: 0, trace: 0, lesioned: false, spikes: [],
      }));
      this.byId = Object.fromEntries(this.neurons.map((n) => [n.id, n]));
      this.synapses = SYNAPSES.map(([a, b, w]) => ({ pre: this.byId[a], post: this.byId[b], w }));
      this.out = this.neurons.map(() => []);
      for (const s of this.synapses) this.out[s.pre.idx].push(s);
      this.totalSpikes = 0;
    }

    // Smoothed firing rate in Hz.
    rate(id) {
      return (this.byId[id].trace / TRACE_TAU) * 1000;
    }

    step(dt, inputs, noise) {
      this.t += dt;
      const decay = Math.exp(-dt / TRACE_TAU);
      const fired = [];
      for (const n of this.neurons) {
        n.trace *= decay;
        if (n.lesioned) { n.v = 0; n.inbox = 0; continue; }
        const I = n.bias + (inputs[n.id] || 0) + (Math.random() - 0.5) * noise;
        n.v += n.inbox;
        n.inbox = 0;
        if (this.t >= n.refUntil) n.v += dt * (-n.v / TAU + I);
        if (n.v < -0.5) n.v = -0.5;
        if (n.v >= V_TH) {
          n.v = 0;
          n.refUntil = this.t + REFRACT;
          n.trace += 1;
          n.spikes.push(this.t);
          fired.push(n);
        }
      }
      for (const n of fired) for (const s of this.out[n.idx]) s.post.inbox += s.w;
      this.totalSpikes += fired.length;
      return fired.length;
    }

    prune(windowMs) {
      const cut = this.t - windowMs;
      for (const n of this.neurons) {
        while (n.spikes.length && n.spikes[0] < cut) n.spikes.shift();
      }
    }
  }

  const api = { Brain, NEURONS, SYNAPSES, TRACE_TAU };
  root.MosquitoBrain = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
