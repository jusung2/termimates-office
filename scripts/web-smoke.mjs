// 웹 사무실 연기 시험: 브라우저 없이 가짜 화면 도구로 office.js 를 돌려 오류가 없는지 본다 (창을 띄우지 않음).
// 쓰는 법: node scripts/web-smoke.mjs
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const dir = new URL('../panel/web/', import.meta.url)
const calls = { draw: 0, text: 0 }
const fakeCtx = () => new Proxy({}, {
  get(t, k) {
    if (k in t) return t[k]
    if (k === 'measureText') return (s) => ({ width: String(s).length * 14 })
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} })
    if (k === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) })
    if (k === 'drawImage') return () => { calls.draw++ }
    if (k === 'fillText') return () => { calls.text++ }
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
const L = api.layout(1000)
console.log('seats', L.seats.map((s) => s.key).join(','), '| H', L.H, '| draws', calls.draw, '| texts', calls.text)
if (!calls.draw || !calls.text) { console.error('아무것도 안 그려짐'); process.exit(1) }
console.log('ok')
