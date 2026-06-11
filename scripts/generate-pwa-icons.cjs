// PWA 아이콘 PNG 생성 (외부 라이브러리 없이 Node 내장 zlib 사용)
// 실행: node scripts/generate-pwa-icons.cjs
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const CRC_TABLE = (() => {
  const t = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

function hex(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

function render(size) {
  const s = size / 512;
  const buf = Buffer.alloc(size * size * 4); // transparent
  const set = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
  };
  const rect = (x, y, w, h, color, radius = 0) => {
    const X = Math.round(x * s), Y = Math.round(y * s), W = Math.round(w * s), H = Math.round(h * s), R = Math.round(radius * s);
    const col = hex(color);
    for (let yy = Y; yy < Y + H; yy++) {
      for (let xx = X; xx < X + W; xx++) {
        if (R > 0) {
          const dx = xx < X + R ? X + R - xx : xx > X + W - 1 - R ? xx - (X + W - 1 - R) : 0;
          const dy = yy < Y + R ? Y + R - yy : yy > Y + H - 1 - R ? yy - (Y + H - 1 - R) : 0;
          if (dx > 0 && dy > 0 && dx * dx + dy * dy > R * R) continue;
        }
        set(xx, yy, col);
      }
    }
  };

  rect(0, 0, 512, 512, "#0F172A", 104);
  rect(150, 100, 212, 26, "#38BDF8", 13);
  rect(150, 118, 212, 296, "#F1F5F9", 14);
  const win = "#0F172A";
  [150, 214, 278].forEach((y) => [178, 234, 290].forEach((x) => rect(x, y, 44, 44, win, 6)));
  rect(232, 344, 48, 70, win, 8);
  return encodePNG(size, size, buf);
}

const outDir = path.join(__dirname, "..", "public");
[192, 512].forEach((size) => {
  const png = render(size);
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), png);
  console.log(`generated public/icon-${size}.png (${png.length} bytes)`);
});
