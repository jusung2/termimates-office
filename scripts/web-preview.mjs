// 웹 사무실 미리보기: 브라우저 없이 office.js 의 실제 그림 코드로 사무실(월드 픽셀)을 PNG 로 뽑는다. 창을 띄우지 않음.
// 쓰는 법: node scripts/web-preview.mjs <출력.png> [폭=900] [ms 목록=0,1500,3000]   (글자는 안 그림 · 최종 확인은 진짜 브라우저로)
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import vm from 'node:vm'
const [out = 'web-preview.png', width = '900', times = '0,1500,3000'] = process.argv.slice(2)
const dir = new URL('../panel/web/', import.meta.url)

// ---- 아주 작은 소프트웨어 캔버스 (사각형 · 원 · 그림 붙이기만) ----
function parse(c) {
  if (!c || typeof c !== 'string') return c && c.stops ? parse(c.stops[Math.floor(c.stops.length / 2)]?.[1]) : [0, 0, 0, 0]
  if (c === 'transparent') return [0, 0, 0, 0]
  if (c[0] === '#') { const h = c.length === 4 ? c.slice(1).split('').map((x) => x + x).join('') : c.slice(1, 7); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1] }
  const m = c.match(/rgba?\(([^)]+)\)/); if (m) { const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p[3] ?? 1] }
  return [255, 0, 255, 1]
}
function makeCanvas() {
  let W = 0, H = 0, buf = new Uint8ClampedArray(0)
  const cv = { style: {}, classList: { toggle() {} }, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) }
  const resize = () => { buf = new Uint8ClampedArray(W * H * 4) }
  Object.defineProperty(cv, 'width', { get: () => W, set: (v) => { W = v | 0; resize() } })
  Object.defineProperty(cv, 'height', { get: () => H, set: (v) => { H = v | 0; resize() } })
  Object.defineProperty(cv, 'buf', { get: () => buf })
  const blend = (i, r, g, b, a) => { if (a <= 0) return; const k = 1 - a; buf[i] = r * a + buf[i] * k; buf[i + 1] = g * a + buf[i + 1] * k; buf[i + 2] = b * a + buf[i + 2] * k; buf[i + 3] = Math.min(255, 255 * a + buf[i + 3] * k) }
  let shapes = []
  const ctx = {
    fillStyle: '#000', strokeStyle: '#000', globalAlpha: 1, lineWidth: 1, font: '', textAlign: '', textBaseline: '', imageSmoothingEnabled: false,
    fillRect(x, y, w, h) { const [r, g, b, a] = parse(this.fillStyle); const A = a * this.globalAlpha
      for (let yy = Math.max(0, Math.round(y)); yy < Math.min(H, Math.round(y + h)); yy++) for (let xx = Math.max(0, Math.round(x)); xx < Math.min(W, Math.round(x + w)); xx++) blend((yy * W + xx) * 4, r, g, b, A) },
    clearRect() { buf.fill(0) },
    createLinearGradient: () => ({ stops: [], addColorStop(o, c) { this.stops.push([o, c]) } }),
    createRadialGradient: () => ({ stops: [], addColorStop(o, c) { this.stops.push([o, c]) } }),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData(img, x, y) { for (let j = 0; j < img.height; j++) for (let i = 0; i < img.width; i++) { const s = (j * img.width + i) * 4, d = ((y + j) * W + x + i) * 4; if (x + i < W && y + j < H) for (let k = 0; k < 4; k++) buf[d + k] = img.data[s + k] } },
    drawImage(src, ...a) {
      let sx = 0, sy = 0, sw = src.width, sh = src.height, dx, dy, dw, dh
      if (a.length === 2) { [dx, dy] = a; dw = sw; dh = sh } else if (a.length === 4) { [dx, dy, dw, dh] = a } else { [sx, sy, sw, sh, dx, dy, dw, dh] = a }
      if (!src.buf || dw !== sw || dh !== sh) return // 확대 붙이기(화면용)는 건너뜀
      for (let j = 0; j < sh; j++) for (let i = 0; i < sw; i++) {
        const s = ((sy + j) * src.width + sx + i) * 4, X = Math.round(dx) + i, Y = Math.round(dy) + j
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue
        blend((Y * W + X) * 4, src.buf[s], src.buf[s + 1], src.buf[s + 2], (src.buf[s + 3] / 255) * this.globalAlpha)
      }
    },
    beginPath() { shapes = [] }, closePath() {}, moveTo() {}, lineTo() {}, arcTo() {}, rect() {}, clip() {}, save() {}, restore() {}, stroke() {},
    arc(cx, cy, r) { shapes.push([cx, cy, r, r]) }, ellipse(cx, cy, rx, ry) { shapes.push([cx, cy, rx, ry]) },
    fill() { for (const [cx, cy, rx, ry] of shapes) { const [r, g, b, a] = parse(this.fillStyle)
      for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) if (x >= 0 && y >= 0 && x < W && y < H && ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) blend((y * W + x) * 4, r, g, b, a * this.globalAlpha) } },
    measureText: (s) => ({ width: String(s).length * 12 }), fillText() {},
  }
  cv.getContext = () => ctx
  return cv
}
const visible = makeCanvas()
const el = () => { const e = { hidden: false, textContent: '', innerHTML: '', className: '', style: {}, children: [], classList: { toggle() {} }, addEventListener() {}, clientWidth: +width, clientHeight: Number(process.env.STAGE_H ?? 2000) }
  e.getContext = () => makeCanvas().getContext(); e.querySelector = () => { const q = el(); q.children = Array.from({ length: 10 }, () => ({ classList: { toggle() {} } })); return q }; return e }
const els = {}
let now = Date.UTC(2026, 10, 26, Number(process.env.HOUR_UTC ?? 3), 0, 0)
const rafs = []
const win = { devicePixelRatio: 1, addEventListener() {}, requestAnimationFrame: (f) => rafs.push(f), cancelAnimationFrame() {} }
const box = { window: win, document: { getElementById: (id) => (els[id] ??= id === 'office' ? visible : el()), createElement: () => makeCanvas() },
  location: { search: '' }, URLSearchParams, console, EventSource: function () { return {} }, fetch: () => Promise.resolve({ json: () => Promise.resolve(null) }),
  Date: class extends Date { static now() { return now } }, requestAnimationFrame: win.requestAnimationFrame, cancelAnimationFrame() {} }
box.globalThis = box
vm.createContext(box)
vm.runInContext(readFileSync(new URL('sprites.js', dir), 'utf8'), box)
vm.runInContext(readFileSync(new URL('office.js', dir), 'utf8'), box)
const t0 = now
const W = (id, role, x = {}) => ({ id, role, task: '일', status: 'work', tool: 'Edit', target: '/a/b.ts', action: '고치는 중', since: t0 - 3000, started: t0 - 60000, background: false, recent: [], ...x })
const Q = (t, n, x = {}) => W(`q${t}${n}`, 'general-purpose', { job: 'QA', team: String(t), member: `${t}-${n}`, ...x })
const snap = { v: 1, session: 's', project: '/work/app', demo: null,
  office: { prompt: '회원가입 화면 만들어줘', promptAt: t0 - 1500, lead: W('main', 'main', { status: 'think', tool: undefined }),
    workers: [Q(1, 1, { tool: 'Bash' }), Q(2, 1, { started: t0 - 1000, status: 'think' }), W('d1', 'designer', { job: '디자이너', tool: 'Read' }), W('v1', 'general-purpose', { job: '개발자', status: 'done', ended: t0 - 6500, handback: '완성' })],
    handoffs: [{ at: t0 - 6500, from: 'v1', preview: '완성' }], assigns: [], skillUses: {}, shelf: [{ at: t0 - 1800, who: 'd1', book: 'animate' }] },
  power: { lead: { tokens: 90000, window: 200000 }, workers: {}, byWorker: {}, today: 1, usual: 2 },
  units: [{ key: 'QA 1팀', job: 'QA', worker: 'q11', count: 1, team: true, members: [{ id: 'q11', member: '1-1', status: 'work' }] },
    { key: 'QA 2팀', job: 'QA', worker: 'q21', count: 1, team: true, members: [{ id: 'q21', member: '2-1', status: 'think' }] },
    { key: '디자이너', job: '디자이너', worker: 'd1', count: 1, team: false, members: [{ id: 'd1', status: 'work' }] },
    { key: '개발자', job: '개발자', worker: 'v1', count: 0, team: false, members: [{ id: 'v1', status: 'done' }] }] }
box.window.__termimates.take(snap)
const shots = []
for (const ms of times.split(',').map(Number)) {
  now = t0 + ms
  const fs = rafs.splice(0); fs.forEach((f) => f(now))
  const w = box.window.__termimates.world()
  shots.push({ w: w.width, h: w.height, buf: Uint8ClampedArray.from(w.buf) })
}
const S = 3, gap = 6, Wd = Math.max(...shots.map((s) => s.w)) * S, Ht = shots.reduce((n, s) => n + s.h * S + gap, 0)
const img = Buffer.alloc((Wd * 3 + 1) * Ht, 0x22)
let y0 = 0
for (const s of shots) { for (let y = 0; y < s.h * S; y++) { const row = (y0 + y) * (Wd * 3 + 1); img[row] = 0
  for (let x = 0; x < s.w * S; x++) { const i = (Math.floor(y / S) * s.w + Math.floor(x / S)) * 4; img[row + 1 + x * 3] = s.buf[i]; img[row + 2 + x * 3] = s.buf[i + 1]; img[row + 3 + x * 3] = s.buf[i + 2] } }
  for (let y = s.h * S; y < s.h * S + gap; y++) img[(y0 + y) * (Wd * 3 + 1)] = 0; y0 += s.h * S + gap }
const crc = (b) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } let r = ~0; for (const x of b) r = t[(r ^ x) & 255] ^ (r >>> 8); return (~r) >>> 0 }
const chunk = (ty, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(ty), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]) }
const ih = Buffer.alloc(13); ih.writeUInt32BE(Wd, 0); ih.writeUInt32BE(Ht, 4); ih[8] = 8; ih[9] = 2
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(img)), chunk('IEND', Buffer.alloc(0))]))
console.log('ok', Wd, Ht)
