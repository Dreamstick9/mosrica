# Mosrica

A desktop app that simulates a mosquito's host-seeking brain with spiking neurons.

The mosquito in the room isn't scripted. Every turn, speed-up and bite comes from
a 17-neuron spiking network (leaky integrate-and-fire). Senses (CO₂, lactic
acid, body heat, DEET) feed a processing layer, which drives movement.

**Is this the real mosquito brain?** No. It's a simplified model I designed by
hand, inspired by known mosquito host-seeking behaviour: CO₂ triggers the search
and makes the mosquito notice body heat, the two antennae steer, and DEET drives
avoidance. A real insect brain has well over 100,000 neurons. A full *Aedes
aegypti* connectome is being mapped (Jefferis lab, Cambridge) but isn't used here.

## Run

```bash
npm install
npm start
```

## What you can do

- **Add people / repellent**: click the room. Hosts breathe out CO₂ and give off heat and lactic acid. DEET zones repel.
- **Switch off neurons**: click any neuron in the brain diagram, or use the buttons under it / the Experiments menu. Remove the CO₂ neurons and the mosquito can no longer find anyone.
- **Watch it think**: brain diagram (circles fill as neurons fire; red lines excite, purple lines inhibit) and a 4-second activity chart.
- **Tune it**: CO₂ gain, plume turbulence and neural noise sliders.
- **File menu**: save / open scenarios (`⌘S` / `⌘O`), export a JSON run report (`⌘E`), save a PNG snapshot of the window into `snapshots/`.

Keys: `Space` pause · `R` reset · `1/2/3` host / DEET / erase.

## Electron architecture

| File | Process | What it does |
|---|---|---|
| `app/app.js` | Main | Creates the `BrowserWindow`, builds the application `Menu`, handles `ipcMain` calls, opens `dialog` save/open/message boxes, writes files with `fs`, captures snapshots with `capturePage()` |
| `app/preload.js` | Preload | `contextBridge.exposeInMainWorld("mosrica", …)`: the only bridge between the page and Node |
| `src/*` | Renderer | Plain HTML/CSS/JS: the simulation and canvas drawing |

IPC channels:

- `menu-action` (main → renderer, `webContents.send`): menu clicks such as `reset` and `ko-co2`
- `save-snapshot`, `export-report`, `save-scenario`, `open-scenario` (renderer → main, `ipcRenderer.invoke` / `ipcMain.handle`)
- `show-about` (renderer → main, `ipcRenderer.send` / `ipcMain.on`)

## How the brain works

| Layer | Neurons | Role |
|---|---|---|
| Sensory | CO₂ L/R, Lactic, Heat L/R, DEET L/R | Antenna tips sample the chemical / thermal field |
| Central | PN L/R, Arousal, LN, Avoid L/R | Left/right projection neurons with mutual inhibition (winner-take-all), CO₂-driven arousal that gates heat sensing, local inhibitory gain control, repellent avoidance |
| Motor | Turn L/R, Surge, Probe | Firing-rate difference steers, Surge sets speed, Probe triggers a bite near a warm host |

Extra biology: CO₂ arrives as turbulent filaments (an Ornstein-Uhlenbeck flicker
per antenna), and a blood meal makes the mosquito sated, which suppresses
host-seeking for a while.

Results from headless 60-second trials (4 runs each):

| Condition | Bites per run |
|---|---|
| Normal | 3–6 |
| CO₂ neurons knocked out | 0 |
| Arousal knocked out | 0 |
| DEET on every host | 0 |

## Files

- `app/app.js`: Electron main process
- `app/preload.js`: context bridge
- `src/brain.js`: the spiking network (pure JS)
- `src/world.js`: arena, sensing and motor decoding
- `src/renderer.js`: canvas drawing, controls and IPC calls
