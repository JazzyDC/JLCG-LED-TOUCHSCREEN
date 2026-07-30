import { EventEmitter } from "node:events";
import { connect, type Socket } from "node:net";
import type { ScrcpySession } from "./scrcpy";

const DEVICE_NAME_BYTES = 64;
const CODEC_METADATA_BYTES = 12;
const FRAME_HEADER_BYTES = 12;
const PTS_VALUE_MASK = BigInt("0x3fffffffffffffff");
const PTS_KEYFRAME_FLAG = BigInt("0x4000000000000000");
const ZERO_BIG_INT = BigInt(0);

export type AndroidVideoMetadata = {
  serial: string;
  codec: "h264";
  width: number;
  height: number;
};

export type AndroidVideoFrame = {
  serial: string;
  timestamp: number;
  keyframe: boolean;
  data: ArrayBuffer;
};

export type AndroidTouch = {
  action: "down" | "move" | "up";
  pointerId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  pressure?: number;
  buttons?: number;
};

export type AndroidKey = {
  action: "down" | "up";
  keyCode: number;
  repeat?: number;
  metaState?: number;
};

export type AndroidScroll = {
  x: number;
  y: number;
  width: number;
  height: number;
  horizontal: number;
  vertical: number;
};

function waitForConnection(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Timed out connecting to the Android streaming service."));
    }, 10_000);

    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(Math.round(value), minimum), maximum);
}

function hasIdrNalUnit(frame: Buffer): boolean {
  for (let index = 0; index < frame.length - 4; index += 1) {
    const threeByteStart = frame[index] === 0 && frame[index + 1] === 0 && frame[index + 2] === 1;
    const fourByteStart = threeByteStart === false && frame[index] === 0 && frame[index + 1] === 0 && frame[index + 2] === 0 && frame[index + 3] === 1;
    const nalIndex = threeByteStart ? index + 3 : fourByteStart ? index + 4 : -1;
    if (nalIndex !== -1 && (frame[nalIndex] & 0x1f) === 5) return true;
  }
  return false;
}

/**
 * A direct scrcpy video/control connection. The class deliberately transfers
 * encoded frames instead of exposing a Node stream to the sandboxed renderer.
 */
export class AndroidStream extends EventEmitter {
  private videoSocket: Socket | null = null;
  private controlSocket: Socket | null = null;
  private buffer = Buffer.alloc(0);
  private metadata: AndroidVideoMetadata | null = null;
  private receivedDummyByte = false;
  private closed = false;

  constructor(private readonly session: ScrcpySession) {
    super();
  }

  async start(): Promise<AndroidVideoMetadata> {
    // scrcpy accepts client sockets in this order when audio is disabled.
    this.videoSocket = await waitForConnection(this.session.port);
    this.controlSocket = await waitForConnection(this.session.port);
    this.videoSocket.on("data", (chunk: Buffer) => this.readVideo(chunk));
    this.videoSocket.once("close", () => this.close());
    this.videoSocket.once("error", (error) => this.close(error));
    this.controlSocket.once("close", () => this.close());
    this.controlSocket.once("error", (error) => this.close(error));

    return new Promise<AndroidVideoMetadata>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Android video metadata was not received.")), 10_000);
      this.once("metadata", (metadata: AndroidVideoMetadata) => {
        clearTimeout(timer);
        resolve(metadata);
      });
      this.once("stream-error", (error: Error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  sendTouch(event: AndroidTouch): void {
    const actions: Record<AndroidTouch["action"], number> = { down: 0, up: 1, move: 2 };
    const packet = Buffer.alloc(32);
    packet.writeUInt8(2, 0); // TYPE_INJECT_TOUCH_EVENT
    packet.writeUInt8(actions[event.action], 1);
    packet.writeBigUInt64BE(BigInt(Math.max(0, event.pointerId)), 2);
    packet.writeUInt32BE(clamp(event.x, 0, event.width), 10);
    packet.writeUInt32BE(clamp(event.y, 0, event.height), 14);
    packet.writeUInt16BE(clamp(event.width, 1, 0xffff), 18);
    packet.writeUInt16BE(clamp(event.height, 1, 0xffff), 20);
    packet.writeUInt16BE(clamp((event.pressure ?? 1) * 0xffff, 0, 0xffff), 22);
    packet.writeUInt32BE(clamp(event.buttons ?? 1, 0, 0xffffffff), 24);
    packet.writeUInt32BE(0, 28);
    this.writeControl(packet);
  }

  sendScroll(event: AndroidScroll): void {
    const packet = Buffer.alloc(25);
    packet.writeUInt8(3, 0); // TYPE_INJECT_SCROLL_EVENT
    packet.writeUInt32BE(clamp(event.x, 0, event.width), 1);
    packet.writeUInt32BE(clamp(event.y, 0, event.height), 5);
    packet.writeUInt16BE(clamp(event.width, 1, 0xffff), 9);
    packet.writeUInt16BE(clamp(event.height, 1, 0xffff), 11);
    packet.writeInt32BE(clamp(event.horizontal, -0x80000000, 0x7fffffff), 13);
    packet.writeInt32BE(clamp(event.vertical, -0x80000000, 0x7fffffff), 17);
    packet.writeUInt32BE(0, 21);
    this.writeControl(packet);
  }

  sendKey(event: AndroidKey): void {
    const packet = Buffer.alloc(14);
    packet.writeUInt8(0, 0); // TYPE_INJECT_KEYCODE
    packet.writeUInt8(event.action === "down" ? 0 : 1, 1);
    packet.writeUInt32BE(clamp(event.keyCode, 0, 0xffffffff), 2);
    packet.writeUInt32BE(clamp(event.repeat ?? 0, 0, 0xffffffff), 6);
    packet.writeUInt32BE(clamp(event.metaState ?? 0, 0, 0xffffffff), 10);
    this.writeControl(packet);
  }

  sendText(text: string): void {
    const data = Buffer.from(text.slice(0, 4_096), "utf8");
    const packet = Buffer.alloc(5 + data.length);
    packet.writeUInt8(1, 0); // TYPE_INJECT_TEXT
    packet.writeUInt32BE(data.length, 1);
    data.copy(packet, 5);
    this.writeControl(packet);
  }

  setClipboard(text: string): void {
    const data = Buffer.from(text.slice(0, 16_384), "utf8");
    const packet = Buffer.alloc(14 + data.length);
    packet.writeUInt8(8, 0); // TYPE_SET_CLIPBOARD
    packet.writeBigUInt64BE(BigInt(Date.now()), 1);
    packet.writeUInt8(0, 9); // paste=false
    packet.writeUInt32BE(data.length, 10);
    data.copy(packet, 14);
    this.writeControl(packet);
  }

  stop(): void {
    this.close();
  }

  private readVideo(chunk: Buffer): void {
    if (this.closed) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);

    if (!this.receivedDummyByte) {
      if (this.buffer.length < 1) return;
      this.buffer = this.buffer.subarray(1);
      this.receivedDummyByte = true;
    }
    if (!this.metadata) {
      if (this.buffer.length < DEVICE_NAME_BYTES + CODEC_METADATA_BYTES) return;
      this.buffer = this.buffer.subarray(DEVICE_NAME_BYTES);
      const codecId = this.buffer.subarray(0, 4).toString("ascii");
      const width = this.buffer.readUInt32BE(4);
      const height = this.buffer.readUInt32BE(8);
      this.buffer = this.buffer.subarray(CODEC_METADATA_BYTES);
      if (codecId !== "h264" || !width || !height) {
        this.close(new Error("Android device did not provide a supported H.264 video stream."));
        return;
      }
      this.metadata = { serial: this.session.serial, codec: "h264", width, height };
      this.emit("metadata", this.metadata);
    }

    while (this.buffer.length >= FRAME_HEADER_BYTES) {
      const timestampAndFlags = this.buffer.readBigUInt64BE(0);
      const timestamp = Number(timestampAndFlags & PTS_VALUE_MASK);
      const keyframe = (timestampAndFlags & PTS_KEYFRAME_FLAG) !== ZERO_BIG_INT;
      const size = this.buffer.readUInt32BE(8);
      if (size > 16 * 1024 * 1024) {
        this.close(new Error("Android video frame exceeds the permitted size."));
        return;
      }
      if (this.buffer.length < FRAME_HEADER_BYTES + size) return;
      const encoded = this.buffer.subarray(FRAME_HEADER_BYTES, FRAME_HEADER_BYTES + size);
      this.buffer = this.buffer.subarray(FRAME_HEADER_BYTES + size);
      const copy = Uint8Array.from(encoded).buffer;
      this.emit("frame", {
        serial: this.session.serial,
        timestamp,
        keyframe: keyframe || hasIdrNalUnit(encoded),
        data: copy,
      } satisfies AndroidVideoFrame);
    }
  }

  private writeControl(packet: Buffer): void {
    if (!this.controlSocket || this.controlSocket.destroyed || this.closed) {
      throw new Error("Android control channel is not connected.");
    }
    this.controlSocket.write(packet);
  }

  private close(error?: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.videoSocket?.destroy();
    this.controlSocket?.destroy();
    if (error) this.emit("stream-error", error);
    this.emit("closed", this.session.serial);
  }
}
