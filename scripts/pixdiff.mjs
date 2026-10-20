// Pixel diff of two same-size PNGs (converted with macOS sips). Usage: node scripts/pixdiff.mjs before.png after.png [cell]
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
const [a, b, cell = 40] = process.argv.slice(2)
const bmp = p => { const out = p.replace(/\.png$/, '.bmp'); execFileSync('sips', ['-s', 'format', 'bmp', p, '--out', out], { stdio: 'ignore' }); return readFileSync(out) }
const parse = buf => {
  const off = buf.readUInt32LE(10), w = buf.readInt32LE(18), h0 = buf.readInt32LE(22), bpp = buf.readUInt16LE(28)
  const h = Math.abs(h0), stride = Math.ceil(w * bpp / 32) * 4
  return { w, h, px: (x, y) => { const row = h0 > 0 ? h - 1 - y : y; const i = off + row * stride + x * bpp / 8; return [buf[i], buf[i + 1], buf[i + 2]] } }
}
const A = parse(bmp(a)), B = parse(bmp(b))
if (A.w !== B.w || A.h !== B.h) { console.log(JSON.stringify({ sizeMismatch: [A.w, A.h, B.w, B.h] })); process.exit() }
let diff = 0
const cells = new Map()
for (let y = 0; y < A.h; y++) for (let x = 0; x < A.w; x++) {
  const p = A.px(x, y), q = B.px(x, y)
  if (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]) > 24) { diff++; const k = `${Math.floor(x / cell)},${Math.floor(y / cell)}`; cells.set(k, (cells.get(k) ?? 0) + 1) }
}
const boxes = [...cells.entries()].sort((p, q) => q[1] - p[1]).slice(0, 25).map(([k, n]) => { const [cx, cy] = k.split(',').map(Number); return `${cx * cell},${cy * cell} (${n})` })
console.log(JSON.stringify({ w: A.w, h: A.h, diffPixels: diff, pct: +(100 * diff / (A.w * A.h)).toFixed(4), cells: cells.size, top: boxes }))
