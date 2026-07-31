export type MobileDevice = {
  serial: string;
  state: "device" | "offline" | "unauthorized" | "unknown";
  model: string | null;
  product: string | null;
  device: string | null;
  transportId: string | null;
  connectionType: "usb" | "wifi";
  status: "disconnected" | "connecting" | "connected" | "reconnecting" | "error";
  info?: { name: string; resolution: { width: number; height: number } | null };
  battery?: { level: number | null; charging: boolean | null; status: string | null };
  error?: string;
};

export type MobileMetadata = { serial: string; codec: "h264"; width: number; height: number };
export type MobileFrame = { serial: string; timestamp: number; config: boolean; keyframe: boolean; data: ArrayBuffer | Uint8Array };
export type MobileStatus = { serial: string; status: MobileDevice["status"]; error?: string };

export type AndroidTouchInput = { action: "down" | "move" | "up"; pointerId: number; x: number; y: number; width: number; height: number; pressure?: number; buttons?: number };
export type AndroidSwipeInput = { fromX: number; fromY: number; toX: number; toY: number; width: number; height: number; durationMs?: number };
export type AndroidScrollInput = { x: number; y: number; width: number; height: number; horizontal: number; vertical: number };
export type AndroidKeyboardInput = { action: "down" | "up"; keyCode: number; repeat?: number; metaState?: number } | { text: string };

export type ElectronMobileApi = {
  getDevices(): Promise<MobileDevice[]>;
  connectDevice(serial: string, wifiAddress?: string): Promise<MobileDevice>;
  disconnectDevice(serial: string): Promise<void>;
  getScreenStream(serial: string): Promise<MobileMetadata>;
  sendTouch(serial: string, event: AndroidTouchInput): Promise<void>;
  sendSwipe(serial: string, event: AndroidSwipeInput): Promise<void>;
  sendScroll(serial: string, event: AndroidScrollInput): Promise<void>;
  sendKeyboard(serial: string, event: AndroidKeyboardInput): Promise<void>;
  sendClipboard(serial: string, text: string): Promise<void>;
  onScreenFrame(listener: (frame: MobileFrame) => void): () => void;
  onScreenMetadata(listener: (metadata: MobileMetadata) => void): () => void;
  onStatus(listener: (status: MobileStatus) => void): () => void;
};

export type DesktopApi = {
  files: { select(): Promise<string[]> };
};

declare global {
  interface Window {
    electron?: ElectronMobileApi;
    desktop?: DesktopApi;
  }
}

export {};
