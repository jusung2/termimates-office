// 미리보기: 실제 scene.ts 의 draw() 로 그린 픽셀을 PNG 로 (칸 하나 = 가로 1 · 세로 2 픽셀, 4배 확대)
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
// 쓰는 법: node scripts/panel-preview.mjs <복사한 scene.ts> <출력.png>  (node 가 .ts 를 바로 읽음. 최종 확인은 진짜 터미널로)
const scene = await import(process.argv[2])
const out = process.argv[3]
const now = 1_800_000_000_000
const W = (id, role, extra = {}) => ({ id, role, task: '일', status: 'work', tool: 'Edit', target: 'a.ts', action: '', since: now - 3000, started: now - 60000, background: false, recent: [], ...extra })
const Q = (team, n, extra = {}) => W(`q${team}${n}`, 'general-purpose', { job: 'QA', team: String(team), member: `${team}-${n}`, ...extra })
// 예시: QA 3팀 × 3명 (팀마다 앞 팀원은 끝, 지금 한 명 일함) + 디자이너 한 명
const o = {
  lead: { ...W('main', 'main'), status: 'wait_report', tool: undefined },
  workers: [
    Q(1, 1, { status: 'done', ended: now - 60000 }), Q(1, 2, { tool: 'Bash' }),
    Q(2, 1, { status: 'done', ended: now - 60000 }), Q(2, 2, { status: 'done', ended: now - 1700 }), Q(2, 3, { started: now - 1200, status: 'think', tool: undefined }),
    Q(3, 1, { tool: 'Read' }),
    W('d1', 'designer', { job: '디자이너', tool: 'Skill', target: 'ui-design' }),
  ],
  handoffs: [{ at: now - 1700, from: 'q22', preview: 'x' }],
  assigns: [], skillUses: {},
  shelf: [{ at: now - 2600, who: 'd1', book: 'ui-design' }],
}
const keyOf = w => (w.team ? `${w.job} ${w.team}팀` : (w.job ?? w.role))
const jobOf = w => w.job ?? w.role
const frames = []
for (const [cols, dt] of [[64, 0], [64, 700], [64, 1400], [48, 0]]) {
  const L = scene.layout(o, cols, keyOf, jobOf)
  const px = scene.draw(o, L, now + dt, 14)
  frames.push({ L, px })
}
const S = 4, gap = 8
const Wd = Math.max(...frames.map(f => f.L.cols)) * S
const Ht = frames.reduce((n, f) => n + f.L.rows * 2 * S + gap, 0)
const img = Buffer.alloc((Wd * 3 + 1) * Ht, 0x22)
let y0 = 0
for (const f of frames) {
  const w = f.L.cols, h = f.L.rows * 2
  for (let y = 0; y < h * S; y++) {
    const row = (y0 + y) * (Wd * 3 + 1)
    img[row] = 0
    for (let x = 0; x < w * S; x++) {
      const c = f.px[Math.floor(y / S) * w + Math.floor(x / S)] ?? 0
      img[row + 1 + x * 3] = (c >> 16) & 255; img[row + 2 + x * 3] = (c >> 8) & 255; img[row + 3 + x * 3] = c & 255
    }
  }
  for (let y = h * S; y < h * S + gap; y++) img[(y0 + y) * (Wd * 3 + 1)] = 0
  y0 += h * S + gap
}
for (let y = 0; y < Ht; y++) img[y * (Wd * 3 + 1)] = 0
const crc = (buf) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } let r = ~0; for (const b of buf) r = t[(r ^ b) & 255] ^ (r >>> 8); return (~r) >>> 0 }
const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]) }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(Wd, 0); ihdr.writeUInt32BE(Ht, 4); ihdr[8] = 8; ihdr[9] = 2
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(img)), chunk('IEND', Buffer.alloc(0))]))
console.log('ok', Wd, Ht)
