// app.js — Electron main process
import { app, BrowserWindow, ipcMain, dialog, Menu } from "electron";
import path from "path";
import fs from "fs";

let electronWindow = null;

// Feature: Snapshots — window screenshots are written here
const SNAPSHOT_DIR = path.join(import.meta.dirname, "..", "snapshots");

if (!fs.existsSync(SNAPSHOT_DIR)) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
}

function createWindow() {
    electronWindow = new BrowserWindow({
        height: 900,
        width: 1440,
        minHeight: 720,
        minWidth: 1100,
        backgroundColor: "#ffffff",

        webPreferences: {
            preload: path.join(import.meta.dirname, "preload.js")
        }
    });

    electronWindow.loadFile(path.join(import.meta.dirname, "../src/index.html"));
}

// Feature: Application Menu — every item forwards an action to the renderer
function createApplicationMenu() {
    const isMac = process.platform === "darwin";
    const send = (action) => () => electronWindow?.webContents.send("menu-action", action);

    const template = [
        ...(isMac ? [{ label: app.name, submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }] }] : []),

        {
            label: "File",
            submenu: [
                { label: "Open Scenario…", accelerator: "CmdOrCtrl+O", click: send("open-scenario") },
                { label: "Save Scenario…", accelerator: "CmdOrCtrl+S", click: send("save-scenario") },
                { type: "separator" },
                { label: "Export Run Report…", accelerator: "CmdOrCtrl+E", click: send("export-report") },
                { label: "Save Snapshot", accelerator: "CmdOrCtrl+Shift+S", click: send("snapshot") },
                ...(isMac ? [] : [{ type: "separator" }, { role: "quit" }])
            ]
        },
        {
            label: "Simulation",
            submenu: [
                { label: "Play / Pause", click: send("toggle-play") },
                { label: "Restart", click: send("reset") },
                { label: "Remove Everyone", click: send("clear") },
                { type: "separator" },
                { label: "Speed 1×", click: send("speed-1") },
                { label: "Speed 2×", click: send("speed-2") },
                { label: "Speed 4×", click: send("speed-4") }
            ]
        },
        {
            label: "Experiments",
            submenu: [
                { label: "Remove CO₂ Sense", click: send("ko-co2") },
                { label: "Remove Arousal", click: send("ko-arousal") },
                { label: "Remove Heat Sense", click: send("ko-heat") },
                { type: "separator" },
                { label: "Restore All Neurons", click: send("restore") }
            ]
        },
        {
            label: "View",
            submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "togglefullscreen" }]
        },
        {
            label: "Help",
            submenu: [{ label: "How Mosrica Works", click: showAbout }]
        }
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function showAbout() {
    dialog.showMessageBox(electronWindow, {
        type: "info",
        title: "Mosrica",
        message: "A mosquito driven by 17 simulated neurons",
        detail:
            "The mosquito isn't scripted. Every turn and every bite comes from spikes in a small " +
            "neural network: senses (CO₂, lactic acid, body heat, DEET) feed a processing layer, " +
            "which drives movement (turn left, turn right, speed up, bite).\n\n" +
            "This is a simplified model inspired by how real mosquitoes find people, not the real " +
            "mosquito brain, which has well over 100,000 neurons.\n\n" +
            "Try clicking a neuron to switch it off and see how the behaviour changes."
    });
}

// Feature: Snapshot — capture the whole window and save it as PNG
ipcMain.handle("save-snapshot", async () => {
    let image;
    try {
        image = await electronWindow.webContents.capturePage();
    } catch (error) {
        // Capture fails while the window is hidden behind others — bring it forward and retry once.
        electronWindow.show();
        await new Promise((resolve) => setTimeout(resolve, 200));
        try {
            image = await electronWindow.webContents.capturePage();
        } catch (retryError) {
            console.error("Failed to capture snapshot:", retryError);
            return null;
        }
    }

    const filePath = path.join(SNAPSHOT_DIR, `mosrica-${Date.now()}.png`);
    fs.writeFileSync(filePath, image.toPNG());
    return filePath;
});

// Feature: Save Dialog — used for both run reports and scenarios
async function saveJson(title, fileName, data) {
    const { canceled, filePath } = await dialog.showSaveDialog(electronWindow, {
        title,
        buttonLabel: "Save",
        defaultPath: path.join(app.getPath("documents"), fileName),
        filters: [{ name: "JSON", extensions: ["json"] }]
    });

    if (canceled || !filePath) return null;
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return filePath;
}

ipcMain.handle("export-report", (_event, report) => {
    return saveJson("Export run report", `mosrica-report-${Date.now()}.json`, report);
});

ipcMain.handle("save-scenario", (_event, scenario) => {
    return saveJson("Save scenario", "scenario.json", scenario);
});

// Feature: Open Dialog — load a saved scenario back in
ipcMain.handle("open-scenario", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(electronWindow, {
        title: "Open scenario",
        properties: ["openFile"],
        filters: [{ name: "JSON", extensions: ["json"] }]
    });

    if (canceled || !filePaths.length) return null;

    try {
        return JSON.parse(fs.readFileSync(filePaths[0], "utf8"));
    } catch (error) {
        dialog.showMessageBox(electronWindow, {
            type: "error",
            title: "Could not open scenario",
            message: "That file is not a valid Mosrica scenario.",
            detail: String(error.message)
        });
        return null;
    }
});

ipcMain.on("show-about", showAbout);

app.whenReady().then(() => {
    createApplicationMenu();
    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});
