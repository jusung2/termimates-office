// 일어난 일 → 사무실 상태 (순수 함수). 실제 훅과 시연(/termimates 시연)이 같은 함수를 쓴다:
// 시연 장면이 실제로 일할 때와 똑같이 보이도록.

import type { Fill, Office, Paper, Power, Review, TodoMark, Tok, Worker } from '../types'
import { plus, sum } from './power'
import { skillRole } from './skills'
import {
  actionText, clip, doneText, familyOf, isChecker, isPartner, jobOf, memberOf, personaOf, reasonOf, roleOf, teamOf, tierOfModel, title,
  verdictOf,
} from './words'

/** 그 직원의 짧은 한글 역할 */
export const jobOfW = (w: Worker): string => w.job ?? title(w.role)

/** 그 직원의 생김새용 기본 역할 (이름이 뭐든) */
export const familyOfW = (w: Worker): string => w.family ?? familyOf(w.role, w.task)

/** 이름표에 쓰는 자리 이름 (「QA 1팀」 · 「리서처」) */
export const nameOf = (w: Worker): string => (w.team ? `${jobOfW(w)} ${w.team}팀` : jobOfW(w))

/** 사무실 한 자리 = 한 명 또는 한 팀. QA 3팀 × 3명이면 9명이 아니라 팀마다 한 자리(세 자리). 같은 역할 · 같은 팀이면 같은 자리.
 *  파트장(다른 직원)이 부른 직원은 파트장 아래 따로 (「개발자 · 개발자 파트」 — 파트장과 같은 역할이어도 안 섞인다) */
export const unitOf = (w: Worker): string => (w.part ? `${nameOf(w)} · ${w.part} 파트` : nameOf(w))

export const fresh = (id: string, role: string, now: number): Worker => ({
  id, role, task: '', status: 'desk', action: '출근 전', since: now, started: now, background: false, recent: [],
})

export const EMPTY: Office = {
  lead: fresh('main', 'main', 0), workers: [], handoffs: [], assigns: [], skillUses: {},
}

export function log(w: Worker, at: number, text: string): Worker {
  return { ...w, recent: [[at, clip(text, 120)] as [number, string], ...w.recent].slice(0, 15) }
}

export function set(w: Worker, status: Worker['status'], action: string, at: number, tool?: string, target?: string): Worker {
  const changed = status !== w.status || action !== w.action
  return { ...w, status, action, since: changed ? at : w.since, tool: status === 'work' ? tool : undefined,
    target: status === 'work' ? target : undefined }
}

export function withWorker(o: Office, id: string, now: number, fn: (w: Worker) => Worker): Office {
  if (id === 'main') return { ...o, lead: fn(o.lead) }
  const has = o.workers.some(w => w.id === id)
  const base = has ? o.workers : [...o.workers, fresh(id, 'general-purpose', now)]
  return { ...o, workers: base.map(w => (w.id === id ? fn(w) : w)) }
}

export function running(o: Office): Worker[] {
  return o.workers.filter(w => w.ended === undefined && !w.teammate)
}

export function leadWaitOrRest(o: Office, now: number, rest: [Worker['status'], string]): Office {
  const r = running(o)
  if (r.length) {
    const names = [...new Set(r.map(unitOf))].slice(0, 3).join(', ')
    return { ...o, lead: set(o.lead, 'wait_report', `${names} 보고 기다리는 중 (${r.length}명)`, now) }
  }
  return { ...o, lead: set(o.lead, rest[0], rest[1], now) }
}

/** 출근(세션 시작) */
export function onStart(o: Office, now: number): Office {
  return o.lead.status === 'desk' || o.lead.status === 'off'
    ? { ...o, lead: log(set(o.lead, 'ask', '출근, 사장님 지시 기다리는 중', now), now, '출근') }
    : o
}

/** 사장님 지시 */
export function onPrompt(o: Office, text: string, now: number): Office {
  return {
    ...o, prompt: clip(text, 60), promptAt: now,
    lead: log(set(o.lead, 'think', '사장님 지시를 읽고 생각하는 중', now), now, `사장님 지시: 「${clip(text, 60)}」`),
  }
}

/** 사장님 확인(허락 · 질문)을 기다리기 시작 — 그 사람이 손을 든다 */
export function onWait(o: Office, who: string, what: string, now: number, id?: string): Office {
  const out = withWorker(o, who, now, w => set(w, 'ask', `사장님 확인 기다리는 중: ${clip(what, 40)}`, now))
  return { ...out, waiting: { at: now, who, what: clip(what, 60), id } }
}

/** 확인이 끝남 (허락 · 거절 · 답) */
export function onWaitEnd(o: Office, now: number): Office {
  if (!o.waiting) return o
  const who = o.waiting.who
  const out = withWorker(o, who, now, w => (w.status === 'ask' ? set(w, 'think', '확인 받고 이어서 하는 중', now) : w))
  return { ...out, waiting: undefined }
}

/** 이 종류의 에이전트 이름표를 바꿈 (이미 출근한 직원도 바로) */
export function onRename(o: Office, type: string, name: string): Office {
  return { ...o, workers: o.workers.map(w => (w.role === type ? { ...w, job: name } : w)) }
}

/** 팀장이 할 일 목록을 적음 (TodoWrite 는 통째로, TaskCreate 는 한 줄 더하기) — 웹 화이트보드에 보인다 */
export function onTodos(o: Office, tool: string, input: Record<string, unknown>): Office {
  if (tool === 'TodoWrite' && Array.isArray(input.todos)) {
    const todos = (input.todos as Record<string, unknown>[]).slice(0, 12).map(t => ({
      text: clip(String(t.content ?? t.subject ?? ''), 40),
      state: (t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'doing' : 'todo') as 'todo' | 'doing' | 'done',
    }))
    return { ...o, todos }
  }
  if (tool === 'TaskCreate' && typeof input.subject === 'string') {
    return { ...o, todos: [...(o.todos ?? []), { text: clip(input.subject, 40), state: 'todo' as const }].slice(-12) }
  }
  return o
}

/** 사장님이 사무실에서 말을 걺 (who: 'main' 또는 직원 id) — 받은 사람의 '한 일' 에 남긴다 */
export function onTalk(o: Office, who: string, text: string, now: number): Office {
  return withWorker(o, who, now, w => log(w, now, `사장님이 말 걺: 「${clip(text, 60)}」`))
}

/** 책을 꺼내러 갈 사람 (who: 스킬을 쓴 쪽).
 *  직원(서브에이전트)이 썼으면 실제로 그 AI 가 읽으니 그 직원. 팀장 · 사장님이 썼으면 그 스킬 담당 역할 직원이
 *  사무실에 있으면 그 직원, 담당이 팀장이거나 그 역할 직원이 없으면 팀장. */
export function readerOf(o: Office, who: string, book: string, description?: string): string {
  if (who !== 'main') return who
  const role = skillRole(book, description)
  if (role === '팀장') return 'main'
  const w = [...o.workers].reverse().find(x => x.ended === undefined && !x.teammate && familyOfW(x) === role)
  return w ? w.id : 'main'
}

/** 스킬 = 책장에서 책 꺼내 와 읽기. 장면은 그림 쪽이 정해진 길이로 보여 준다 */
export function toShelf(o: Office, who: string, book: string, now: number): Office {
  return { ...o, shelf: [...(o.shelf ?? []), { at: now, who, book }].slice(-20) }
}

/** 한 차례 시작 (who: 'main' 또는 직원 id) */
export function onTurnStart(o: Office, who: string, now: number): Office {
  return withWorker(o, who, now, w =>
    w.status === 'work' ? w : set(w, 'think', who !== 'main' ? '일을 받아 시작하는 중' : '생각하는 중', now))
}

/** 도구를 쓰기 시작 */
export function onToolStart(o: Office, who: string, tool: string, target: string | undefined, sub: string | undefined,
  now: number): Office {
  if (tool === 'Skill') o = toShelf(o, readerOf(o, who, target ?? ''), target ?? '', now)
  return tool === 'SubagentHandback'
    ? withWorker(o, who, now, w => set(w, 'handoff', '팀장에게 서류 넘기는 중', now))
    : withWorker(o, who, now, w => set(w, 'work', actionText(tool, target, sub), now, tool, target))
}

/** 도구가 끝남 (실패면 errText) */
export function onToolEnd(o: Office, who: string, tool: string, target: string | undefined, sub: string | undefined,
  failed: boolean, errText: string | undefined, now: number): Office {
  let out = withWorker(o, who, now, w => log(w, now, (failed ? '실패: ' : '') + doneText(tool, target, sub)))
  if (who === 'main' && (tool === 'Agent' || tool === 'Task')) {
    return leadWaitOrRest(out, now, ['think', '다음 할 일 생각하는 중'])
  }
  out = withWorker(out, who, now, w => {
    if (w.status !== 'work' || w.tool !== tool) return w
    const next2 = set(w, 'think', failed ? '실패를 보고 다시 생각하는 중' : '다음 할 일 생각하는 중', now)
    return failed ? { ...next2, error: clip(errText ?? '실패', 120) } : next2
  })
  return out
}

export type Spawn = {
  id: string
  type: string
  name?: string
  description: string
  background: boolean
  teammate?: boolean
  parentAgentId?: string
  prompt?: string // 맡긴 일 본문 앞부분 (역할 · 팀 번호 · 페르소나를 찾는 데만 씀, 저장하지 않음)
  model?: string // 일하는 모델 (agent.spawn 결과의 model — 엔진이 정한 진짜 모델 id)
}

/** 직급 · 페르소나: roles.json 에 사용자가 정한 게 있으면 그걸, 없으면 모델 이름 · 맡긴 일에서 */
function roleBadge(s: Spawn): Pick<Worker, 'model' | 'tier' | 'persona'> {
  const own = roleOf(s.type)
  const model = own?.model ?? s.model
  const tier = own?.model ? tierOfModel(own.model) : isPartner(s.type, s.name) ? 'partner' : tierOfModel(s.model)
  return { model, tier, persona: own?.persona ?? personaOf(`${s.description} ${(s.prompt ?? '').slice(0, 300)}`) }
}

/** 검사 직원이 볼 서류를 만든 직원 짐작: 같은 부모(팀장 또는 같은 직원)가 맡긴 일 중, 검사 직원이 아닌 직원이
 *  이 검사 직원이 출근하기 직전에 가장 늦게 끝낸 일. 끝난 일이 없으면 모름 (애매하면 안 짐작) */
export function guessTarget(o: Office, s: Spawn): string | undefined {
  // 이번 사장님 지시 안에서 일한 직원만 (지난 지시 때 끝난 직원은 이 검사와 상관없음)
  const from = o.promptAt ?? 0
  const done = o.workers.filter(w => w.id !== s.id && !w.checker && !w.teammate && w.parent === s.parentAgentId &&
    w.started >= from && w.ended !== undefined && w.status === 'done')
  return done.sort((a, b) => (b.ended ?? 0) - (a.ended ?? 0))[0]?.id
}

/** 직원 입사(일 맡김) */
export function onSpawn(o: Office, s: Spawn, now: number): Office {
  const had = o.workers.find(w => w.id === s.id)
  const checker = isChecker(s.type, `${s.description} ${s.name ?? ''}`)
  const w0: Worker = had ?? { ...fresh(s.id, s.type, now), status: 'think', action: '일을 받아 시작하는 중' }
  const text = `${s.description} ${s.name ?? ''} ${(s.prompt ?? '').slice(0, 300)}`
  const w = log({ ...w0, role: s.type, name: s.name, task: s.description, background: s.background,
    teammate: s.teammate === true, started: had?.started ?? now,
    job: jobOf(s.type, text), family: familyOf(s.type, text), team: teamOf(text), member: memberOf(text),
    parent: s.parentAgentId, checker: checker || undefined, reviewOf: checker ? had?.reviewOf ?? guessTarget(o, s) : undefined,
    ...roleBadge(s) }, now, `출근: ${s.description}`)
  // 층: 다른 직원이 불렀으면 그 직원(의 맨 위 파트장) 자리를 적어 둔다
  const boss = s.parentAgentId ? o.workers.find(x => x.id === s.parentAgentId && x.id !== s.id) : undefined
  if (boss) w.part = boss.part ?? unitOf(boss)
  const workers = had ? o.workers.map(x => (x.id === s.id ? w : x)) : [...o.workers, w]
  let lead = o.lead
  if (!s.parentAgentId) {
    lead = log(lead, now, `${unitOf(w)}에게 일 맡김: ${s.description}`)
    if (!s.background) lead = set(lead, 'wait_report', `${unitOf(w)} 보고 기다리는 중`, now)
  }
  return { ...o, workers, lead, assigns: [...o.assigns, { at: now, to: s.id }].slice(-30) }
}

/** 검사 결과 한 줄 (사무실 소식 · 보고서 · 카드에 같이 씀) */
export function reviewLine(r: Pick<Review, 'unit' | 'verdict' | 'reason' | 'nth'>): string {
  const what = r.unit ? `${r.unit} 서류` : '서류'
  if (r.verdict === 'pass') return `검토: ${what} 통과 ✓`
  if (r.verdict === 'reject') return `검토: ${what} 반려 ✗${r.nth && r.nth > 1 ? ` (${r.nth}번째)` : ''}${r.reason ? ` — ${r.reason}` : ''}`
  return `검토 끝: ${what}`
}

/** 검사 직원이 끝남 → 마지막 글에서 통과 / 반려를 뽑아 남긴다. 반려 횟수는 이번 일(사장님 지시 뒤)에서 같은 자리 일을 센다 */
function addReview(o: Office, w: Worker, answer: string, now: number): { o: Office; line: string } {
  const target = w.reviewOf ? o.workers.find(x => x.id === w.reviewOf) : undefined
  const unit = target ? unitOf(target) : undefined
  const verdict = verdictOf(answer)
  const from = o.promptAt ?? 0
  const nth = verdict === 'reject'
    ? (o.reviews ?? []).filter(r => r.verdict === 'reject' && r.at >= from && r.unit === unit).length + 1 : undefined
  const r: Review = { at: now, by: w.id, of: target?.id, unit, verdict, reason: verdict === 'reject' ? reasonOf(answer) : undefined, nth }
  return { o: { ...o, reviews: [...(o.reviews ?? []), r].slice(-20) }, line: reviewLine(r) }
}

/** 한 차례 끝 (id 없으면 팀장) */
export function onComplete(o: Office, id: string | undefined, answer: string, aborted: boolean, now: number): Office {
  if (id) {
    const w = o.workers.find(x => x.id === id)
    if (!w) return o
    const paper = clip(answer, 200)
    const done: Worker = w.teammate
      ? set({ ...w, handback: paper || w.handback }, 'idle', '일 끝, 다음 일 기다리는 중', now)
      : { ...set({ ...w, handback: paper || w.handback }, aborted ? 'unfinished' : 'done', aborted ? '멈춤' : '보고 완료', now),
        ended: now }
    let out: Office = { ...o, workers: o.workers.map(x => (x.id === id ? log(done, now, '보고 완료') : x)) }
    if (w.checker && !aborted) {
      const rv = addReview(out, w, answer, now)
      out = withWorker(rv.o, id, now, x => log(x, now, rv.line))
    }
    if (paper) out = { ...out, handoffs: [...out.handoffs, { at: now, from: id, preview: paper }].slice(-30) }
    out = { ...out, lead: log(out.lead, now, `${unitOf(w)}${w.member ? ` ${w.member}` : ''}의 서류 받음`) }
    if (out.lead.status === 'wait_report') out = leadWaitOrRest(out, now, ['think', '직원 보고를 받는 중'])
    return out
  }
  const said = clip(answer, 200)
  const out = { ...o, said: said || o.said, lead: log(o.lead, now, '한 차례 마침') }
  return aborted
    ? { ...out, lead: set(out.lead, 'ask', '사장님이 멈춰서 기다리는 중', now) }
    : leadWaitOrRest(out, now, ['idle', '일 끝, 쉬는 중'])
}

/** 한 차례가 쓴 토큰을 이번 일 · 세션 · 직원 몫 · 오늘에 더한다 (저장소는 따로) */
export function addUsage(p: Power, id: string, t: Tok, day: string, fill?: Fill): Power {
  const n = sum(t)
  return {
    ...p, job: plus(p.job, t), session: plus(p.session, t), byWorker: { ...p.byWorker, [id]: plus(p.byWorker[id], t) },
    day, mine: (p.day === day ? p.mine : 0) + n, today: (p.day === day ? p.today : 0) + n,
    jobBy: { ...(p.jobBy ?? {}), [id]: plus(p.jobBy?.[id], t) },
    lead: id === 'main' && fill ? fill : p.lead,
    workers: id !== 'main' && fill ? { ...p.workers, [id]: fill } : p.workers,
  }
}

// -- 자리 접기 · 층 · 반복 (웹 · 터미널이 같은 규칙을 쓴다) ------------------------------------------
// 「같은 규칙, 다른 문턱」: 자리가 모자라면 ① 나란히 펼친 같은 일 직원을 한 자리로 → ② 같은 직군 자리를 「리서처 ×4」 한 자리로
// (사람 많은 직군부터 하나씩) → ③ 그래도 넘치면 「+n명」 한 자리. 문턱(앉을 수 있는 자리 수)만 웹 · 터미널이 따로 정한다.

/** 한 자리(unitOf) 요약 */
export type UnitInfo = {
  key: string; name: string; family: string; worker: Worker; list: Worker[]; active: Worker[]; team: boolean
  present: Worker[] // 자리에 있는 사람: 일하는 중 + 막 끝나 보고 · 퇴근 걸음 중인 사람 (나란히 자리가 그동안 안 없어지게)
  desk: boolean // 모두 검사 직원이라 웹에선 심사대에 앉는다 (원래 자리를 따로 안 만든다)
  boss?: string // 이 자리 직원을 부른 파트장 자리 (팀장이 불렀으면 없음)
  kids: number // 파트장이면 그 아래에서 일한 사람 수
  loop: number // ⟳ 반복 횟수 (반려 · 같은 일을 다시 맡김). 없으면 0
  leaving: Worker[] // 막 끝나 나가는 중인데 이 자리 대표가 아닌 사람 (새 사람이 자리를 이어받음 등). 자리 그림과 따로 끝까지 걸어 나간다
  before: Record<string, Worker[]> // 나란히 자리 이어받기: 지금 그 자리 사람 id → 그 자리에서 막 나가는 중인 앞사람들
}

/** 화면 한 자리에 그릴 것: 한 자리 · 나란히 앉은 같은 일 한 사람(twin) · 접은 직군(fold) · 「+n명」(more) */
export type Spot = {
  key: string // 화면에서 고유한 자리 이름
  pick: string // 누르면 고를 것 (자리 key · 「fold:리서처」 · 「__more」)
  kind: 'unit' | 'twin' | 'fold' | 'more'
  units: string[] // 이 자리에 든 자리(unitOf) 들
  label: string // 이름표 (unit 은 자리 이름 — 파트 이름은 빼고. ×n 은 그리는 쪽이 붙인다)
  family: string // 생김새
  people: number // 이 자리에 든 사람 수
  who?: string // twin: 그 사람 id
  leaving?: string[] // 이 자리에서 나가는 중인 사람 id (자리를 이어받은 새 사람과 따로 문까지 걸어 나간다)
}

const STATUS_ORDER: Worker['status'][] = ['handoff', 'work', 'think', 'ask', 'wait_report', 'unfinished', 'done', 'idle', 'off', 'desk']
const TWIN_MAX = 6 // 같은 일 직원을 나란히 펼치는 최대 수 (더 많으면 처음부터 한 자리)
export const LINGER_MS = 15000 // 끝난 뒤 자리를 지켜 두는 시간 (서류 보고 → 문으로 퇴근 걸음이 끝날 때까지, 웹 · 터미널 다 넉넉히)

/** 웹 심사대에 앉는 검사 직원: 이번 지시의 검사 직원 (office.js reviewersOf 와 같은 규칙) */
export const atDesk = (o: Office, w: Worker): boolean =>
  !!w.checker && !w.teammate && (w.ended === undefined || w.started >= (o.promptAt ?? 0) - 1000)

/** 사무실 자리 요약 (처음 출근한 순서). 팀원(teammate)도 자리에 앉는 지금 그림과 같게 모두 넣는다.
 *  now 를 주면 막 끝난 사람도 퇴근 걸음이 끝날 때까지 자리에 있는 것으로 센다 (present) */
export function unitsOf(o: Office, now?: number): UnitInfo[] {
  const byKey = new Map<string, Worker[]>()
  for (const w of o.workers) byKey.set(unitOf(w), [...(byKey.get(unitOf(w)) ?? []), w])
  const from = o.promptAt ?? 0
  const out: UnitInfo[] = []
  for (const [key, list] of byKey) {
    const active = list.filter(w => w.ended === undefined)
    const pool = active.length ? active : list
    const worker = [...pool].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || b.since - a.since)[0]!
    // 파트장 아래 자리면 그 파트장 자리 (같은 자리 사람은 다 같은 파트장), 파트장이면 그 아래 사람 수
    const boss = worker.part
    const kids = o.workers.filter(w => w.part === key).length
    const rejects = (o.reviews ?? []).filter(r => r.verdict === 'reject' && r.at >= from && r.unit === key).length
    // 다시 맡김: 같은 설명의 앞 사람이 끝난 뒤에 또 맡긴 일만 (동시에 여럿 맡긴 병렬은 반복이 아님)
    const again = list.filter(w => w.started >= from && w.task &&
      list.some(x => x !== w && x.task === w.task && x.started >= from && x.ended !== undefined && x.ended <= w.started)).length
    // 나란히 자리 번호: 출근 순으로 앉히되, 이미 끝난 사람 자리가 있으면 새 사람이 그 자리에 이어 앉는다.
    // 그래서 끝난 사람이 퇴근해 자리가 빠져도 일하던 사람의 자리 번호는 안 바뀐다 (15초 뒤 한 칸씩 순간이동하지 않게)
    // 이어받은 자리의 앞사람은 before 에 적어 둔다: 새 사람이 앉아도 앞사람은 퇴근 걸음을 끝까지 걷는다 (갑자기 사라지지 않게)
    const slots: Worker[] = []
    const prev = new Map<string, Worker[]>()
    for (const w of [...list].sort((a, b) => a.started - b.started)) {
      const i = slots.findIndex(x => x.ended !== undefined && x.ended <= w.started)
      if (i >= 0) {
        prev.set(w.id, [slots[i]!, ...(prev.get(slots[i]!.id) ?? [])])
        slots[i] = w
      } else slots.push(w)
    }
    const fresh = (w: Worker) => now !== undefined && w.ended !== undefined && now - w.ended < LINGER_MS
    const present = now === undefined ? slots.filter(w => w.ended === undefined) : slots.filter(w => w.ended === undefined || fresh(w))
    const before: Record<string, Worker[]> = {}
    for (const [id, ws] of prev) if (ws.some(fresh)) before[id] = ws.filter(fresh)
    out.push({ key, name: nameOf(worker), family: familyOfW(worker), worker, list, active, present, desk: list.every(w => atDesk(o, w)),
      team: list.some(w => w.team), boss, kids, loop: Math.max(rejects, again), leaving: list.filter(w => w !== worker && fresh(w)), before })
  }
  return out
}

/** 웹 사무실 스냅샷의 자리 몫 (register.tsx writeSnap · 시험 · 미리보기가 같이 쓴다).
 *  steps = 접기 단계 (터미널과 같은 규칙 — 웹은 자기 문턱으로 고르기만). part = 파트장 아래 직원 (파트장 순서대로, 웹은 그 아래 한 줄을 더한다).
 *  심사대에 앉는 검사 직원 자리는 steps 에 안 넣는다 (심사대 한 곳에만 보이게, 카드는 units 로) */
export function webSeats(o: Office, now?: number) {
  const info = unitsOf(o, now)
  // 심사대에 가 있는 검사 직원은 웹 자리 계산에서 뺀다 (같은 자리에 검사 아닌 직원이 같이 있어도 — 빈 나란히 자리를 차지하지 않게)
  const off = (w: Worker) => atDesk(o, w)
  const seat = info.map(u => {
    const present = u.present.filter(w => !off(w)), active = u.active.filter(w => !off(w))
    const rep = off(u.worker) ? active[0] ?? u.list.filter(w => !off(w)).pop() ?? u.worker : u.worker
    // 심사대 직원은 심사대 장면이 퇴근까지 따로 그린다
    const before = Object.fromEntries(Object.entries(u.before).map(([k, ws]) => [k, ws.filter(w => !off(w))]))
    return { ...u, present, active, worker: rep, leaving: u.leaving.filter(w => !off(w) && w !== rep), before }
  })
  const units = seat.map(u => ({
    key: u.key, job: jobOfW(u.worker), family: u.family, worker: u.worker.id, count: u.active.length, team: u.team,
    members: u.list.map(w => ({ id: w.id, member: w.member, status: w.status })),
    boss: u.boss, kids: u.kids || undefined, loop: u.loop || undefined,
  }))
  const tops = seat.filter(u => !u.boss && !u.desk)
  const kids = tops.flatMap(t => seat.filter(u => u.boss === t.key && !u.desk))
  return { units, steps: { main: foldSteps(tops), part: foldSteps(kids) } }
}

/** 접기 단계들: 0 = 다 펼침, 뒤로 갈수록 덜 자리를 쓴다. 고르는 건 fold() */
export function foldSteps(units: (Pick<UnitInfo, 'key' | 'family' | 'list' | 'active' | 'team'> &
  { name?: string; present?: Worker[]; leaving?: Worker[]; before?: Record<string, Worker[]> })[]): Spot[][] {
  const people = (u: (typeof units)[number]) => u.active.length || u.list.length
  const ids = (ws: Worker[] | undefined) => (ws?.length ? { leaving: ws.map(w => w.id) } : {})
  const one = (u: (typeof units)[number]): Spot =>
    ({ key: u.key, pick: u.key, kind: 'unit', units: [u.key], label: u.name ?? u.key, family: u.family, people: people(u), ...ids(u.leaving) })
  const steps: Spot[][] = []
  // 나란히 자리: 일하는 사람 + 막 끝나 퇴근 걸음 중인 사람 (한 명 끝났다고 그 자리가 바로 사라져 뒤 자리가 당겨지지 않게)
  const here = (u: (typeof units)[number]) => u.present ?? u.active
  const twins = (u: (typeof units)[number]) => !u.team && here(u).length >= 2 && here(u).length <= TWIN_MAX
  if (units.some(twins)) {
    steps.push(units.flatMap(u => (twins(u)
      ? here(u).map((w, i): Spot => ({ key: `${u.key}#${i + 1}`, pick: u.key, kind: 'twin', units: [u.key], label: `${u.name ?? u.key} ${i + 1}/${here(u).length}`,
        family: u.family, people: 1, who: w.id, ...ids(u.before?.[w.id]) }))
      : [one(u)])))
  }
  let cur = units.map(one)
  steps.push(cur)
  // 같은 직군 자리가 둘 이상이면 접을 수 있다. 자리 많은 직군부터 (같으면 먼저 온 직군)
  const fams = [...new Set(cur.map(s => s.family))].filter(f => cur.filter(s => s.family === f).length >= 2)
  fams.sort((a, b) => cur.filter(s => s.family === b).length - cur.filter(s => s.family === a).length)
  for (const f of fams) {
    const mine = cur.filter(s => s.family === f)
    const n = mine.reduce((acc, s) => acc + s.people, 0)
    const at = cur.indexOf(mine[0]!)
    const gone = mine.flatMap(s => s.leaving ?? [])
    const merged: Spot = { key: `fold:${f}`, pick: `fold:${f}`, kind: 'fold', units: mine.flatMap(s => s.units), label: `${f} ×${n}`, family: f, people: n,
      ...(gone.length ? { leaving: gone } : {}) }
    cur = [...cur.slice(0, at), merged, ...cur.slice(at).filter(s => s.family !== f)]
    steps.push(cur)
  }
  return steps
}

/** 앉을 수 있는 자리 수(max)에 맞는 단계. 접어도 넘치면 앞 max-1 자리 + 「+n명」 */
export function fold(steps: Spot[][], max: number): Spot[] {
  const m = Math.max(1, Math.floor(max))
  const fit = steps.find(s => s.length <= m)
  if (fit) return fit
  const last = steps[steps.length - 1] ?? []
  const keep = last.slice(0, m - 1), rest = last.slice(m - 1)
  const n = rest.reduce((acc, s) => acc + s.people, 0)
  return [...keep, { key: '__more', pick: '__more', kind: 'more', units: rest.flatMap(s => s.units), label: `+${n}명`, family: '', people: n }]
}

// -- 화이트보드 칸반 ---------------------------------------------------------------------------
// 이번 일(사장님 지시 뒤)에 맡긴 일을 단계 칸(대기 · 진행 · 완료 · 반려)에 놓는다. 맡긴 일 낱말에 단계(기획 · 개발 · 검사)가 있거나
// 검사 결과가 있을 때만 — 단계를 모르면 없음 (화이트보드는 지금 할 일 목록 그대로).
const STAGE_WORDS: [RegExp, string][] = [
  [/기획|계획|설계|\bplan|\bspec\b|architect/i, '기획'],
  [/검사|검토|검수|리뷰|테스트|\bqa\b|\breview|\btest|\bverif/i, '검사'],
  [/개발|구현|고치|수정|만들|\bimplement|\bbuild|\bfix\b/i, '개발'],
]
export const stageWord = (task: string): string | undefined => STAGE_WORDS.find(([re]) => re.test(task))?.[1]

export type BoardCol = { name: '대기' | '진행' | '완료' | '반려'; cards: { text: string; loop?: number }[] }

export function boardOf(o: Office): BoardCol[] | undefined {
  const from = o.promptAt ?? 0
  const ws = o.workers.filter(w => w.started >= from && !w.teammate)
  const rvs = (o.reviews ?? []).filter(r => r.at >= from)
  if (ws.length < 2 || !(rvs.length || ws.some(w => stageWord(w.task)))) return undefined
  const cols: BoardCol[] = [{ name: '대기', cards: [] }, { name: '진행', cards: [] }, { name: '완료', cards: [] }, { name: '반려', cards: [] }]
  const col = (n: BoardCol['name']) => cols.find(c => c.name === n)!
  for (const t of o.todos ?? []) if (t.state === 'todo') col('대기').cards.push({ text: t.text })
  for (const w of ws) {
    const text = clip(`${stageWord(w.task) ? `${stageWord(w.task)}·` : ''}${w.task || unitOf(w)}`, 24)
    const last = [...rvs].reverse().find(r => r.of === w.id)
    // 반려 뒤 같은 자리의 이어지는 일이 통과했으면 이 카드는 끝난 이야기 → 반려 칸에서 뺀다
    const passedLater = last?.verdict === 'reject' && rvs.some(r => r.verdict === 'pass' && r.at > last.at && r.unit === unitOf(w))
    if (passedLater) continue
    if (last?.verdict === 'reject') col('반려').cards.push({ text, loop: last.nth })
    else if (w.status === 'unfinished') col('반려').cards.push({ text: `${text} (못 끝냄)` })
    else if (w.ended !== undefined) col('완료').cards.push({ text })
    else col('진행').cards.push({ text })
  }
  return cols
}

// -- 놓친 일 서류 -------------------------------------------------------------------------------
// 짐작 없이 흔적 있는 것만: ① 차례가 끝났는데 그 사람이 적은 할 일 목록(TodoWrite · TaskCreate)에 안 끝난 줄
// ② 사장님이 「했어?」 류로 물은 차례의 답에 「놓쳤 · 깜빡 · 빠뜨렸 · 아직 안 했 · 못 했」 ③ 직원이 중단됨.
// 「오래 조용함」 · 번호 대조 같은 짐작은 안 한다. 시연 · 다시 보기는 이 함수들을 안 부른다 (실제 훅만).

/** 팀장이 서류를 주우러 갔다 와서 확인하는 시간 (그 뒤 입력창에 문장). 걷기는 앞 PICK_WALK_MS, 나머지는 자리에서 읽기 */
export const PICK_MS = 7000
export const PICK_WALK_MS = 5600
const MAX_PAPERS = 12

const markState = (st: unknown): TodoMark['state'] => (st === 'completed' ? 'done' : st === 'in_progress' ? 'doing' : 'todo')

/** 끝난 줄의 서류는 치운다 (나중에 그 줄이 완료되면 서류도 사라짐) */
function sweep(o: Office): Office {
  if (!o.papers?.length) return o
  const done = new Set((o.marks ?? []).filter(m => m.state === 'done').map(m => m.key))
  const papers = o.papers.filter(p => !p.ref || !done.has(p.ref))
  return papers.length === o.papers.length ? o : { ...o, papers }
}

/** 할 일 도구 호출의 흔적 (who: 'main' 또는 직원 id). TodoWrite = 그 사람 목록 통째로, TaskCreate = 결과의 id 로 한 줄,
 *  TaskUpdate = id 로 상태 바꿈 (deleted 면 그 줄 · 서류 없앰). result 는 도구가 돌려준 것 (TaskCreate 의 task.id) */
export function onTodoMarks(o: Office, who: string, tool: string, input: Record<string, unknown>, result?: unknown): Office {
  let marks = o.marks ?? []
  if (tool === 'TodoWrite' && Array.isArray(input.todos)) {
    const mine = (input.todos as Record<string, unknown>[]).slice(0, 30).map((t): TodoMark => {
      const text = clip(String(t.content ?? t.subject ?? ''), 60)
      return { key: `todo:${who}:${text}`, who, text, state: markState(t.status) }
    }).filter(m => m.text)
    marks = [...marks.filter(m => !(m.who === who && m.key.startsWith('todo:'))), ...mine]
  } else if (tool === 'TaskCreate') {
    const id = (result as { task?: { id?: unknown } } | undefined)?.task?.id
    const text = clip(String(input.subject ?? ''), 60)
    if (id === undefined || !text) return o
    marks = [...marks.filter(m => m.key !== `task:${id}`), { key: `task:${id}`, who, text, state: 'todo' }]
  } else if (tool === 'TaskUpdate' && input.taskId !== undefined) {
    const key = `task:${String(input.taskId)}`
    if (input.status === 'deleted') {
      return { ...o, marks: marks.filter(m => m.key !== key), papers: (o.papers ?? []).filter(p => p.ref !== key) }
    }
    marks = marks.map(m => (m.key !== key ? m : {
      ...m, state: input.status ? markState(input.status) : m.state, text: typeof input.subject === 'string' ? clip(input.subject, 60) : m.text,
    }))
  } else return o
  return sweep({ ...o, marks: marks.slice(-60) })
}

/** 「했어?」 · 「확인했어?」 · 「다 됐어?」 류 물음 */
export const isAsk = (text: string): boolean =>
  /(했어|했나요|했니|했냐|했지|했어요|했습니까|됐어|됐나요|됐니|봤어|봤나요|돌렸어|돌렸나요|넣었어|고쳤어|끝났어|끝냈어)\s*[?？]|(했|됐|봤|돌렸|넣었|고쳤|끝냈)(는지|나)\s*(확인|말해|알려)|\b(did you|have you)\b.*\?/i.test(text)

const MISS = /놓쳤|놓친\s*(게|것|일|부분)\s*(있|이 있)|깜빡|빠뜨렸|빠트렸|빼먹었|누락(했|됐|되었)|아직\s*안\s*했|아직\s*못\s*했|못\s*했(어|습니다|네|어요)|못했(어|습니다|네|어요)/
const NOT_MISSED = /(놓친|빠뜨린|빠트린|빼먹은|누락된|못 한|못한)\s*(건|게|것|일|부분)[은는이가]?\s*없/

/** 답에서 놓친 일을 말한 문장 하나 (짧게). 없으면 undefined. 「놓친 건 없어요」 는 아님 */
export function missedIn(answer: string): string | undefined {
  for (const raw of answer.split(/(?<=[.!?。])\s+|\n+/)) {
    const line = raw.replace(/^[\s>*\-•·\d.)]+/, '').trim()
    if (!line || !MISS.test(line) || NOT_MISSED.test(line)) continue
    // 「죄송해요, 」 같은 앞말은 빼고 짧게
    return clip(line.replace(/^(죄송(해요|합니다)|미안(해요|합니다)|앗|아|네|사실)[,.!\s]*/, ''), 48)
  }
  return undefined
}

const WHY: Record<Paper['why'], string> = { todo: '할 일 목록에 안 끝난 줄', said: '답에 「놓쳤다」', abort: '중단됨' }

/** 서류 한 장 떨어뜨림 (같은 줄의 안 주운 서류가 있으면 또 안 만든다). 사무실 소식(팀장 한 일)에도 한 줄 */
function drop(o: Office, now: number, p: Omit<Paper, 'id' | 'at'>): Office {
  if (p.ref && (o.papers ?? []).some(x => x.ref === p.ref && !x.picked)) return o
  if (!p.ref && (o.papers ?? []).some(x => !x.picked && x.who === p.who && x.why === p.why && x.text === p.text)) return o
  const id = `p${now.toString(36)}${(o.papers ?? []).length}`
  const paper: Paper = { id, at: now, ...p }
  const where = p.who === 'main' ? '팀장 자리' : `${p.unit} 자리`
  return { ...o, papers: [...(o.papers ?? []), paper].slice(-MAX_PAPERS),
    lead: log(o.lead, now, `📄 놓친 일 서류: 「${clip(p.text, 40)}」 — ${where} (${WHY[p.why]})`) }
}

/** 차례가 끝남 (id 없으면 팀장): ① 그 사람 할 일 목록의 안 끝난 줄 ② (팀장) 물음의 답에 「깜빡」 류 ③ 직원 중단 → 서류.
 *  onComplete 다음에 부른다 (실제 훅만 — 시연은 안 부름) */
export function onMissed(o: Office, id: string | undefined, answer: string, aborted: boolean, now: number): Office {
  const who = id ?? 'main'
  const w = id ? o.workers.find(x => x.id === id) : undefined
  if (id && !w) return o
  const unit = w ? unitOf(w) : '팀장'
  let out = o
  for (const m of o.marks ?? []) if (m.who === who && m.state !== 'done') out = drop(out, now, { who, unit, why: 'todo', text: m.text, ref: m.key })
  if (!id && o.asked) {
    const said = missedIn(answer)
    if (said) out = drop(out, now, { who, unit, why: 'said', text: said })
    out = { ...out, asked: false }
  }
  if (w && aborted && !w.teammate) out = drop(out, now, { who, unit, why: 'abort', text: clip(w.task || unitOf(w), 48) })
  return out
}

/** 팀장이 서류를 주우러 감 (이미 주우러 갔으면 그대로) */
export function pickPaper(o: Office, id: string, now: number): Office {
  const p = (o.papers ?? []).find(x => x.id === id)
  if (!p || p.picked !== undefined) return o
  return { ...o, papers: (o.papers ?? []).map(x => (x.id === id ? { ...x, picked: now } : x)),
    lead: log(set(o.lead, 'work', '놓친 일 서류 주우러 가는 중', now, 'Read', '놓친 일 서류'), now, `📄 놓친 일 서류 주움: 「${clip(p.text, 40)}」`) }
}

/** 다시 확인을 넘겼으면 서류를 치운다. back = 못 넘겨서 바닥에 도로 둠 */
export function donePaper(o: Office, id: string, now: number, back = false): Office {
  const papers = back ? (o.papers ?? []).map(x => (x.id === id ? { ...x, picked: undefined } : x)) : (o.papers ?? []).filter(x => x.id !== id)
  const lead = o.lead.status === 'work' && o.lead.target === '놓친 일 서류' ? set(o.lead, 'idle', back ? '서류를 도로 놓음' : '놓친 일 다시 확인 문장을 입력창에 넣음', now) : o.lead
  return { ...o, papers, lead }
}

/** 입력창에 넣을 문장 */
export const paperLine = (p: Pick<Paper, 'text'>): string => `놓친 일 다시 확인: ${p.text}`
