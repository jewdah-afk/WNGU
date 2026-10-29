// Minimal RGBA PNG encoder/decoder (zlib from Node) for QA images.
import zlib from "node:zlib";

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
export function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// simple RGBA canvas for compositing in Node
export class Surface {
  constructor(w, h, bg = [0, 0, 0, 0]) { this.w = w; this.h = h; this.px = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) this.px.set(bg, i * 4); }
  blit(s, dx, dy, scale = 1) {
    for (let y = 0; y < s.h * scale; y++) for (let x = 0; x < s.w * scale; x++) {
      const tx = dx + x, ty = dy + y;
      if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) continue;
      const si = (Math.floor(y / scale) * s.w + Math.floor(x / scale)) * 4, a = s.rgba[si + 3] / 255;
      if (!a) continue;
      const di = (ty * this.w + tx) * 4;
      for (let c = 0; c < 3; c++) this.px[di + c] = s.rgba[si + c] * a + this.px[di + c] * (1 - a);
      this.px[di + 3] = 255;
    }
  }
  png() { return encodePNG(this.w, this.h, this.px); }
}
