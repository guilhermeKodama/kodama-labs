export interface DockerFrame {
  stream: number;
  text: string;
}

/** Docker multiplexed log header: 1 byte stream, 3 unused, uint32be size. */
export function demuxDockerFrames(buffer: Buffer): { rest: Buffer; frames: DockerFrame[] } {
  const frames: DockerFrame[] = [];
  let offset = 0;
  while (buffer.length - offset >= 8) {
    const size = buffer.readUInt32BE(offset + 4);
    if (buffer.length - offset < 8 + size) break;
    const stream = buffer[offset] ?? 0;
    const text = buffer.subarray(offset + 8, offset + 8 + size).toString("utf8");
    frames.push({ stream, text });
    offset += 8 + size;
  }
  return { rest: buffer.subarray(offset), frames };
}

export function encodeDockerFrame(stream: number, text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const header = Buffer.alloc(8);
  header[0] = stream;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}
