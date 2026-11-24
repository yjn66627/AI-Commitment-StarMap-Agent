'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('StarmapCameraControl',Object.freeze({stop:()=>ipcRenderer.send('starmap-camera-stopped')}));
