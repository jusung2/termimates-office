// TermiMates: 대화창 옆 사무실 패널.
// 토큰 0 · 방해 0: 모든 훅은 관찰만 하고 next(e) 결과를 그대로 돌려준다. 모델 호출, 프롬프트 · 컨텍스트 변경,
// 모델이 쓰는 도구 등록 없음. 명령 /termimates 는 글을 남기지 않는다(모델이 읽을 줄이 없다).

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnUsage } from 'claude-code'

import type { Fill, LogEntry, Office, Power, Replay, Tok, View } from '../types'
import { HOLD, IDLE_DEMO, startDemo, STEPS } from './demo'
import {
  addUsage, boardOf, donePaper, EMPTY, familyOfW, isAsk, jobOfW, log, onComplete, onMissed, onPrompt, onRename, onSpawn, onStart, onTalk,
  onTodoMarks, onTodos, settleIdle, onToolEnd, onToolStart, onTurnStart, onWait, onWaitEnd, paperLine, PICK_MS, pickPaper, readerOf, reviewLine,
  foldSteps, running, set, toShelf, unitOf, unitsOf, webSeats,
} from './office'
import {
  adviceOf, average, bar, baseline, dayKey, dayOf, EMPTY_POWER, isOld, LED, man, parts, percentOf, plus, stageOf, sum, tokOf, ZERO,
} from './power'
import { CW, draw, encode, isCrowded, isGone, isMoving, layout, outOf, paperSpots, plan, seatsOf, TAG_ROW, xOf, zoom } from './scene'
import type { Layout } from './scene'
import { reportOf, stepsFromLog } from './replay'
import { setLocalNotes, skillNote, skillRole } from './skills'
import { ago, bubbles, clip, hhmm, isGeneric, namesNow, setNames, setRoles, targetOf, tierText, TIERS, title } from './words'

const PANE = 'office'
const TITLE = '사무실'

const office = atom({ plugin: 'termimates', key: 'office' } as const, EMPTY, { shape: 'office-1' })
const view = atom({ plugin: 'termimates', key: 'view' } as const, { tab: 'office', selected: 'main' } as View, {
  shape: 'view-1',
})
const power = atom({ plugin: 'termimates', key: 'power' } as const, EMPTY_POWER, { shape: 'power-1' })
const demo = atom({ plugin: 'termimates', key: 'demo' } as const, IDLE_DEMO, { shape: 'demo-1' })
const replay = atom({ plugin: 'termimates', key: 'replay' } as const, { from: 0, log: [] } as Replay, { shape: 'replay-1' })

// -- 화면 도우미 ----------------------------------------------------------------

function dw(s: string): number {
  let n = 0
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    n += c >= 0x1100 && (c <= 0x115f || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) || c >= 0x1f300) ? 2 : 1
  }
  return n
}

function fit(s: string, cols: number): string {
  if (dw(s) <= cols) return s
  let out = ''
  for (const ch of s) {
    if (dw(out + ch) > cols - 1) break
    out += ch
  }
  return out + '…'
}

/** 이름표 글: 자리 이름 · 같이 일하는 수(×n) · 파트장 아래 수(+n) · 퇴근. room(칸) 안에 들게 줄인다:
 *  그대로 → 나란히 자리(같은 일 ×n)는 번호(「1/3」)를 뺀다(깔개 위 「같은 일 ×n」 · 카드에 있음) → 띄어쓰기를 뺀다 → 끝을 「…」.
 *  번호를 띄어쓰기보다 먼저 빼는 건 「designer1/3」 처럼 붙인 글이 옆자리 것과 한 낱말로 이어져 읽히기 때문 */
export function tagText(s: { name: string; kind?: string; count: number; kids?: number }, room: number, away = false): string {
  const tail = (s.kind !== 'fold' && s.kind !== 'more' && s.count > 1 ? ` ×${s.count}` : '') + (s.kids ? ` +${s.kids}` : '') + (away ? ' 퇴근' : '')
  const full = s.name + tail
  const short = s.kind === 'twin' ? s.name.replace(/ \d+\/\d+$/, '') + tail : full
  const pick = [full, short, short.replace(/ /g, '')].find(x => dw(x) <= room)
  return pick ?? fit(short, room)
}

let lastWidth = 0 // 애니메이션 타이머가 쓰는 패널 폭 (다시 그릴 때마다 갱신)
let lastRows = 0 // 그림이 쓸 수 있는 줄 수 (패널 높이 - 위 글줄 - 카드 몫)
let cardRows = 12 // 그림 아래 카드 몫 (그리기마다 이번 카드 높이로 다시 잼 — 처음 한 번만 이 값으로 어림)
let calms = 0 // 안 붐빈 채 그린 횟수 (펼쳐 둔 카드는 이 수가 늘면 무효 — 그리기 중엔 상태를 못 써서 여기 센다)
// 그림 몫 고정: 폭 · 높이 · 직원 수 · 자리 수 · 펼침/접힘이 그대로면 지난번 그림 몫 그대로 (누르기 · 고르기 · 글 길이로는 배율이 안 바뀜)
// key = 그 조건들, rows = 그때 정한 그림 몫, gain = 그때 정한 「접으면 커지나」
let stick: { key: string; rows: number; gain: boolean } | undefined

/** 글 한 줄이 폭 안에서 몇 줄로 접히는지 */
const wrapped = (text: string, width: number): number => Math.max(1, Math.ceil(dw(text) / Math.max(1, width)))

let lastPlan: ReturnType<typeof plan> | undefined // 지난번 그린 자리 (애니메이션은 이 자리 그대로 — 그림 크기가 그린 것과 같게)

/** 터미널 사무실 배치: 「크게 → 보통 → 접기 → +n」 (plan) 에 맞춰 자리를 놓는다.
 *  keep 이면 지난번 자리 그대로 (다시 그리기 없이 칠만 하는 애니메이션용: 퇴근 걸음이 끝나 자리가 줄어도 다음 그리기까지 기다린다) */
function sceneOf(o: Office, width: number, rows: number, now: number, keep = false): Layout {
  const units = unitsOf(o, now)
  const p = keep && lastPlan ? lastPlan : plan(units, width, rows)
  if (!keep) lastPlan = p
  return layout(o, width, unitOf, familyOfW, { spots: p.spots, units, k: p.k, isles: p.isles, compact: p.compact })
}

/** 그림 한 장 (2배면 늘려서) */
function cellsOf(o: Office, L: Layout, now: number, pw: Power): string {
  const px = draw(o, L, now, new Date(now).getHours(), seatFills(L, pw))
  const out = outOf(L)
  return encode(zoom(px, L), out.cols, out.rows)
}

/** 자리별 피로도 % (자리 key 로 — 나란히 앉은 같은 일 직원도 각자) */
function seatFills(L: Layout, pw: Power): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of L.seats) {
    const p = s.key === 'main' ? percentOf(pw.lead) : s.worker && s.worker.ended === undefined ? percentOf(pw.workers[s.worker.id]) : undefined
    if (p !== undefined) out[s.key] = p
  }
  return out
}

/** 한 줄을 조각(글자 + 모양)으로 받아 폭 안에서 자른다. 넘치는 조각은 '…' 로 끝내고 뒤는 버린다. */
type Piece = [string, Record<string, unknown>?]
function rowOf(T: ReturnType<EngineInterface['ui']['resolve']>, key: string, cols: number, pieces: Piece[]): JSX.Element {
  const { Box, Text } = T
  const out: JSX.Element[] = []
  let used = 0
  for (const [i, [text, props]] of pieces.entries()) {
    if (!text) continue
    const w = dw(text)
    if (used + w > cols) {
      if (cols - used >= 2) out.push(<Text key={key + i} {...(props ?? {})}>{fit(text, cols - used)}</Text>)
      break
    }
    out.push(<Text key={key + i} {...(props ?? {})}>{text}</Text>)
    used += w
  }
  return <Box key={key}>{out}</Box>
}

// -- 전기세 · 피로도 ----------------------------------------------------------------
// 엔진이 이미 센 숫자만 쓴다: turn.complete 의 usage, session.measure 의 context, 직원의 tokenCount → 토큰 0.
// 오늘 합계는 $.store 에 세션마다 자기 키(day:<날짜>:<세션>)로 적어 여러 창이 서로 덮어쓰지 않게 한다.

let sid = '' // 이 세션 id (store 키)
let pastTotals: Record<string, number> = {} // 지난 날짜별 합계 (하루에 한 번 읽음)
let pastDay = ''

/** 지난 날 기록을 읽는다. 지난 날은 키 하나로 합치고, 14일 넘은 건 지운다. */
async function loadPast($: EngineInterface, day: string) {
  const byDay: Record<string, string[]> = {}
  for (const k of await $.store.keys()) {
    if (!k.startsWith('day:')) continue
    const d = k.slice(4, 14)
    ;(byDay[d] = byDay[d] ?? []).push(k)
  }
  const totals: Record<string, number> = {}
  for (const [d, ks] of Object.entries(byDay)) {
    if (d >= day) continue
    if (isOld(d, day)) {
      for (const k of ks) await $.store.delete(k)
      continue
    }
    let n = 0
    for (const k of ks) n += Number(await $.store.get(k)) || 0
    totals[d] = n
    const one = `day:${d}:sum`
    if (ks.length > 1 || ks[0] !== one) {
      await $.store.set(one, n)
      for (const k of ks) if (k !== one) await $.store.delete(k)
    }
  }
  pastTotals = totals
  pastDay = day
}

async function todayTotal($: EngineInterface, day: string): Promise<number> {
  let n = 0
  for (const k of await $.store.keys()) if (k.startsWith(`day:${day}:`)) n += Number(await $.store.get(k)) || 0
  return n
}

async function leadFill($: EngineInterface): Promise<Fill | undefined> {
  try {
    const { context } = await $.session.usage()
    return context.tokens ? { tokens: context.tokens, window: context.window } : undefined
  } catch {
    return undefined
  }
}

async function workerFill($: EngineInterface, id: string): Promise<Fill | undefined> {
  try {
    const a = (await $.agent.list()).find(x => x.id === id)
    return a && a.tokenCount > 0 ? { tokens: a.tokenCount, window: a.contextWindowSize ?? 200000 } : undefined
  } catch {
    return undefined
  }
}

async function changePower($: EngineInterface, fn: (p: Power) => Power) {
  try {
    await update($, power, p => fn(p ?? EMPTY_POWER))
  } catch {
    // 기록 실패는 조용히 넘긴다
  }
}

/** 한 차례(팀장 또는 직원)가 쓴 토큰을 이번 일 · 세션 · 직원 몫 · 오늘 합계에 더한다. */
async function count($: EngineInterface, agentId: string | undefined, usage: TurnUsage | undefined) {
  if (!usage) return
  const t = tokOf(usage)
  const n = sum(t)
  if (!n) return
  const id = agentId ?? 'main'
  const fill = agentId ? await workerFill($, agentId) : await leadFill($)
  try {
    const day = dayOf(await $.clock.now())
    await changePower($, p => addUsage(p, id, t, day, fill))
    if (!sid) return
    if (day !== pastDay) await loadPast($, day)
    await $.store.set(dayKey(day, sid), (await read($, power)).mine)
    const today = await todayTotal($, day)
    const { usual } = baseline({ ...pastTotals, [day]: today }, day)
    await changePower($, p => ({ ...p, today: Math.max(today, p.day === day ? p.mine : 0), usual }))
  } catch {
    // 기록 실패는 조용히 넘긴다
  }
}

/** 새 지시가 오면 지난 일의 합계를 '최근 일들'에 남기고 이번 일을 0 으로. */
async function closeJob($: EngineInterface) {
  const n = sum((await read($, power)).job)
  if (!n) return
  let jobUsual: number | undefined
  try {
    const old = await $.store.get('jobs')
    const list = [...(Array.isArray(old) ? old.filter((x): x is number => typeof x === 'number' && x > 0) : []), n].slice(-30)
    await $.store.set('jobs', list)
    jobUsual = average(list)
  } catch {
    // 기록 실패는 조용히 넘긴다
  }
  await changePower($, p => ({ ...p, job: ZERO, jobBy: {}, jobUsual: jobUsual ?? p.jobUsual }))
}

/** 세션 시작(또는 다시 불러옴): 오늘 합계 · 평소 · 팀장 피로도를 읽어 둔다. 쌓인 숫자는 지우지 않는다. */
async function startPower($: EngineInterface) {
  try {
    sid = await $.session.id()
  } catch {
    sid = ''
  }
  const fill = await leadFill($)
  try {
    const day = dayOf(await $.clock.now())
    await loadPast($, day)
    const stored = sid ? Number(await $.store.get(dayKey(day, sid))) || 0 : 0
    const today = await todayTotal($, day)
    const jobs = await $.store.get('jobs')
    const jobUsual = average(Array.isArray(jobs) ? jobs.filter((x): x is number => typeof x === 'number' && x > 0) : [])
    const { usual } = baseline({ ...pastTotals, [day]: today }, day)
    await changePower($, p => ({
      ...p, day, mine: Math.max(p.day === day ? p.mine : 0, stored), today, usual, jobUsual, lead: fill ?? p.lead,
    }))
  } catch {
    if (fill) await changePower($, p => ({ ...p, lead: fill }))
  }
}

// 이 명령들은 일을 시키는 게 아니라서 '이번 일' 을 새로 시작하지 않는다
const QUIET = new Set(['termimates', 'help', 'cost', 'context', 'status', 'config', 'plugin', 'plugins', 'reload-plugins',
  'model', 'theme', 'skills', 'usage', 'doctor', 'memory', 'permissions', 'agents', 'mcp', 'hooks', 'fast'])

// -- 창 열림 기억: 저절로 열지 않는다 (다른 프로젝트 세션을 방해하지 않게) ----------------------------
// 저절로 열지 않는다. 프로젝트마다 마지막으로 /termimates 로 켰는지 끄는지를 기억해 두고, 켜 둔 프로젝트만 다시 연다.
let project = '' // 이 세션의 프로젝트 폴더 (기억 키)

async function remember($: EngineInterface, isOpen: boolean) {
  if (project) await $.store.set(`open:${project}`, isOpen).catch(() => undefined)
}

// -- 책장 = 스킬 목록: 책장을 누르면 주르륵 ----------------------------------------------------------
// 내 스킬(내가 만든 것)과 플러그인 스킬(플러그인별로 묶음)을 확실히 나누고, 줄마다 이름 + 한 줄 설명만 (담당은 화면에 안 보임)
export type ShelfItem = { name: string; note: string; role: string; source: string; plugin: string; count: number; last: number }
let cmdCache: { at: number; list: { name: string; description: string; source: string; plugin: string }[] } | undefined

/** 내 스킬 · 명령 (개인 + 플러그인). 방금 쓴 것 먼저, 그다음 개인, 플러그인 */
async function shelfItems($: EngineInterface, o: Office): Promise<ShelfItem[]> {
  const now = Date.now()
  if (!cmdCache || now - cmdCache.at > 30000) {
    const all = await $.command.list().catch(() => [])
    cmdCache = { at: now, list: all
      .filter(c => (c.source === 'user' || c.source === 'plugin') && c.name !== 'termimates' && c.plugin !== 'termimates')
      .map(c => ({ name: c.name, description: c.description, source: c.source,
        plugin: c.source === 'user' ? '' : c.plugin ?? (c.name.includes(':') ? c.name.split(':')[0]! : '기타') })) }
  }
  return cmdCache.list.map(c => {
    const u = o.skillUses[c.name]
    return { name: c.name, note: skillNote(c.name, c.description), role: skillRole(c.name, c.description), source: c.source,
      plugin: c.plugin, count: u?.count ?? 0, last: u?.last ?? 0 }
  }).sort((a, b) => b.last - a.last || (a.source === b.source ? a.name.localeCompare(b.name) : a.source === 'user' ? -1 : 1))
}

// -- 웹 사무실: 같은 사무실을 브라우저에서 크게 (창 크기에 맞춰 반응형) ---------------------------------
// 패널이 지금 사무실 상태를 이 컴퓨터 파일(~/.termimates/panel/<세션>.json)에 적고, 같이 든 작은 서버(web/serve.py,
// 127.0.0.1 만)가 브라우저로 보낸다. 그림은 브라우저가 그린다(web/office.js). 모델 호출 없음, 토큰 0.
const WEB_PORT = 8766
let webOn = false
let snapDir = ''
let lastSnap = ''
let lastSnapAt = 0
let server: { return?: () => unknown } | undefined
let serverTriedAt = 0

let home = ''
async function homeOf($: EngineInterface): Promise<string> {
  if (!home) home = (await $.process.run(['/usr/bin/printenv', 'HOME'])).stdout.trim()
  return home
}

async function homeDir($: EngineInterface): Promise<string> {
  if (snapDir) return snapDir
  snapDir = `${await homeOf($)}/.termimates/panel`
  return snapDir
}

/** 이 컴퓨터의 스킬 한 줄 설명 (~/.termimates/skill-notes.json). git 에 안 올리는 내 설정 — 없으면 스킬 설명 첫 문장 */
async function loadLocalNotes($: EngineInterface) {
  try {
    const text = await $.fs.read(`${await homeOf($)}/.termimates/skill-notes.json`)
    setLocalNotes(JSON.parse(String(text)))
    cmdCache = undefined
  } catch {
    // 없으면 그만
  }
}

/** 직원 피로도를 2초마다 새로 잰다 (직원마다 따로: 그 에이전트 대화가 얼마나 찼는지). 이미 있는 숫자만 읽어 토큰 0 */
async function sampleFills($: EngineInterface) {
  try {
    const o = await read($, office)
    const live = o.workers.filter(w => w.ended === undefined)
    if (!live.length) return
    const agents = await $.agent.list()
    const got: Record<string, Fill> = {}
    for (const w of live) {
      const a = agents.find(x => x.id === w.id)
      if (a && a.tokenCount > 0) got[w.id] = { tokens: a.tokenCount, window: a.contextWindowSize ?? 200000 }
    }
    if (!Object.keys(got).length) return
    await changePower($, p => (Object.entries(got).every(([k, f]) => p.workers[k]?.tokens === f.tokens) ? p : { ...p, workers: { ...p.workers, ...got } }))
  } catch {
    // 못 재도 그대로
  }
}

/** 자리별 피로도 % (그림의 책상 앞 막대 · 계기판용) */
function fillsOf(o: Office, pw: Power): Record<string, number> {
  const out: Record<string, number> = {}
  const lp = percentOf(pw.lead)
  if (lp !== undefined) out.main = lp
  for (const u of seatsOf(o, unitOf)) {
    const p = percentOf(pw.workers[u.worker.id])
    if (p !== undefined && u.worker.ended === undefined) out[u.role] = p
  }
  return out
}

/** 서버를 띄운다. 이미 다른 세션 서버가 그 포트에 있으면 새 서버는 바로 끝나고, 그걸 같이 쓴다(가끔 다시 시도). */
function runServer($: EngineInterface, dir: string) {
  if (server) return
  serverTriedAt = Date.now()
  let child: ReturnType<EngineInterface['process']['spawn']>
  try {
    child = $.process.spawn({ argv: ['python3', `${$.plugin.root}/web/serve.py`, '--port', String(WEB_PORT), '--dir', dir] })
  } catch {
    return // python3 를 못 띄움 — 패널은 그대로
  }
  server = child as unknown as { return?: () => unknown }
  void (async () => {
    try {
      for await (const _ of child) {
        if (!webOn) break // 끄면 고리를 나와 서버도 끝
      }
    } catch {
      // python3 가 없거나 못 띄움 — 패널은 그대로
    } finally {
      server = undefined
    }
  })()
}

function stopServer() {
  try {
    server?.return?.()
  } catch {
    // 이미 끝남
  }
  server = undefined
}

/** 지금 상태를 파일로 (바뀐 게 있을 때만, 0.3초마다 확인) */
async function writeSnap($: EngineInterface) {
  if (!webOn || !snapDir) return
  try {
    if (!server && Date.now() - serverTriedAt > 15000) runServer($, snapDir)
    await webPicks($)
    const dm = await read($, demo)
    const o = dm.running ? dm.office : await read($, office)
    const pw = dm.running ? dm.power : await read($, power)
    const { units, steps } = webSeats(o, Date.now())
    const skills = await shelfItems($, o)
    const rp = await read($, replay)
    const body = JSON.stringify({
      v: 1, session: sid, project, demo: dm.running ? { step: dm.step, total: dm.total, label: dm.label } : null, office: o, power: pw, units, steps, board: boardOf(o) ?? null, skills,
      report: dm.running ? null : rp.report ?? null, roster: roster?.list ?? [],
    })
    const now = Date.now()
    if (body === lastSnap && now - lastSnapAt < 5000) return
    lastSnap = body
    lastSnapAt = now
    await $.fs.write(`${snapDir}/${sid || 'session'}.json`, body)
  } catch {
    // 못 적어도 패널은 그대로
  }
}

async function startWeb($: EngineInterface) {
  webOn = true
  lastSnap = ''
  const dir = await homeDir($)
  runServer($, dir)
  await writeSnap($)
}

/** 브라우저로 웹 사무실을 연다. 서버가 뜰 때까지 잠깐(최대 3초) 기다렸다가 연다 — 맥은 open, 리눅스는 xdg-open */
async function openBrowser($: EngineInterface) {
  const url = `http://127.0.0.1:${WEB_PORT}`
  const ok = async (argv: string[]) => {
    try {
      return (await $.process.run(argv)).exitCode === 0
    } catch {
      return false
    }
  }
  for (let i = 0; i < 10; i++) {
    if (await ok(['/usr/bin/curl', '-s', '-o', '/dev/null', '-m', '1', url])) break
    await $.clock.sleep(300)
  }
  if (!(await ok(['/usr/bin/open', url]))) await ok(['xdg-open', url])
}

/** 사장님 확인 기다림 시작 → 12초 넘게 그대로면 맥 알림 한 번 (다른 창에서 일하다 놓치지 않게) */
async function waitFor($: EngineInterface, who: string, what: string, id?: string) {
  await change($, (o, now) => onWait(o, who, what, now, id))
  const at = (await read($, office)).waiting?.at
  void (async () => {
    await $.clock.sleep(12000)
    const o = await read($, office)
    if (o.waiting && o.waiting.at === at) {
      await $.ui.notify(`사장님 확인이 필요해요 — ${o.waiting.what}`, { title: 'TermiMates', key: 'wait' }).catch(() => undefined)
    }
  })().catch(() => undefined)
}

// -- 다시 보기 · 보고서: 이번 일에서 일어난 일을 적어 둔다 (토큰 0, 이 세션 안에서만) ----------------------
// 일하는 동안은 메모리에만 적고(그릴 때마다 상태를 안 건드림), 일이 끝날 때 보고서와 함께 한 번 저장한다.
let jobLog: { from: number; log: LogEntry[] } = { from: 0, log: [] }
async function rec($: EngineInterface, k: string, a: unknown[]) {
  try {
    const t = await $.clock.now()
    jobLog.log.push({ t, k, a })
    if (jobLog.log.length > 600) jobLog.log.splice(0, jobLog.log.length - 600)
  } catch {
    // 못 적어도 그대로
  }
}

/** 입력창에 글만 넣는다 (보내기는 사람이 Enter → 그 전엔 토큰 0) */
async function fillPrompt($: EngineInterface, text: string) {
  try {
    const r = await $.prompt.fill({ text })
    $.ui.toast(r.isFilled ? '입력창에 넣었어요. 확인하고 Enter 를 누르세요' : '입력창에 못 넣었어요')
  } catch {
    $.ui.toast('입력창에 못 넣었어요')
  }
}

// -- 놓친 일 서류: 누르면 팀장이 주워 와 확인 → 입력창에 「놓친 일 다시 확인: …」 (보내기는 사람이) -----------------
// 여러 장을 연달아 누르면 대기열에 쌓아 순차 처리 — 두 서류가 동시에 picked 되면 scene 의 find 가 첫 번째만 걷기 때문.
// $ 는 세션당 하나의 인스턴스이므로 drainPickQ 에 인자로 넘기고, 큐에는 id(string)만 저장한다.
const picking = new Set<string>()
const pickQ: string[] = []
let pickBusy = false

async function drainPickQ($: EngineInterface) {
  if (pickBusy) return
  pickBusy = true
  try {
    while (pickQ.length > 0) {
      const id = pickQ.shift()!
      await runPickUp($, id)
    }
  } finally {
    pickBusy = false
  }
}

async function runPickUp($: EngineInterface, id: string) {
  if (picking.has(id)) return
  const p = (await read($, office)).papers?.find(x => x.id === id && x.picked === undefined)
  if (!p) return
  picking.add(id)
  try {
    await change($, (o, now) => pickPaper(o, id, now))
    await $.clock.sleep(PICK_MS) // 걸어가 줍고 → 자리로 돌아와 → 읽어 보기 (그림 쪽이 같은 시간으로 보여 줌)
    const text = paperLine(p)
    let ok = false
    try {
      ok = (await $.prompt.fill({ text })).isFilled
      if (ok) $.ui.toast('입력창에 「놓친 일 다시 확인」 을 넣었어요. 확인하고 Enter 를 누르세요')
    } catch {
      // 아래 복사로
    }
    if (!ok) {
      // 입력창에 못 넣으면 (대화 상자가 떠 있음 등) 복사해 두고 문장을 보여 준다
      ok = await $.ui.copy({ text }).then(r => r.isCopied, () => false)
      $.ui.toast(ok ? `입력창에 못 넣어 복사했어요: ${text}` : `입력창에 못 넣었어요: ${text}`)
    }
    await change($, (o, now) => donePaper(o, id, now, !ok))
  } finally {
    picking.delete(id)
  }
}

function pickUp($: EngineInterface, id: string) {
  if (picking.has(id)) return // 현재 줍는 중인 같은 서류
  if (pickQ.includes(id)) return // 대기열에 같은 서류가 있음
  pickQ.push(id)
  void drainPickQ($)
}

/** 웹에서 누른 서류: serve.py 가 <세션>.pick 에 적어 둔 서류 id 들을 읽고 비운다 (0.3초마다, 웹을 켰을 때만) */
async function webPicks($: EngineInterface) {
  if (!snapDir || !sid) return
  const path = `${snapDir}/${sid}.pick`
  try {
    if (!(await $.fs.exists(path))) return
    const text = String(await $.fs.read(path)).trim()
    if (!text) return
    await $.fs.write(path, '')
    for (const line of text.split('\n')) {
      const id = (JSON.parse(line) as { id?: unknown }).id
      if (typeof id === 'string') void pickUp($, id)
    }
  } catch {
    // 못 읽으면 다음에
  }
}

// -- 이름표: 사용자가 정한 이름 (패널에서 바꾼 것 + ~/.termimates/roles.json) --------------------------
async function loadNames($: EngineInterface) {
  // 값이 글자면 이름표 이름, { name, persona, model } 이면 이름 · 페르소나 · 직급(모델)까지
  let file: Record<string, string> = {}
  try {
    const raw = JSON.parse(String(await $.fs.read(`${await homeOf($)}/.termimates/roles.json`))) as unknown
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        const name = typeof v === 'string' ? v : v && typeof v === 'object' ? (v as { name?: unknown }).name : undefined
        if (typeof name === 'string') file[k] = name
      }
      setRoles(raw as Record<string, unknown>)
    }
  } catch {
    // 없으면 그만
  }
  const saved = ((await $.store.get('names').catch(() => undefined)) ?? {}) as Record<string, string>
  setNames({ ...file, ...saved })
}

async function rename($: EngineInterface, type: string, name: string) {
  const saved = { ...(((await $.store.get('names').catch(() => undefined)) ?? {}) as Record<string, string>), [type]: name }
  await $.store.set('names', saved).catch(() => undefined)
  setNames({ ...namesNow(), [type]: name })
  await update($, office, o => onRename(o ?? EMPTY, type, name)).catch(() => undefined)
}

// -- 명부: 내가 만든 에이전트 (.claude/agents) — 누르면 「맡기기」 문장이 입력창에 -----------------------
export type RosterItem = { name: string; description: string; where: string }
let roster: { at: number; list: RosterItem[] } | undefined
async function loadRoster($: EngineInterface): Promise<RosterItem[]> {
  if (roster && Date.now() - roster.at < 60000) return roster.list
  const list: RosterItem[] = []
  const dirs: [string, string][] = [[`${project}/.claude/agents`, '이 프로젝트']]
  try { dirs.push([`${await homeOf($)}/.claude/agents`, '내 컴퓨터']) } catch { /* HOME 못 앎 */ }
  for (const [dir, where] of dirs) {
    const entries = await $.fs.list(dir).catch(() => [])
    for (const e of entries) {
      if (e.kind !== 'file' || !e.name.endsWith('.md')) continue
      const text = String(await $.fs.read(`${dir}/${e.name}`, { length: 3000 }).catch(() => ''))
      const head = /^---\s*\n([\s\S]*?)\n---/.exec(text)?.[1] ?? ''
      const pick = (k: string) => (new RegExp(`^${k}:\\s*["']?(.+?)["']?\\s*$`, 'm').exec(head)?.[1] ?? '').trim()
      const name = pick('name') || e.name.replace(/\.md$/, '')
      if (list.some(x => x.name === name)) continue
      list.push({ name, description: skillNote(name, pick('description')), where })
    }
  }
  roster = { at: Date.now(), list }
  return list
}

// -- 시연 (가짜 장면, 토큰 0) -----------------------------------------------------
const DEMO_WORDS = new Set(['시연', '예시', 'demo'])
let demoRun = 0 // 몇 번째 시연인지: 멈추거나 다시 시작하면 앞 시연은 그 자리에서 그친다

async function runDemo($: EngineInterface, steps = STEPS, pw?: Power, label?: string) {
  const my = ++demoRun
  try {
    const t0 = await $.clock.now()
    await update($, demo, () => startDemo(t0, steps.length, pw, label))
    for (const [i, s] of steps.entries()) {
      await $.clock.sleep(s.wait)
      if (my !== demoRun) return
      const now = await $.clock.now()
      await update($, demo, d => (d?.running ? { ...s.run(d, now), step: i + 1 } : (d ?? IDLE_DEMO)))
    }
    await $.clock.sleep(HOLD)
    if (my === demoRun) await update($, demo, d => ({ ...(d ?? IDLE_DEMO), running: false }))
  } catch {
    // 시연이 멈춰도 실제 사무실은 그대로
  }
}

async function stopDemo($: EngineInterface) {
  demoRun++
  await update($, demo, d => ({ ...(d ?? IDLE_DEMO), running: false })).catch(() => undefined)
}

/** 사무실 상태 바꾸기. 실패해도 Claude 작업은 그대로 간다. */
async function change($: EngineInterface, fn: (o: Office, now: number) => Office) {
  try {
    const now = await $.clock.now()
    await update($, office, o => fn(o ?? EMPTY, now))
  } catch {
    // 기록 실패는 조용히 넘긴다
  }
}

let booted = false // 이 모듈이 올라온 뒤 시작 준비(명령 · 타이머 · 웹)를 했나. 플러그인을 다시 불러오면 처음으로 돌아간다
let ticking = false // 그리기 · 스냅샷 타이머를 걸었나 (세션 시작이 또 와도 두 번 걸지 않게)

/** 시작 준비: 명령 등록 · 그리기 타이머 · 전기세 · 이름 · 명부 · (켜 둔 프로젝트면) 웹 사무실 이어 쓰기.
 *  fresh = 세션 시작 때. 아니면 /reload-plugins 처럼 세션 시작 없이 모듈만 새로 올라온 때라 창 · 안내는 다시 안 연다.
 *  어느 쪽이든 브라우저는 안 연다 (사람이 /termimates 웹 으로 켤 때만) */
async function boot($: EngineInterface, cwd: string, fresh: boolean) {
  if (booted && !fresh) return // 세션 시작은 올 때마다 그 프로젝트 기준으로 다시 (창 · 웹), 깨우기는 한 번만
  booted = true
  try {
    // immediate: Claude 가 일하는 중에 쳐도 기다리지 않고 바로 켜고 끈다 (글을 남기지 않아 대화에 섞이지 않음)
    await $.command.register({
      name: 'termimates', description: '사무실 창 열기 / 닫기 · 「도움말」 사용법 · 「웹」 브라우저 사무실 · 「시연」 가짜 장면 (토큰 0)',
      argumentHint: '[도움말 | 웹 | 시연]', immediate: true,
    })
    if (fresh) await change($, onStart)
    await change($, o => settleIdle(o)) // 예전 규칙으로 남은 「쉬는 중」 팀원 퇴근 (/reload-plugins 뒤에도)
    await startPower($)
    void loadLocalNotes($)
    void loadNames($)
    project = cwd
    void loadRoster($).catch(() => undefined)
    if (fresh) {
      // 처음 깐 사람: 딱 한 번 저절로 열고 사용법 안내 카드를 보여 준다
      const welcomed = await $.store.get('welcomed').catch(() => true)
      if (welcomed !== true) {
        await $.store.set('welcomed', true).catch(() => undefined)
        await update($, view, x => ({ ...(x ?? ({ tab: 'office', selected: 'main' } as View)), guide: true }))
        void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
      } else if ((await $.store.get(`open:${project}`).catch(() => undefined)) === true) void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
    }
    if ((await $.store.get(`web:${project}`).catch(() => undefined)) === true) await startWeb($).catch(() => undefined)
    if (!ticking) {
      // 다시 불러오면 타이머가 멈추고 이 값도 처음으로 돌아가니, 깨울 때 새로 건다
      ticking = true
      // 움직이는 게 있으면 1초에 10번, 없으면 1초에 3번만 그린다 (걷기가 뚝뚝 끊기지 않게)
      $.clock.every(100, () => {
        void animate($)
      })
      $.clock.every(300, () => {
        void writeSnap($)
      })
      $.clock.every(2000, () => {
        void sampleFills($)
      })
    }
  } catch {
    // 패널을 못 열어도 세션은 그대로
  }
}

let rejoin = false // /resume · /clear: 같은 프로세스 · 같은 모듈에서 세션만 바뀜 (세션 시작 이벤트가 안 옴)

/** 세션 시작 없이 모듈만 새로 올라왔으면(/reload-plugins) 처음 오는 이벤트에서 한 번 이어서 준비한다. 기다리지 않음.
 *  /resume · /clear 뒤엔 모듈이 그대로라 타이머(clock.every)는 안 멈춘다 — 대신 세션 id 가 바뀌고 세션 시작이 안 오니,
 *  처음 오는 이벤트에서 새 세션 id 로 스냅샷 · 전기세 키를 옮기고 퇴근한 팀장을 다시 출근시킨다 */
function wake($: EngineInterface) {
  if (rejoin && booted) {
    rejoin = false
    void (async () => {
      await change($, onStart)
      await startPower($) // sid 를 새 세션 id 로
      lastSnap = ''
      await writeSnap($)
    })().catch(() => undefined)
    return
  }
  if (booted) return
  void $.session.cwd().then(cwd => boot($, cwd, false)).catch(() => undefined)
}

/** 애니메이션: 그림만 바꿔 칠한다 (다시 그리기 없음). 패널이 없으면 그냥 넘어간다. */
let lastBlit = 0

async function animate($: EngineInterface) {
  if (!lastWidth) return
  try {
    const d = await read($, demo)
    const o = d.running ? d.office : await read($, office)
    const pw = d.running ? d.power : await read($, power)
    const now = await $.clock.now()
    if (!isMoving(o, now) && now - lastBlit < 340) return
    lastBlit = now
    const L = sceneOf(o, lastWidth, lastRows, now, true)
    await $.ui.blit({ requestId: PANE, key: 'scene', cells: cellsOf(o, L, now, pw) })
  } catch {
    // 닫혀 있거나 크기가 바뀌는 중
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const ran = await next(e)
    await boot($, e.cwd, true)
    return ran
  })

  // /termimates 는 켜고 끄는 스위치: 보이면 닫고, 아니면 연다
  // /termimates 시연 = 가짜 장면 켜고 끄기 (Claude 를 부르지 않음)
  on('command.run', { command: 'termimates' }, async ($, e) => {
    wake($) // /reload-plugins 뒤 세션 시작 없이 올라왔으면 여기서 이어서 준비 (웹 스냅샷 · 타이머)
    const up = (await $.ui.panes()).find(p => p.id === PANE)
    // /termimates 시연 = 회원가입 장면 (다른 낱말은 무시). 시연 중에 다시 치면 멈춤
    const words = e.args.trim().toLowerCase().split(/\s+/)
    // /termimates 도움말 = 처음 쓰는 사람 안내 카드
    if (words.some(x => ['도움말', 'help', '가이드', '안내'].includes(x))) {
      await update($, view, x => ({ ...(x ?? ({ tab: 'office', selected: 'main' } as View)), tab: 'office' as const, guide: true, shelf: false }))
      if (!(up?.isPlaced && up.isShown)) await $.ui.open({ id: PANE, title: TITLE })
      return {}
    }
    // /termimates 웹 = 브라우저 사무실 켜고 끄기 (프로젝트마다 기억). 켤 때 브라우저도 연다 (세션 다시 열 때 저절로 켜질 땐 안 연다)
    if (words.includes('웹') || words.includes('web')) {
      if (webOn) {
        webOn = false
        stopServer()
        await $.store.set(`web:${project}`, false).catch(() => undefined)
        $.ui.toast('웹 사무실을 껐어요')
      } else {
        await startWeb($).catch(() => undefined)
        await $.store.set(`web:${project}`, true).catch(() => undefined)
        $.ui.toast(`웹 사무실을 브라우저로 열어요: http://127.0.0.1:${WEB_PORT}`)
        void openBrowser($).catch(() => undefined)
      }
      return {}
    }
    if (words.some(x => DEMO_WORDS.has(x))) {
      if ((await read($, demo)).running) await stopDemo($)
      else {
        if (!(up?.isPlaced && up.isShown)) await $.ui.open({ id: PANE, title: TITLE })
        void runDemo($, STEPS)
      }
      return {}
    }
    if (up?.isPlaced && up.isShown) {
      await $.ui.close({ id: PANE })
      await remember($, false)
    } else {
      await $.ui.open({ id: PANE, title: TITLE })
      await remember($, true)
    }
    return {}
  })

  on('prompt.submit', async ($, e, next) => {
    wake($)
    const ran = await next(e)
    if (!e.isMeta && (!e.command || !QUIET.has(e.command.name))) await closeJob($)
    // 사장님이 /스킬 로 직접 부르면 팀장이 책장에 다녀온다 (Claude 가 Skill 도구로 쓰면 쓴 사람이 간다: office.ts)
    const cmd = e.command?.name
    if (!e.isMeta && cmd && !QUIET.has(cmd)) {
      const known = (await $.command.list().catch(() => [])).find(c => c.name === cmd && (c.source === 'user' || c.source === 'plugin'))
      if (known) await change($, (o, now) => toShelf(o, readerOf(o, 'main', cmd, known.description), cmd, now))
    }
    if (!e.isMeta && !e.command) {
      await change($, (o, now) => ({ ...onWaitEnd(onPrompt(o, e.text, now), now), asked: isAsk(e.text) })) // 「했어?」 물음이면 답에서 놓친 일을 본다
      const t = await $.clock.now()
      jobLog = { from: t, log: [{ t, k: 'prompt', a: [clip(e.text, 60)] }] }
      await update($, replay, () => ({ from: t, log: [] })).catch(() => undefined) // 지난 보고서는 내림
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    wake($)
    const ran = await next(e)
    await change($, (o, now) => onTurnStart(o, e.agentId ?? 'main', now))
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    wake($)
    const raw = e as unknown as Record<string, unknown>
    const tool = String(e.tool)
    const target = targetOf(raw)
    const sub = typeof raw.subagent_type === 'string' ? raw.subagent_type : undefined
    const who = e.agentId ?? 'main'
    const todoRaw = who === 'main' && (tool === 'TodoWrite' || tool === 'TaskCreate') ? { todos: raw.todos, subject: raw.subject } : undefined
    await change($, (o, now) => onToolStart(who === 'main' ? onTodos(o, tool, raw) : o, who, tool, target, sub, now))
    void rec($, 'start', [who, tool, target, sub, todoRaw])
    // 질문(AskUserQuestion)은 사장님 답을 기다리는 것 → 손 들기 + 알림
    if (tool === 'AskUserQuestion') await waitFor($, who, '질문에 답해 주세요')
    const ran = await next(e)
    const failed = ran.deny === undefined && ran.isError === true
    const errText = failed ? String((ran as { text?: string }).text ?? '실패') : undefined
    await change($, (o, now) => onToolEnd(o.waiting?.who === who ? onWaitEnd(o, now) : o, who, tool, target, sub, failed, errText, now))
    // 놓친 일 서류용 할 일 흔적: 누가 적었는지 · 끝냈는지 (도구가 성공했을 때만. TaskCreate 의 id 는 결과에서)
    if ((tool === 'TodoWrite' || tool === 'TaskCreate' || tool === 'TaskUpdate') && ran.deny === undefined && !failed) {
      await change($, o => onTodoMarks(o, who, tool, raw, ran.result))
    }
    void rec($, 'end', [who, tool, target, sub, failed, errText ? clip(errText, 120) : undefined])
    return ran
  }).catch(($, e, next) => next(e))

  // 허락 창이 뜨면 사장님 호출: 손 들기 · 맨 위 알림 · 12초 넘으면 맥 알림.
  // 사람이 답하는 실제 호출만 (approver = person). 자동 모드 판정기가 정하는 건 사람을 안 부르니 1.5초 기다려 본다.
  // 허락되면 tool.run 에서 바로 내린다 (도구가 오래 돌아도 「확인 필요」 가 남지 않게).
  const asks = new Map<string, { who: string; what: string }>()
  const askText = (tool: string, input: unknown) => {
    if (tool === 'AskUserQuestion') return '질문에 답해 주세요'
    if (tool === 'ExitPlanMode') return '계획을 보고 허락해 주세요'
    const t = targetOf((input ?? {}) as Record<string, unknown>)
    return `${tool}${t ? ` · ${clip(t, 40)}` : ''} 허락해 주세요`
  }
  on('tool.check', async ($, e, next) => {
    const ran = await next(e)
    const id = e.tool_use_id
    if (ran.decision === 'ask' && id && e.approver === 'person' && !e.op && e.tool !== 'AskUserQuestion') {
      asks.set(id, { who: e.agentId ?? 'main', what: askText(e.tool, e.input) })
      void (async () => {
        await $.clock.sleep(1500)
        const a = asks.get(id)
        if (a) await waitFor($, a.who, a.what, id)
      })().catch(() => undefined)
    }
    return ran
  }).catch(($, e, next) => next(e))

  // 자동 모드 판정기가 맡음 → 사람을 안 부른다. 판정기가 못 정하면(ask) 그때 사람에게
  on('tool.judge', async ($, e, next) => {
    const a = asks.get(e.tool_use_id)
    asks.delete(e.tool_use_id)
    const ran = await next(e)
    if (a && ran.decision === 'ask') await waitFor($, a.who, a.what, e.tool_use_id).catch(() => undefined)
    return ran
  }).catch(($, e, next) => next(e))

  // 허락됨 → 바로 손 내림
  on('tool.run', async ($, e, next) => {
    const id = (e as { tool_use_id?: string }).tool_use_id
    if (id) asks.delete(id)
    const who = e.agentId ?? 'main'
    const w = (await read($, office)).waiting
    if (w && (w.id === id || w.who === who)) await change($, (o, now) => onWaitEnd(o, now))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    wake($)
    const ran = await next(e)
    if (ran.deny !== undefined || !ran.agentId) return ran
    const id = ran.agentId
    const spawn = {
      id, type: e.subagentType, name: e.name, description: e.description, background: e.background,
      teammate: e.isTeammate === true, parentAgentId: e.parentAgentId, prompt: (e.prompt ?? '').slice(0, 300),
      model: ran.model ?? e.model, // 엔진이 정한 진짜 모델 id (없으면 Agent 호출에 적힌 별명)
    }
    await change($, (o, now) => onSpawn(o, spawn, now))
    void rec($, 'spawn', [spawn])
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    wake($)
    const ran = await next(e)
    const id = e.agentId
    await count($, id, e.usage)
    await change($, (o, now) => onMissed(onComplete(id ? o : onWaitEnd(o, now), id, e.answer, e.isAborted, now), id, e.answer, e.isAborted, now))
    // 검사 직원의 글은 줄바꿈째 더 길게 적어 둔다 (다시 보기에서도 「판정: …」 줄로 통과 · 반려를 똑같이 뽑게)
    const checker = id ? (await read($, office)).workers.find(w => w.id === id)?.checker : false
    await rec($, 'done', [id, checker ? e.answer.slice(0, 1500) : clip(e.answer, 200), e.isAborted])
    if (!id) {
      // 팀장이 일을 마치면 이번 일 보고서 (직원이 있었거나 한 일이 몇 개 이상일 때)
      try {
        const { from, log } = jobLog
        if (from && (log.some(x => x.k === 'spawn') || log.length >= 4)) {
          const o = await read($, office)
          const now = await $.clock.now()
          const report = reportOf(o, from, now, await read($, power))
          await update($, replay, () => ({ from, log: [...log], report }))
        }
      } catch {
        // 보고서는 못 만들어도 그대로
      }
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('skill.prompt', async ($, e, next) => {
    const ran = await next(e)
    await change($, (o, now) => {
      const u = o.skillUses[e.skill] ?? { count: 0, last: 0 }
      return { ...o, skillUses: { ...o.skillUses, [e.skill]: { count: u.count + 1, last: now } } }
    })
    return ran
  }).catch(($, e, next) => next(e))

  // 팀장 피로도: 엔진이 차례마다 잰 대화량
  on('session.measure', async ($, e, next) => {
    const ran = await next(e)
    const tokens = e.context.tokens
    if (tokens) await changePower($, p => ({ ...p, lead: { tokens, window: e.context.window } }))
    return ran
  }).catch(($, e, next) => next(e))

  // 대화 정리(compact) = 커피 마시며 서류 정리 → 피로 회복
  on('session.compact', async ($, e, next) => {
    const mine = !e.agentId && e.trigger !== 'precompute'
    if (mine) {
      await change($, (o, now) => ({
        ...o, lead: log(set(o.lead, 'think', '커피 마시며 서류 정리하는 중 (대화 정리)', now), now, '대화 정리 시작'),
      }))
    }
    const ran = await next(e)
    if (mine) {
      const skipped = 'skip' in ran && ran.skip !== undefined
      await change($, (o, now) => ({
        ...o,
        lead: log(set(o.lead, e.trigger === 'manual' ? 'idle' : 'think',
          skipped ? '정리 못 하고 하던 일로' : e.trigger === 'manual' ? '정리 끝, 피로가 풀렸어요' : '정리 끝, 하던 일로 돌아가는 중', now),
        now, skipped ? '대화 정리 안 됨' : '대화 정리 끝 — 피로 회복'),
      }))
      if (!skipped) {
        // 엔진이 알려 준 정리 뒤 대화량이 있으면 그걸로, 없으면 다시 재 본다
        const after = 'tokensAfter' in ran ? ran.tokensAfter : undefined
        const fill = await leadFill($)
        await changePower($, p => ({
          ...p, lead: after ? { tokens: after, window: fill?.window ?? p.lead?.window ?? 200000 } : fill,
        }))
      }
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    // /resume · /clear: 프로세스는 다른 세션 id 로 이어 간다 (세션 시작 없음) → 다음 이벤트에서 wake 가 이어 준비
    if (e.reason === 'resume' || e.reason === 'clear') rejoin = true
    await closeJob($).catch(() => undefined)
    await change($, (o, now) => ({
      ...o,
      lead: log(set(o.lead, 'off', '퇴근', now), now, '퇴근'),
      workers: o.workers.map(w => (w.ended === undefined ? { ...set(w, 'unfinished', '끝내지 못하고 퇴근', now), ended: now } : w)),
    }))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    wake($)
    const dm = await read($, demo)
    const live = !dm.running // 시연 중이면 가짜 장면을 그린다 (실제 기록은 뒤에서 그대로 쌓임)
    const o = live ? await read($, office) : dm.office
    const v = await read($, view)
    const now = await $.clock.now()
    const width = Math.max(CW, e.props.bodyColumns)
    lastWidth = width
    const pick = (key: string) => () => update($, view, x => ({ ...(x ?? v), selected: key, shelf: false, report: false, guide: false, tired: false }))
    const toggleShelf = () => update($, view, x => ({ ...(x ?? v), shelf: !(x ?? v).shelf }))
    const items = v.tab === 'library' || v.shelf ? await shelfItems($, o) : []
    // 책장 목록: 내 스킬(내가 만든 것) → 플러그인 스킬(플러그인별로 묶어 접어 둠). 줄마다 이름 + 한 줄 설명
    const shelfList = (all: boolean) => {
      const mine = items.filter(i => i.source === 'user')
      const plug = items.filter(i => i.source !== 'user')
      const groups = [...new Set(plug.map(i => i.plugin))].map(g => [g, plug.filter(i => i.plugin === g)] as [string, ShelfItem[]])
      const more = all || v.shelfMore
      const row = (i: ShelfItem, k: string) => (
        <Box key={k + i.name} flexDirection="column">
          <Box>
            <Text bold color="suggestion">{'▌' + i.name}</Text>
            {i.count ? <Text color="warning">{` ★ 이번 세션 ${i.count}번`}</Text> : null}
            <Text>  </Text>
            <Button key={'use-' + i.name} plain onPress={() => fillPrompt($, `/${i.name} `)}><Text dimColor underline>쓰기 ▸</Text></Button>
          </Box>
          <Text dimColor>{'  ' + i.note}</Text>
        </Box>
      )
      return (
        <Box key="shelf-list" flexDirection="column" borderStyle="round" paddingX={1}>
          <Text bold>📚 책장<Text dimColor>{all ? '  「쓰기」 를 누르면 입력창에 /스킬 이 들어가요 (Enter 는 직접)' : '  (책장을 다시 누르면 접혀요 · 「쓰기」 = 입력창에 넣기)'}</Text></Text>
          <Text key="h-mine" bold color="warning">{`내 스킬 ${mine.length}개`}<Text dimColor> — 내가 만들어 둔 것 (~/.claude/skills · commands, 이 프로젝트 .claude)</Text></Text>
          {mine.length ? mine.map(i => row(i, 'm-')) : <Text dimColor>  아직 없어요</Text>}
          <Text key="h-plug" bold>{`플러그인 스킬 ${plug.length}개`}<Text dimColor> — 설치한 플러그인에 딸려 온 것</Text></Text>
          {more ? groups.flatMap(([g, list]) => [
            <Text key={'g-' + g} bold dimColor>{`  ${g} 플러그인 · ${list.length}개`}</Text>,
            ...list.map(i => row(i, 'p-')),
          ]) : groups.length ? (
            <Button key="shelf-more" plain onPress={() => update($, view, x => ({ ...(x ?? v), shelfMore: true }))}>
              <Text color="suggestion">{'  ' + groups.map(([g, list]) => `${g} ${list.length}`).join(' · ') + '  ▾ 펼치기'}</Text>
            </Button>
          ) : null}
        </Box>
      )
    }
    const tab = (t: View['tab']) => () => update($, view, x => ({ ...(x ?? v), tab: t }))

    const T = $.ui.resolve(e)
    const { Box, Text, Button } = T

    const r = running(o)
    const done = o.workers.filter(w => w.status === 'done')
    const situation = [
      `팀장: ${o.lead.action}`,
      r.length ? `일하는 자리 ${[...new Set(r.map(unitOf))].join(', ')}` : '',
      done.length ? `보고 완료 ${done.length}건` : '',
      // 오래 같은 일에 머무는 직원 (5분 넘게)
      ...r.filter(w => (w.status === 'work' || w.status === 'think') && now - w.since > 5 * 60000)
        .map(w => `⏳ ${unitOf(w)} ${Math.floor((now - w.since) / 60000)}분째 같은 일`),
    ].filter(Boolean).join(' · ')

    const tabs = (
      <Box key="tabs">
        <Button key="tab-office" plain onPress={tab('office')}>
          <Text bold={v.tab === 'office'} dimColor={v.tab !== 'office'}>{v.tab === 'office' ? '▣' : '□'} 사무실</Text>
        </Button>
        <Text>  </Text>
        <Button key="tab-library" plain onPress={tab('library')}>
          <Text bold={v.tab === 'library'} dimColor={v.tab !== 'library'}>{v.tab === 'library' ? '▣' : '□'} 도서관</Text>
        </Button>
        <Text>  </Text>
        <Button key="tab-roster" plain onPress={tab('roster')}>
          <Text bold={v.tab === 'roster'} dimColor={v.tab !== 'roster'}>{v.tab === 'roster' ? '▣' : '□'} 명부</Text>
        </Button>
        <Text>  </Text>
        <Button key="tab-help" plain onPress={() => update($, view, x => ({ ...(x ?? v), tab: 'office' as const, guide: !(x ?? v).guide, shelf: false }))}>
          <Text bold={!!v.guide} dimColor={!v.guide} color={v.guide ? 'suggestion' : undefined}>? 도움말</Text>
        </Button>
      </Box>
    )

    if (v.tab === 'library') {
      return (
        <Box flexDirection="column">
          {tabs}
          {shelfList(true)}
        </Box>
      )
    }
    if (v.tab === 'roster') {
      // 명부: 내가 만든 에이전트. 「맡기기」 = 입력창에 부탁 문장 (Enter 는 직접 → 그 전엔 토큰 0)
      const list = await loadRoster($)
      return (
        <Box flexDirection="column">
          {tabs}
          <Box key="roster" flexDirection="column" borderStyle="round" paddingX={1}>
            <Text bold>👥 명부<Text dimColor>{`  내가 만든 에이전트 ${list.length}명 (.claude/agents) · 「맡기기」 를 누르면 입력창에 부탁 문장이 들어가요`}</Text></Text>
            {list.length ? list.map(a => (
              <Box key={'r-' + a.name} flexDirection="column">
                <Box>
                  <Text bold color="suggestion">{'▌' + (namesNow()[a.name] ?? a.name)}</Text>
                  <Text dimColor>{`  ${a.where}${namesNow()[a.name] ? ` · ${a.name}` : ''}`}</Text>
                  <Text>  </Text>
                  <Button key={'hire-' + a.name} plain onPress={() => fillPrompt($, `${a.name} 에이전트에게 맡겨 줘: `)}>
                    <Text dimColor underline>맡기기 ▸</Text>
                  </Button>
                </Box>
                <Text dimColor>{'  ' + a.description}</Text>
              </Box>
            )) : <Text dimColor>아직 없어요. 프로젝트의 .claude/agents 나 ~/.claude/agents 에 에이전트를 만들면 여기 보여요.</Text>}
            <Text dimColor>이름은 사무실에서 그 직원을 눌러 바꿀 수 있어요 (또는 ~/.termimates/roles.json).</Text>
          </Box>
        </Box>
      )
    }

    // 맨 위 계기판: 팀장 피로도 · 전기세 (따뜻한 캡슐 = 사람, 시안 LED = 전기)
    const pw = live ? await read($, power) : dm.power
    const cells = width >= 56 ? 10 : width >= 40 ? 6 : 4
    const leadPct = percentOf(pw.lead)
    const st = leadPct !== undefined ? stageOf(leadPct) : undefined
    const [fOn, fOff] = bar((leadPct ?? 0) / 100, cells)
    const fatigueRow = rowOf(T, 'fatigue-rest', width - 9, [
      ['(' + '█'.repeat(fOn), { color: st?.color }],
      ['░'.repeat(fOff) + ')', { dimColor: true }],
      [leadPct !== undefined ? ` ${leadPct}% ${st!.name}` : ' 아직 안 잼', { bold: true, color: st?.color }],
      [pw.lead ? ` · 팀장 대화 ${man(pw.lead.tokens)}/${man(pw.lead.window)}` : ' · 다음 대답 때 재요', { dimColor: true }],
      ...(() => {
        // 직원 중 가장 피곤한 사람 (직원마다 따로 잼)
        const f = fillsOf(o, pw)
        const top = Object.entries(f).filter(([k]) => k !== 'main').sort((a, b) => b[1] - a[1])[0]
        return top ? [[` · 직원 최고 ${top[1]}% ${top[0]}`, { color: stageOf(top[1]).color }] as Piece] : []
      })(),
    ])
    const usualFrac = pw.usual ? pw.today / pw.usual : undefined
    const over = usualFrac !== undefined && usualFrac > 1
    const [eOn, eOff] = bar(usualFrac ?? 0, cells)
    const powerRow = rowOf(T, 'power', width, [
      ['전기세 ', { bold: true, color: LED.num }],
      usualFrac !== undefined ? ['[' + '▮'.repeat(eOn), { color: over ? LED.warn : LED.on }] : [''],
      usualFrac !== undefined ? ['▯'.repeat(eOff) + '] ', { color: LED.off }] : [''],
      [`오늘 ${man(pw.today)}`, { bold: true, color: LED.num }],
      usualFrac !== undefined
        ? [` · 평소의 ${Math.round(usualFrac * 100)}%${over ? ' (많이 쓰는 중)' : ''}`, over ? { color: LED.warn } : { dimColor: true }]
        : [' · 평소 기록 쌓는 중', { dimColor: true }],
      [' · 사무실 표시 0', { dimColor: true }],
    ])
    const jobN = sum(pw.job)
    const jobRow = rowOf(T, 'job', width, [
      ['  이번 일 ', { dimColor: true }],
      [man(jobN), { bold: true, color: LED.num }],
      [pw.jobUsual && jobN ? ` (평소 일의 ${Math.round((jobN / pw.jobUsual) * 100)}%)` : '', { dimColor: true }],
      [jobN ? ` · ${parts(pw.job)}` : '', { dimColor: true }],
    ])
    const tired = leadPct !== undefined && leadPct >= 70
      ? <Text key="tired" color={st?.color}>팀장이 많이 피곤해요. 피로도를 누르면 정리하는 법이 나와요.</Text>
      : null
    const toggleTired = () => update($, view, x => ({ ...(x ?? v), tired: !(x ?? v).tired, guide: false, shelf: false, report: false }))

    // 🔔 사장님 확인 기다림 (허락 · 질문)
    const waitRow = o.waiting ? (
      <Text key="wait" bold inverse color="warning">{` 🔔 사장님 확인 필요 — ${o.waiting.what} · ${ago(now - o.waiting.at)}째 `}</Text>
    ) : null
    // 🎬 이번 일 보고서 + 다시 보기
    const rp = live ? await read($, replay) : undefined
    const rep = rp?.report
    const toggleReport = () => update($, view, x => ({ ...(x ?? v), report: !(x ?? v).report, guide: false, shelf: false, tired: false }))
    const reportLine = rep && !v.report && o.lead.status !== 'think' && o.lead.status !== 'work' ? (
      <Box key="report-line">
        <Text color="success">✅ 이번 일 끝 · </Text>
        <Button key="report" plain onPress={toggleReport}><Text bold underline color="success">📋 보고서 · ▶ 다시 보기</Text></Button>
      </Box>
    ) : null
    const replayNow = async () => {
      const log = (await read($, replay)).log
      await update($, view, x => ({ ...(x ?? v), report: false }))
      if (!log.length) return $.ui.toast('다시 볼 기록이 없어요')
      void runDemo($, stepsFromLog(log), await read($, power), '다시 보기')
    }
    const reportCard = v.report && rep ? (
      <Box key="report-card" flexDirection="column" borderStyle="round" borderColor="success" paddingX={1}>
        <Text bold color="success">{`📋 이번 일 보고서 — 「${clip(rep.prompt, 40)}」`}</Text>
        <Text>{`걸린 시간 ${rep.mins}분 · 자리 ${rep.units.length}개 (직원 ${rep.units.reduce((n, u) => n + u.people, 0)}명) · 서류 ${rep.papers}장 · 실패 ${rep.fails}번`}</Text>
        <Text color={LED.num}>{`전기세 ${man(rep.tokens)}${rep.top ? ` · 제일 많이 쓴 자리: ${rep.top}` : ''}`}</Text>
        {rep.units.map(u => (
          <Text key={'ru-' + u.key} dimColor>{`  · ${u.key}${u.people > 1 ? ` (${u.people}명)` : ''} — ${u.mins}분 · 서류 ${u.papers}장${u.fails ? ` · 실패 ${u.fails}번` : ''}${u.tokens ? ` · ${man(u.tokens)}` : ''}`}</Text>
        ))}
        {(rep.reviews ?? []).slice(-6).map((r, i) => (
          <Text key={'rv-' + i} color={r.verdict === 'reject' ? 'error' : r.verdict === 'pass' ? 'success' : undefined}>{`  🔍 ${r.by} ${reviewLine(r)}`}</Text>
        ))}
        <Box key="report-actions" columnGap={2} marginTop={1}>
          <Button key="replay" onPress={replayNow}>▶ 다시 보기 (4배 빠르게)</Button>
          <Button key="report-close" onPress={toggleReport}>닫기</Button>
        </Box>
      </Box>
    ) : null
    // 피로도 안내 카드: 단계별 할 일 + 입력창에 글만 넣어 주는 단추 (Enter 는 사람이 누름 → 누르기 전엔 토큰 0)
    const advice = adviceOf(leadPct)
    const fill = (text: string) => async () => {
      try {
        const r = await $.prompt.fill({ text })
        $.ui.toast(r.isFilled ? '입력창에 넣었어요. 확인하고 Enter 를 누르세요' : '입력창에 못 넣었어요')
      } catch {
        $.ui.toast('입력창에 못 넣었어요')
      }
    }
    const tiredCard = v.tired ? (
      <Box key="tired-card" flexDirection="column" borderStyle="round" borderColor={st?.color} paddingX={1}>
        <Text bold color={st?.color}>{`팀장 피로도 ${advice.title}`}</Text>
        {advice.lines.map((l, i) => <Text key={'adv' + i}>{l}</Text>)}
        <Text dimColor>피로도 = 팀장이 지금 들고 있는 대화량 ÷ 최대치. 직원은 각자 따로 (일이 끝나면 다음 직원은 0% 부터).</Text>
        {advice.act ? (
          <Box key="tired-actions" columnGap={2} marginTop={1} flexWrap="wrap">
            <Button key="fill-note" onPress={fill('지금까지 한 일 · 정한 것 · 남은 일을 HANDOFF.md 에 정리해 줘. 다음 대화에서 이 파일부터 읽고 이어 갈 거야.')}>📝 정리 부탁 문장 넣기</Button>
            <Button key="fill-compact" onPress={fill('/compact')}>/compact 넣기</Button>
            <Button key="fill-clear" onPress={fill('/clear')}>/clear 넣기 (정리 먼저!)</Button>
          </Box>
        ) : null}
        <Button key="tired-close" plain onPress={toggleTired}><Text dimColor>닫기</Text></Button>
      </Box>
    ) : null

    // 그림 몫 = 패널 줄 수 - 위 글줄 - 아래 카드 몫. 위 글줄은 지금 보이는 줄을 세고, 카드는 지난번 높이로
    // 📄 놓친 일 서류: 숫자 키(창을 고른 뒤) · Tab · 눌러서 고르면 팀장이 주워 와 입력창에 「놓친 일 다시 확인: …」
    const lost = live ? (o.papers ?? []).filter(p => p.picked === undefined) : []
    const paperRow = lost.length ? (() => {
      const out: JSX.Element[] = [<Text key="ph" bold color="warning">{`📄 놓친 일 ${lost.length}장 `}</Text>]
      let used = dw(`📄 놓친 일 ${lost.length}장 `)
      for (const [i, p] of lost.slice(0, 9).entries()) {
        const label = `[${i + 1}] ${clip(p.text, 16)}`
        if (used + dw(label) + 1 > width) break
        used += dw(label) + 1
        out.push(<Button key={'paper-' + p.id} plain hotkey={String(i + 1)} onPress={() => void pickUp($, p.id)}><Text color="warning" underline>{label}</Text></Button>, <Text key={'pg' + i}> </Text>)
      }
      return <Box key="papers">{out}</Box>
    })() : null
    const headRows = 1 + (live ? 0 : 1) + 3 + (tired ? 1 : 0) + (waitRow ? 1 : 0) + (reportLine ? 1 : 0) + (paperRow ? 1 : 0) +
      wrapped(o.prompt ? `사장님 지시 「${o.prompt}」` : '아직 사장님 지시 없음', width) + wrapped(situation, width)
    const bodyRows = e.props.scroll?.bodyRows ?? 40
    const units = unitsOf(o, now)
    // 붐빔 · 펼쳐 둠 (아래 「붐빌 때 카드 접기」). 사장님이 펼쳐 둔 것(cardOpen)은 붐비는 동안 그대로, 한 번이라도 안 붐비면 무효
    const crowdedNow = e.surface === 'terminal' && isCrowded(units)
    if (e.surface === 'terminal' && !crowdedNow) calms++ // 다른 화면(웹 등)에서 그린 건 안 센다
    const epoch = calms + 1
    const open = crowdedNow && v.cardOpen === epoch
    // 그림 몫을 다시 정하는 때: 폭 · 높이 · 직원 수 · 자리 수 · 붐빔 · 펼침이 바뀔 때만 (그 밖엔 지난번 몫 그대로)
    const stickKey = [width, bodyRows, units.length, (foldSteps(units.filter(u => !u.boss))[0] ?? []).length, crowdedNow, open, live].join('|')
    const stuck = e.surface === 'terminal' && stick?.key === stickKey ? stick : undefined
    lastRows = stuck ? stuck.rows : Math.max(1, bodyRows - headRows - cardRows)
    let L = sceneOf(o, width, lastRows, now)
    // 고를 수 있는 것: 팀장 · 자리 · 접은 자리(fold:…) · +n · 그림에 없어도 있는 자리(파트장 아래 직원)
    const sel = v.selected === 'main' || units.some(u => u.key === v.selected) || L.seats.some(s => s.pick === v.selected) ? v.selected : 'main'
    const selSeat = L.seats.find(s => s.pick === sel && (s.kind === 'fold' || s.kind === 'more'))

    // 고른 직원의 이야기
    let detail: JSX.Element[] = []
    let detailRows = 0 // 카드 높이 (그림 몫 계산용)
    const line = (key: string, text: string, props: Record<string, unknown> = {}) => {
      detailRows += wrapped(text, width - 4) // 테두리 2 + 안쪽 여백 2
      detail.push(<Text key={key} {...props}>{text}</Text>)
    }
    // 피로도 + 전기세 몫 한 줄. 좁으면 덜 중요한 것부터 줄인다: 대화량 짧게 → 「(이번 세션)」 빼기 → 대화량 빼기 → 나눔(일반 · 할인 …) 빼기 → 단계 이름 빼기
    // fat: [긴, 짧은] 피로도 · talkTok: [긴, 짧은] 대화량 (없으면 빈 배열)
    const fuelLine = (fat: [string, string], talkTok: [string, string] | [], color: string | undefined, share: Tok | undefined, note = '') => {
      const tok = sum(share)
      const conv = [...talkTok, '']
      const power = tok ? [` · 전기세 몫${note}: ${man(tok)} · ${parts(share!)}`, ` · 전기세 몫: ${man(tok)} · ${parts(share!)}`, ` · 전기세 ${man(tok)}`] : ['', '', '']
      const steps: [number, number, number][] = [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 2, 1], [0, 2, 2], [1, 2, 2]]
      const room = width - 4
      const at = (f: number, c: number, p: number) => [fat[f], conv[Math.min(c, conv.length - 1)]!, power[p]!] as const
      const [f, c, p0] = steps.map(([a, b, d]) => at(a, b, d)).find(x => dw(x.join('')) <= room) ?? at(1, 2, 2)
      const p = f + c ? p0 : p0.replace(/^ · /, '') // 피로도를 못 쟀으면 전기세부터
      detailRows += wrapped(f + c + p, room)
      detail.push(<Text key="d-f"><Text color={color}>{f + c}</Text>{p ? <Text color={LED.num}>{p}</Text> : null}</Text>)
    }
    // crowded = 붐빌 때 짧은 카드 (맡긴 일 3줄 + 「외 n건」 · 한 일 2줄 · 설명 줄 빼기)
    // mark = 접을 수 있을 때 머리줄 앞 「▾ 」 (머리줄을 누르면 접힘)
    const buildCard = async (crowded: boolean, mark = '') => {
      detail = []
      detailRows = 0
      const doneN = crowded ? 2 : undefined
      if (sel === 'main') {
        // 지금 하는 일 · 사장님 지시는 위 글줄에 이미 있어서 카드엔 안 쓴다 (몇 초째만 머리줄에)
        line('d-h', `${mark}팀장 · 메인 Claude · 지금 일 ${ago(now - o.lead.since)}째`, { bold: true })
        if (leadPct !== undefined) fuelLine([`피로도: ${leadPct}% ${st!.name}`, `피로도 ${leadPct}%`],
          [` · 대화 ${man(pw.lead!.tokens)} / ${man(pw.lead!.window)} 토큰`, ` · 대화 ${man(pw.lead!.tokens)}`], st?.color, pw.byWorker.main, ' (이번 세션)')
        else fuelLine(['피로도: 아직 안 잼 (다음 대답 때 재요)', '피로도: 아직 안 잼'], [], undefined, pw.byWorker.main, ' (이번 세션)')
        if (o.said && (o.lead.status === 'idle' || o.lead.status === 'wait_report')) line('d-s', `마지막으로 한 말: ${o.said}`, { dimColor: true })
        if (o.workers.length) {
          // 붐비면 일하는 중인 것부터 3줄 + 「외 n건」, 아니면 최근 6건
          const recent = [...o.workers].reverse()
          const shown = crowded ? [...recent.filter(w => w.ended === undefined), ...recent.filter(w => w.ended !== undefined)].slice(0, 3) : recent.slice(0, 6)
          const rest = crowded ? o.workers.length - shown.length : 0
          line('d-ah', `맡긴 일${crowded ? ` ${o.workers.length}건` : ''}:`, { bold: true })
          shown.forEach((w, i) =>
            line('d-a' + i, `  ${unitOf(w)}${w.member ? ` ${w.member}` : ''} — ${w.task || '(설명 없음)'} · ${w.status === 'done' ? '보고 완료' : w.action}`))
          if (rest > 0) line('d-amore', `  외 ${rest}건 (직원을 누르면 보여요)`, { dimColor: true })
        }
        const rvs = (o.reviews ?? []).filter(r => r.at >= (o.promptAt ?? 0)).slice(-3)
        if (rvs.length) {
          line('d-rvh', '검사 결과:', { bold: true })
          rvs.forEach((r, i) => line('d-rv' + i, `  ${reviewLine(r)}`, { color: r.verdict === 'reject' ? 'error' : r.verdict === 'pass' ? 'success' : undefined }))
        }
        if (o.lead.recent.length) {
          // 4줄만 (나머지는 사무실 소식에) — 카드가 짧아야 그림이 커진다
          line('d-rh', '한 일:', { bold: true })
          o.lead.recent.slice(0, doneN ?? 4).forEach(([t, text], i) => line('d-r' + i, `  ${hhmm(t)}  ${text}`, { dimColor: true }))
        }
      } else if (selSeat) {
        // 접은 자리 · +n: 그 안의 자리마다 사람과 각자 상태
        const inside = units.filter(u => selSeat.ids?.some(id => u.list.some(w => w.id === id)))
        line('d-h', mark + (selSeat.kind === 'more' ? `자리가 모자라 접은 ${selSeat.name.slice(1)}` : `${selSeat.name} (같은 직군 접음)`), { bold: true })
        line('d-fn', '자리가 모자라 한 자리로 접었어요. 패널을 넓히거나 키우면 펼쳐져요.', { dimColor: true })
        inside.forEach((u, i) => {
          line('d-u' + i, `${u.key} · ${u.active.length ? `일하는 중 ${u.active.length}명` : '다 끝남'}${u.loop ? ` · ⟳${u.loop}` : ''}`, { bold: true })
          ;[...u.list].reverse().slice(0, 4).forEach((x, j) => line(`d-u${i}-${j}`,
            `  ${x.member ?? ''}${x.member ? ' ' : ''}${x.status === 'done' ? '보고 완료 ✓' : x.ended !== undefined ? '퇴근' : x.action} — ${x.task || '(설명 없음)'}`,
            { dimColor: x.ended !== undefined }))
        })
      } else {
        const list = o.workers.filter(w => unitOf(w) === sel).reverse()
        const w = list.find(x => x.ended === undefined) ?? list[0]
        line('d-h', `${mark}${sel}${list.length > 1 ? ` · 이번 세션 ${list.length}번 출근` : ''}`, { bold: true })
        // 청록 깔개(나란히 자리)로 앉은 자리면 맨 위에 그 뜻을 쉬운 말로 (그림엔 글자 없이 깔개만)
        const twinsHere = L.seats.filter(x => x.kind === 'twin' && x.pick === sel).length
        if (twinsHere) line('d-twin', `같은 일을 나눠서 동시에 하는 직원들이에요 (${twinsHere}명)`, { color: 'suggestion' }) // 그림의 청록 깔개 · 「같은 일 ×n」
        if (w) {
          const kinds = [...new Set(list.map(x => x.role))].join(', ')
          if (kinds !== sel) line('d-k', `에이전트 종류: ${kinds}`, { dimColor: true })
          if (w.tier) line('d-tier', `모델 직급: ${tierText(w.tier)}${w.model ? ` · ${w.model}` : ''}`)
          if (w.persona) line('d-persona', `페르소나: 「${w.persona}」`, { color: 'error' })
          if (w.checker) {
            // 검사 직원: 무엇을 보는지 · 결과 (반려 이유는 마지막 글에서 뽑을 수 있을 때만)
            const of = w.reviewOf ? o.workers.find(x => x.id === w.reviewOf) : undefined
            const last = [...(o.reviews ?? [])].reverse().find(r => r.by === w.id)
            line('d-rv', last ? `🔍 ${reviewLine(last)}` : `🔍 검사 직원 · ${of ? `${unitOf(of)} 서류 검토 중` : '검토 중'}`,
              { color: last?.verdict === 'reject' ? 'error' : last?.verdict === 'pass' ? 'success' : undefined })
          }
          const unit = units.find(u => u.key === sel)
          if (unit?.boss) line('d-boss', `${unit.boss} 파트장이 맡긴 일 (사무실엔 파트장 자리에 「+n」 으로만 보여요)`, { dimColor: true })
          if (unit?.loop) line('d-loop', `⟳ ${unit.loop}번째 다시 하는 중 (반려 · 같은 일 다시 맡김)`, { color: 'warning' })
          if (unit?.kids) {
            // 파트장: 이 직원이 부른 직원들 (터미널엔 층을 안 그리고 여기서만)
            const ids = new Set(unit.list.map(x => x.id))
            const kids = o.workers.filter(x => x.parent && !ids.has(x.id) && units.some(u => u.boss === sel && u.list.includes(x)))
            line('d-kh', `파트원 ${unit.kids}명 · 일하는 중 ${kids.filter(x => x.ended === undefined).length}명`, { bold: true })
            ;[...kids].reverse().slice(0, 6).forEach((x, i) => line('d-k' + i,
              `  ${unitOf(x)} — ${x.task || '(설명 없음)'} · ${x.status === 'done' ? '보고 완료 ✓' : x.ended !== undefined ? '퇴근' : x.action}`,
              { dimColor: x.ended !== undefined }))
          }
          if (list.some(x => x.team) || (unit && unit.active.length >= 2)) {
            // 팀 자리: 팀원마다 한 줄 (출근 순). 사무실엔 팀 하나 = 한 자리만 그린다
            const state = (x: typeof w) =>
              x.status === 'done' ? '보고 완료 ✓' : x.status === 'unfinished' ? '못 끝냄' : x.ended !== undefined ? '퇴근' : x.action
            line('d-mh', `${list.some(x => x.team) ? '팀원' : '같은 일 직원'} ${list.length}명 · 일하는 중 ${list.filter(x => x.ended === undefined).length}명`, { bold: true })
            const ms = [...list].reverse()
            const shown = crowded ? [...ms.filter(x => x.ended === undefined), ...ms.filter(x => x.ended !== undefined)].slice(0, 3) : ms
            shown.forEach((x, i) => line('d-m' + i,
              `  ${x.member ?? ms.indexOf(x) + 1}  ${state(x)} — ${x.task || '(설명 없음)'}${x.handback ? ` · 서류 「${clip(x.handback, 40)}」` : ''}`,
              { dimColor: x.ended !== undefined }))
            if (ms.length > shown.length) line('d-mmore', `  외 ${ms.length - shown.length}명`, { dimColor: true })
          }
          line('d-now', w.status === 'done' ? `상태: 보고 완료 · ${ago(now - (w.ended ?? now))} 전` : `지금: ${w.action} · ${ago(now - w.since)}째`)
          if (w.task) line('d-t', `맡은 일: ${w.task} (팀장이 맡김)`)
          const fill = (live && w.ended === undefined ? await workerFill($, w.id) : undefined) ?? pw.workers[w.id]
          const wp = percentOf(fill)
          const share = list.reduce((acc, x) => (pw.byWorker[x.id] ? plus(acc, pw.byWorker[x.id]!) : acc), ZERO)
          // 피로도 + 전기세 몫 한 줄 (재 본 게 없으면 전기세만)
          const ws = wp !== undefined ? stageOf(wp) : undefined
          if (ws || sum(share)) {
            const note = list.length > 1 ? ` (${list.length}번 출근 합계)` : ''
            if (ws) fuelLine([`피로도: ${wp}% ${ws.name}`, `피로도 ${wp}%`], [` · 대화 ${man(fill!.tokens)} / ${man(fill!.window)} 토큰`, ` · 대화 ${man(fill!.tokens)}`], ws.color, share, note)
            else fuelLine(['', ''], [], undefined, share, note)
          }
          if (wp !== undefined && wp >= 70) line('d-fn', '대화가 많이 찼어요. 남은 일은 새 직원에게 나눠 맡기면 덜 피곤해요 (일이 끝나면 이 대화는 버려지고 다음 직원은 0% 부터).', { dimColor: true })
          if (sum(share) && !crowded) line('d-pn', '실제 AI 직원이라 팀장과 따로 대화를 들고 일해요. 직원이 많을수록 전기세가 더 나와요.', { dimColor: true })
          if (w.handback) line('d-hb', `넘긴 서류: 「${w.handback}」`, { color: 'suggestion' })
          if (w.error) line('d-e', `⚠ 실패: ${w.error}`, { color: 'error' })
          if (w.recent.length) {
            line('d-rh', '한 일:', { bold: true })
            w.recent.slice(0, doneN ?? 6).forEach(([t, text], i) => line('d-r' + i, `  ${hhmm(t)}  ${text}`, { dimColor: true }))
          }
        }
      }
    }
    const mine = o.workers.filter(w => unitOf(w) === sel).reverse()
    const agentId = !live || sel === 'main' ? undefined : (mine.find(w => w.ended === undefined) ?? mine[0])?.id
    const selW = mine.find(w => w.ended === undefined) ?? mine[0]
    const hasRename = live && !!selW && !isGeneric(selW.role)

    // 붐비는가: 섬 후보이거나, 보통 카드를 놓으면 그림 몫이 모자라 자리가 접힐 때 (보통 카드 높이로만 정해서 그리기마다 오락가락하지 않게)
    const extra = 2 + (!live || sel === 'main' || agentId ? 1 : 0) + (hasRename ? 1 : 0) + (agentId ? 1 : 0) // 테두리 2 · 말 걸기 · 이름 바꾸기 · 대화 보기 단추
    await buildCard(false)
    const folds = plan(units, width, Math.max(1, bodyRows - headRows - detailRows - extra)).spots.some(x => x.kind === 'fold' || x.kind === 'more')
    if (e.surface === 'terminal' && (isCrowded(units) || folds)) await buildCard(true)
    // 붐빌 때 카드 접기: 섬 후보이고, 카드를 「요약 한 줄 + 말 걸기 칸」 으로 접으면 그림 배율이 커질 때만.
    // 직원 · 자리를 눌러도 펼치지 않고 접힌 한 줄이 그 직원 요약으로 바뀐다 (그림 크기 그대로). 그 줄을 누르면 펼침, 머리줄 「▾」 를 누르면 다시 접힘.
    // 「접으면 커지나」 는 그림 몫을 정할 때만 잰다 (고른 카드 길이로 그리기마다 오락가락하지 않게)
    const FOLD_ROWS = 2 // 요약 한 줄 + 말 걸기 칸 (테두리 없이)
    const foldGain = stuck ? stuck.gain : crowdedNow &&
      plan(units, width, Math.max(1, bodyRows - headRows - FOLD_ROWS)).k > plan(units, width, Math.max(1, bodyRows - headRows - detailRows - extra)).k
    const folded = foldGain && !open
    const foldCard = () => update($, view, x => ({ ...(x ?? v), cardOpen: undefined }))
    const openCard = () => update($, view, x => ({ ...(x ?? v), cardOpen: epoch }))
    let summary = ''
    if (folded && sel !== 'main') {
      // 「▸ QA 1팀 · 일하는 중 · 서류 2장 · 누르면 펼침」 (접은 자리 · +n 은 그 안 사람 수) — 좁으면 뒤에서부터 줄인다
      const ws = selSeat ? units.filter(u => selSeat.ids?.some(id => u.list.some(w => w.id === id))).flatMap(u => u.list)
        : o.workers.filter(w => unitOf(w) === sel)
      const busy = ws.filter(w => w.ended === undefined).length
      const last = [...ws].reverse()[0]
      const state = busy ? `일하는 중${busy > 1 ? ` ${busy}명` : ''}` : last?.status === 'done' ? '보고 완료' : '퇴근'
      const papers = o.handoffs.filter(h => h.at >= (o.promptAt ?? 0) && ws.some(w => w.id === h.from)).length
      const name = selSeat ? (selSeat.kind === 'more' ? `접은 ${selSeat.name.slice(1)}` : selSeat.name) : sel
      const tries = [`▸ ${name} · ${state}${papers ? ` · 서류 ${papers}장` : ''}`, `▸ ${name} · ${state}`, `▸ ${name}`]
      summary = [tries[0]! + ' · 누르면 펼침', ...tries].find(x => dw(x) <= width) ?? fit(tries[tries.length - 1]!, width)
      detail = []
      detailRows = 1
    } else if (folded) {
      // 「▸ 팀장 · 13% 쌩쌩 · 전기세 2.1억 · 맡긴 일 10건 (일하는 중 3)」 — 좁으면 뒤에서부터 줄인다
      const tok = sum(pw.byWorker.main)
      const busy = o.workers.filter(w => w.ended === undefined).length
      const parts0 = [
        '▸ 팀장',
        leadPct !== undefined ? ` · ${leadPct}% ${st!.name}` : ' · 피로도 아직 안 잼',
        tok ? ` · 전기세 ${man(tok)}` : '',
        o.workers.length ? ` · 맡긴 일 ${o.workers.length}건` : '',
        o.workers.length ? ` (일하는 중 ${busy})` : '',
      ]
      const tries = [parts0, [...parts0.slice(0, 4), ''], [parts0[0]!, parts0[1]!, '', parts0[3]!, ''], [parts0[0]!, parts0[1]!, '', '', '']].map(x => x.join(''))
      const hint = ' · 누르면 펼침'
      summary = [tries[0]! + hint, ...tries].find(x => dw(x) <= width) ?? fit(tries[tries.length - 1]!, width)
      detail = []
      detailRows = 1
    } else if (foldGain) await buildCard(true, '▾ ')
    // 그림 몫을 이번 카드 높이로 정확히: 지난번과 다르면 다시 놓는다 — 그림 몫을 다시 정하는 때(stickKey 가 바뀔 때)만.
    // 카드가 안 보일 때(책장 · 안내 · 피로도 · 보고서)는 지난번 몫 그대로 (그림이 들썩이지 않게)
    const hidden = v.shelf || v.guide || v.tired || (v.report && rep)
    if (e.surface === 'terminal' && !stuck && !hidden) {
      const rows = folded ? FOLD_ROWS : detailRows + extra
      if (rows !== cardRows) {
        cardRows = rows
        lastRows = Math.max(1, bodyRows - headRows - cardRows)
        L = sceneOf(o, width, lastRows, now)
      }
      stick = { key: stickKey, rows: lastRows, gain: foldGain }
    }
    // 그림 몫을 고정한 채 고른 카드가 남은 줄보다 길면 짧은 카드로 (그림은 그대로)
    if (e.surface === 'terminal' && stuck && !folded && detailRows + extra > bodyRows - headRows - outOf(L).rows) await buildCard(true, foldGain ? '▾ ' : '')
    const K = L.k
    const OUT = outOf(L)
    const CWK = Math.round(CW * K) // 화면에서 자리 한 칸 폭

    // 말풍선 자리: 자기 책상 폭이 기본, 옆자리에 말풍선이 없으면 그 자리 반까지, 줄 끝이면 끝까지 넓힌다.
    // (팀장은 그 줄에 혼자라 줄 전체를 쓴다.) 그래도 좁으면 짧은 말로 바꾼다.
    const away = new Set(L.seats.filter(s => isGone(o, L, s.key, now)).map(s => s.key)) // 퇴근한 자리
    const sayOf = (s: (typeof L.seats)[number]) =>
      !s.worker || s.worker.status === 'desk' || away.has(s.key) ? []
        : o.waiting && s.worker.status === 'ask' && o.waiting.who === s.worker.id ? ['확인해 주세요!', '확인 필요'] // 🔔 사장님 확인 기다림
          : bubbles(s.worker.status, s.worker.tool, s.worker.target)
    const spots = new Map<string, { left: number; text: string }>()
    const byRow = new Map<number, (typeof L.seats)[number][]>()
    for (const s of L.seats) byRow.set(s.row, [...(byRow.get(s.row) ?? []), s])
    for (const row of byRow.values()) {
      row.sort((a, b) => a.col - b.col)
      row.forEach((s, i) => {
        const say = sayOf(s)
        if (!say.length) return
        const prev = row[i - 1]
        const nxt = row[i + 1]
        const half = Math.floor(CWK / 2)
        const lo = !prev ? 0 : sayOf(prev).length ? xOf(L, prev.col) + CWK : xOf(L, prev.col) + half
        const hi = !nxt ? OUT.cols : sayOf(nxt).length ? xOf(L, nxt.col) : xOf(L, nxt.col) + half
        const room = Math.max(4, hi - lo)
        const text =
          say.map(t => ' ' + t + ' ').find(t => dw(t) <= room) ?? say.find(t => dw(t) <= room) ?? fit(say[say.length - 1]!, room)
        const w = dw(text)
        const left = Math.max(lo, Math.min(hi - w, xOf(L, s.col) + half - Math.floor(w / 2)))
        spots.set(s.key, { left, text })
      })
    }

    // 말 걸기: 직원을 누르면 그 에이전트에게 말을 건다
    // 팀장 = 대화창에 사장님 말로, 직원 = 그 에이전트에게 메시지(SendMessage 와 같은 통로). 보낼 때만 토큰이 든다.
    const { Input } = T
    const talkTo = sel === 'main' ? 'main' : agentId
    const talk = !live ? (
      <Text key="talk-off" dimColor>시연 중엔 말 걸기가 안 돼요 (가짜 직원)</Text>
    ) : talkTo ? (
      <Box key="talk-box" flexDirection="column">
        <Input key={'talk-' + (v.talks ?? 0)} label={`${sel}에게: `} submitLabel="보내기"
          placeholder="할 말 쓰고 Enter · Claude 에게 보내져서 토큰이 들어요"
          onSubmit={async value => {
            const text = value.trim()
            if (!text) return
            try {
              if (talkTo === 'main') {
                await $.prompt.submit({ text, asUser: true })
                $.ui.toast('팀장에게 보냈어요')
              } else {
                const r = await $.session.send({ to: { agentId: talkTo }, text })
                $.ui.toast(r.isDelivered ? `${sel}에게 보냈어요` : `못 보냈어요: ${r.reason}`)
                if (!r.isDelivered) return
              }
              const now2 = await $.clock.now()
              await update($, office, x => onTalk(x ?? EMPTY, talkTo, text, now2))
              await update($, view, x => ({ ...(x ?? v), talks: ((x ?? v).talks ?? 0) + 1 }))
            } catch (err) {
              $.ui.toast(`못 보냈어요: ${String(err)}`)
            }
          }} />
      </Box>
    ) : null

    // ✏️ 이름 바꾸기: 이 종류의 에이전트를 앞으로 이 이름으로 (general-purpose 처럼 이름으로 일을 모르는 종류는 빼고)
    const renameBox = hasRename && selW ? (
      <Input key={'rename-' + selW.role + '-' + (v.talks ?? 0)} label={`이름 바꾸기 (${selW.role}): `} submitLabel="바꾸기"
        placeholder={`지금 「${sel}」 — 새 이름 쓰고 Enter`}
        onSubmit={async value => {
          const name = value.trim().slice(0, 20)
          if (!name) return
          await rename($, selW.role, name)
          const key = selW.team ? `${name} ${selW.team}팀` : name
          await update($, view, x => ({ ...(x ?? v), selected: key, talks: ((x ?? v).talks ?? 0) + 1 }))
          $.ui.toast(`앞으로 「${name}」 으로 불러요`)
        }} />
    ) : null

    let scene: JSX.Element
    if (e.surface === 'terminal') {
      const { Raster } = $.ui.resolve(e)
      scene = (
        <Box key="floor" position="relative" width={OUT.cols} height={OUT.rows}>
          <Raster key="scene" columns={OUT.cols} rows={OUT.rows} cells={cellsOf(o, L, now, pw)} />
          <Box key="shelf-btn" position="absolute" top={Math.ceil(K)} left={Math.max(0, xOf(L, L.shelfX))}>
            <Button key="shelf" plain onPress={toggleShelf}>
              <Text inverse={!!v.shelf} color={v.shelf ? 'warning' : undefined} bold>{v.shelf ? '📚 책장 ▴' : '📚 책장 ▾'}</Text>
            </Button>
          </Box>
          {paperSpots(o, L).filter(x => x.p.picked === undefined).map(x => {
            // 바닥 서류 옆 번호 (위 「📄 놓친 일」 줄의 숫자 키와 같음). 눌러도 된다
            const n = lost.findIndex(p => p.id === x.p.id) + 1
            return n > 0 && n <= 9 ? (
              <Box key={'lost-' + x.p.id} position="absolute" top={Math.floor((x.y / 2) * K)} left={xOf(L, x.x + 4)}>
                <Button key={'lost-btn-' + x.p.id} plain onPress={() => void pickUp($, x.p.id)}><Text color="warning" bold inverse>{String(n)}</Text></Button>
              </Box>
            ) : null
          })}
          {(() => {
            // 청록 깔개(같은 일을 나란히 하는 직원) 위 짧은 글: 그 자리 줄의 통로 칸(이름표 한 줄 아래, 아랫줄 말풍선 위)에
            // 「같은 일 ×n」 → 모자라면 「같은일×n」 → 그래도 안 되면 안 씀. 줄이 바뀐 묶음은 첫 줄에만
            const out: JSX.Element[] = []
            const seen = new Set<string>()
            const twins = L.seats.filter(x => x.kind === 'twin')
            for (const t of twins) {
              const pk = t.pick ?? t.key
              if (seen.has(pk)) continue
              seen.add(pk)
              const group = twins.filter(x => (x.pick ?? x.key) === pk && x.row === t.row)
              const n = twins.filter(x => (x.pick ?? x.key) === pk).length
              const last = group[group.length - 1]!
              const left = xOf(L, t.col), room = xOf(L, last.col + CW) - left - 1
              const text = [`같은 일 ×${n}`, `같은일×${n}`].find(x => dw(x) <= room)
              if (text) {
                out.push(
                  <Box key={'twin-' + pk} position="absolute" top={Math.ceil((t.row + TAG_ROW + 1) * K)} left={left + 1}>
                    <Button key={'twin-btn-' + pk} plain onPress={pick(pk)}><Text color="cyan" bold>{text}</Text></Button>
                  </Box>,
                )
              }
            }
            return out
          })()}
          {(L.isles ?? []).filter(g => g.keys.length >= 2 && !g.other).map(g => {
            // 역할별 섬: 자리마다 이름표 대신 섬 아래 하나 (「디자이너 ×3」 — 수는 이 조각 책상에 앉은 사람 수)
            const left = xOf(L, g.col), room = xOf(L, g.col + g.w) - left - 2
            const text = tagText({ name: g.name, count: g.people }, room)
            // 누를 때마다 섬 안 자리를 차례로 고른다 (자리마다 이름표가 없으니)
            const picks = [...new Set(L.seats.filter(x => g.keys.includes(x.key)).map(x => x.pick ?? x.key))]
            const pk = picks[(picks.indexOf(sel) + 1) % picks.length] ?? 'main'
            return (
              <Box key={'isle-' + g.keys[0]} position="absolute" top={Math.ceil((g.row + TAG_ROW) * K)} left={left + Math.max(1, Math.floor((room + 2 - dw(text)) / 2))}>
                <Button key={'isle-btn-' + g.keys[0]} plain onPress={pick(pk)}>
                  <Text bold={picks.includes(sel)} color={picks.includes(sel) ? 'suggestion' : undefined}>{text}</Text>
                </Button>
              </Box>
            )
          })}
          {L.seats.flatMap(s => {
            const w = s.worker
            const say = spots.get(s.key)
            const inIsle = (L.isles ?? []).some(g => g.keys.length >= 2 && !g.other && g.keys.includes(s.key))
            const pickKey = s.pick ?? s.key
            const isSel = pickKey === sel
            const tone = w?.status === 'unfinished' ? 'error' : w?.status === 'done' ? 'success' : w?.status === 'ask' ? 'warning' : undefined
            // 이름표: 자리 이름 · 같이 일하는 수 · 파트장이면 그 아래 사람 수(「+3」, 층은 카드에서) · 다시 하는 횟수 ⟳n
            // 이름표는 자리 폭보다 좁게: 옆자리 이름표와 붙어 「designer1/3designer2/3」 처럼 읽히지 않게 (tagText)
            // 옆자리가 한 자리 폭으로 붙어 있으면 두 칸 좁게: 가운데 놓으면 이름표 사이가 늘 두 칸 이상 빈다
            const tight = L.seats.some(x => x !== s && x.row === s.row && Math.abs(xOf(L, x.col) - xOf(L, s.col)) <= CWK + 1)
            const TAG = CWK - (tight ? 2 : 1)
            const base0 = tagText(s, TAG, away.has(s.key))
            const base = s.loop && dw(base0) + 3 <= TAG ? `${base0} ⟳${s.loop}` : base0
            // 직급 별(★★)은 자리 폭에 들어갈 때만 이름 뒤에 (안 들어가면 카드에서 봄)
            const stars = w && s.key !== 'main' && w.tier ? TIERS[w.tier].stars : ''
            // ★ 은 터미널에 따라 두 칸으로 그려지기도 해서 넉넉히 두 칸으로 센다
            // 검사 직원: 검사하는 동안 🔍, 끝나면 통과 ✓ · 반려 ✗ (자리 폭에 들어갈 때만, 별보다 먼저)
            const last = w?.checker ? [...(o.reviews ?? [])].reverse().find(r => r.by === w.id) : undefined
            const rmark = !w?.checker ? '' : w.ended === undefined ? '🔍' : last?.verdict === 'pass' ? '✓' : last?.verdict === 'reject' ? '✗' : ''
            const showMark = !!rmark && dw(base) + 1 + 2 <= TAG
            const room = TAG - (showMark ? 3 : 0)
            const showStars = !!stars && dw(base) + 1 + [...stars].length * 2 <= room
            const name = fit(base, TAG)
            const tagW = dw(name) + (showMark ? 3 : 0) + (showStars ? 1 + [...stars].length : 0)
            return [
              say ? (
                <Box key={'say-' + s.key} position="absolute" top={Math.ceil(s.row * K) + (K === 2 ? 1 : 0)} left={say.left}>
                  <Button key={'bubble-' + s.key} plain onPress={pick(pickKey)}>
                    <Text color={tone} inverse>{say.text}</Text>
                  </Button>
                </Box>
              ) : null,
              // 이름표는 자리 가운데 (고른 사람은 굵게 · 색). 섬에 앉은 자리는 섬 이름표 하나로
              inIsle ? null : <Box key={'tag-' + s.key} position="absolute" top={Math.ceil((s.row + TAG_ROW) * K)} left={xOf(L, s.col) + Math.max(0, Math.floor((CWK - tagW) / 2))}>
                <Button key={'pick-' + s.key} plain onPress={pick(pickKey)}>
                  <Text bold={isSel} color={isSel ? 'suggestion' : undefined} dimColor={!isSel && away.has(s.key)}>
                    {name}
                  </Text>
                </Button>
                {showMark ? <Text key={'rv-' + s.key} color={rmark === '✗' ? 'error' : rmark === '✓' ? 'success' : undefined}>{' ' + rmark}</Text> : null}
                {showStars ? <Text key={'tier-' + s.key} color={w?.persona ? 'error' : 'warning'}>{' ' + stars}</Text> : null}
              </Box>,
            ]
          })}
        </Box>
      )
    } else {
      scene = (
      <Box key="floor" flexDirection="column">
        <Button key="shelf" plain onPress={toggleShelf}>{v.shelf ? '📚 책장 접기' : '📚 책장 (스킬 목록)'}</Button>
        {L.seats.map(s => (
          <Button key={'pick-' + s.key} plain onPress={pick(s.pick ?? s.key)}>
            {((s.pick ?? s.key) === sel ? '▸ ' : '  ') + s.name + (s.key !== 'main' && s.worker?.tier ? ` ${TIERS[s.worker.tier].stars}` : '') + '  '}
            <Text dimColor>{s.worker ? s.worker.action : ''}</Text>
          </Button>
        ))}
      </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {tabs}
        {live ? null : rowOf(T, 'demo', width, [
          [`▶ ${dm.label ?? '시연'} 중 ${dm.step}/${dm.total}`, { bold: true, color: 'warning' }],
          [dm.label ? ' · 방금 일을 빠르게 다시 보는 중 (토큰 0)' : ' · 가짜 장면이라 Claude 를 부르지 않아요 (토큰 0)', { color: 'warning' }],
          [' · 멈추기: /termimates 시연', { dimColor: true }],
        ])}
        <Box key="fatigue-line">
          <Button key="fatigue" plain onPress={toggleTired}>
            <Text bold color={st?.color} underline>{v.tired ? '피로도 ▾' : '피로도 ▸'}</Text>
          </Button>
          <Text> </Text>
          {fatigueRow}
        </Box>
        {powerRow}
        {jobRow}
        {tired}
        {waitRow}
        {reportLine}
        {paperRow}
        <Text bold>{o.prompt ? `사장님 지시 「${o.prompt}」` : '아직 사장님 지시 없음'}</Text>
        <Text dimColor>{situation}</Text>
        {scene}
        {v.guide ? (
          <Box key="guide" flexDirection="column" borderStyle="round" borderColor="suggestion" paddingX={1}>
            <Text bold color="suggestion">👋 처음 오셨나요? TermiMates 사무실 사용법</Text>
            <Text>여기는 지금 이 프로젝트(= 회사)의 사무실이에요. Claude 에게 일을 시키면 직원들이 출근해서 일하는 모습이 보여요.</Text>
            <Text> </Text>
            <Text><Text bold>팀장</Text> = 지금 대화하는 Claude. 일을 나누면 직원이 문으로 출근해요 — 기본은 기획자 · 디자이너 · 개발자 · QA · 리서처, 내가 지은 이름은 그대로 (designer · executor 처럼 흔한 표준 이름만 쉬운 역할로, 팀이면 「QA 1팀」 한 자리).</Text>
            <Text><Text bold>청록 깔개 · 같은 일 ×n</Text> = 같은 일을 나눠서 동시에 하는 직원들 (누르면 그 직원들 목록).</Text>
            <Text><Text bold>직원을 누르면</Text> 지금 하는 일 · 넘긴 서류 · 피로도 · 전기세가 보이고, 아래 칸에 말을 걸거나 이름을 바꿀 수 있어요 (말은 보낼 때만 토큰).</Text>
            <Text><Text bold>📚 책장</Text>을 누르면 내 스킬 목록 — 「쓰기」 를 누르면 입력창에 /스킬 이 들어가요. <Text bold>명부</Text> 탭은 내가 만든 에이전트와 「맡기기」.</Text>
            <Text><Text bold>🔔</Text> 허락 · 질문을 기다리면 맨 위에 노란 줄 (12초 넘으면 알림). 일이 끝나면 <Text bold>📋 보고서 · ▶ 다시 보기</Text>.</Text>
            <Text><Text bold>📄 놓친 일</Text> = 할 일 목록에 안 끝난 줄 · 「했어?」 에 「깜빡했어요」 · 직원 중단 → 그 자리 바닥에 서류. 숫자 키(창을 고른 뒤)나 눌러서 고르면 팀장이 주워 와 입력창에 「놓친 일 다시 확인: …」 (Enter 는 직접).</Text>
            <Text><Text bold>맨 위</Text> 피로도 = 대화가 얼마나 찼는지 (70% 넘으면 새 세션 권함) · 전기세 = 쓴 토큰.</Text>
            <Text> </Text>
            <Text bold>명령</Text>
            <Text>  /termimates          사무실 열기 · 닫기 (켜 둔 프로젝트는 다음에도 열림)</Text>
            <Text>  /termimates 시연     가짜 장면 구경 (Claude 를 안 불러서 토큰 0)</Text>
            <Text>  /termimates 웹       브라우저에서 큰 사무실 (http://127.0.0.1:8766)</Text>
            <Text>  /termimates 도움말   이 안내 다시 보기</Text>
            <Text dimColor>그림이 깨져 보이면: 터미널의 「모호한 폭 문자를 넓게」 끄기 · 줄 간격 1.0 · 창 넓히기 (설명서 「화면이 깨질 때」), 아니면 /termimates 웹.</Text>
            <Text dimColor>이 화면은 AI 를 부르지 않아요 (토큰 0). 기록은 이 컴퓨터에만 남아요.</Text>
            <Box key="guide-actions" columnGap={2} marginTop={1}>
              <Button key="guide-demo" onPress={async () => {
                await update($, view, x => ({ ...(x ?? v), guide: false }))
                void runDemo($)
              }}>▶ 시연 보기</Button>
              <Button key="guide-ok" onPress={() => update($, view, x => ({ ...(x ?? v), guide: false }))}>알겠어요</Button>
            </Box>
          </Box>
        ) : null}
        {tiredCard}
        {reportCard}
        {v.shelf ? shelfList(false) : null}
        <Box key="card" flexDirection="column" borderStyle={folded ? undefined : 'round'} paddingX={folded ? 0 : 1} display={v.shelf || v.guide || v.tired || (v.report && rep) ? 'none' : 'flex'}>
          {folded ? <Button key="card-fold" plain onPress={openCard}><Text bold>{summary}</Text></Button> : null}
          {foldGain && !folded && detail.length ? [<Button key="card-unfold" plain onPress={foldCard}>{detail[0]!}</Button>, ...detail.slice(1)] : detail}
          {talk}
          {folded ? null : renameBox}
          {agentId && !folded ? (
            <Box key="card-actions" columnGap={2}>
              <Button key="open-agent" onPress={async () => {
                const r2 = await $.ui.view({ agentId })
                if (r2.deny) $.ui.toast(`대화를 열 수 없어요: ${r2.deny}`)
              }}>이 직원 대화 보기</Button>
              <Button key="open-main" onPress={() => $.ui.view({})}>메인 대화로</Button>
            </Box>
          ) : null}
        </Box>
      </Box>
    )
  })
}
