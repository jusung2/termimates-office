// 일어난 일 → 사무실 상태 (순수 함수). 실제 훅과 시연(/termimates 시연)이 같은 함수를 쓴다:
// 시연 장면이 실제로 일할 때와 똑같이 보이도록.

import type { Fill, Office, Power, Review, Tok, Worker } from '../types'
import { plus, sum } from './power'
import { skillRole } from './skills'
import { actionText, clip, doneText, familyOf, jobOf, memberOf, teamOf, title } from './words'

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
  const had = o.workers.find(w => w.id === s.id)
  const checker = isChecker(s.type, `${s.description} ${s.name ?? ''}`)
  const w0: Worker = had ?? { ...fresh(s.id, s.type, now), status: 'think', action: '일을 받아 시작하는 중' }
  const text = `${s.description} ${s.name ?? ''} ${(s.prompt ?? '').slice(0, 300)}`
  const w = log({ ...w0, role: s.type, name: s.name, task: s.description, background: s.background,
    teammate: s.teammate === true, started: had?.started ?? now,
    job: jobOf(s.type, text), family: familyOf(s.type, text), team: teamOf(text), member: memberOf(text),
    parent: s.parentAgentId, checker: checker || undefined, reviewOf: checker ? had?.reviewOf ?? guessTarget(o, s) : undefined,
    ...roleBadge(s) }, now, `출근: ${s.description}`)
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
