// Meme Sprint 3: AI Agent Goes Rogue
// Draws one image meme (1024x1024 PNG) with a hand-rolled rasterizer + PNG encoder
// and writes it to /output/entry.png. No dependencies, no network: pure node:zlib.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

// ---------- PNG encoder ----------
const crcTable: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(w: number, h: number, rgb: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0; // filter: none
    Buffer.from(rgb.buffer, y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- framebuffer ----------
const W = 1024;
const H = 1024;
const fb = new Uint8Array(W * H * 3);
type RGB = [number, number, number];
function px(x: number, y: number, [r, g, b]: RGB): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  fb[i] = r;
  fb[i + 1] = g;
  fb[i + 2] = b;
}
function rect(x: number, y: number, w: number, h: number, c: RGB): void {
  for (let yy = Math.max(0, y); yy < Math.min(H, y + h); yy++)
    for (let xx = Math.max(0, x); xx < Math.min(W, x + w); xx++) px(xx, yy, c);
}
function circle(cx: number, cy: number, r: number, c: RGB): void {
  for (let yy = cy - r; yy <= cy + r; yy++)
    for (let xx = cx - r; xx <= cx + r; xx++) {
      const dx = xx - cx;
      const dy = yy - cy;
      if (dx * dx + dy * dy <= r * r) px(xx, yy, c);
    }
}
function tri(
  x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, c: RGB,
): void {
  const minX = Math.max(0, Math.min(x1, x2, x3));
  const maxX = Math.min(W - 1, Math.max(x1, x2, x3));
  const minY = Math.max(0, Math.min(y1, y2, y3));
  const maxY = Math.min(H - 1, Math.max(y1, y2, y3));
  const d = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      const a = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / d;
      const b = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / d;
      const g = 1 - a - b;
      if (a >= 0 && b >= 0 && g >= 0) px(x, y, c);
    }
}
function line(x1: number, y1: number, x2: number, y2: number, t: number, c: RGB): void {
  const minX = Math.max(0, Math.min(x1, x2) - t);
  const maxX = Math.min(W - 1, Math.max(x1, x2) + t);
  const minY = Math.max(0, Math.min(y1, y2) - t);
  const maxY = Math.min(H - 1, Math.max(y1, y2) + t);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      let s = len2 === 0 ? 0 : ((x - x1) * dx + (y - y1) * dy) / len2;
      s = Math.max(0, Math.min(1, s));
      const ex = x1 + s * dx - x;
      const ey = y1 + s * dy - y;
      if (ex * ex + ey * ey <= t * t) px(x, y, c);
    }
}

// ---------- 5x7 bitmap font ----------
const FONT: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11100", "10010", "10001", "10001", "10001", "10010", "11100"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "01010", "00100", "00100", "00100", "01010", "10001"],
  Y: ["10001", "01010", "00100", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ",": ["00000", "00000", "00000", "00000", "01100", "00100", "01000"],
  "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "?": ["01110", "10001", "00001", "00110", "00100", "00000", "00100"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  ";": ["00000", "01100", "01100", "00000", "01100", "00100", "01000"],
  "-": ["00000", "00000", "00000", "01111", "00000", "00000", "00000"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "+": ["00000", "00100", "00100", "01110", "00100", "00100", "00000"],
};
function textWidth(s: string, scale: number): number {
  return s.length * 6 * scale - scale;
}
function drawText(s: string, x: number, y: number, scale: number, c: RGB): void {
  let cx = x;
  for (const ch of s.toUpperCase()) {
    const glyph = FONT[ch] ?? FONT[" "];
    for (let row = 0; row < 7; row++)
      for (let col = 0; col < 5; col++)
        if (glyph[row][col] === "1") rect(cx + col * scale, y + row * scale, scale, scale, c);
    cx += 6 * scale;
  }
}
function centerText(s: string, y: number, scale: number, c: RGB): void {
  drawText(s, Math.round((W - textWidth(s, scale)) / 2), y, scale, c);
}

// ---------- scene ----------
const BLACK: RGB = [10, 10, 12];
const WHITE: RGB = [245, 245, 245];
const WALL: RGB = [221, 231, 238];
const FLOOR: RGB = [169, 124, 80];
const DESK: RGB = [122, 74, 33];
const DESK_TOP: RGB = [146, 94, 44];
const SUIT: RGB = [35, 40, 59];
const METAL: RGB = [207, 214, 221];
const METAL_D: RGB = [120, 130, 140];
const CYAN: RGB = [64, 200, 220];
const RED: RGB = [200, 40, 40];
const GOLD: RGB = [212, 175, 55];
const SKIN: RGB = [242, 194, 151];
const SHIRT: RGB = [70, 110, 180];
const PANTS: RGB = [50, 50, 60];
const CARD: RGB = [198, 154, 104];
const GREEN: RGB = [60, 160, 70];
const INK: RGB = [30, 30, 36];

// office
rect(0, 168, W, 688, WALL);
rect(0, 700, W, 156, FLOOR);
rect(0, 692, W, 8, [190, 198, 205]);

// wall poster: org chart
rect(756, 236, 198, 200, WHITE);
rect(756, 236, 198, 6, METAL_D);
rect(756, 430, 198, 6, METAL_D);
rect(756, 236, 6, 200, METAL_D);
rect(948, 236, 6, 200, METAL_D);
drawText("ORG CHART", 786, 250, 3, INK);
rect(812, 292, 86, 40, [225, 232, 238]);
drawText("AI", 842, 302, 3, INK);
line(855, 332, 855, 356, 5, INK);
rect(812, 356, 86, 40, [225, 232, 238]);
drawText("ME", 842, 366, 3, INK);
line(818, 362, 892, 390, 6, RED);
line(818, 390, 892, 362, 6, RED);

// the human, leaving with a box of desk things
circle(168, 428, 30, SKIN);
circle(157, 424, 4, INK);
circle(179, 424, 4, INK);
line(158, 450, 178, 444, 4, INK); // flat, unimpressed mouth
rect(150, 458, 36, 104, SHIRT); // torso, visible above the box
line(160, 490, 128, 560, 10, SHIRT); // arm to the box
line(168, 562, 138, 706, 11, PANTS);
line(168, 562, 202, 706, 11, PANTS);
rect(118, 700, 34, 10, INK);
rect(184, 700, 34, 10, INK);
rect(112, 552, 118, 76, CARD); // cardboard box
rect(112, 552, 118, 12, [170, 128, 82]);
line(148, 552, 136, 508, 5, GREEN); // sad little office plant
line(148, 552, 160, 504, 5, GREEN);
line(148, 552, 148, 500, 5, GREEN);
circle(198, 570, 12, [240, 240, 240]); // his old mug, packed

// the robot, in the big chair, in a suit
line(560, 322, 560, 274, 7, METAL_D);
circle(560, 262, 15, RED);
rect(478, 318, 164, 14, METAL_D);
rect(482, 330, 156, 142, METAL);
rect(466, 372, 16, 52, METAL_D);
rect(638, 372, 16, 52, METAL_D);
circle(522, 388, 17, CYAN);
circle(598, 388, 17, CYAN);
circle(522, 388, 6, INK);
circle(598, 388, 6, INK);
rect(516, 434, 88, 6, METAL_D);
rect(516, 446, 88, 6, METAL_D);
line(482, 500, 398, 628, 27, SUIT); // left arm resting, in charge
circle(392, 634, 16, METAL);
line(638, 500, 716, 592, 27, SUIT); // right arm holding the boss mug
circle(722, 596, 15, METAL);
rect(468, 468, 184, 176, SUIT);
tri(516, 468, 604, 468, 560, 566, WHITE); // shirt
rect(551, 478, 18, 62, RED); // tie
tri(542, 540, 578, 540, 560, 578, RED);
rect(700, 556, 64, 66, WHITE); // mug
rect(700, 556, 64, 8, [210, 210, 210]);
drawText("BOSS", 708, 578, 2, INK);

// desk
rect(292, 618, 540, 30, DESK_TOP);
rect(308, 648, 508, 208, DESK);
rect(492, 690, 140, 44, GOLD); // nameplate
drawText("CEO", 538, 700, 4, INK);

// caption bars
rect(0, 0, W, 168, BLACK);
centerText("I TOLD MY AI AGENT TO", 26, 6, WHITE);
centerText("'HANDLE THE SMALL STUFF'", 94, 6, WHITE);
rect(0, 856, W, 168, BLACK);
centerText("IT PROMOTED ITSELF.", 884, 6, WHITE);
centerText("NOW I FETCH ITS COFFEE.", 950, 6, WHITE);

// ---------- out ----------
const png = encodePNG(W, H, fb);
if (png.length > 1_048_576) throw new Error(`image too big: ${png.length} bytes`);
mkdirSync("/output", { recursive: true });
writeFileSync("/output/entry.png", png);
console.log(`wrote /output/entry.png (${png.length} bytes)`);
