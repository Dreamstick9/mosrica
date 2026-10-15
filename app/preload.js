// preload.js
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mosrica", {
    // Menu clicks in main arrive here as an action name, e.g. "reset".
    registerListenerForMenuActionFromMain: (callback) => {
        const fn = (event, action) => {
            callback(action);
        };

        ipcRenderer.on("menu-action", fn);

        return () => {
            ipcRenderer.removeListener("menu-action", fn);
        };
    },

    saveSnapshot: () => ipcRenderer.invoke("save-snapshot"),
    exportReport: (report) => ipcRenderer.invoke("export-report", report),
    saveScenario: (scenario) => ipcRenderer.invoke("save-scenario", scenario),
    openScenario: () => ipcRenderer.invoke("open-scenario"),

    showAbout: () => {
        ipcRenderer.send("show-about");
    }
});
