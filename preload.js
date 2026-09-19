const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openVRMDialog: () => ipcRenderer.invoke('dialog:openVRM'),
  openAudioDialog: () => ipcRenderer.invoke('dialog:openAudio'),
  onAudioAnalysisStatus: (callback) => {
    ipcRenderer.on('audio-analysis-status', (_event, payload) => callback(payload));
  },
  queryAIDirector: (sceneDescription) => ipcRenderer.invoke('ai-director:query', sceneDescription),
  logToFile: (level, message) => ipcRenderer.send('renderer-log', { level, message }),
  openLogsFolder: () => ipcRenderer.invoke('open-logs-folder'),
});
