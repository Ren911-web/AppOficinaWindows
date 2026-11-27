const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pcNetwork',{status:()=>ipcRenderer.invoke('network-status'),connectBackup:()=>ipcRenderer.invoke('network-connect-backup')});
contextBridge.exposeInMainWorld('pcPhoto',{share:(dataUrl)=>ipcRenderer.invoke('share-photo',{dataUrl})});
contextBridge.exposeInMainWorld('pcUpdater',{check:()=>ipcRenderer.invoke('update-check'),install:(manifestUrl,manifest)=>ipcRenderer.invoke('update-install',{manifestUrl,manifest})});
