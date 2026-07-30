import { EventEmitter } from "node:events";
import { batteryInfo, connectUSB, connectWifi, deviceInfo, disconnect as disconnectAdb, getDevices, type AndroidBatteryInfo, type AndroidDevice, type AndroidDeviceInfo } from "./adb";
import { AndroidStream, type AndroidKey, type AndroidScroll, type AndroidTouch, type AndroidVideoFrame, type AndroidVideoMetadata } from "./android-stream";
import { ScrcpyManager } from "./scrcpy";

export type MobileDeviceStatus = "disconnected" | "connecting" | "connected" | "reconnecting" | "error";

export type MobileDevice = AndroidDevice & {
  status: MobileDeviceStatus;
  info?: AndroidDeviceInfo;
  battery?: AndroidBatteryInfo;
  error?: string;
};

export type MobileSwipe = {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  width: number;
  height: number;
  durationMs?: number;
};

type ActiveStream = {
  stream: AndroidStream;
  metadata: AndroidVideoMetadata;
  reconnectTimer: NodeJS.Timeout | null;
  manuallyDisconnected: boolean;
};

const RECONNECT_DELAY_MS = 3_000;

/** Main-process mobile device coordinator. All renderer communication is IPC-only. */
export class MobileDeviceService extends EventEmitter {
  private readonly scrcpy = new ScrcpyManager();
  private readonly streams = new Map<string, ActiveStream>();
  private readonly status = new Map<string, MobileDeviceStatus>();

  async getDevices(): Promise<MobileDevice[]> {
    const devices = await getDevices();
    return Promise.all(devices.map(async (device) => {
      const connected = this.status.get(device.serial) ?? "disconnected";
      if (device.state !== "device") return { ...device, status: connected };
      const [info, battery] = await Promise.all([
        deviceInfo(device.serial).catch(() => undefined),
        batteryInfo(device.serial).catch(() => undefined),
      ]);
      return { ...device, status: connected, info, battery };
    }));
  }

  async connectDevice(serial: string, wifiAddress?: string): Promise<MobileDevice> {
    this.setStatus(serial, "connecting");
    try {
      const device = wifiAddress ? await connectWifi(wifiAddress) : await connectUSB(serial);
      const [info, battery] = await Promise.all([deviceInfo(device.serial), batteryInfo(device.serial)]);
      this.setStatus(device.serial, "connected");
      return { ...device, status: "connected", info, battery };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to connect to Android device.";
      this.setStatus(serial, "error", message);
      throw error;
    }
  }

  async disconnectDevice(serial: string): Promise<void> {
    const active = this.streams.get(serial);
    if (active) {
      active.manuallyDisconnected = true;
      if (active.reconnectTimer) clearTimeout(active.reconnectTimer);
      active.stream.stop();
      this.streams.delete(serial);
    }
    await this.scrcpy.stop(serial);
    await disconnectAdb(serial);
    this.setStatus(serial, "disconnected");
  }

  async getScreenStream(serial: string): Promise<AndroidVideoMetadata> {
    const active = this.streams.get(serial);
    if (active) return active.metadata;

    const session = await this.scrcpy.start(serial);
    const stream = new AndroidStream(session);
    stream.on("frame", (frame: AndroidVideoFrame) => this.emit("frame", frame));
    stream.on("closed", () => void this.handleStreamClosed(serial));
    stream.on("stream-error", (error: Error) => this.setStatus(serial, "error", error.message));

    try {
      const metadata = await stream.start();
      this.streams.set(serial, { stream, metadata, reconnectTimer: null, manuallyDisconnected: false });
      this.setStatus(serial, "connected");
      this.emit("metadata", metadata);
      return metadata;
    } catch (error) {
      stream.stop();
      await this.scrcpy.stop(serial);
      const message = error instanceof Error ? error.message : "Unable to start Android video stream.";
      this.setStatus(serial, "error", message);
      throw error;
    }
  }

  sendTouch(serial: string, event: AndroidTouch): void {
    this.getActive(serial).stream.sendTouch(event);
  }

  async sendSwipe(serial: string, event: MobileSwipe): Promise<void> {
    const stream = this.getActive(serial).stream;
    const pointerId = 0;
    stream.sendTouch({ action: "down", pointerId, x: event.fromX, y: event.fromY, width: event.width, height: event.height });
    const duration = Math.min(Math.max(event.durationMs ?? 220, 16), 1_500);
    const steps = Math.max(2, Math.round(duration / 16));
    for (let step = 1; step < steps; step += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, duration / steps));
      const amount = step / steps;
      stream.sendTouch({
        action: "move",
        pointerId,
        x: event.fromX + (event.toX - event.fromX) * amount,
        y: event.fromY + (event.toY - event.fromY) * amount,
        width: event.width,
        height: event.height,
      });
    }
    stream.sendTouch({ action: "up", pointerId, x: event.toX, y: event.toY, width: event.width, height: event.height, pressure: 0, buttons: 0 });
  }

  sendScroll(serial: string, event: AndroidScroll): void {
    this.getActive(serial).stream.sendScroll(event);
  }

  sendKeyboard(serial: string, event: AndroidKey | { text: string }): void {
    const stream = this.getActive(serial).stream;
    if ("text" in event) stream.sendText(event.text);
    else stream.sendKey(event);
  }

  sendClipboard(serial: string, text: string): void {
    this.getActive(serial).stream.setClipboard(text);
  }

  async shutdown(): Promise<void> {
    for (const active of this.streams.values()) {
      active.manuallyDisconnected = true;
      if (active.reconnectTimer) clearTimeout(active.reconnectTimer);
      active.stream.stop();
    }
    this.streams.clear();
    await this.scrcpy.stopAll();
  }

  private getActive(serial: string): ActiveStream {
    const active = this.streams.get(serial);
    if (!active) throw new Error("Android screen stream is not connected.");
    return active;
  }

  private async handleStreamClosed(serial: string): Promise<void> {
    const active = this.streams.get(serial);
    if (!active || active.manuallyDisconnected) return;
    await this.scrcpy.stop(serial);
    this.setStatus(serial, "reconnecting");
    active.reconnectTimer = setTimeout(() => {
      this.streams.delete(serial);
      void this.getScreenStream(serial).catch(() => undefined);
    }, RECONNECT_DELAY_MS);
  }

  private setStatus(serial: string, status: MobileDeviceStatus, error?: string): void {
    this.status.set(serial, status);
    this.emit("status", { serial, status, error });
  }
}
