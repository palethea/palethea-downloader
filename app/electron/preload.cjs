const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('paletheaDesktop', {
  isDesktop: true,
  onWindowStateChange: (listener) => {
    if (typeof listener !== 'function') {
      return () => {}
    }

    const wrapped = (event, payload) => listener(payload)
    ipcRenderer.on('palethea:window-state', wrapped)

    return () => {
      ipcRenderer.removeListener('palethea:window-state', wrapped)
    }
  },
  onUtilityProgress: (listener) => {
    if (typeof listener !== 'function') {
      return () => {}
    }

    const wrapped = (event, payload) => listener(payload)
    ipcRenderer.on('palethea:utility-progress', wrapped)

    return () => {
      ipcRenderer.removeListener('palethea:utility-progress', wrapped)
    }
  },
  getWindowState: () => ipcRenderer.invoke('palethea:get-window-state'),
  minimizeWindow: () => ipcRenderer.invoke('palethea:window-minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('palethea:window-toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('palethea:window-close'),
  openLibraryFolder: () => ipcRenderer.invoke('palethea:open-library-folder'),
  listLibraryFiles: () => ipcRenderer.invoke('palethea:list-library-files'),
  clearLibraryFiles: () => ipcRenderer.invoke('palethea:clear-library-files'),
  deleteLibraryItemFolder: (fileName) => ipcRenderer.invoke('palethea:delete-library-item-folder', fileName),
  showItemInFolder: (fileName) => ipcRenderer.invoke('palethea:show-item-in-folder', fileName),
  openItemDefault: (fileName) => ipcRenderer.invoke('palethea:open-item-default', fileName),
  copyFileToClipboard: (fileName) => ipcRenderer.invoke('palethea:copy-file-to-clipboard', fileName),
  fixTikTok120Fps: (fileName) => ipcRenderer.invoke('palethea:fix-tiktok-120fps', fileName),
  extractAudioFromMedia: (fileName) => ipcRenderer.invoke('palethea:extract-audio-from-media', fileName),
  compressMediaToSize: (fileName, targetSizeMb, durationSeconds, format) => ipcRenderer.invoke(
    'palethea:compress-media-to-size',
    fileName,
    targetSizeMb,
    durationSeconds,
    format,
  ),
})
