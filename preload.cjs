const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("notch", {
  state: (cb) => ipcRenderer.on("state", (_, s) => cb(s)),
  ready: () => ipcRenderer.invoke("app:ready"),
  permReply: (sessionID, requestID, decision, message) => ipcRenderer.invoke("perm:reply", { sessionID, requestID, decision, message }),
  prompt: (sessionID, text) => ipcRenderer.invoke("session:prompt", { sessionID, text }),
  interrupt: (sessionID, resume) => ipcRenderer.invoke("session:interrupt", { sessionID, resume }),
  updateSession: (sessionID, changes) => ipcRenderer.invoke("session:update", { sessionID, ...changes }),
  openSession: (sessionID) => ipcRenderer.invoke("session:open", sessionID),
  setSize: (w, h) => ipcRenderer.send("ui:size", { w, h }),
  hover: (cb) => ipcRenderer.on("hover", (_, v) => cb(v)),
  pin: (v) => ipcRenderer.send("ui:pin", v),
  mute: (v) => ipcRenderer.send("ui:mute", v),
  formReply: (sessionID, formID, answer) => ipcRenderer.invoke("form:reply", { sessionID, formID, answer }),
  formCancel: (sessionID, formID) => ipcRenderer.invoke("form:cancel", { sessionID, formID }),
  openExternal: (url) => ipcRenderer.send("open:external", url),
  notify: (v) => ipcRenderer.send("ui:notify", v),
  checkUpdate: () => ipcRenderer.invoke("update:check"),
  dismissUpdate: (v) => ipcRenderer.send("update:dismiss", v),
  startOpenCode: () => ipcRenderer.invoke("opencode:start"),
  quit: () => ipcRenderer.send("app:quit"),
});
