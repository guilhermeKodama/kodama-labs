export interface DockerFrame {
  stream: number;
  text: string;
}

/** A declared payload bigger than this is treated as a corrupt header, not a frame to wait for. */
export const MAX_DOCKER_FRAME_BYTES = 1024 * 1024;

export interface DemuxedFrames {
  rest: Buffer;
  frames: DockerFrame[];
  /** True when a header claimed an absurd size and the remainder was discarded. */
  corrupted: boolean;
}

/** Docker multiplexed log header: 1 byte stream, 3 unused, uint32be size. */
export function demuxDockerFrames(buffer: Buffer): DemuxedFrames {
  const frames: DockerFrame[] = [];
  let offset = 0;
  while (buffer.length - offset >= 8) {
    const size = buffer.readUInt32BE(offset + 4);
    if (size > MAX_DOCKER_FRAME_BYTES) {
      return { frames, rest: Buffer.alloc(0), corrupted: true };
    }
    if (buffer.length - offset < 8 + size) break;
    const stream = buffer[offset] ?? 0;
    const text = buffer.subarray(offset + 8, offset + 8 + size).toString("utf8");
    frames.push({ stream, text });
    offset += 8 + size;
  }
  return { frames, rest: buffer.subarray(offset), corrupted: false };
}

export function encodeDockerFrame(stream: number, text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const header = Buffer.alloc(8);
  header[0] = stream;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}
