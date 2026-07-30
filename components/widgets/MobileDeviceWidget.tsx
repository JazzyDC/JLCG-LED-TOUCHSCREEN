"use client";

import { type KeyboardEvent, type PointerEvent, type WheelEvent, useCallback, useEffect, useRef, useState } from "react";
import type { MobileDevice, MobileFrame, MobileMetadata } from "@/types/electron";

type Decoder = {
  configure(config: { codec: string; codedWidth: number; codedHeight: number; optimizeForLatency: boolean }): void;
  decode(chunk: unknown): void;
  close(): void;
};

type DecoderConstructor = new (options: { output: (frame: { displayWidth: number; displayHeight: number; close(): void }) => void; error: (error: Error) => void }) => Decoder;
type EncodedVideoChunkConstructor = new (init: { type: "key" | "delta"; timestamp: number; data: Uint8Array }) => unknown;

const ANDROID_KEYS: Record<string, number> = {
  Backspace: 67, Tab: 61, Enter: 66, Escape: 4, " ": 62,
  ArrowUp: 19, ArrowDown: 20, ArrowLeft: 21, ArrowRight: 22,
  Home: 3, End: 123, PageUp: 92, PageDown: 93, Delete: 112,
};

function asBytes(data: MobileFrame["data"]): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

export function MobileDeviceWidget() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const decoder = useRef<Decoder | null>(null);
  const metadata = useRef<MobileMetadata | null>(null);
  const [devices, setDevices] = useState<MobileDevice[]>([]);
  const [serial, setSerial] = useState("");
  const [wifiAddress, setWifiAddress] = useState("");
  const [status, setStatus] = useState<MobileDevice["status"]>("disconnected");
  const [message, setMessage] = useState("Choose an authorized Android device.");
  const selected = devices.find((device) => device.serial === serial);

  const closeDecoder = useCallback(() => {
    decoder.current?.close();
    decoder.current = null;
  }, []);

  const configureDecoder = useCallback((next: MobileMetadata) => {
    metadata.current = next;
    closeDecoder();
    const runtime = globalThis as unknown as { VideoDecoder?: DecoderConstructor; EncodedVideoChunk?: EncodedVideoChunkConstructor };
    const VideoDecoderConstructor = runtime.VideoDecoder;
    if (!VideoDecoderConstructor) {
      setStatus("error");
      setMessage("This Electron runtime does not support hardware video decoding.");
      return;
    }
    const target = canvas.current;
    if (target) {
      target.width = next.width;
      target.height = next.height;
    }
    const context = target?.getContext("2d", { alpha: false, desynchronized: true });
    decoder.current = new VideoDecoderConstructor({
      output: (frame) => {
        if (target && context) context.drawImage(frame as CanvasImageSource, 0, 0, target.width, target.height);
        frame.close();
      },
      error: (error) => {
        setStatus("error");
        setMessage(`Video decoder error: ${error.message}`);
      },
    });
    decoder.current.configure({ codec: "avc1.42E01E", codedWidth: next.width, codedHeight: next.height, optimizeForLatency: true });
  }, [closeDecoder]);

  const loadDevices = useCallback(async () => {
    if (!window.electron) {
      setStatus("error");
      setMessage("Mobile Device is available only in the installed Electron app.");
      return;
    }
    try {
      const next = await window.electron.getDevices();
      setDevices(next);
      if (!serial && next[0]) setSerial(next[0].serial);
      setMessage(next.length ? "Select a device and launch its screen." : "No Android devices found. Enable USB debugging or connect by Wi-Fi.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Unable to list Android devices.");
    }
  }, [serial]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadDevices(), 0);
    if (!window.electron) return;
    const removeFrame = window.electron.onScreenFrame((frame) => {
      if (frame.serial !== serial || !decoder.current) return;
      try {
        const VideoChunk = (globalThis as unknown as { EncodedVideoChunk?: EncodedVideoChunkConstructor }).EncodedVideoChunk;
        if (!VideoChunk) throw new Error("This Electron runtime does not support encoded video chunks.");
        decoder.current.decode(new VideoChunk({ type: frame.keyframe ? "key" : "delta", timestamp: frame.timestamp, data: asBytes(frame.data) }));
      } catch (error) {
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "Unable to decode Android video.");
      }
    });
    const removeMetadata = window.electron.onScreenMetadata((next) => {
      if (next.serial === serial) configureDecoder(next);
    });
    const removeStatus = window.electron.onStatus((next) => {
      if (next.serial !== serial) return;
      setStatus(next.status);
      if (next.error) setMessage(next.error);
    });
    return () => {
      removeFrame();
      removeMetadata();
      removeStatus();
      closeDecoder();
      window.clearTimeout(initialLoad);
    };
  }, [closeDecoder, configureDecoder, loadDevices, serial]);

  const launch = async () => {
    if (!window.electron) return;
    const target = wifiAddress.trim() || serial;
    if (!target) {
      setMessage("Select an Android device or enter its Wi-Fi ADB address.");
      return;
    }
    setStatus("connecting");
    setMessage("Connecting to Android device…");
    try {
      const device = await window.electron.connectDevice(target, wifiAddress.trim() || undefined);
      setSerial(device.serial);
      setDevices((current) => [...current.filter((item) => item.serial !== device.serial), device]);
      const stream = await window.electron.getScreenStream(device.serial);
      configureDecoder(stream);
      setStatus("connected");
      setMessage("Live Android screen connected.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Unable to start Android screen.");
    }
  };

  const disconnect = async () => {
    if (!window.electron || !serial) return;
    await window.electron.disconnectDevice(serial).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Disconnect failed."));
    closeDecoder();
    metadata.current = null;
    setStatus("disconnected");
    setMessage("Android device disconnected.");
  };

  const coordinates = (event: { clientX: number; clientY: number }) => {
    const bounds = canvas.current?.getBoundingClientRect();
    const screen = metadata.current;
    if (!bounds || !screen) return null;
    return { x: (event.clientX - bounds.left) * screen.width / bounds.width, y: (event.clientY - bounds.top) * screen.height / bounds.height, width: screen.width, height: screen.height };
  };

  const sendPointer = (event: PointerEvent<HTMLCanvasElement>, action: "down" | "move" | "up") => {
    if (!window.electron || !serial || status !== "connected") return;
    const point = coordinates(event);
    if (!point) return;
    window.electron.sendTouch(serial, { action, pointerId: event.pointerId, ...point, pressure: event.pressure || 1, buttons: event.buttons }).catch(() => undefined);
  };

  const onWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    if (!window.electron || !serial || status !== "connected") return;
    event.preventDefault();
    const point = coordinates(event);
    if (point) window.electron.sendScroll(serial, { ...point, horizontal: event.deltaX, vertical: event.deltaY }).catch(() => undefined);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
    if (!window.electron || !serial || status !== "connected") return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
      navigator.clipboard.readText().then((text) => window.electron?.sendClipboard(serial, text)).catch(() => undefined);
      event.preventDefault();
      return;
    }
    const code = ANDROID_KEYS[event.key];
    if (code !== undefined) {
      window.electron.sendKeyboard(serial, { action: "down", keyCode: code }).then(() => window.electron?.sendKeyboard(serial, { action: "up", keyCode: code })).catch(() => undefined);
      event.preventDefault();
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      window.electron.sendKeyboard(serial, { text: event.key }).catch(() => undefined);
      event.preventDefault();
    }
  };

  return <div className="mobile-device" data-widget-interactive>
    <div className="mobile-toolbar">
      <select value={serial} onChange={(event) => setSerial(event.target.value)} aria-label="Android device">
        <option value="">Select USB device</option>
        {devices.map((device) => <option key={device.serial} value={device.serial}>{device.info?.name ?? device.model ?? device.serial} · {device.connectionType.toUpperCase()}</option>)}
      </select>
      <input value={wifiAddress} onChange={(event) => setWifiAddress(event.target.value)} placeholder="Wi-Fi ADB: 192.168.1.50:5555" aria-label="Wireless ADB address" />
      <button onClick={() => void loadDevices()} title="Refresh Android devices">↻</button>
      <button onClick={() => void launch()} disabled={status === "connecting"}>Launch</button>
      <button onClick={() => void disconnect()} disabled={!serial || status === "disconnected"}>Disconnect</button>
    </div>
    <div className="mobile-status"><span className={`mobile-status-dot ${status}`} /><strong>{status}</strong><span>{selected?.battery?.level ?? "—"}% {selected?.battery?.charging ? "⚡" : ""}</span><span>{selected?.info?.resolution ? `${selected.info.resolution.width} × ${selected.info.resolution.height}` : "—"}</span><span>{selected?.connectionType?.toUpperCase() ?? "—"}</span></div>
    <div className="mobile-screen-wrap"><canvas ref={canvas} className="mobile-screen" tabIndex={0} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); sendPointer(event, "down"); }} onPointerMove={(event) => sendPointer(event, "move")} onPointerUp={(event) => sendPointer(event, "up")} onPointerCancel={(event) => sendPointer(event, "up")} onWheel={onWheel} onKeyDown={onKeyDown} /></div>
    <p className="mobile-message">{message}</p>
  </div>;
}
