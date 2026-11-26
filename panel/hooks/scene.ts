// 픽셀 사무실: 바닥 · 벽 · 책상 · 직원 캐릭터를 한 장의 Raster(색 칸)로 그린다.
// 한 칸 = 글자 '▀' 하나 = 위 픽셀(글자색) + 아래 픽셀(배경색). 그래서 세로 픽셀은 칸의 2배.

import type { Office, Paper, Status, Worker } from '../types'
import { fold, foldSteps, PICK_MS, PICK_WALK_MS } from './office'
import type { Spot, UnitInfo } from './office'

export const CW = 12 // 책상 한 자리 가로 칸
export const CH = 9 // 세로 칸: 말풍선 1 + 그림 7 + 이름표 1
export const WALL = 3 // 벽 높이(칸)

const C = {
  skin: 0xf4c7a1, eye: 0x2b2b2b, pants: 0x3d4a66, shoes: 0x2a2a2a, white: 0xf5f5f5,
  book: 0xc2410c, page: 0xfff8e7, ring: 0xadb5bd, lens: 0xa5d8ff, wood: 0x7a4a2a,
  mug: 0xffffff, tie: 0xd64541, glasses: 0x222222, helmet: 0xfcc419, beret: 0xd6336c,
  cap: 0x2f9e44, steam: 0xd0d4da, paper: 0xfffdf5, chair: 0x3b3f46,
  deskTop: 0xb07a45, deskFront: 0x8b5a2b, deskEdge: 0x6f4518,
  lid: 0xced4da, lidBase: 0xadb5bd, glow: 0x74c0fc, dark: 0x868e96,
  floor: 0xc49a6c, seam: 0xa8825a, wall: 0x5f7f7a, molding: 0x4a6762, base: 0x3f5753,
  frame: 0xe9ecef, day: 0x9ad0f5, night: 0x1d2b53, star: 0xfff3bf, rug: 0x8c3b3b, rugEdge: 0xa94442,
  leaf: 0x2f9e44, leafDark: 0x2b8a3e, pot: 0xa0522d,
}

const SHIRTS = [0x1971c2, 0xe67700, 0x0ca678, 0xc2255c, 0x5c940d, 0x6741d9, 0x1098ad, 0xd9480f, 0xa61e4d, 0x2b8a3e]
const HAIRS = [0x4a2c17, 0x1e1e1e, 0x8b4513, 0x5a3825, 0xd4a373, 0x3b2f2f]
const ROLE_SHIRT: Record<string, number> = {
  사장님: 0x2a3142, main: 0x1c3d6e, 리서처: 0x0c8599, 기획자: 0x7048e8, 개발자: 0xe8590c, 디자이너: 0x1971c2, QA: 0x5c940d,
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

export function shirtOf(role: string): number {
  return ROLE_SHIRT[role] ?? SHIRTS[hash(role) % SHIRTS.length] ?? 0x1971c2
}

function hairOf(role: string): number {
  return role === 'main' ? 0x2b2b2b : HAIRS[(hash(role) >>> 5) % HAIRS.length] ?? 0x4a2c17
}

// 역할마다 소품: 팀장 넥타이 · 리서처 탐험 모자 · 기획자 안경 · 디자이너 베레모 · QA 야구모자 · 개발자 안전모
export function propOf(role: string): string | undefined {
  return ({ 사장님: 'tie', main: 'tie', 리서처: 'hat', 기획자: 'glasses', 디자이너: 'beret', QA: 'cap', 개발자: 'helmet' } as Record<string, string>)[role]
}

// 그림 칸 10 × 12, 사람은 가운데 8 × 12 (8 × 12 보다 작으면 사람으로 안 보인다). 양옆 한 칸은 돋보기 · 망치 같은 소품 자리. '.' = 투명
const BODY = [
  '...hhhh...',
  '..hhhhhh..',
  '..hssssh..',
  '..sesses..',
  '..ssssss..',
  '....ss....',
  '..bbbbbb..',
  '.b.bbbb.b.',
  '.b.bbbb.b.',
  '.s.pppp.s.',
  '...p..p...',
  '...k..k...',
]

type Grid = string[][]

function put(g: Grid, r: number, c: number, k: string) {
  const line = g[r]
  if (line && c >= 0 && c < line.length) line[c] = k
}
function row(g: Grid, r: number, text: string) {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch && ch !== ' ') put(g, r, i, ch)
  }
}

export function kindOf(status: Status | string, tool?: string): string {
  if (status === 'work') {
    if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'NotebookEdit') return 'type'
    if (tool === 'Read' || tool === 'Skill') return 'read'
    if (tool === 'Grep' || tool === 'Glob' || tool === 'WebSearch' || tool === 'WebFetch' || tool === 'ToolSearch' || tool === 'LSP') return 'search'
    if (tool === 'Bash') return 'hammer'
    if (tool === 'Agent' || tool === 'Task' || tool === 'SendMessage' || tool === 'Workflow') return 'give'
    if (tool === 'AskUserQuestion') return 'hand_up'
    return 'type'
  }
  return ({ handoff: 'give', ask: 'hand_up', idle: 'coffee', think: 'think', wait_report: 'wait', done: 'done' } as Record<string, string>)[status] ?? 'stand'
}

/** 캐릭터 픽셀 12줄 (팔레트 키). walking 이면 다리를 번갈아. */
export function figure(role: string, kind: string, frame: number, walking = false, blink = false): Grid {
  const g: Grid = BODY.map(r => r.split(''))
  const p = propOf(role)
  if (p === 'tie') { put(g, 6, 4, 'w'); put(g, 6, 5, 'w'); for (const r of [7, 8]) { put(g, r, 4, 't'); put(g, r, 5, 't') } }
  if (p === 'hat') { row(g, 0, '.nnnnnnnn.'); row(g, 1, '..nnnnnn..') }
  if (p === 'glasses') row(g, 3, '..GeGGeG..')
  if (p === 'beret') { row(g, 0, '..rrrrr...'); row(g, 1, '.rrrrrrr..') }
  if (p === 'cap') { row(g, 0, '...qqqq...'); row(g, 1, '..qqqqqqqq') }
  if (p === 'helmet') { row(g, 0, '...yyyy...'); row(g, 1, '..yyyyyy..') }
  if (blink && p !== 'glasses') row(g, 3, '..ssssss..')
  const f = frame % 2
  switch (kind) {
    case 'type': // 두 손을 앞으로 (자판)
      if (f) { row(g, 7, '..bbbbbb..'); row(g, 8, '..sbbbbs..') }
      break
    case 'read': // 책을 펴 들고 쪽을 넘김
      row(g, 6, '..oooooo..')
      row(g, 7, '.s' + (f ? 'owwwwo' : 'owwowo') + 's.')
      row(g, 8, '..bbbbbb..')
      break
    case 'search': { // 오른손에 돋보기
      const d = f
      for (const r of [7, 8, 9]) put(g, r, 8, '.')
      put(g, 6, 8, 'b'); put(g, 5, 8, 's')
      put(g, 2, 8 - d, 'R'); put(g, 2, 9 - d, 'R'); put(g, 3, 8 - d, 'L'); put(g, 3, 9 - d, 'R'); put(g, 4, 9 - d, 'n')
      break
    }
    case 'hammer': // 망치질 (명령 실행)
      for (const r of [7, 8, 9]) put(g, r, 8, '.')
      if (f) { put(g, 6, 8, 'b'); put(g, 5, 8, 's'); put(g, 4, 8, 'n'); put(g, 3, 8, 'R'); put(g, 3, 9, 'R') }
      else { put(g, 7, 8, 'b'); put(g, 8, 8, 's'); put(g, 8, 9, 'R'); put(g, 9, 9, 'R') }
      break
    case 'give': // 두 손으로 서류
      row(g, 7, '.bbbbbbbb.'); row(g, 8, '.swwwwwws.')
      break
    case 'hand_up': // 손 들기 (질문)
      for (const r of [7, 8, 9]) put(g, r, 8, '.')
      put(g, 6, 8, 'b'); put(g, 5, 8, 'b'); put(g, 4, 8, 'b'); put(g, 3, 8, f ? 's' : 'b'); put(g, 2, 8, 's')
      break
    case 'think': // 턱 괴기
      put(g, 5, 6, 's'); put(g, 5, 7, 's'); put(g, 6, 7, 'b')
      break
    case 'done': // 두 팔 번쩍
      if (f) {
        for (const r of [7, 8, 9]) { put(g, r, 1, '.'); put(g, r, 8, '.') }
        put(g, 6, 1, 'b'); put(g, 5, 1, 's'); put(g, 6, 8, 'b'); put(g, 5, 8, 's')
      }
      break
  }
  if (walking) { // 다리를 벌렸다 모았다
    if (f) { row(g, 10, '..p....p..'); row(g, 11, '.kk....kk.') } else { row(g, 10, '...p..p...'); row(g, 11, '...k..k...') }
  }
  return g
}

function colorOf(k: string, role: string): number | undefined {
  switch (k) {
    case '.': return undefined
    case 'b': return shirtOf(role)
    case 'h': return hairOf(role)
    case 's': return C.skin
    case 'e': return C.eye
    case 'p': return C.pants
    case 'k': return C.shoes
    case 'w': return C.paper
    case 'o': return C.book
    case 'R': return C.ring
    case 'L': return C.lens
    case 'n': return C.wood
    case 't': return C.tie
    case 'G': return C.glasses
    case 'y': return C.helmet
    case 'r': return C.beret
    case 'q': return C.cap
    case 'c': return C.mug
    case 'S': return C.steam
  }
  return 0x868e96
}

// -- 장면 -------------------------------------------------------------------

/** 사무실 한 자리 = 한 명 또는 한 팀. role 은 생김새(짧은 한글 역할), team 이면 members 는 팀원 상태(출근 순) */
export type Seat = {
  key: string; role: string; name: string; col: number; row: number; worker?: Worker; count: number
  team?: boolean; members?: Status[]
  pick?: string // 누르면 고를 것 (없으면 key). 나란히 앉은 같은 일 직원은 그 자리, 접은 자리는 「fold:리서처」
  kind?: Spot['kind']
  ids?: string[] // 이 자리에 든 직원 id 들 (일 맡길 때 서류가 날아갈 자리 찾기)
  kids?: number // 파트장이면 그 아래 사람 수 (터미널은 층을 안 그리고 「+3」 만)
  loop?: number // ⟳ 반복 횟수
  leaving?: Worker[] // 이 자리에서 막 나가는 중인 사람 (새 사람이 자리를 이어받아도 문까지 끝까지 걷는다)
}

export type Layout = {
  cols: number; rows: number; seats: Seat[]; shelfX: number
  wall: number // 벽 높이(칸). 촘촘한 윗부분이면 COMPACT_WALL
  top: number // 첫 직원 줄이 시작하는 칸 (큰 복도 바로 아래)
  keyOf: (w: Worker) => string // 그 직원이 앉는 자리 (역할 또는 「QA 1팀」)
  k: Scale // 그림 배율 (cols · rows · 자리 위치는 1배 기준, 화면 칸은 xOf · yOf 로)
  xs: number[] // 1배 칸 → 화면 칸 (길이 cols + 1, 마지막 = 화면 폭)
  isles?: IsleSpot[] // 역할별 섬으로 놓았을 때만
}

export type Scale = 1 | 1.5 | 2

/** 그림에 놓인 섬 한 조각 (1배 칸 기준). 이름표는 그리는 쪽이 이 자리 아래 하나로. people = 이 조각 책상에 앉은 사람 수 */
export type IsleSpot = { name: string; people: number; first: boolean; other: boolean; col: number; w: number; row: number; keys: string[] }

/** 1.5배: 시작 칸을 팀장 자리의 12칸 무늬에 맞추는 만큼 (가까운 쪽, 넘치면 왼쪽으로) */
function alignTo(leadCol: number, x: number, total: number, cols: number): number {
  const d = (((leadCol - x) % CW) + CW) % CW
  return d <= CW / 2 && x + d + total <= cols ? d : Math.max(-x, d - CW)
}

/** 1배 칸 줄 → 화면 칸 줄 */
export const yOf = (L: Layout, r: number): number => Math.floor(r * L.k)
/** 1배 칸 → 화면 칸 */
export const xOf = (L: Layout, c: number): number => L.xs[Math.max(0, Math.min(L.cols, Math.round(c)))] ?? 0
/** 화면 크기 (칸 · 줄) */
export const outOf = (L: Layout): { cols: number; rows: number } => ({ cols: L.xs[L.cols] ?? L.cols, rows: Math.floor(L.rows * L.k) })

// 1.5배: 칸 12개 중 6개를 두 번 그린다. 자리 왼쪽 끝 기준 0 · 2 · 4 · 7 · 9 · 11 번째 — 자리 가운데를 두고 좌우가 같아서
// 두 눈(4 · 7번째)이 똑같이 두 칸, 머리 · 얼굴 폭도 좌우 대칭 (아무 칸이나 겹치면 한쪽 눈만 커진다)
const DUP15 = new Set([0, 2, 4, 7, 9, 11])
function colsMap(cols: number, k: Scale, origin: number): number[] {
  const xs: number[] = [0]
  for (let c = 0; c < cols; c++) {
    const n = k === 2 ? 2 : k === 1.5 && DUP15.has((((c - origin) % CW) + CW) % CW) ? 2 : 1
    xs.push(xs[c]! + n)
  }
  return xs
}

// 자리 한 칸(CW × CH 칸): 0줄 말풍선 · 1~6줄 사람과 작은 책상 · 7줄 이름표 · 8줄 통로(걸어 다니는 길)
export const TAG_ROW = 7
export const HALL = 5 // 팀장 줄과 직원 줄 사이 큰 복도(칸). 사람 키만큼 비워 둬서 걸어 다녀도 책상 · 사람을 덮지 않는다
const LEFT = 4 // 왼쪽 출입문 자리
const SHELF_W = 13 // 오른쪽 책장 폭(픽셀)

const STAFF_TOP = WALL + CH + HALL // 첫 직원 줄이 시작하는 칸

// 촘촘한 윗부분 (붐벼서 섬 배치일 때만, 보통 높이로는 섬이 안 들어갈 때): 벽을 2칸으로(창문은 얇게),
// 팀장 자리를 맨 위에 붙여 말풍선 · 머리가 벽 앞에 오게, 복도는 사람 키만큼 그대로 (팀장 이름표 바로 아래부터).
// 팀장 · 출입문 · 복도 · 책장은 그대로 보이고 위쪽만 3칸 준다
export const COMPACT_WALL = 2
const COMPACT_LEAD = 0 // 팀장 자리 줄 (말풍선 줄이 벽 위)
const COMPACT_TOP = COMPACT_LEAD + CH + HALL // 14

const ORDER: Status[] = ['handoff', 'work', 'think', 'ask', 'wait_report', 'unfinished', 'done', 'idle', 'off', 'desk']

export type Unit = { role: string; worker: Worker; count: number; list: Worker[] }

/** 자리별 대표 직원 (지금 일하는 사람 우선). keyOf 로 같은 자리(같은 역할, 또는 같은 팀)끼리 모은다 */
export function seatsOf(o: Office, keyOf: (w: Worker) => string = w => w.role): Unit[] {
  const byKey = new Map<string, Worker[]>()
  for (const w of o.workers) {
    const key = keyOf(w)
    const list = byKey.get(key) ?? []
    list.push(w)
    byKey.set(key, list)
  }
  const out: Unit[] = []
  for (const [role, list] of byKey) {
    const active = list.filter(w => w.ended === undefined)
    const pool = active.length ? active : list
    const best = [...pool].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || b.since - a.since)[0]
    if (best) out.push({ role, worker: best, count: active.length, list })
  }
  return out // 처음 출근한 순서 그대로 (자리 고정)
}

export type Opts = { spots?: Spot[]; units?: UnitInfo[]; k?: Scale; isles?: IsleSeg[][]; compact?: boolean }

/** 자리 하나에 들어갈 사람 (접은 자리 · +n 자리는 대표 한 명 또는 없음) */
function seatOfSpot(o: Office, sp: Spot, units: UnitInfo[], jobOf: (w: Worker) => string): Omit<Seat, 'col' | 'row'> {
  const us = sp.units.map(k => units.find(u => u.key === k)).filter((u): u is UnitInfo => !!u)
  const list = us.flatMap(u => u.list)
  const leaving = (sp.leaving ?? []).map(id => o.workers.find(w => w.id === id)).filter((w): w is Worker => !!w)
  const base = { key: sp.key, pick: sp.pick, kind: sp.kind, ids: list.map(w => w.id), name: sp.label, ...(leaving.length ? { leaving } : {}) }
  if (sp.kind === 'twin') {
    const w = o.workers.find(x => x.id === sp.who)
    // 파트장 「+n」 · ⟳n 은 묶음 첫 자리에만
    const first = sp.key.endsWith('#1')
    return { ...base, role: w ? jobOf(w) : sp.family, worker: w, count: 1, ids: w ? [w.id] : [],
      kids: first ? us[0]?.kids || undefined : undefined, loop: first ? us[0]?.loop || undefined : undefined }
  }
  if (sp.kind === 'unit' && us[0]) {
    const u = us[0]
    return { ...base, role: jobOf(u.worker), worker: u.worker, count: u.active.length, team: u.team,
      members: u.team ? u.list.map(w => w.status) : undefined, kids: u.kids || undefined, loop: u.loop || undefined }
  }
  // 접은 자리: 지금 일하는 사람을 대표로, 책상 앞 점은 사람마다 (+n 자리는 빈 책상)
  const best = us.map(u => u.worker).sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status))[0]
  return { ...base, role: sp.kind === 'more' ? '' : sp.family, worker: sp.kind === 'more' ? undefined : best, count: 0, team: true,
    members: list.map(w => w.status) }
}

/** 한 줄에 앉는 자리 수 */
export const perRowOf = (cols: number): number => Math.max(1, Math.floor((cols - LEFT) / CW))
const MIN_BIG = 44 // 2배로 그릴 때 1배 기준 최소 폭 (팀장 · 책장 · 문이 다 들어가는 폭)

// -- 역할별 섬 (터미널만) ----------------------------------------------------------------------
// 직원이 많아 한 줄로는 1배밖에 안 될 때: 같은 쉬운 역할끼리 책상을 붙여 섬을 만들고, 섬들을 두세 줄로 놓아 더 크게 그린다.
// 섬 이름표는 하나(「디자이너 ×3」). 혼자인 역할들은 「기타」 섬에 모으고 각자 이름표를 그대로 둔다.
// 직원이 적으면(ISLE_MIN 아래) 섬을 안 만든다 — 지금 모습 그대로.
export type Isle = { name: string; family: string; keys: string[]; people: number; other?: boolean }
/** 한 줄에 놓인 섬 한 조각 (섬이 한 줄보다 길면 여러 조각, 이름표는 첫 조각에만 수를 붙인다) */
export type IsleSeg = { isle: Isle; keys: string[]; first: boolean }
export const ISLE_MIN = 7 // 자리가 이만큼 넘어야 섬
const ISLE_ROWS = 3 // 섬 줄은 세 줄까지
/** 섬 사이 칸. 1.5배는 얼굴이 대칭이게 자리를 12칸 무늬에 맞춰야 해서 한 자리 폭 */
const isleGap = (k: Scale): number => (k === 1.5 ? CW : CW / 2)

/** 자리들을 역할(생김새 역할)별 섬으로. 처음 나온 역할 순서 그대로, 혼자인 역할이 둘 이상이면 「기타」 섬 하나로 (맨 뒤) */
export function islesOf(spots: Spot[]): Isle[] {
  const fams: string[] = []
  for (const sp of spots) if (!fams.includes(sp.family)) fams.push(sp.family)
  const groups = fams.map(f => spots.filter(sp => sp.family === f))
  const singles = groups.filter(g => g.length === 1).map(g => g[0]!)
  const isle = (name: string, family: string, g: Spot[], other?: boolean): Isle =>
    ({ name, family, keys: g.map(x => x.key), people: g.reduce((n, x) => n + x.people, 0), ...(other ? { other } : {}) })
  const out = groups.filter(g => g.length > 1 || singles.length < 2).map(g => isle(g[0]!.family, g[0]!.family, g))
  if (singles.length >= 2) out.push(isle('기타', '', singles, true))
  return out
}

/** 섬들을 줄에 담기: 지금 줄에 통째로 들어가면 거기, 아니면 새 줄, 한 줄보다 길면 한 줄씩 잘라서. 줄이 max 를 넘으면 없음 */
export function packIsles(isles: Isle[], avail: number, gap: number, max: number): IsleSeg[][] | undefined {
  const per = Math.max(1, Math.floor(avail / CW))
  const rows: IsleSeg[][] = []
  const used = (r: IsleSeg[]) => r.reduce((n, x, i) => n + x.keys.length * CW + (i ? gap : 0), 0)
  for (const isle of isles) {
    for (let i = 0; i < isle.keys.length; i += per) {
      const seg: IsleSeg = { isle, keys: isle.keys.slice(i, i + per), first: i === 0 }
      const last = rows[rows.length - 1]
      if (last && used(last) + gap + seg.keys.length * CW <= avail) last.push(seg)
      else rows.push([seg])
    }
  }
  return rows.length <= max ? rows : undefined
}

/** 붐비는가: 그림에 앉을 자리(파트장 아래 직원 빼고)가 섬 배치 후보만큼 (그러면 패널 카드도 짧게) */
export const isCrowded = (units: UnitInfo[]): boolean => (foldSteps(units.filter(u => !u.boss))[0] ?? []).length >= ISLE_MIN

/** 터미널: 「2배 → 1.5배 → 1배 → 접기 → +n」. width · rows = 그림이 쓸 수 있는 칸 · 줄 수.
 *  사람이 적어 줄인 폭(width ÷ 배율)으로도 한 줄에 다 앉고 그 배율 높이가 들어가면 크게, 아니면 1배로 줄 수에 맞춰 접는다.
 *  파트장 아래 직원(boss 있음)은 터미널에선 안 그린다 (파트장 이름표의 「+n」 · 카드로) */
export function plan(units: UnitInfo[], width: number, rows: number): { k: Scale; spots: Spot[]; isles?: IsleSeg[][]; compact?: boolean } {
  const steps = foldSteps(units.filter(u => !u.boss))
  const first = steps[0] ?? []
  for (const k of [2, 1.5] as const) {
    const vw = Math.floor(width / k)
    if (vw >= MIN_BIG && first.length <= perRowOf(vw) && Math.floor(k * (STAFF_TOP + CH)) <= rows) return { k, spots: first }
  }
  // 한 줄로는 1배뿐: 역할별 섬을 두세 줄로 놓아 크게 그릴 수 있으면 그쪽 (큰 배율부터)
  if (first.length >= ISLE_MIN) {
    const isles = islesOf(first)
    // 같은 배율이면 보통 윗부분 먼저, 안 들어가면 촘촘한 윗부분으로
    for (const k of [2, 1.5] as const) {
      const vw = Math.floor(width / k)
      if (vw < MIN_BIG) continue
      for (const top of [STAFF_TOP, COMPACT_TOP]) {
        const fit = Math.min(ISLE_ROWS, Math.floor((Math.floor(rows / k) - top) / CH))
        if (fit < 2) continue
        const packed = packIsles(isles, vw - LEFT, isleGap(k), fit)
        if (packed && packed.length >= 2) {
          const order = packed.flat().flatMap(g => g.keys)
          return { k, spots: order.map(key => first.find(x => x.key === key)!), isles: packed, ...(top === COMPACT_TOP ? { compact: true } : {}) }
        }
      }
    }
  }
  const maxRows = Math.max(1, Math.floor((rows - STAFF_TOP) / CH))
  return { k: 1, spots: fold(steps, perRowOf(Math.max(CW + LEFT, Math.min(512, width))) * maxRows) }
}

export function layout(o: Office, width: number, keyOf: (w: Worker) => string, jobOf: (w: Worker) => string = w => w.role,
  opts: Opts = {}): Layout {
  const k = opts.k ?? 1
  const cols = Math.max(CW + LEFT, Math.min(512, Math.floor(width / k)))
  const shelfX = cols - SHELF_W - 2
  // 팀장은 가운데, 책장과 겹치면 왼쪽으로 (보고하러 온 직원이 설 자리도 남긴다)
  const leadCol = Math.max(LEFT, Math.min(Math.floor((cols - CW) / 2), shelfX - CW - 10))
  // 촘촘한 윗부분은 섬 배치에서만
  const compact = !!(opts.compact && opts.isles && opts.spots)
  const wall = compact ? COMPACT_WALL : WALL
  const top = compact ? COMPACT_TOP : STAFF_TOP
  const seats: Seat[] = [{ key: 'main', role: 'main', name: '팀장', col: leadCol, row: compact ? COMPACT_LEAD : WALL, worker: o.lead, count: 0 }]
  const staff: Omit<Seat, 'col' | 'row'>[] = opts.spots
    ? opts.spots.map(sp => seatOfSpot(o, sp, opts.units ?? [], jobOf))
    : seatsOf(o, keyOf).map(s => {
      const team = s.list.some(w => w.team)
      return { key: s.role, role: jobOf(s.worker), name: s.role, worker: s.worker, count: s.count, team,
        members: team ? s.list.map(w => w.status) : undefined, ids: s.list.map(w => w.id) }
    })
  const perRow = perRowOf(cols)
  // 실제 앉은 자리 수만큼만 가운데에: 사람이 적으면 자리 사이를 조금 띄워 고르게 펼친다 (한 자리 폭의 1.5배까지).
  // 1.5배는 자리를 팀장 자리와 같은 12칸 무늬에 맞춰야 얼굴이 대칭이라, 간격을 12칸 배수로 · 시작을 무늬에 맞춘다
  const inRow = Math.max(1, Math.min(perRow, staff.length))
  const wide = Math.min(Math.floor(CW * 1.5), Math.max(CW, Math.floor((cols - LEFT) / inRow)))
  const step = k === 1.5 ? CW * Math.max(1, Math.floor(Math.min(CW * 2, (cols - LEFT) / inRow) / CW)) : wide
  // 섬 배치: 줄마다 섬 조각을 가운데 모아 놓는다 (섬 안 자리는 붙여서, 섬 사이는 isleGap)
  if (opts.isles && opts.spots) {
    const gap = isleGap(k)
    const isles: IsleSpot[] = []
    let i = 0
    opts.isles.forEach((row, r) => {
      const total = row.reduce((n, g, j) => n + g.keys.length * CW + (j ? gap : 0), 0)
      let x = LEFT + Math.floor((cols - LEFT - total) / 2)
      if (k === 1.5) x += alignTo(leadCol, x, total, cols)
      const y = top + r * CH
      for (const g of row) {
        // 이름표 수 = 이 조각 책상에 앉은 사람 수 (같은 생김새 역할이라 한 섬으로 묶인 다른 이름 자리가 다음 줄로 넘어가도 안 셈)
        const people = g.keys.reduce((n, key) => n + (opts.spots!.find(s => s.key === key)?.people ?? 0), 0)
        isles.push({ name: g.isle.name, people, first: g.first, other: !!g.isle.other, col: x, w: g.keys.length * CW, row: y, keys: g.keys })
        g.keys.forEach((_, j) => seats.push({ ...staff[i++]!, col: x + j * CW, row: y }))
        x += g.keys.length * CW + gap
      }
    })
    return { cols, rows: top + opts.isles.length * CH, seats, shelfX, wall, top, keyOf, k, xs: colsMap(cols, k, leadCol), isles }
  }
  staff.forEach((s, i) => {
    const r = Math.floor(i / perRow)
    const c = i % perRow
    const n = Math.min(perRow, staff.length - r * perRow) // 이 줄 자리 수
    const st = n === inRow ? step : CW
    let margin = LEFT + Math.floor((cols - LEFT - (n - 1) * st - CW) / 2)
    if (k === 1.5) {
      const d = (((leadCol - margin) % CW) + CW) % CW
      margin += d <= CW / 2 && margin + d + (n - 1) * st + CW <= cols ? d : d - CW
      margin = Math.max(0, margin)
    }
    seats.push({ ...s, col: margin + c * st, row: STAFF_TOP + r * CH })
  })
  const staffRows = Math.max(1, Math.ceil(staff.length / perRow))
  return { cols, rows: STAFF_TOP + staffRows * CH, seats, shelfX, wall, top, keyOf, k, xs: colsMap(cols, k, leadCol) }
}

/** 크게: 픽셀을 배율만큼 늘린다 (가로는 xs 무늬, 세로는 k 배). 글자는 그리는 쪽에서 xOf · yOf 로 위치만 옮긴다 */
export function zoom(px: Uint32Array, L: Layout): Uint32Array {
  if (L.k === 1) return px
  const w = L.cols, h = L.rows * 2, o = outOf(L), ow = o.cols, oh = o.rows * 2
  const src = new Int32Array(ow)
  for (let c = 0; c < w; c++) for (let x = L.xs[c]!; x < L.xs[c + 1]!; x++) src[x] = c
  const out = new Uint32Array(ow * oh)
  for (let y = 0; y < oh; y++) {
    const row = Math.min(h - 1, Math.floor(y / L.k)) * w, dst = y * ow
    for (let x = 0; x < ow; x++) out[dst + x] = px[row + src[x]!] ?? 0
  }
  return out
}

type Px = { w: number; h: number; px: Uint32Array }

function fill(b: Px, x: number, y: number, w: number, h: number, color: number) {
  for (let j = Math.max(0, y); j < Math.min(b.h, y + h); j++)
    for (let i = Math.max(0, x); i < Math.min(b.w, x + w); i++) b.px[j * b.w + i] = color
}

function dot(b: Px, x: number, y: number, color: number) {
  if (x >= 0 && y >= 0 && x < b.w && y < b.h) b.px[y * b.w + x] = color
}

function blitGrid(b: Px, g: Grid, x: number, y: number, role: string, dim = false) {
  for (let r = 0; r < g.length; r++) {
    const line = g[r] ?? []
    for (let c = 0; c < line.length; c++) {
      const col = colorOf(line[c] ?? '.', role)
      if (col === undefined) continue
      const i = x + c, j = y + r
      if (i < 0 || j < 0 || i >= b.w || j >= b.h) continue
      b.px[j * b.w + i] = dim ? mix(col, b.px[j * b.w + i] ?? col, 0.5) : col
    }
  }
}

function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t)
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

function room(b: Px, L: Layout, hour: number, now: number) {
  const H = L.wall * 2
  // 바닥: 나무 판자
  for (let y = H; y < b.h; y++)
    for (let x = 0; x < b.w; x++) {
      const plank = Math.floor((y - H) / 3)
      const seamX = (x + (plank % 2) * 8) % 16 === 0
      b.px[y * b.w + x] = (y - H) % 3 === 2 || seamX ? C.seam : C.floor
    }
  // 벽 · 창문 · 걸레받이
  fill(b, 0, 0, b.w, H, C.wall)
  fill(b, 0, 0, b.w, 1, C.molding)
  fill(b, 0, H - 1, b.w, 1, C.base)
  const isNight = hour < 6 || hour >= 19
  for (let x = 8; x + 10 < b.w - SHELF_W - 2; x += 26) {
    if (L.wall < WALL) {
      // 촘촘한 벽: 얇은 창문 띠 (유리 한 줄)
      fill(b, x, 1, 10, 2, C.frame)
      fill(b, x + 1, 1, 8, 1, isNight ? C.night : C.day)
      fill(b, x + 5, 1, 1, 1, C.frame)
      continue
    }
    fill(b, x, 1, 10, 4, C.frame)
    fill(b, x + 1, 2, 8, 2, isNight ? C.night : C.day)
    fill(b, x + 5, 2, 1, 2, C.frame)
    if (isNight && (Math.floor(now / 900) + x) % 3 === 0) b.px[2 * b.w + x + 2] = C.star
  }
}

// 걷는 길의 발 높이 픽셀. 0 = 큰 복도(왼쪽 문 · 가운데 팀장 · 오른쪽 책장이 다 여기에 붙어 있음),
// k(1~) = k번째 직원 줄 아래 좁은 통로
const aisleFoot = (L: Layout, k: number) => (k === 0 ? L.top * 2 - 1 : (L.top + CH * (k - 1) + 8) * 2 + 1)
const standY = (L: Layout, k: number) => aisleFoot(L, k) - 11 // 그 길에 선 사람의 머리 꼭대기
const seatedY = (s: Seat) => s.row * 2 + 2
const deskBottom = (s: Seat) => s.row * 2 + 13
const rowOf = (L: Layout, s: Seat) => (s.key === 'main' ? 0 : Math.round((s.row - L.top) / CH) + 1) // 0 = 팀장 줄
const DOOR_X = -10 // 문 밖

/** 의자 (늘 맨 뒤에 깐다) */
function chair(b: Px, s: Seat) {
  const X = s.col, Y = s.row * 2
  if (s.key === 'main') fill(b, X + 1, Y + 12, CW - 2, 4, C.rug)
  fill(b, X + 3, Y + 6, 6, 6, C.chair)
}

/** 앉은 사람 + 작은 책상 (앞뒤 순서 하나로 묶어 그린다) */
function seatUnit(b: Px, s: Seat, now: number, frame: number, present: boolean, reading: boolean, tired?: number) {
  const X = s.col, Y = s.row * 2
  const w = s.worker
  if (present && w) {
    const kind = reading ? 'read' : kindOf(w.status, w.tool)
    const blink = (Math.floor(now / 250) + (hash(s.key) % 17)) % 17 === 0
    // 생김새(모자 · 소품)는 역할로, 옷 · 머리 색은 자리로 (QA 1팀 · 2팀이 서로 달라 보이게)
    blitGrid(b, figure(s.role, kind, frame, false, blink), X + 1, Y + 2, s.pick ?? s.key)
    if (kind === 'coffee') {
      fill(b, X + 9, Y + 9, 2, 2, C.mug)
      dot(b, X + 10 - (frame % 2), Y + 7 - (frame % 2), C.steam)
    }
  }
  // 작은 책상 8칸 (양옆이 통로)
  fill(b, X + 2, Y + 10, 8, 1, C.deskTop)
  fill(b, X + 2, Y + 11, 8, 2, C.deskFront)
  fill(b, X + 2, Y + 13, 8, 1, C.deskEdge)
  // 책상 앞 아래 줄: 피로도 막대 (8칸, 찬 만큼 색)
  if (present && tired !== undefined) {
    const n = Math.max(1, Math.round((Math.min(100, tired) / 100) * 8))
    for (let i = 0; i < 8; i++) dot(b, X + 2 + i, Y + 13, i < n ? tiredColor(tired) : 0x4a3a2a)
  }
  // 팀 자리: 책상 앞에 팀원마다 작은 점 (끝 초록 · 일하는 중 노랑 깜빡 · 못 끝냄 빨강 · 그 밖 회색)
  if (s.team && s.members) {
    s.members.slice(-4).forEach((st, i) => {
      const c = st === 'done' || st === 'idle' ? 0x3fa66b : st === 'unfinished' ? 0xc9423a
        : st === 'off' || st === 'desk' ? 0x868e96 : frame % 2 ? 0xfcc419 : 0x8a6d0b
      dot(b, X + 3 + i * 2, Y + 12, c)
    })
  }
  // 노트북 뒷면 — 일하는 중이면 불빛이 깜빡
  const isWorking = present && !!w && (w.status === 'work' || w.status === 'think')
  fill(b, X + 6, Y + 8, 3, 2, C.lid)
  fill(b, X + 5, Y + 10, 4, 1, C.lidBase)
  dot(b, X + 7, Y + 8, isWorking ? (frame % 2 ? C.glow : C.white) : C.dark)
}

/** 책장: 스킬 = 책. 꺼내 간 책 자리는 비어 있다. */
const SHELF_H = 17
const shelfTop = (L: Layout) => (L.wall < WALL ? 1 : 3) // 촘촘한 윗부분이면 두 픽셀 위로 (크기 · 칸은 그대로)
function shelf(b: Px, x: number, top: number, out: Set<number>) {
  const h = SHELF_H
  fill(b, x, top, SHELF_W, h, C.wood)
  const SPINES = [0xc2410c, 0x1971c2, 0x2f9e44, 0xe8590c, 0x7048e8, 0xd6336c, 0x0c8599, 0xf59f00]
  for (let shelfNo = 0; shelfNo < 3; shelfNo++) {
    const y = top + 1 + shelfNo * 5
    fill(b, x + 1, y, SHELF_W - 2, 4, 0x4a2f1b) // 칸 안쪽 그늘
    for (let i = 0; i < SHELF_W - 2; i++) {
      const slot = shelfNo * 16 + i
      if (out.has(slot)) continue
      const tall = 3 + ((i * 7 + shelfNo) % 2)
      fill(b, x + 1 + i, y + 4 - tall, 1, tall, SPINES[(i + shelfNo * 3) % SPINES.length]!)
    }
  }
}

const slotOf = (book: string) => (hash(book) % 3) * 16 + (hash(book + '#') % (SHELF_W - 2))

/** 출입문 (왼쪽 벽). 나가는 사람은 문 뒤로 사라진다. */
function door(b: Px, L: Layout) {
  const y0 = standY(L, 0) - 2
  fill(b, 0, y0, 3, aisleFoot(L, 0) - y0 + 1, 0x2b211a)
  fill(b, 2, y0, 1, aisleFoot(L, 0) - y0 + 1, C.wood)
  fill(b, 0, y0, 3, 1, C.wood)
  dot(b, 1, y0 + 7, 0xfcc419) // 손잡이
}

function paperAt(b: Px, x: number, y: number) {
  fill(b, Math.round(x), Math.round(y), 3, 2, C.paper)
  dot(b, Math.round(x) + 1, Math.round(y) + 1, C.ring)
}

function bookAt(b: Px, x: number, y: number, color: number) {
  fill(b, Math.round(x), Math.round(y), 2, 3, color)
  dot(b, Math.round(x) + 1, Math.round(y), C.page)
}

/** 놓친 일 서류: 바닥에 떨어진 종이 한 장 (흰 종이 + 빨간 줄 + 그림자) */
function lostPaper(b: Px, x: number, y: number) {
  fill(b, x, y + 2, 4, 1, 0x7a5a3a) // 그림자
  fill(b, x, y, 4, 2, C.paper)
  dot(b, x + 1, y, 0xd64541)
  dot(b, x + 2, y + 1, 0xd64541)
}

export type PaperSpot = { p: Paper; x: number; y: number; k: number } // x · y: 1배 픽셀 (y = 종이 윗줄), k: 그 길(0 = 큰 복도)

/** 서류가 떨어진 곳: 그 일을 맡았던 자리 바로 위 통로 바닥 (자리가 없으면 · 팀장 것이면 팀장 책상 왼쪽 큰 복도) */
export function paperSpots(o: Office, L: Layout): PaperSpot[] {
  const lead = L.seats[0]
  if (!lead) return []
  const n = new Map<string, number>()
  return (o.papers ?? []).map(p => {
    const s = p.who === 'main' ? undefined
      : L.seats.find(x => x.key !== 'main' && (x.ids?.includes(p.who) || x.worker?.id === p.who)) ?? L.seats.find(x => x.key !== 'main' && (x.pick ?? x.key) === p.unit)
    const at = s ?? lead
    const i = n.get(at.key) ?? 0
    n.set(at.key, i + 1)
    if (!s) return { p, x: Math.max(LEFT, lead.col - 6 - i * 5), y: aisleFoot(L, 0) - 3, k: 0 }
    const k = rowOf(L, s) - 1
    return { p, x: s.col + 7 - i * 5, y: aisleFoot(L, k) - 3, k }
  })
}

const TRIP_MS = 6000 // 서류 들고 팀장에게 갔다 오기
const ASSIGN_MS = 1300 // 일 맡길 때 서류가 날아가는 시간
const SHELF_MS = 7500 // 책장에 가서 책 꺼내 오기
const READ_MS = 4000 // 돌아와 자리에서 그 책을 펴 읽기
const ARRIVE_MS = 3500 // 문으로 들어와 자리에 앉기
const LEAVE_MS = 3500 // 자리에서 일어나 문으로 퇴근
const BOSS_MS = 8000 // 사장님이 문으로 들어와 팀장에게 지시서를 건네고 나가기

/** 사장님 지시가 들어온 직후: 사장님이 복도를 걸어 팀장 책상 앞까지 와서 지시서를 건네고 돌아간다 */
function bossOf(o: Office, L: Layout, now: number): Motion | undefined {
  const age = o.promptAt === undefined ? -1 : now - o.promptAt
  if (age < 0 || age >= BOSS_MS) return undefined
  const lead = L.seats[0]!
  const pts = [{ x: DOOR_X, y: standY(L, 0) }, { x: lead.col - 3, y: standY(L, 0) }]
  const t = age / BOSS_MS
  if (t < 0.4) return { pts, p: ease(t / 0.4), carry: 'paper' }
  if (t < 0.6) return { pts, p: 1, give: ease((t - 0.4) / 0.2) }
  return { pts, p: 1 - ease((t - 0.6) / 0.4) }
}

type Pt = { x: number; y: number }

function lengthOf(pts: Pt[]): number {
  let n = 0
  for (let i = 1; i < pts.length; i++) n += Math.abs(pts[i]!.x - pts[i - 1]!.x) + Math.abs(pts[i]!.y - pts[i - 1]!.y)
  return n
}

/** 길 위의 한 점 (d: 출발점에서 걸은 거리) */
function pointAt(pts: Pt[], d: number): Pt {
  let left = d
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!
    const seg = Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
    if (left <= seg) {
      const q = seg ? left / seg : 0
      return { x: a.x + (b.x - a.x) * q, y: a.y + (b.y - a.y) * q }
    }
    left -= seg
  }
  return pts[pts.length - 1]!
}

const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u))

/** 자리에서 큰 복도(문 · 팀장 · 책장 줄)의 x 까지 걷는 길. 꺾어서 가고 책상을 뚫고 지나가지 않는다. */
function toHall(L: Layout, s: Seat, x: number): Pt[] {
  const start = { x: s.col + 1, y: seatedY(s) }
  const k = rowOf(L, s)
  if (k === 0) {
    // 팀장: 책상 옆으로 비켜 나와 → 앞 복도로
    const side = { x: s.col + CW - 1, y: start.y }
    return [start, side, { x: side.x, y: standY(L, 0) }, { x, y: standY(L, 0) }]
  }
  // 직원: 의자 뒤 통로로 물러나 → (뒷줄이면 왼쪽 끝 길로 올라가) → 큰 복도
  const up = { x: start.x, y: standY(L, k - 1) }
  const pts = [start, up]
  if (k > 1) pts.push({ x: LEFT - 3, y: up.y }, { x: LEFT - 3, y: standY(L, 0) })
  pts.push({ x, y: standY(L, 0) })
  return pts
}

type Motion = { pts: Pt[]; p: number; carry?: 'paper' | 'book'; book?: string; give?: number }

/** 지금 이 자리 사람이 걷는 중이면 어디쯤인지. gone = 퇴근해서 자리에 없음. who 를 주면 그 사람으로 (자리에서 나가는 앞사람) */
function motionOf(o: Office, L: Layout, s: Seat, now: number, who?: Worker): { m?: Motion; gone: boolean } {
  const w = who ?? s.worker
  if (!w) return { gone: false }
  const lead = L.seats[0]!
  const id = s.key === 'main' ? 'main' : w.id
  // 1) 서류 보고: 팀장 옆까지 → 건네고 → 돌아옴
  const h = s.key === 'main' ? undefined : [...o.handoffs].reverse().find(x => x.from === w.id)
  const hAge = h ? now - h.at : -1
  if (h && hAge >= 0 && hAge < TRIP_MS) {
    const pts = toHall(L, s, lead.col + 6) // 팀장 책상 바로 앞(조금 오른쪽)에 선다
    const t = hAge / TRIP_MS
    if (t < 0.4) return { m: { pts, p: ease(t / 0.4), carry: 'paper' }, gone: false }
    if (t < 0.6) return { m: { pts, p: 1, give: ease((t - 0.4) / 0.2) }, gone: false }
    return { m: { pts, p: 1 - ease((t - 0.6) / 0.4) }, gone: false }
  }
  // 2) 퇴근: 보고 다녀온 뒤 문으로 (다시 불리면 새로 출근)
  if (w.ended !== undefined && s.key !== 'main') {
    const leaveAt = w.ended + (h && h.at >= w.ended - 1000 ? TRIP_MS : 0) + 1500
    const lAge = now - leaveAt
    if (lAge >= LEAVE_MS) return { gone: true }
    if (lAge >= 0) return { m: { pts: toHall(L, s, DOOR_X), p: ease(lAge / LEAVE_MS) }, gone: false }
  }
  if (who) return { gone: false } // 나가는 앞사람: 책장 · 출근 걸음은 자리 주인 몫
  // 놓친 일 서류: 팀장이 그 자리 근처로 걸어가 줍고 → 자리로 돌아온다 (그 뒤 자리에서 읽음)
  if (s.key === 'main') {
    const got = paperSpots(o, L).find(x => x.p.picked !== undefined && now - x.p.picked >= 0 && now - x.p.picked < PICK_WALK_MS)
    if (got) {
      const tx = got.x - 3
      const pts = got.k === 0 ? toHall(L, s, tx) : [...toHall(L, s, LEFT - 3), { x: LEFT - 3, y: standY(L, got.k) }, { x: tx, y: standY(L, got.k) }]
      const t = (now - got.p.picked!) / PICK_WALK_MS
      if (t < 0.45) return { m: { pts, p: ease(t / 0.45) }, gone: false }
      if (t < 0.55) return { m: { pts, p: 1, carry: t > 0.5 ? 'paper' : undefined }, gone: false }
      return { m: { pts, p: 1 - ease((t - 0.55) / 0.45), carry: 'paper' }, gone: false }
    }
  }
  // 3) 책장: 스킬을 쓰면 책장에 가서 그 책을 꺼내 와 읽는다
  const sh = [...(o.shelf ?? [])].reverse().find(x => x.who === id)
  const sAge = sh ? now - sh.at : -1
  if (sh && sAge >= 0 && sAge < SHELF_MS) {
    const pts = toHall(L, s, L.shelfX + 2)
    const t = sAge / SHELF_MS
    if (t < 0.4) return { m: { pts, p: ease(t / 0.4) }, gone: false }
    if (t < 0.55) return { m: { pts, p: 1, carry: t > 0.48 ? 'book' : undefined, book: sh.book }, gone: false }
    return { m: { pts, p: 1 - ease((t - 0.55) / 0.45), carry: 'book', book: sh.book }, gone: false }
  }
  // 4) 출근: 문으로 들어와 자리에 앉는다
  if (s.key !== 'main') {
    const aAge = now - w.started
    if (aAge >= 0 && aAge < ARRIVE_MS) return { m: { pts: toHall(L, s, DOOR_X), p: 1 - ease(aAge / ARRIVE_MS) }, gone: false }
  }
  return { gone: false }
}

/** 자리를 이어받힌 앞사람들의 걸음: 서류 보고 → 문으로 퇴근을 끝까지 (퇴근 전 잠깐 서 있는 동안은 자리 옆에 선 채로) */
export function leavingOf(o: Office, L: Layout, s: Seat, now: number): { w: Worker; m: Motion }[] {
  const out: { w: Worker; m: Motion }[] = []
  for (const w of s.leaving ?? []) {
    if (w.ended === undefined) continue
    const r = motionOf(o, L, s, now, w)
    if (r.gone) continue
    out.push({ w, m: r.m ?? { pts: toHall(L, s, DOOR_X), p: 0 } })
  }
  return out
}

/** 퇴근해서 자리에 없는가 (이름표 · 말풍선을 끄려고) */
export function isGone(o: Office, L: Layout, key: string, now: number): boolean {
  const s = L.seats.find(x => x.key === key)
  return !!s && motionOf(o, L, s, now).gone
}

/** 지금 무언가 움직이는 중인가 (그럴 때만 그림을 자주 바꾼다) */
export function isMoving(o: Office, now: number): boolean {
  const near = (at: number | undefined, ms: number) => at !== undefined && now - at >= 0 && now - at < ms
  return near(o.promptAt, BOSS_MS) || o.handoffs.some(h => near(h.at, TRIP_MS)) || o.assigns.some(a => near(a.at, ASSIGN_MS)) ||
    (o.shelf ?? []).some(x => near(x.at, SHELF_MS)) || (o.papers ?? []).some(p => near(p.picked, PICK_MS)) ||
    o.workers.some(w => near(w.started, ARRIVE_MS) || (w.ended !== undefined && now - w.ended < TRIP_MS + 1500 + LEAVE_MS))
}

/** 피로도 막대 색 (쌩쌩 초록 · 하품 노랑 · 피곤 주황 · 녹초 빨강) */
const tiredColor = (p: number) => (p < 40 ? 0x3fa66b : p < 70 ? 0xe0b23a : p < 90 ? 0xe07a3a : 0xc9423a)

/** fills: 자리 key → 피로도 % (직원마다 따로: 그 직원 대화가 얼마나 찼는지) */
export function draw(o: Office, L: Layout, now: number, hour: number, fills: Record<string, number> = {}): Uint32Array {
  const b: Px = { w: L.cols, h: L.rows * 2, px: new Uint32Array(L.cols * L.rows * 2) }
  const frame = Math.floor(now / 350)
  room(b, L, hour, now)
  const lead = L.seats[0]
  if (!lead) return b.px

  const moves = new Map<string, Motion>()
  const gone = new Set<string>()
  const taken = new Set<number>()
  for (const s of L.seats) {
    const r = motionOf(o, L, s, now)
    if (r.m) moves.set(s.key, r.m)
    if (r.gone) gone.add(s.key)
  }
  // 꺼내 간 책은 책장에서 빈칸
  for (const x of o.shelf ?? []) if (now - x.at >= SHELF_MS * 0.46 && now - x.at < SHELF_MS + READ_MS) taken.add(slotOf(x.book))
  // 책을 들고 돌아온 사람은 잠깐 자리에서 그 책을 읽는다
  const readers = new Set((o.shelf ?? []).filter(x => now - x.at >= SHELF_MS && now - x.at < SHELF_MS + READ_MS).map(x => x.who))
  // 주워 온 서류는 자리에서 펴 본다
  if ((o.papers ?? []).some(p => p.picked !== undefined && now - p.picked >= PICK_WALK_MS && now - p.picked < PICK_MS + 1500)) readers.add('main')

  // 앞뒤 순서: 의자는 맨 뒤, 그다음 발이 위(멀리)에 있는 것부터 그린다 → 앞에 있는 게 뒤에 있는 걸 가린다
  // 같은 일을 나란히 하는 직원(twin): 청록 깔개 하나 위에 같은 책상 · 같은 옷 (묶음 표시)
  // 역할별 섬: 섬 하나에 짙은 깔개 하나 (자리들이 한 책상 섬으로 묶여 보이게). 같은 일 청록 깔개는 그 위에
  for (const g of L.isles ?? []) {
    if (g.keys.length < 2 || g.other) continue
    fill(b, g.col, g.row * 2 + 8, g.w, 8, 0x8a6440)
    fill(b, g.col + 1, g.row * 2 + 9, g.w - 2, 6, 0xa57d52)
  }
  for (const s of L.seats) {
    if (s.kind !== 'twin') continue
    const next = L.seats.find(x => x.kind === 'twin' && x.pick === s.pick && x.row === s.row && x.col > s.col)
    const end = next ? next.col + 1 : s.col + CW - 1
    fill(b, s.col + 1, s.row * 2 + 9, end - s.col, 6, 0x2f8f83)
    fill(b, s.col + 1, s.row * 2 + 10, end - s.col, 4, 0x5fb3a6)
  }
  for (const s of L.seats) chair(b, s)
  type Thing = { foot: number; paint: () => void }
  const st = shelfTop(L)
  const things: Thing[] = [{ foot: st + SHELF_H, paint: () => shelf(b, L.shelfX, st, taken) }]
  // 걷는 사람 하나 그리기 (직원 · 팀장 · 사장님 같이 씀). key 로 옷 색, role 로 소품
  const walker = (m: Motion, role: string, key: string) => {
    const len = lengthOf(m.pts)
    const at = pointAt(m.pts, m.p * len)
    const walking = m.p > 0.001 && m.p < 0.999
    const step = Math.floor((m.p * len) / 3) // 걸은 거리에 맞춰 발을 번갈아 (미끄러지지 않게)
    const x = Math.round(at.x)
    const y = Math.round(at.y) - (walking && step % 2 ? 1 : 0) // 걸음마다 살짝 들썩
    things.push({
      foot: Math.round(at.y) + 11,
      paint: () => {
        const holding = m.carry !== undefined || m.give !== undefined
        blitGrid(b, figure(role, holding ? 'give' : 'stand', walking ? step : frame, walking, false), x, y, key)
        if (m.carry === 'paper') paperAt(b, x + 3, y + 7)
        if (m.carry === 'book') bookAt(b, x + 4, y + 6, 0xc2410c)
        if (m.give !== undefined) {
          // 서류를 팀장 책상 위로 건넨다
          const q = m.give
          paperAt(b, x + 3 + (lead.col + 6 - x - 3) * q, y + 7 + (lead.row * 2 + 9 - y - 7) * q)
        }
      },
    })
  }
  // 놓친 일 서류: 바닥에 (팀장이 주워 들기 전까지). 지나가는 사람이 위에 그려지게 발 높이 = 종이 줄
  for (const x of paperSpots(o, L)) {
    if (x.p.picked !== undefined && now - x.p.picked >= PICK_WALK_MS * 0.5) continue
    things.push({ foot: x.y + 2, paint: () => lostPaper(b, x.x, x.y) })
  }
  const boss = bossOf(o, L, now)
  if (boss) walker(boss, '사장님', '사장님')
  for (const s of L.seats) {
    const w = s.worker
    const present = !!w && !moves.has(s.key) && !gone.has(s.key) && w.status !== 'off' && !(s.key === 'main' && w.status === 'desk')
    const reading = !!w && readers.has(s.key === 'main' ? 'main' : w.id)
    things.push({ foot: deskBottom(s), paint: () => seatUnit(b, s, now, frame, present, reading, fills[s.key]) })
    const m = moves.get(s.key)
    if (m) walker(m, s.role, s.pick ?? s.key)
    for (const x of leavingOf(o, L, s, now)) walker(x.m, s.role, s.pick ?? s.key)
  }
  things.push({ foot: aisleFoot(L, 0) + 1, paint: () => door(b, L) }) // 문은 복도 사람보다 앞
  things.sort((a, c) => a.foot - c.foot)
  for (const t of things) t.paint()

  // 일 맡기기: 팀장 책상 → 직원 책상으로 서류가 포물선을 그리며 날아간다 (맨 위)
  for (const a of o.assigns) {
    const age = now - a.at
    if (age < 0 || age >= ASSIGN_MS) continue
    const w = o.workers.find(x => x.id === a.to)
    const s = w && (L.seats.find(x => x.ids?.includes(w.id)) ?? L.seats.find(x => x.key === L.keyOf(w)))
    if (!s) continue
    const q = ease(age / ASSIGN_MS)
    const x0 = lead.col + 5, y0 = lead.row * 2 + 9
    const x1 = s.col + 5, y1 = s.row * 2 + 9
    paperAt(b, x0 + (x1 - x0) * q, y0 + (y1 - y0) * q - Math.sin(q * Math.PI) * 8)
  }
  return b.px
}

/** 픽셀 → Raster cells (base64). 칸마다 '▀' 위색/아래색. */
export function encode(px: Uint32Array, cols: number, rows: number): string {
  const words = new Uint32Array(cols * rows * 3)
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = (r * cols + c) * 3
      words[i] = 0x2580
      words[i + 1] = (px[(r * 2) * cols + c] ?? 0) & 0xffffff
      words[i + 2] = (px[(r * 2 + 1) * cols + c] ?? 0) & 0xffffff
    }
  // toBase64 는 실행 환경에 있다 (RasterProps 예시) — TS 기본 lib 에만 아직 없다
  return (new Uint8Array(words.buffer) as Uint8Array & { toBase64(): string }).toBase64()
}
