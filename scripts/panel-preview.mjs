// 미리보기: 실제 scene.ts 의 plan() → layout() → draw() → zoom() 길 그대로 그린 픽셀을 PNG 로 (칸 하나 = 가로 1 · 세로 2 픽셀, 4배 확대)
// 쓰는 법: node scripts/panel-preview.mjs <출력.png> [칸=113] [그림 줄 수=40] [서류]   (최종 확인은 진짜 터미널로)
// 「서류」 를 붙이면 놓친 일 서류 장면: 바닥에 서류 둘 + 팀장이 하나를 주우러 가는 중 (두 번째 그림)
import { writeFileSync } from 'node:fs'
import { register } from 'node:module'
import { deflateSync } from 'node:zlib'
// 패널 .ts 를 바로 읽는다 (node 22 는 타입을 지우고 돌림). 확장자 없는 import('./office') 만 './office.ts' 로 찾아 준다
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c) } catch (e) { if (s.startsWith('.') && !/\\.[cm]?[jt]sx?$/.test(s)) return next(s + '.ts', c); throw e } }`))
const scene = await import(new URL('../panel/hooks/scene.ts', import.meta.url).href)
const office = await import(new URL('../panel/hooks/office.ts', import.meta.url).href)
const [out = 'panel-preview.png', width = '113', rows = '40', extra = ''] = process.argv.slice(2)
const now = 1_800_000_000_000
// 예시: QA 3팀 (앞 팀원은 끝) + 리서처 둘 나란히 + 디자이너 + 개발 파트장과 그 아래 둘
let o = office.onPrompt(office.EMPTY, '회원가입 만들어줘', now - 90000)
const sp = (id, type, description, x = {}) => { o = office.onSpawn(o, { id, type, description, background: true, ...x }, now - 80000 + o.workers.length * 100) }
const work = (id, tool = 'Edit') => { o = office.onToolStart(o, id, tool, 'a.ts', undefined, now - 3000) }
for (const t of [1, 2, 3]) { sp(`q${t}1`, 'general-purpose', `QA ${t}팀 ${t}-1`); o = office.onComplete(o, `q${t}1`, '찾음', false, now - 60000); sp(`q${t}2`, 'general-purpose', `QA ${t}팀 ${t}-2`); work(`q${t}2`, 'Bash') }
sp('x1', 'Explore', '조사 1'); sp('x2', 'Explore', '조사 2'); work('x1', 'Grep'); work('x2', 'Read')
sp('d1', 'designer', '시안'); work('d1')
sp('L1', 'executor', '개발 이끌기'); sp('k1', 'executor', '조각 1', { parentAgentId: 'L1' }); sp('k2', 'executor', '조각 2', { parentAgentId: 'L1' })
for (const id of ['L1', 'k1', 'k2']) work(id)
if (extra === '서류') {
  // 놓친 일: 디자이너가 적어 둔 할 일 한 줄이 안 끝남 · 팀장 목록에 안 끝난 줄 · 리서처 x2 중단 → 각 자리 근처 바닥에
  o = office.onTodoMarks(o, 'd1', 'TodoWrite', { todos: [{ content: '아이콘 색 맞추기', status: 'pending' }] })
  o = office.onMissed(o, 'd1', '', false, now - 5000)
  o = office.onMissed(office.onComplete(o, 'x2', '', true, now - 4000), 'x2', '', true, now - 4000)
  o = office.onTodoMarks(o, 'main', 'TodoWrite', { todos: [{ content: 'README 고치기', status: 'in_progress' }] })
  o = office.onMissed(o, undefined, '', false, now - 3000)
  o = office.pickPaper(o, o.papers.find((p) => p.who === 'main').id, now - 600) // 팀장이 하나를 주우러 가는 중 (두 번째 그림에서 걷는 모습)
}
const frames = []
for (const [cols, budget, dt] of [[+width, +rows, 0], [+width, +rows, 700], [Math.floor(+width / 2), +rows, 0], [+width, 70, 0]]) {
  const units = office.unitsOf(o, now + dt)
  const p = scene.plan(units, cols, budget)
  const L = scene.layout(o, cols, office.unitOf, office.familyOfW, { spots: p.spots, units, k: p.k })
  const size = scene.outOf(L)
  frames.push({ L: { cols: size.cols, rows: size.rows }, px: scene.zoom(scene.draw(o, L, now + dt, 14), L) })
  console.log(`${cols}칸 · 그림 몫 ${budget}줄 → 배율 ${p.k} · ${size.cols}×${size.rows} · 자리 ${p.spots.map((x) => x.label).join(', ')}`)
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
