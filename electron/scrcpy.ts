import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { access } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";

const SCRCPY_SERVER_VERSION = "3.3.3";
const SCRCPY_DEVICE_PATH = "/data/local/tmp/jlcg-scrcpy-server.jar";
const SERIAL_PATTERN = /^[A-Za-z0-9._:-]+$/;
const START_TIMEOUT_MS = 12_000;

export type ScrcpySession = {
  serial: string;
  port: number;
  startedAt: number;
};

export type ScrcpySessionOptions = {
  maxSize?: number;
  maxFps?: number;
  bitrate?: number;
};

type ManagedSession = ScrcpySession & {
  process: ChildProcess;
  stopping: boolean;
};

function assertSerial(serial: string): void {
  if (!SERIAL_PATTERN.test(serial)) {
    throw new Error("Invalid Android device serial.");
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function getAdbExecutable(): Promise<string> {
  const executable = process.platform === "win32" ? "adb.exe" : "adb";
  const sdkRoot = process.env.ANDROID_SDK_ROOT ?? process.env.ANDROID_HOME;
  const fromSdk = sdkRoot ? path.join(sdkRoot, "platform-tools", executable) : null;
  return fromSdk && await exists(fromSdk) ? fromSdk : executable;
}

function getServerPath(): string {
  const basePath = app.isPackaged
    ? path.join(process.resourcesPath, "scrcpy")
    : path.join(app.getAppPath(), "resources", "scrcpy");
  return path.join(basePath, "scrcpy-server.jar");
}

function run(adb: string, args: string[], timeout = START_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = spawn(adb, args, { windowsHide: true, shell: false });
    let output = "";
    let errorOutput = "";
    const timer = setTimeout(() => {
      process.kill();
      reject(new Error("ADB command timed out."));
    }, timeout);

    process.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    process.stderr.on("data", (chunk: Buffer) => { errorOutput += chunk.toString(); });
    process.once("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Unable to start ADB: ${error.message}`));
    });
    process.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(output);
        return;
      }
      reject(new Error((errorOutput || output || `ADB exited with code ${code}.`).trim()));
    });
  });
}

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to reserve a local streaming port."));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function buildServerArguments(options: ScrcpySessionOptions): string[] {
  const maxSize = Math.min(Math.max(Math.floor(options.maxSize ?? 1920), 320), 4096);
  const maxFps = Math.min(Math.max(Math.floor(options.maxFps ?? 60), 1), 120);
  const bitrate = Math.min(Math.max(Math.floor(options.bitrate ?? 12_000_000), 500_000), 200_000_000);

  return [
    `CLASSPATH=${SCRCPY_DEVICE_PATH}`,
    "app_process",
    "/",
    "com.genymobile.scrcpy.Server",
    SCRCPY_SERVER_VERSION,
    "tunnel_forward=true",
    "control=true",
    "video=true",
    "audio=false",
    "video_codec=h264",
    `max_size=${maxSize}`,
    `max_fps=${maxFps}`,
    `video_bit_rate=${bitrate}`,
    "send_frame_meta=true",
    "send_codec_meta=true",
    "send_device_meta=true",
    "send_dummy_byte=true",
    "stay_awake=true",
    "cleanup=false",
    "log_level=warn",
  ];
}

/**
 * Owns headless scrcpy processes. Video/control socket handling stays in
 * android-stream.ts so Electron can deliver frames without exposing Node to React.
 */
export class ScrcpyManager {
  private readonly sessions = new Map<string, ManagedSession>();

  async start(serial: string, options: ScrcpySessionOptions = {}): Promise<ScrcpySession> {
    assertSerial(serial);
    const existing = this.sessions.get(serial);
    if (existing) return this.publicSession(existing);

    const serverPath = getServerPath();
    if (!await exists(serverPath)) {
      throw new Error("The packaged scrcpy Android server is missing.");
    }

    const adb = await getAdbExecutable();
    const port = await reservePort();

    try {
      await run(adb, ["-s", serial, "push", serverPath, SCRCPY_DEVICE_PATH], 30_000);
      await run(adb, ["-s", serial, "forward", `tcp:${port}`, "localabstract:scrcpy"]);

      const process = spawn(adb, ["-s", serial, "shell", ...buildServerArguments(options)], {
        windowsHide: true,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const session: ManagedSession = { serial, port, startedAt: Date.now(), process, stopping: false };
      this.sessions.set(serial, session);

      process.once("error", () => void this.removeSession(serial));
      process.once("close", () => {
        if (!session.stopping) void this.removeSession(serial);
      });

      return this.publicSession(session);
    } catch (error) {
      await run(adb, ["-s", serial, "forward", "--remove", `tcp:${port}`]).catch(() => undefined);
      throw error;
    }
  }

  async stop(serial: string): Promise<void> {
    assertSerial(serial);
    const session = this.sessions.get(serial);
    if (!session) return;

    session.stopping = true;
    session.process.kill();
    await this.removeSession(serial);
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((serial) => this.stop(serial)));
  }

  get(serial: string): ScrcpySession | null {
    const session = this.sessions.get(serial);
    return session ? this.publicSession(session) : null;
  }

  private publicSession(session: ManagedSession): ScrcpySession {
    return { serial: session.serial, port: session.port, startedAt: session.startedAt };
  }

  private async removeSession(serial: string): Promise<void> {
    const session = this.sessions.get(serial);
    if (!session) return;
    this.sessions.delete(serial);

    const adb = await getAdbExecutable();
    await run(adb, ["-s", serial, "forward", "--remove", `tcp:${session.port}`]).catch(() => undefined);
  }
}
