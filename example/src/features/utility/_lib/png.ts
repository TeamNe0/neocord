import { promisify } from "node:util";
import { crc32, deflate } from "node:zlib";

const deflateAsync = promisify(deflate);
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type Rgb = readonly [red: number, green: number, blue: number];

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

export async function createGradientPng(width: number, height: number, from: Rgb, to: Rgb): Promise<Buffer> {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);

  const rowLength = 1 + width * 3;
  const pixels = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const mix = width === 1 ? 0 : x / (width - 1);
      const offset = y * rowLength + 1 + x * 3;
      for (let channel = 0; channel < 3; channel++) {
        const start = from[channel] ?? 0;
        const end = to[channel] ?? 0;
        pixels[offset + channel] = Math.round(start + (end - start) * mix);
      }
    }
  }

  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", await deflateAsync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
