import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ADB_TIMEOUT_MS = 10_000;
const SERIAL_PATTERN = /^[A-Za-z0-9._:-]+$/;
const WIFI_ENDPOINT_PATTERN = /^(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*|\d{1,3}(?:\.\d{1,3}){3}):([1-9]\d{0,4})$/;

export type ConnectionType = "usb" | "wifi";
export type DeviceState = "device" | "offline" | "unauthorized" | "unknown";

export type AndroidDevice = {
  serial: string;
  state: DeviceState;
  model: string | null;
  product: string | null;
  device: string | null;
  transportId: string | null;
  connectionType: ConnectionType;
};

export type AndroidDeviceInfo = {
  serial: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  androidVersion: string | null;
  resolution: { width: number; height: number } | null;
  connectionType: ConnectionType;
};

export type AndroidBatteryInfo = {
  level: number | null;
  charging: boolean | null;
  status: string | null;
};

type AdbResult = { stdout: string; stderr: string };

function assertSerial(serial: string): void {
  if (!SERIAL_PATTERN.test(serial)) {
    throw new Error("Invalid Android device serial.");
  }
}

function connectionType(serial: string): ConnectionType {
  return serial.includes(":") ? "wifi" : "usb";
}

async function executableExists(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function getAdbExecutable(): Promise<string> {
  const executable = process.platform === "win32" ? "adb.exe" : "adb";
  const sdkRoot = process.env.ANDROID_SDK_ROOT ?? process.env.ANDROID_HOME;
  const sdkRoots = [
    sdkRoot,
    // Android Studio's default Windows location. This keeps the packaged app
    // usable when ANDROID_SDK_ROOT is not inherited from a developer shell.
    process.platform === "win32" && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Android", "Sdk")
      : undefined,
  ].filter((root): root is string => Boolean(root));

  for (const root of sdkRoots) {
    const sdkAdb = path.join(root, "platform-tools", executable);
    if (await executableExists(sdkAdb)) return sdkAdb;
  }

  // Electron Builder can supply a bundled platform-tools binary later. Until
  // then, resolving `adb` through PATH keeps development and Linux supported.
  return executable;
}

async function runAdb(args: string[], timeout = ADB_TIMEOUT_MS): Promise<AdbResult> {
  const adb = await getAdbExecutable();

  try {
    const result = await execFileAsync(adb, args, {
      windowsHide: true,
      timeout,
      maxBuffer: 2 * 1024 * 1024,
      encoding: "utf8",
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown ADB error.";
    throw new Error(`ADB command failed: ${detail}`);
  }
}

function parseDevices(output: string): AndroidDevice[] {
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial = "", rawState = "unknown", ...properties] = line.split(/\s+/);
      const values = new Map(properties.map((property) => {
        const separator = property.indexOf(":");
        return separator === -1 ? [property, ""] : [property.slice(0, separator), property.slice(separator + 1)];
      }));
      const state: DeviceState = rawState === "device" || rawState === "offline" || rawState === "unauthorized" ? rawState : "unknown";

      return {
        serial,
        state,
        model: values.get("model")?.replaceAll("_", " ") ?? null,
        product: values.get("product") ?? null,
        device: values.get("device") ?? null,
        transportId: values.get("transport_id") ?? null,
        connectionType: connectionType(serial),
      };
    })
    .filter((device) => SERIAL_PATTERN.test(device.serial));
}

function parseResolution(value: string): { width: number; height: number } | null {
  const match = value.match(/Physical size:\s*(\d+)x(\d+)/i) ?? value.match(/(\d+)x(\d+)/);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

function propertyValue(output: string): string | null {
  const value = output.trim();
  return value && value !== "unknown" ? value : null;
}

/** Starts the local ADB daemon and returns every visible Android device. */
export async function getDevices(): Promise<AndroidDevice[]> {
  await runAdb(["start-server"]);
  const { stdout } = await runAdb(["devices", "-l"]);
  return parseDevices(stdout);
}

/** Verifies a USB-debugging device is attached and authorized. */
export async function connectUSB(serial: string): Promise<AndroidDevice> {
  assertSerial(serial);
  const device = (await getDevices()).find((candidate) => candidate.serial === serial);

  if (!device || device.connectionType !== "usb") {
    throw new Error("USB Android device was not found.");
  }
  if (device.state === "unauthorized") {
    throw new Error("Authorize USB debugging on the Android device, then reconnect.");
  }
  if (device.state !== "device") {
    throw new Error("USB Android device is not ready.");
  }

  return device;
}

/** Connects to an Android device that has wireless ADB enabled. */
export async function connectWifi(endpoint: string): Promise<AndroidDevice> {
  const port = WIFI_ENDPOINT_PATTERN.exec(endpoint)?.[1];
  if (!port || Number(port) > 65535) {
    throw new Error("Enter a valid wireless ADB address, for example 192.168.1.50:5555.");
  }

  const { stdout, stderr } = await runAdb(["connect", endpoint], 20_000);
  const response = `${stdout}\n${stderr}`.trim();
  if (!/connected to|already connected to/i.test(response)) {
    throw new Error(response || "Unable to connect to the Android device over Wi-Fi.");
  }

  const device = (await getDevices()).find((candidate) => candidate.serial === endpoint);
  if (!device || device.state !== "device") {
    throw new Error("Wireless Android device connected but is not ready yet.");
  }
  return device;
}

/** Stops the ADB connection to a wireless device. USB devices remain physically connected. */
export async function disconnect(serial: string): Promise<void> {
  assertSerial(serial);
  if (connectionType(serial) === "wifi") {
    await runAdb(["disconnect", serial]);
  }
}

export async function deviceInfo(serial: string): Promise<AndroidDeviceInfo> {
  assertSerial(serial);
  const [manufacturer, model, androidVersion, resolution] = await Promise.all([
    runAdb(["-s", serial, "shell", "getprop", "ro.product.manufacturer"]),
    runAdb(["-s", serial, "shell", "getprop", "ro.product.model"]),
    runAdb(["-s", serial, "shell", "getprop", "ro.build.version.release"]),
    runAdb(["-s", serial, "shell", "wm", "size"]),
  ]);
  const cleanManufacturer = propertyValue(manufacturer.stdout);
  const cleanModel = propertyValue(model.stdout);

  return {
    serial,
    name: [cleanManufacturer, cleanModel].filter(Boolean).join(" ") || serial,
    manufacturer: cleanManufacturer,
    model: cleanModel,
    androidVersion: propertyValue(androidVersion.stdout),
    resolution: parseResolution(resolution.stdout),
    connectionType: connectionType(serial),
  };
}

export async function batteryInfo(serial: string): Promise<AndroidBatteryInfo> {
  assertSerial(serial);
  const { stdout } = await runAdb(["-s", serial, "shell", "dumpsys", "battery"]);
  const level = stdout.match(/^\s*level:\s*(\d+)\s*$/m)?.[1];
  const statusCode = stdout.match(/^\s*status:\s*(\d+)\s*$/m)?.[1];
  const acPowered = /^\s*AC powered:\s*true\s*$/mi.test(stdout);
  const usbPowered = /^\s*USB powered:\s*true\s*$/mi.test(stdout);
  const wirelessPowered = /^\s*Wireless powered:\s*true\s*$/mi.test(stdout);
  const statusMap: Record<string, string> = { "1": "Unknown", "2": "Charging", "3": "Discharging", "4": "Not charging", "5": "Full" };

  return {
    level: level ? Number(level) : null,
    charging: statusCode ? statusCode === "2" || statusCode === "5" : (acPowered || usbPowered || wirelessPowered),
    status: statusCode ? (statusMap[statusCode] ?? "Unknown") : null,
  };
}
