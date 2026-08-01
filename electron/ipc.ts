import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Notification,
  screen,
  type IpcMainInvokeEvent,
} from "electron";
import { MobileDeviceService, type MobileSwipe } from "./mobile";
import type { AndroidKey, AndroidScroll, AndroidTouch } from "./android-stream";

type NotificationPayload = {
  title: string;
  body: string;
};

const MAX_NOTIFICATION_LENGTH = 200;
const SERIAL_PATTERN = /^[A-Za-z0-9._:-]+$/;
const mobileDevices = new MobileDeviceService();

function getWindow(event: IpcMainInvokeEvent, mainWindow: BrowserWindow): BrowserWindow {
  return BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
}

function sanitizeNotification(payload: NotificationPayload): NotificationPayload {
  return {
    title: payload.title.trim().slice(0, MAX_NOTIFICATION_LENGTH),
    body: payload.body.trim().slice(0, MAX_NOTIFICATION_LENGTH),
  };
}

function assertRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(message);
  return value as Record<string, unknown>;
}

function assertSerial(value: unknown): string {
  if (typeof value !== "string" || !SERIAL_PATTERN.test(value)) throw new TypeError("Invalid Android device serial.");
  return value;
}

function number(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`Invalid ${name}.`);
  return value;
}

function touch(value: unknown): AndroidTouch {
  const payload = assertRecord(value, "Invalid Android touch event.");
  if (payload.action !== "down" && payload.action !== "move" && payload.action !== "up") throw new TypeError("Invalid Android touch action.");
  return {
    action: payload.action,
    pointerId: number(payload.pointerId, "pointer ID"), x: number(payload.x, "x coordinate"), y: number(payload.y, "y coordinate"),
    width: number(payload.width, "screen width"), height: number(payload.height, "screen height"),
    pressure: payload.pressure === undefined ? undefined : number(payload.pressure, "pressure"),
    buttons: payload.buttons === undefined ? undefined : number(payload.buttons, "buttons"),
  };
}

function swipe(value: unknown): MobileSwipe {
  const payload = assertRecord(value, "Invalid Android swipe event.");
  return {
    fromX: number(payload.fromX, "start x coordinate"), fromY: number(payload.fromY, "start y coordinate"),
    toX: number(payload.toX, "end x coordinate"), toY: number(payload.toY, "end y coordinate"),
    width: number(payload.width, "screen width"), height: number(payload.height, "screen height"),
    durationMs: payload.durationMs === undefined ? undefined : number(payload.durationMs, "swipe duration"),
  };
}

function scroll(value: unknown): AndroidScroll {
  const payload = assertRecord(value, "Invalid Android scroll event.");
  return {
    x: number(payload.x, "x coordinate"), y: number(payload.y, "y coordinate"), width: number(payload.width, "screen width"), height: number(payload.height, "screen height"),
    horizontal: number(payload.horizontal, "horizontal scroll"), vertical: number(payload.vertical, "vertical scroll"),
  };
}

function keyboard(value: unknown): AndroidKey | { text: string } {
  const payload = assertRecord(value, "Invalid Android keyboard event.");
  if (typeof payload.text === "string") return { text: payload.text.slice(0, 4096) };
  if (payload.action !== "down" && payload.action !== "up") throw new TypeError("Invalid Android keyboard action.");
  return { action: payload.action, keyCode: number(payload.keyCode, "key code"), repeat: payload.repeat === undefined ? undefined : number(payload.repeat, "repeat count"), metaState: payload.metaState === undefined ? undefined : number(payload.metaState, "meta state") };
}

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  mobileDevices.on("frame", (frame) => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send("mobile:frame", frame);
  });
  mobileDevices.on("metadata", (metadata) => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send("mobile:metadata", metadata);
  });
  mobileDevices.on("status", (status) => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send("mobile:status", status);
  });
  ipcMain.handle("window:minimize", (event) => {
    getWindow(event, mainWindow).minimize();
  });

  ipcMain.handle("window:toggle-maximize", (event) => {
    const window = getWindow(event, mainWindow);
    if (window.isMaximized()) {
      window.unmaximize();
      return false;
    }

    window.maximize();
    return true;
  });

  ipcMain.handle("window:toggle-fullscreen", (event) => {
    const window = getWindow(event, mainWindow);
    window.setFullScreen(!window.isFullScreen());
    return window.isFullScreen();
  });

  ipcMain.handle("window:close", (event) => {
    getWindow(event, mainWindow).close();
  });

  ipcMain.handle("app:print", (event) => {
    const window = getWindow(event, mainWindow);

    return new Promise<boolean>((resolve) => {
      window.webContents.print({ silent: false, printBackground: true }, (success) => resolve(success));
    });
  });

  ipcMain.handle("app:show-notification", (_event, payload: NotificationPayload) => {
    if (!Notification.isSupported() || !payload || typeof payload.title !== "string" || typeof payload.body !== "string") {
      return false;
    }

    const notification = sanitizeNotification(payload);
    if (!notification.title) {
      return false;
    }

    new Notification(notification).show();
    return true;
  });

  ipcMain.handle("file:select", async (event) => {
    const result = await dialog.showOpenDialog(getWindow(event, mainWindow), {
      title: "Select a local file",
      properties: ["openFile"],
    });

    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle("app:set-auto-launch", (_event, enabled: unknown) => {
    if (typeof enabled !== "boolean") {
      throw new TypeError("Auto-launch setting must be a boolean.");
    }

    app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: false });
    return app.getLoginItemSettings().openAtLogin;
  });

  ipcMain.handle("display:list", () => {
    return screen.getAllDisplays().map((display) => ({
      id: display.id,
      bounds: display.bounds,
      workArea: display.workArea,
      scaleFactor: display.scaleFactor,
      isPrimary: display.id === screen.getPrimaryDisplay().id,
    }));
  });

  ipcMain.handle("mobile:get-devices", () => mobileDevices.getDevices());
  ipcMain.handle("mobile:connect", (_event, payload: unknown) => {
    const request = assertRecord(payload, "Invalid Android connection request.");
    const serial = assertSerial(request.serial);
    const wifiAddress = request.wifiAddress;
    if (wifiAddress !== undefined && typeof wifiAddress !== "string") throw new TypeError("Invalid Android Wi-Fi address.");
    return mobileDevices.connectDevice(serial, wifiAddress);
  });
  ipcMain.handle("mobile:pair-wifi", (_event, payload: unknown) => {
    const request = assertRecord(payload, "Invalid Android Wi-Fi pairing request.");
    if (typeof request.endpoint !== "string" || typeof request.code !== "string") throw new TypeError("Invalid Android Wi-Fi pairing request.");
    return mobileDevices.pairWifiDevice(request.endpoint, request.code);
  });
  ipcMain.handle("mobile:enable-usb-wifi", (_event, serial: unknown) => mobileDevices.enableUsbWifi(assertSerial(serial)));
  ipcMain.handle("mobile:disconnect", (_event, serial: unknown) => mobileDevices.disconnectDevice(assertSerial(serial)));
  ipcMain.handle("mobile:get-screen-stream", (_event, serial: unknown) => mobileDevices.getScreenStream(assertSerial(serial)));
  ipcMain.handle("mobile:send-touch", (_event, serial: unknown, event: unknown) => mobileDevices.sendTouch(assertSerial(serial), touch(event)));
  ipcMain.handle("mobile:send-swipe", (_event, serial: unknown, event: unknown) => mobileDevices.sendSwipe(assertSerial(serial), swipe(event)));
  ipcMain.handle("mobile:send-scroll", (_event, serial: unknown, event: unknown) => mobileDevices.sendScroll(assertSerial(serial), scroll(event)));
  ipcMain.handle("mobile:send-keyboard", (_event, serial: unknown, event: unknown) => mobileDevices.sendKeyboard(assertSerial(serial), keyboard(event)));
  ipcMain.handle("mobile:send-clipboard", (_event, serial: unknown, text: unknown) => {
    if (typeof text !== "string") throw new TypeError("Invalid Android clipboard text.");
    mobileDevices.sendClipboard(assertSerial(serial), text);
  });
}

export async function shutdownMobileDevices(): Promise<void> {
  await mobileDevices.shutdown();
}


