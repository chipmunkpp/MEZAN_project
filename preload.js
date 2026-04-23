'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Exposes a safe, typed API to the renderer (index.html) via window.api
 * All Node / Electron APIs are proxied through contextBridge so the
 * renderer runs in a sandboxed context without direct Node access.
 */
contextBridge.exposeInMainWorld('api', {

  /** Load all persisted data from %APPDATA%\Saver 98\saver98-data.json */
  loadAllData: () =>
    ipcRenderer.invoke('sv98:load'),

  /** Save all data object to disk (debounced inside renderer) */
  saveAllData: (data) =>
    ipcRenderer.invoke('sv98:save', data),

  /** Save a receipt image. base64Data = base64 string, name = original filename */
  saveReceipt: (base64Data, name) =>
    ipcRenderer.invoke('sv98:saveReceipt', base64Data, name),

  /** Load a receipt image by filename, returns base64 string or null */
  loadReceipt: (filename) =>
    ipcRenderer.invoke('sv98:loadReceipt', filename),

  /** App version string */
  getVersion: () =>
    ipcRenderer.invoke('sv98:version'),

  /** Available native OCR languages on this machine */
  getOcrInfo: () =>
    ipcRenderer.invoke('sv98:ocrInfo'),

  /** OCR text from an image data URL using the native desktop bridge */
  ocrImage: (dataUrl, options) =>
    ipcRenderer.invoke('sv98:ocrImage', dataUrl, options),

  /** Show OS native Save dialog and write content to chosen path */
  exportFile: (suggestedName, content) =>
    ipcRenderer.invoke('sv98:exportFile', suggestedName, content),

});
