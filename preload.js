const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('forma', {
  // Flask port
  getFlaskPort:   ()       => ipcRenderer.invoke('get-flask-port'),

  // File system
  showOpenDialog: (opts)   => ipcRenderer.invoke('show-open-dialog', opts),
  showSaveDialog: (opts)   => ipcRenderer.invoke('show-save-dialog', opts),
  writeFile:      (args)   => ipcRenderer.invoke('write-file', args),

  // Shell
  openExternal:   (url)    => ipcRenderer.invoke('open-external', url),

  // Navigation
  navigate:       (page)   => ipcRenderer.invoke('navigate', page),

  // Window controls
  minimize:       ()       => ipcRenderer.invoke('window-minimize'),
  maximize:       ()       => ipcRenderer.invoke('window-maximize'),
  close:          ()       => ipcRenderer.invoke('window-close'),

  // Menu-triggered events → renderer listens to these
  on: (channel, fn) => {
    const allowed = ['new-analysis','open-image','open-settings','toggle-history','show-shortcuts'];
    if (allowed.includes(channel)) ipcRenderer.on(channel, fn);
  },
  off: (channel, fn) => ipcRenderer.removeListener(channel, fn),
});
