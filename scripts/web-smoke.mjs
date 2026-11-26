// 웹 사무실 연기 시험: 브라우저 없이 가짜 화면 도구로 office.js 를 돌려 오류가 없는지 본다 (창을 띄우지 않음).
// 쓰는 법: node scripts/web-smoke.mjs
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { register } from 'node:module'
// 패널 office.ts 를 바로 읽는다 (node 22 는 .ts 의 타입을 지우고 돌림). 확장자 없는 import('./words') 만 './words.ts' 로 찾아 준다
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c) } catch (e) { if (s.startsWith('.') && !/\\.[cm]?[jt]sx?$/.test(s)) return next(s + '.ts', c); throw e } }`))
const dir = new URL('../panel/web/', import.meta.url)
const calls = { draw: 0, text: 0, said: new Set() }
const fakeCtx = () => new Proxy({}, {
  get(t, k) {
    if (k in t) return t[k]
    if (k === 'measureText') return (s) => ({ width: String(s).length * 14 })
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} })
    if (k === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) })
    if (k === 'drawImage') return () => { calls.draw++ }
    if (k === 'fillText') return (s) => { calls.text++; calls.said.add(String(s)) }
    return () => {}
  },
  set(t, k, v) { t[k] = v; return true },
})
const fakeCanvas = () => ({ width: 0, height: 0, style: {}, classList: { toggle() {} }, getContext: () => fakeCtx(),
  addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) })
const el = () => { const e = { dataset: {}, setAttribute() {}, hidden: false, textContent: '', innerHTML: '', className: '', style: {}, children: [],
  classList: { toggle() {} }, addEventListener() {}, clientWidth: 1400, clientHeight: 760, getContext: () => fakeCtx(), width: 48, height: 40 }
  e.querySelector = () => { const q = el(); Object.defineProperty(q, 'innerHTML', { set(v) { q.children = (v.match(/<i>/g) || []).map(() => ({ classList: { toggle() {} } })) }, get() { return '' } }); return q }
  return e }
const els = {}
const doc = { getElementById: (id) => (els[id] ??= id === 'office' ? fakeCanvas() : el()), createElement: () => fakeCanvas() }
let rafs = []
let now = Date.UTC(2026, 10, 26, Number(process.env.HOUR_UTC ?? 3), 0, 0)
const win = { devicePixelRatio: 2, addEventListener() {}, requestAnimationFrame: (f) => { rafs.push(f); return rafs.length }, cancelAnimationFrame() {} }
const sandbox = { window: win, document: doc, location: { search: '' }, URLSearchParams, console,
  EventSource: function () { return {} }, fetch: () => Promise.resolve({ json: () => Promise.resolve(null) }),
  Date: class extends Date { static now() { return now } }, Math, JSON, Map, Set, Promise }
sandbox.globalThis = sandbox; sandbox.requestAnimationFrame = win.requestAnimationFrame; sandbox.cancelAnimationFrame = win.cancelAnimationFrame
vm.createContext(sandbox)
vm.runInContext(readFileSync(new URL('sprites.js', dir), 'utf8'), sandbox)
vm.runInContext(readFileSync(new URL('office.js', dir), 'utf8'), sandbox)
const api = sandbox.window.__termimates
const W = (id, role, x = {}) => ({ id, role, task: '일', status: 'work', tool: 'Edit', target: '/a/b.ts', action: '고치는 중', since: now - 3000, started: now - 60000, background: false, recent: [[now - 1000, '한 일']], ...x })
const Q = (t, n, x = {}) => W(`q${t}${n}`, 'general-purpose', { job: 'QA', team: String(t), member: `${t}-${n}`, ...x })
const workers = [Q(1, 1, { status: 'done', ended: now - 2000, handback: '찾음' }), Q(1, 2, { started: now - 500, status: 'think' }), Q(2, 1, { tool: 'Bash' }), Q(3, 1, { tool: 'Skill', target: 'qa-checklist' }),
  W('d1', 'designer', { job: '디자이너', tool: 'Read' })]
const units = [
  { key: 'QA 1팀', job: 'QA', worker: 'q12', count: 1, team: true, members: [{ id: 'q11', member: '1-1', status: 'done' }, { id: 'q12', member: '1-2', status: 'think' }] },
  { key: 'QA 2팀', job: 'QA', worker: 'q21', count: 1, team: true, members: [{ id: 'q21', member: '2-1', status: 'work' }] },
  { key: 'QA 3팀', job: 'QA', worker: 'q31', count: 1, team: true, members: [{ id: 'q31', member: '3-1', status: 'work' }] },
  { key: '디자이너', job: '디자이너', worker: 'd1', count: 1, team: false, members: [{ id: 'd1', status: 'work' }] },
]
const snap = { v: 1, session: 's', project: '/work/app', demo: { step: 3, total: 40, label: '다시 보기' },
  report: { at: now, prompt: 'QA 돌려줘', mins: 12, fails: 1, papers: 3, tokens: 730000, top: 'QA 1팀', units: [{ key: 'QA 1팀', people: 2, mins: 9, fails: 1, papers: 2, tokens: 400000 }] },
  roster: [{ name: 'copywriter', description: '광고 문구를 써요', where: '이 프로젝트' }],
  skills: [{ name: 'qa-checklist', note: 'QA 체크리스트', role: 'QA', source: 'user', count: 2, last: now }, { name: 'vercel:deploy', note: '배포', role: '개발자', source: 'plugin', count: 0, last: 0 }],
  office: { prompt: 'QA 돌려줘', promptAt: now + 300, waiting: { at: now, who: 'main', what: 'Bash 허락해 주세요' }, lead: W('main', 'main', { status: 'wait_report', tool: undefined, action: '보고 기다리는 중' }), workers,
    handoffs: [{ at: now - 2000, from: 'q11', preview: '찾음' }], assigns: [{ at: now - 200, to: 'q12' }], skillUses: {},
    shelf: [{ at: now - 2600, who: 'q31', book: 'qa-checklist' }, { at: now - 6000, who: 'main', book: 'animate' }] },
  power: { job: { input: 1, cacheRead: 2, cacheWrite: 3, output: 4 }, session: { input: 1, cacheRead: 2, cacheWrite: 3, output: 4 }, byWorker: {}, workers: { q12: { tokens: 150000, window: 200000 }, d1: { tokens: 40000, window: 200000 } },
    lead: { tokens: 150000, window: 200000 }, day: '2026-11-26', mine: 10, today: 3000000, usual: 2500000 }, units }
api.take(snap)
for (const width of [1400, 900, 600, 380]) {
  els.stage.clientWidth = width
  api.take({ ...snap, units: units.slice() })
  for (let t = 0; t < 12000; t += 50) { now += 50; const fs = rafs; rafs = []; fs.forEach((f) => f(now)) }
}
if (!api.select('__report').includes('이번 일 보고서') || !api.select('__roster').includes('copywriter')) { console.error('보고서 · 명부 카드 없음'); process.exit(1) }
if (!api.select('__tired').includes('피로도')) { console.error('피로도 안내 없음'); process.exit(1) }
if (!api.select('__help').includes('사용법')) { console.error('도움말 없음'); process.exit(1) }
if (!api.select('__shelf').includes('qa-checklist')) { console.error('책장 카드에 스킬이 없음'); process.exit(1) }
for (const k of ['main', ...units.map((u) => u.key)]) { const html = api.select(k); if (!html.includes('지금 화면')) { console.error('카드에 지금 화면 없음', k); process.exit(1) } }
const shut = api.news(false), open = api.news(true)
if ((shut.match(/<time>/g) || []).length > 3 || !open.includes('사무실 소식') || (open.match(/class="srow/g) || []).length < 4) { console.error('게시판 · 소식 카드 줄 수가 이상함', shut.length, open.length); process.exit(1) }
api.news(false)
// 심사대: 검사 직원이 없으면 안 그리고, 있으면 문 · 복도 · 책장 · 팀장 · 게시판 · 직원 자리와 안 겹친다 (넓은 폭 · 좁은 폭 모두)
if (api.layout(1000).desk) { console.error('검사 직원이 없는데 심사대가 생김'); process.exit(1) }
const rv = W('rv1', 'code-reviewer', { job: 'code-reviewer', checker: true, reviewOf: 'q11', status: 'think', started: now - 1000 })
const rvSnap = { ...snap, office: { ...snap.office, workers: [...workers, rv], reviews: [{ at: now - 500, by: 'old', unit: 'QA 1팀', verdict: 'reject', reason: '빈칸 검사 없음', nth: 2 }] },
  units: [...units, { key: 'code-reviewer', job: 'code-reviewer', worker: 'rv1', count: 1, team: false, members: [{ id: 'rv1', status: 'think' }] }] }
api.take(rvSnap)
for (let t = 0; t < 6000; t += 50) { now += 50; const fs = rafs; rafs = []; fs.forEach((f) => f(now)) }
const hitBox = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
for (let Wd = 380; Wd <= 1800; Wd += 10) {
  const Ly = api.layout(Wd), D = Ly.desk
  if (!D) { console.error('검사 직원이 있는데 심사대 없음', Wd); process.exit(1) }
  const area = D.mode === 'hall' ? { x: D.x - 16, y: D.sign.y, w: D.sign.x + D.sign.w - D.x + 16, h: D.qy - D.sign.y } : { x: D.sx, y: D.sy, w: 100, h: 128 }
  const keep = [['출입문 길', { x: Ly.doorCx - 30, y: 0, w: 60, h: Ly.hallFoot }], ['복도', { x: 0, y: Ly.hallFoot - 14, w: Ly.W, h: 22 }],
    ['책장', { x: Ly.shelf.x - 32, y: 0, w: Ly.shelf.w + 32, h: Ly.shelf.h + 40 }], ['팀장 자리 · 팀장 길', { x: Ly.lead.cx - 64, y: 0, w: 64 + 90, h: Ly.lead.deskBottom + 16 }],
    ['게시판', { x: Ly.news.x, y: Ly.news.y, w: Ly.news.w, h: Ly.news.h + 20 }], ...Ly.seats.filter((x) => !x.lead).map((x) => [x.key, { x: x.sx, y: x.sy, w: 100, h: 128 }])]
  for (const [nm, b] of keep) if (hitBox(area, b)) { console.error('심사대가 겹침', Wd, D.mode, nm); process.exit(1) }
}
if (!api.select('__review').includes('심사대') || !api.select('__review').includes('2번째 반려') || !api.select('__review').includes('빈칸 검사 없음')) { console.error('심사대 카드 이상'); process.exit(1) }
// ③ 층 · 병렬 · 접기: 실제 office.ts(onSpawn · webSeats)로 만든 장면을 웹에 앉히고, 높이가 모자라면 접고 → +n.
// 자리끼리 · 심사대 · 게시판과 안 겹치고, 높이를 주면 그 안에 다 들어간다 (세로 스크롤 없음)
const OF = await import(new URL('../panel/hooks/office.ts', import.meta.url).href)
let lo = OF.onPrompt(OF.EMPTY, '회원가입 만들어줘', now - 60000)
const lsp = (id, type, description, x = {}) => { lo = OF.onSpawn(lo, { id, type, description, background: true, ...x }, now - 50000 + lo.workers.length * 100) }
for (let i = 1; i <= 4; i++) lsp('x' + i, 'Explore', `자료 조사 ${i}`)
lsp('L1', 'executor', '개발 파트 이끌기')
lsp('k1', 'executor', '조각 1', { parentAgentId: 'L1' }); lsp('k2', 'executor', '조각 2', { parentAgentId: 'L1' }); lsp('k3', 'designer', '아이콘', { parentAgentId: 'L1' })
for (let i = 1; i <= 6; i++) lsp(`q${i}`, 'general-purpose', `QA ${i}팀 ${i}-1 테스트`)
lsp('v1', 'general-purpose', '로그인 구현'); lo = OF.onComplete(lo, 'v1', '완료', false, now - 30000)
for (let r = 1; r <= 3; r++) {
  lsp('r' + r, 'code-reviewer', '로그인 코드 검토'); lo = OF.onComplete(lo, 'r' + r, '판정: 반려', false, now - 29000 + r * 1000)
  lsp('v' + (r + 1), 'general-purpose', '로그인 구현'); if (r < 3) lo = OF.onComplete(lo, 'v' + (r + 1), '완료', false, now - 28500 + r * 1000)
}
const layerSnap = { ...snap, office: lo, ...OF.webSeats(lo, now), board: OF.boardOf(lo) ?? null }
if (layerSnap.steps.main.length < 3 || !layerSnap.steps.part[0].length) { console.error('접기 단계 · 파트 줄 단계가 이상함', layerSnap.steps.main.map((x) => x.length)); process.exit(1) }
api.take(layerSnap)
for (let t = 0; t < 3000; t += 50) { now += 50; const fs = rafs; rafs = []; fs.forEach((f) => f(now)) }
for (let Wd = 380; Wd <= 1800; Wd += 20) for (const Hmax of [0, 520, 640, 900]) {
  const Ly = api.layout(Wd, Hmax || undefined)
  const st = Ly.seats.filter((x) => !x.lead)
  if (Hmax && Ly.H > Hmax && st.filter((x) => x.row !== Ly.partRow).length > 1) { console.error('높이를 줬는데 안 들어감', Wd, Hmax, Ly.H); process.exit(1) }
  // 파트 줄은 들어갈 때만 (안 들어가면 파트장 자리 표시 · 카드로만 — 터미널과 같게)
  if ((!Hmax || Hmax >= 900) && (Ly.partRow < 0 || !st.some((x) => x.row === Ly.partRow))) { console.error('파트장이 있는데 파트 줄이 없음', Wd, Hmax); process.exit(1) }
  const box = (x) => ({ x: x.sx, y: x.sy, w: 100, h: 128 })
  for (let i = 0; i < st.length; i++) for (let j = i + 1; j < st.length; j++) if (hitBox(box(st[i]), box(st[j]))) { console.error('자리끼리 겹침', Wd, Hmax, st[i].key, st[j].key); process.exit(1) }
  const D = Ly.desk, keep = [['게시판', { x: Ly.news.x, y: Ly.news.y, w: Ly.news.w, h: Ly.news.h + 20 }]]
  if (D) keep.push(['심사대', D.mode === 'hall' ? { x: D.x - 16, y: D.sign.y, w: D.sign.x + D.sign.w - D.x + 16, h: D.qy - D.sign.y } : { x: D.sx, y: D.sy, w: 100, h: 128 }])
  for (const x of st) for (const [nm, b] of keep) if (hitBox({ x: x.sx, y: x.sy - (x.row === Ly.partRow ? 20 : 0), w: 100, h: 128 }, b)) { console.error('자리가 겹침', Wd, Hmax, x.key, nm); process.exit(1) }
}
{
  const tight = api.layout(600, 520)
  if (!tight.seats.some((x) => x.kind === 'fold' || x.kind === 'more')) { console.error('높이가 모자란데 안 접힘', tight.seats.map((x) => x.key)); process.exit(1) }
  const wide = api.layout(1800)
  if (wide.seats.filter((x) => x.kind === 'twin' && x.pick === '리서처').length !== 4) { console.error('넓은데 병렬 직원을 안 펼침'); process.exit(1) }
}
// 청록 깔개(나란히 자리): 그림엔 글자 없이, 누르면 카드 맨 위에 뜻 한 줄 (넓고 높은 창에서 다 펼쳤을 때)
els.stage.clientWidth = 1800; els.stage.clientHeight = 1400
api.take(snap); api.take(layerSnap)
for (let t = 0; t < 500; t += 50) { now += 50; const fs = rafs; rafs = []; fs.forEach((f) => f(now)) }
if (!calls.said.has('같은 일 ×4') || [...calls.said].some((x) => x.includes('병렬'))) { console.error('청록 깔개 위 「같은 일 ×4」 글이 없음'); process.exit(1) }
if (!api.select('리서처').includes('같은 일을 나눠서 동시에 하는 직원들이에요 (4명)')) { console.error('청록 깔개 자리 카드에 뜻 한 줄이 없음'); process.exit(1) }
els.stage.clientWidth = 1400; els.stage.clientHeight = 760
if (!api.select('개발자').includes('파트원 3명') || !api.select('개발자').includes('⟳ 3번째')) { console.error('파트장 카드 이상', api.select('개발자').replace(/<[^>]+>/g, ' ').slice(0, 300)); process.exit(1) }
// 실제 창 맞추기: 좁고 낮은 창이면 바닥 배율에서 접혀 한 화면에 들어가고, 접은 자리를 누르면 그 사람들 목록
els.stage.clientWidth = 600; els.stage.clientHeight = 520
api.take(snap); api.take(layerSnap) // 자리가 바뀌어야 배율부터 다시 맞춘다
for (let t = 0; t < 1000; t += 50) { now += 50; const fs = rafs; rafs = []; fs.forEach((f) => f(now)) }
// 화면에 보이는 높이(CSS 픽셀) = 캔버스 style 높이. 창 높이(520) 안이어야 세로 스크롤이 없다
if (parseFloat(els.office.style.height) > 520) { console.error('세로 스크롤이 생김', els.office.style.height); process.exit(1) }
const foldCard = api.select('fold:QA') || api.select('__more')
if (!/접/.test(foldCard) || !/QA \d팀/.test(foldCard)) { console.error('접은 자리 카드 이상', foldCard.slice(0, 200)); process.exit(1) }
els.stage.clientWidth = 1400; els.stage.clientHeight = 760
api.take(snap)
const L = api.layout(1000)
console.log('seats', L.seats.map((s) => s.key).join(','), '| H', L.H, '| draws', calls.draw, '| texts', calls.text)
if (!calls.draw || !calls.text) { console.error('아무것도 안 그려짐'); process.exit(1) }
console.log('ok')
