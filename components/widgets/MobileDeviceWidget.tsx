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

const rememberedMobileSessions = new Map<string, { serial?: string; wifiAddress?: string }>();
const ownerForSerial = (serial: string, sessionKey: string) => [...rememberedMobileSessions.entries()].find(([key, value]) => key !== sessionKey && value.serial === serial)?.[0] ?? null;

export function MobileDeviceWidget({ sessionKey = "mobile", fullscreen = false, onExitFullscreen }: { sessionKey?: string; fullscreen?: boolean; onExitFullscreen?: () => void }) {
  const rememberedSession = rememberedMobileSessions.get(sessionKey);
  const canvas = useRef<HTMLCanvasElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const wifiInput = useRef<HTMLInputElement>(null);
  const decoder = useRef<Decoder | null>(null);
  const metadata = useRef<MobileMetadata | null>(null);
  const frameSize = useRef<{ width: number; height: number } | null>(null);
  const lastFrameReceived = useRef(0);
  const latencyEstimate = useRef<number | null>(null);
  const lastLatencyPaint = useRef(0);
  const waitingForKeyFrame = useRef(true);
  const codecConfig = useRef<Uint8Array | null>(null);
  const [devices, setDevices] = useState<MobileDevice[]>([]);
  const [serial, setSerial] = useState(rememberedSession?.serial ?? "");
  const [wifiAddress, setWifiAddress] = useState(rememberedSession?.wifiAddress ?? "");
  const [pairAddress, setPairAddress] = useState("");
  const [pairCode, setPairCode] = useState("");
  const [activeWifiField, setActiveWifiField] = useState<"connect" | "pair" | "code">("connect");
  const [status, setStatus] = useState<MobileDevice["status"]>(rememberedSession?.serial ? "connected" : "disconnected");
  const [message, setMessage] = useState(rememberedSession?.serial ? "Live Android screen connected." : "Choose an authorized Android device.");
  const [streamLatency, setStreamLatency] = useState<number | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardShift, setKeyboardShift] = useState(false);
  const [keyboardSymbols, setKeyboardSymbols] = useState(false);
  const selected = devices.find((device) => device.serial === serial);
  const storageKey = `jlcg-mobile-session:${sessionKey}`;
  const statusRef = useRef(status);

  useEffect(() => { statusRef.current = status; }, [status]);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? "null") as { serial?: string; wifiAddress?: string } | null;
      if (saved?.serial && ownerForSerial(saved.serial, sessionKey)) {
        window.localStorage.removeItem(storageKey);
        return;
      }
      if (saved?.serial) rememberedMobileSessions.set(sessionKey, saved);
      if (saved?.serial) {
        setSerial(saved.serial);
        setStatus("connected");
        setMessage("Live Android screen connected.");
      }
      if (saved?.wifiAddress) setWifiAddress(saved.wifiAddress);
    } catch {
      window.localStorage.removeItem(storageKey);
    }
  }, [sessionKey, storageKey]);

  const closeDecoder = useCallback(() => {
    decoder.current?.close();
    decoder.current = null;
    waitingForKeyFrame.current = true;
    codecConfig.current = null;
    lastFrameReceived.current = 0;
    latencyEstimate.current = null;
    lastLatencyPaint.current = 0;
    setStreamLatency(null);
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
        if (target && context) {
          frameSize.current = { width: frame.displayWidth, height: frame.displayHeight };
          const screen = metadata.current;
          const rotatePortrait = Boolean(screen && screen.width < screen.height);
          const width = rotatePortrait ? (screen?.height ?? frame.displayHeight) : frame.displayWidth;
          const height = rotatePortrait ? (screen?.width ?? frame.displayWidth) : frame.displayHeight;
          if (target.width !== width || target.height !== height) {
            target.width = width;
            target.height = height;
          }
          context.setTransform(1, 0, 0, 1, 0, 0);
          context.clearRect(0, 0, target.width, target.height);
          if (rotatePortrait && frame.displayWidth < frame.displayHeight) {
            context.translate(0, target.height);
            context.rotate(-Math.PI / 2);
            context.drawImage(frame as CanvasImageSource, 0, 0, target.height, target.width);
          } else {
            context.drawImage(frame as CanvasImageSource, 0, 0, target.width, target.height);
          }
        }
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
      if (statusRef.current !== "connected") setMessage(next.length ? "Select a device and launch its screen." : "No Android devices found. Enable USB debugging or connect by Wi-Fi.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Unable to list Android devices.");
    }
  }, [serial]);

  useEffect(() => {
    if (!window.electron || !serial || decoder.current) return;
    let active = true;
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? "null") as { serial?: string } | null;
      if (saved?.serial !== serial) return;
    } catch {
      return;
    }

    window.electron.getScreenStream(serial).then((stream) => {
      if (!active) return;
      configureDecoder(stream);
      setStatus("connected");
      setMessage("Live Android screen connected.");
    }).catch((error: unknown) => {
      if (!active) return;
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Unable to restore Android screen.");
    });
    return () => { active = false; };
  }, [configureDecoder, serial, storageKey]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadDevices(), 0);
    if (!window.electron) return;
    const removeFrame = window.electron.onScreenFrame((frame) => {
      if (frame.serial !== serial || !decoder.current) return;
      try {
        const receivedAt = performance.now();
        if (lastFrameReceived.current) {
          const gap = receivedAt - lastFrameReceived.current;
          latencyEstimate.current = latencyEstimate.current === null ? gap : latencyEstimate.current * 0.82 + gap * 0.18;
          if (receivedAt - lastLatencyPaint.current > 500) {
            setStreamLatency(Math.round(latencyEstimate.current));
            lastLatencyPaint.current = receivedAt;
          }
        }
        lastFrameReceived.current = receivedAt;
        if (frame.config) {
          codecConfig.current = asBytes(frame.data);
          // A new SPS/PPS sequence means the encoder restarted (commonly
          // after rotation or opening the camera). Drop dependent frames until
          // its next IDR frame so we never display corrupted blocks.
          waitingForKeyFrame.current = true;
          return;
        }

        let data = asBytes(frame.data);
        // scrcpy sends SPS/PPS as a configuration packet before the first
        // image. WebCodecs needs both that configuration and a key frame as
        // its first decode input, so prepend it to the first IDR packet.
        if (waitingForKeyFrame.current) {
          if (!frame.keyframe) return;
          if (codecConfig.current) {
            const combined = new Uint8Array(codecConfig.current.length + data.length);
            combined.set(codecConfig.current);
            combined.set(data, codecConfig.current.length);
            data = combined;
          }
          waitingForKeyFrame.current = false;
          codecConfig.current = null;
        }
        const VideoChunk = (globalThis as unknown as { EncodedVideoChunk?: EncodedVideoChunkConstructor }).EncodedVideoChunk;
        if (!VideoChunk) throw new Error("This Electron runtime does not support encoded video chunks.");
        decoder.current.decode(new VideoChunk({ type: frame.keyframe ? "key" : "delta", timestamp: frame.timestamp, data }));
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

  useEffect(() => {
    const hideKeyboard = (event: globalThis.PointerEvent) => {
      if (root.current?.contains(event.target as Node)) return;
      setKeyboardVisible(false);
    };
    document.addEventListener("pointerdown", hideKeyboard, true);
    return () => document.removeEventListener("pointerdown", hideKeyboard, true);
  }, []);

  const launch = async () => {
    if (!window.electron) return;
    const target = wifiAddress.trim() || serial;
    if (!target) {
      setMessage("Select an Android device or enter its Wi-Fi ADB address.");
      return;
    }
    setStatus("connecting");
    setMessage("Connecting to Android deviceâ€¦");
    try {
      const device = await window.electron.connectDevice(target, wifiAddress.trim() || undefined);
      const owner = ownerForSerial(device.serial, sessionKey);
      if (owner) throw new Error(`This phone is already assigned to ${owner === "mobile-app" ? "Mobile Device 01" : "Mobile Device 02"}. Use another phone for this widget.`);
      setSerial(device.serial);
      const savedSession = { serial: device.serial, wifiAddress: wifiAddress.trim() || undefined };
      rememberedMobileSessions.set(sessionKey, savedSession);
      window.localStorage.setItem(storageKey, JSON.stringify(savedSession));
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

  const enableUsbWifi = async () => {
    if (!window.electron || !serial) {
      setMessage("Select the USB Android device first.");
      return;
    }
    setStatus("connecting");
    setMessage("Turning on ADB over Wi-Fi. Keep the phone on the same hotspot.");
    try {
      const response = await window.electron.enableUsbWifi(serial);
      setStatus("disconnected");
      setMessage(`${response} Enter the phone IP as x.x.x.x:5555, then Launch Wi-Fi.`);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Unable to enable Wi-Fi ADB.");
    }
  };

  const pairWifiDevice = async () => {
    if (!window.electron) return;
    const endpoint = pairAddress.trim();
    const code = pairCode.trim();
    if (!endpoint || !code) {
      setMessage("Enter the Wireless debugging pair address and pairing code.");
      return;
    }
    setStatus("connecting");
    setMessage("Pairing Android Wi-Fi debugging...");
    try {
      await window.electron.pairWifi(endpoint, code);
      setStatus("disconnected");
      setPairCode("");
      setMessage("Wi-Fi pairing complete. Enter the connect address from Wireless debugging, then Launch Wi-Fi.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Unable to pair Wi-Fi debugging.");
    }
  };

  const disconnect = async () => {
    if (!window.electron || !serial) return;
    await window.electron.disconnectDevice(serial).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Disconnect failed."));
    closeDecoder();
    metadata.current = null;
    frameSize.current = null;
    rememberedMobileSessions.delete(sessionKey);
    window.localStorage.removeItem(storageKey);
    setStatus("disconnected");
    setMessage("Android device disconnected.");
  };

  const coordinates = (event: { clientX: number; clientY: number }) => {
    const bounds = canvas.current?.getBoundingClientRect();
    const screen = metadata.current;
    if (!bounds || !screen) return null;
    const localX = event.clientX - bounds.left;
    const localY = event.clientY - bounds.top;
    if (screen.width < screen.height) {
      return {
        x: screen.width - (localY * screen.width / bounds.height),
        y: localX * screen.height / bounds.width,
        width: screen.width,
        height: screen.height,
      };
    }
    return { x: localX * screen.width / bounds.width, y: localY * screen.height / bounds.height, width: screen.width, height: screen.height };
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
  const typeWifiKey = (key: string) => {
    if (key === "shift") { setKeyboardShift((shift) => !shift); return; }
    if (key === "symbols") { setKeyboardSymbols((symbols) => !symbols); return; }
    if (key === "done") { setKeyboardVisible(false); return; }
    const update = (current: string) => key === "backspace" ? current.slice(0, -1) : key === "space" ? `${current} ` : `${current}${keyboardShift ? key.toUpperCase() : key}`;
    if (activeWifiField === "pair") setPairAddress(update);
    else if (activeWifiField === "code") setPairCode(update);
    else setWifiAddress(update);
    if (keyboardShift && key.length === 1) setKeyboardShift(false);
  };
  const qwertyRows = keyboardSymbols ? [["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"], ["@", "#", "$", "_", "&", "-", "+", "(", ")"], [".", "*", "\"", "'", ":", ";", "!", "?"]] : [["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"], ["a", "s", "d", "f", "g", "h", "j", "k", "l"], ["z", "x", "c", "v", "b", "n", "m"]];

  return <div ref={root} className={`mobile-device ${fullscreen ? "is-fullscreen" : ""}`} data-widget-interactive>
    {fullscreen && <button className="mobile-exit-fullscreen" onClick={onExitFullscreen} aria-label="Exit mobile fullscreen">x</button>}
    <div className="mobile-toolbar">
      <select value={serial} onChange={(event) => setSerial(event.target.value)} aria-label="Android device">
        <option value="">Select USB device</option>
        {devices.map((device) => <option key={device.serial} value={device.serial}>{device.info?.name ?? device.model ?? device.serial} - {device.connectionType.toUpperCase()}</option>)}
      </select>
      <input ref={wifiInput} value={wifiAddress} onFocus={() => { setActiveWifiField("connect"); setKeyboardVisible(true); }} onChange={(event) => setWifiAddress(event.target.value)} placeholder="Wi-Fi ADB: 192.168.43.1:5555" aria-label="Wireless ADB address" />
      <button onClick={() => void loadDevices()} title="Refresh Android devices">Refresh</button>
      <button onClick={() => void launch()} disabled={status === "connecting"}>{wifiAddress.trim() ? "Launch Wi-Fi" : "Launch"}</button>
      <button onClick={() => void disconnect()} disabled={!serial || status === "disconnected"}>Disconnect</button>
    </div>
    <div className="mobile-wifi-panel">
      <div>
        <strong>Hotspot Wi-Fi</strong>
        <span>PC must be connected to the phone hotspot. Use Wireless debugging pair/connect addresses, or USB first then enable :5555.</span>
      </div>
      <input value={pairAddress} onFocus={() => { setActiveWifiField("pair"); setKeyboardVisible(true); }} onChange={(event) => setPairAddress(event.target.value)} placeholder="Pair address: 192.168.43.1:37123" aria-label="Wireless debugging pair address" />
      <input value={pairCode} onFocus={() => { setActiveWifiField("code"); setKeyboardVisible(true); }} onChange={(event) => setPairCode(event.target.value)} placeholder="Pair code" aria-label="Wireless debugging pair code" inputMode="numeric" />
      <button onClick={() => void pairWifiDevice()} disabled={status === "connecting"}>Pair</button>
      <button onClick={() => void enableUsbWifi()} disabled={!serial || status === "connecting"}>USB to Wi-Fi</button>
    </div>
    <div className="mobile-status"><span className={`mobile-status-dot ${status}`} /><strong>{status}</strong><span>{selected?.battery?.level ?? "-"}% {selected?.battery?.charging ? "charging" : ""}</span><span>{selected?.info?.resolution ? `${selected.info.resolution.width} x ${selected.info.resolution.height}` : "-"}</span><span>{selected?.connectionType?.toUpperCase() ?? "-"}</span><span>LAT {streamLatency === null ? "-" : `~${streamLatency}ms`}</span></div>
    <div className={`mobile-alert ${status}`}>{message}</div>
    <div className="mobile-screen-wrap"><canvas ref={canvas} className="mobile-screen" tabIndex={0} onPointerDown={(event) => { setKeyboardVisible(false); event.currentTarget.setPointerCapture(event.pointerId); sendPointer(event, "down"); }} onPointerMove={(event) => sendPointer(event, "move")} onPointerUp={(event) => sendPointer(event, "up")} onPointerCancel={(event) => sendPointer(event, "up")} onWheel={onWheel} onKeyDown={onKeyDown} /></div>
    {keyboardVisible && <div className="wifi-keyboard" onPointerDown={(event) => event.preventDefault()} aria-label="Wi-Fi address keyboard">
      {qwertyRows.map((row, rowIndex) => <div className={`keyboard-row row-${rowIndex + 1}`} key={row.join("")}>
        {rowIndex === 2 && !keyboardSymbols && <button className={`keyboard-key keyboard-action ${keyboardShift ? "is-active" : ""}`} type="button" onClick={() => typeWifiKey("shift")}>Shift</button>}
        {row.map((key) => <button className="keyboard-key" key={key} type="button" onClick={() => typeWifiKey(key)}>{keyboardShift && !keyboardSymbols ? key.toUpperCase() : key}</button>)}
        {rowIndex === 2 && <button className="keyboard-key keyboard-action" type="button" onClick={() => typeWifiKey("backspace")}>Back</button>}
      </div>)}
      <div className="keyboard-row row-4">
        <button className="keyboard-key keyboard-action" type="button" onClick={() => typeWifiKey("symbols")}>{keyboardSymbols ? "ABC" : "?123"}</button>
        <button className="keyboard-key keyboard-action" type="button" onClick={() => typeWifiKey(".")}>.</button>
        <button className="keyboard-key keyboard-space" type="button" onClick={() => typeWifiKey("space")}>EN</button>
        <button className="keyboard-key keyboard-action" type="button" onClick={() => typeWifiKey(":")}>:</button>
        <button className="keyboard-key keyboard-enter" type="button" onClick={() => typeWifiKey("done")}>Enter</button>
      </div>
    </div>}
    <p className="mobile-message">{message}</p>
  </div>;
}
