import { contextBridge, ipcRenderer } from "electron";

export type DesktopDisplay = {
  id: number;
  bounds: Electron.Rectangle;
  workArea: Electron.Rectangle;
  scaleFactor: number;
  isPrimary: boolean;
};

export type MobileFrame = { serial: string; timestamp: number; keyframe: boolean; data: ArrayBuffer };
export type MobileMetadata = { serial: string; codec: "h264"; width: number; height: number };
export type MobileStatus = { serial: string; status: "disconnected" | "connecting" | "connected" | "reconnecting" | "error"; error?: string };

const desktopApi = {
  window: {
    minimize: () => ipcRenderer.invoke("window:minimize") as Promise<void>,
    toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize") as Promise<boolean>,
    toggleFullscreen: () => ipcRenderer.invoke("window:toggle-fullscreen") as Promise<boolean>,
    close: () => ipcRenderer.invoke("window:close") as Promise<void>,
  },
  app: {
    print: () => ipcRenderer.invoke("app:print") as Promise<boolean>,
    showNotification: (title: string, body: string) =>
      ipcRenderer.invoke("app:show-notification", { title, body }) as Promise<boolean>,
    setAutoLaunch: (enabled: boolean) => ipcRenderer.invoke("app:set-auto-launch", enabled) as Promise<boolean>,
  },
  files: {
    select: () => ipcRenderer.invoke("file:select") as Promise<string[]>,
  },
  displays: {
    list: () => ipcRenderer.invoke("display:list") as Promise<DesktopDisplay[]>,
  },
};

const mobileApi = {
  getDevices: () => ipcRenderer.invoke("mobile:get-devices"),
  connectDevice: (serial: string, wifiAddress?: string) => ipcRenderer.invoke("mobile:connect", { serial, wifiAddress }),
  disconnectDevice: (serial: string) => ipcRenderer.invoke("mobile:disconnect", serial) as Promise<void>,
  getScreenStream: (serial: string) => ipcRenderer.invoke("mobile:get-screen-stream", serial) as Promise<MobileMetadata>,
  sendTouch: (serial: string, event: unknown) => ipcRenderer.invoke("mobile:send-touch", serial, event) as Promise<void>,
  sendSwipe: (serial: string, event: unknown) => ipcRenderer.invoke("mobile:send-swipe", serial, event) as Promise<void>,
  sendScroll: (serial: string, event: unknown) => ipcRenderer.invoke("mobile:send-scroll", serial, event) as Promise<void>,
  sendKeyboard: (serial: string, event: unknown) => ipcRenderer.invoke("mobile:send-keyboard", serial, event) as Promise<void>,
  sendClipboard: (serial: string, text: string) => ipcRenderer.invoke("mobile:send-clipboard", serial, text) as Promise<void>,
  onScreenFrame: (listener: (frame: MobileFrame) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, frame: MobileFrame) => listener(frame);
    ipcRenderer.on("mobile:frame", handler);
    return () => ipcRenderer.removeListener("mobile:frame", handler);
  },
  onScreenMetadata: (listener: (metadata: MobileMetadata) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, metadata: MobileMetadata) => listener(metadata);
    ipcRenderer.on("mobile:metadata", handler);
    return () => ipcRenderer.removeListener("mobile:metadata", handler);
  },
  onStatus: (listener: (status: MobileStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: MobileStatus) => listener(status);
    ipcRenderer.on("mobile:status", handler);
    return () => ipcRenderer.removeListener("mobile:status", handler);
  },
};

contextBridge.exposeInMainWorld("desktop", desktopApi);
contextBridge.exposeInMainWorld("electron", mobileApi);

export type DesktopApi = typeof desktopApi;
export type MobileApi = typeof mobileApi;
