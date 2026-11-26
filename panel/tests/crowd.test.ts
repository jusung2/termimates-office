import { expect, mock, test } from 'claude-code/testing'

import { EMPTY, familyOfW, jobOfW, LINGER_MS, onComplete, onMissed, onPrompt, onSpawn, onTodoMarks, onToolStart, onTurnStart, settleIdle, unitOf, unitsOf } from '../hooks/office'
import type { Spawn } from '../hooks/office'
import { tagText } from '../hooks/register'
import { CH, COMPACT_WALL, CW, draw, layout, outOf, paperSpots, plan, TAG_ROW } from '../hooks/scene'
import { jobOf } from '../hooks/words'
import type { Worker } from '../types'

const sp = (id: string, type: string, description: string, x: Partial<Spawn> = {}): Spawn => ({ id, type, description, background: true, ...x })
// 한글 · 한자는 두 칸, 「…」 같은 문장 부호(0x2000~0x2e7f)는 한 칸 (register.tsx dw 와 같은 셈)
const dw = (s: string) => [...s].reduce((n, ch) => { const c = ch.codePointAt(0) ?? 0; return n + (c > 0x1100 && !(c >= 0x2000 && c < 0x2e80) ? 2 : 1) }, 0)

test('이름표 줄이기: 그대로 → 나란히 자리 번호 빼기 → 띄어쓰기 빼기 → 「…」, 언제나 room 안', () => {
  expect(tagText({ name: '디자이너 1/3', kind: 'twin', count: 1 }, 16)).toBe('디자이너 1/3')
  expect(tagText({ name: '디자이너 1/3', kind: 'twin', count: 1 }, 10)).toBe('디자이너') // 「디자이너1/3」 로 붙이지 않음
  expect(tagText({ name: 'designer 1/3', kind: 'twin', count: 1 }, 10)).toBe('designer')
  expect(tagText({ name: '리서처', kind: 'fold', count: 3 }, 10)).toBe('리서처')
  expect(tagText({ name: '개발자', kind: 'unit', count: 2 }, 10)).toBe('개발자 ×2')
  expect(tagText({ name: 'QA 1팀', kind: 'unit', count: 3 }, 8)).toBe('QA1팀×3') // 번호 없는 자리는 띄어쓰기부터
  const long = tagText({ name: 'document-specialist 2/2', kind: 'twin', count: 1 }, 10)
  expect(long.endsWith('…')).toBe(true)
  expect(dw(long)).toBeLessThanOrEqual(10)
})

test('표준 이름(designer · executor)은 플러그인 접두사가 붙어도 쉬운 역할, 예전 규칙으로 저장된 직원도 다시 고름 · 내가 지은 이름은 그대로', () => {
  expect(jobOf('oh-my-claudecode:designer')).toBe('디자이너')
  expect(jobOf('oh-my-claudecode:executor')).toBe('개발자')
  expect(jobOf('my-plugin:verifier')).toBe('QA')
  expect(jobOf('copywriter')).toBe('copywriter')
  // 규칙이 생기기 전에 출근해 job 에 종류 이름 그대로(「designer」) 저장된 직원 (실제 스냅샷: role designer · job designer)
  const old = (role: string, job: string): Worker => ({ id: 'x', role, job, task: '', status: 'idle', action: '', since: 0, started: 0, background: true, recent: [] })
  expect(jobOfW(old('designer', 'designer'))).toBe('디자이너')
  expect(jobOfW(old('executor', 'executor'))).toBe('개발자')
  expect(jobOfW(old('oh-my-claudecode:designer', 'designer'))).toBe('디자이너')
  expect(jobOfW(old('copywriter', 'copywriter'))).toBe('copywriter') // 내가 지은 이름
  expect(jobOfW(old('designer', '시안 담당'))).toBe('시안 담당') // 사용자가 바꾼 이름
})

test('팀원(이름 붙여 부른 에이전트)도 한 차례 끝나면 서류 보고 → 퇴근, 메시지 받아 다시 일하면 다시 출근', () => {
  let o = onPrompt(EMPTY, '시안', 1000)
  for (const n of ['a', 'b', 'c']) o = onSpawn(o, sp(n, 'designer', `시안 ${n}`, { teammate: true, name: `plan-${n}` }), 2000)
  o = onComplete(o, 'a', '시안 완료', false, 5000)
  const a = o.workers.find(w => w.id === 'a')!
  expect(a.status).toBe('done')
  expect(a.ended).toBe(5000)
  // 퇴근 걸음이 끝나면 자리에서 빠진다 (예전엔 몇 시간씩 「쉬는 중」 으로 남음)
  const present = (t: number) => unitsOf(o, t).flatMap(u => u.present.map(w => w.id))
  expect(present(5000 + LINGER_MS + 1000)).toEqual(['b', 'c'])
  // SendMessage 로 다시 깨우면 같은 id 로 차례가 시작 → 다시 출근
  o = onTurnStart(o, 'a', 60000)
  const back = o.workers.find(w => w.id === 'a')!
  expect(back.ended).toBeUndefined()
  expect(back.started).toBe(60000)
  expect(present(60001)).toContain('a')
  o = onComplete(o, 'a', '또 완료', false, 70000)
  o = onToolStart(o, 'a', 'Edit', 'x.ts', undefined, 80000) // 도구부터 와도 다시 출근
  expect(o.workers.find(w => w.id === 'a')!.ended).toBeUndefined()
})

test('예전 규칙으로 저장된 「쉬는 중」 팀원은 다시 불러올 때 퇴근 처리 (일하는 팀원 · 일반 직원은 그대로)', () => {
  const w = (id: string, x: Partial<Worker>): Worker => ({ id, role: 'designer', task: '', status: 'idle', action: '', since: 100, started: 0, background: true, recent: [], ...x })
  const o = { ...EMPTY, workers: [w('t1', { teammate: true }), w('t2', { teammate: true, status: 'work' }), w('s1', { status: 'idle' })] }
  const out = settleIdle(o)
  expect(out.workers.map(x => x.ended)).toEqual([100, undefined, undefined])
  expect(settleIdle(out)).toBe(out)
})

const crowd = (n: number) => {
  const MIX: [string, string][] = [['designer', '시안'], ['designer', '시안'], ['designer', '시안'], ['executor', '구현'], ['executor', '구현'], ['executor', '구현'],
    ['executor', '구현'], ['verifier', '최종 확인'], ['git-master', '커밋 나누기'], ['general-purpose', '개발 3팀 다듬기'], ['Explore', '조사'], ['planner', '계획']]
  let o = onPrompt(EMPTY, '회원가입', 1000)
  MIX.slice(0, n).forEach(([t, d], i) => {
    o = onSpawn(o, sp(`c${i}`, t, d), 2000 + i)
    o = onToolStart(o, `c${i}`, 'Edit', 'a.ts', undefined, 3000)
  })
  return o
}

test('역할별 섬: 한 줄로는 1배뿐이면 같은 역할끼리 섬을 두세 줄로 놓아 1.5배 · 2배, 직원이 적으면 지금 그대로', () => {
  const big = unitsOf(crowd(12), 4000)
  const p = plan(big, 113, 70)
  expect(p.k).toBe(1.5)
  expect(p.isles!.length).toBeGreaterThanOrEqual(2)
  expect(p.isles!.length).toBeLessThanOrEqual(3)
  const isles = p.isles!.flat().map(g => g.isle)
  expect(isles.find(g => g.name === '디자이너')!.people).toBe(3)
  expect(isles.find(g => g.other)!.keys.length).toBeGreaterThanOrEqual(2) // 혼자인 역할(QA · 리서처 · 기획자)은 「기타」 섬
  // 같은 역할은 붙어 앉는다: 섬 안 자리는 한 자리 폭 간격
  const L = layout(crowd(12), 113, unitOf, familyOfW, { spots: p.spots, units: big, k: p.k, isles: p.isles })
  const d = L.isles!.find(g => g.name === '디자이너')!
  expect(L.seats.filter(s => d.keys.includes(s.key)).map(s => s.col - d.col)).toEqual([0, CW, 2 * CW])
  // 섬끼리 · 줄끼리 안 겹친다
  for (const a of L.isles!) for (const b of L.isles!) if (a !== b && a.row === b.row) expect(a.col + a.w <= b.col || b.col + b.w <= a.col).toBe(true)
  expect(outOf(L).rows).toBeLessThanOrEqual(70)
  // 높이가 모자라면 예전처럼 1배
  expect(plan(big, 113, 40).k).toBe(1)
  expect(plan(big, 113, 40).isles).toBeUndefined()
  // 적을 때(2명 · 6명)는 섬 없이 지금 그대로
  for (const n of [2, 6]) {
    const us = unitsOf(crowd(n), 4000)
    for (const [w, r] of [[113, 70], [113, 40], [56, 70], [160, 90]] as const) {
      const q = plan(us, w, r)
      expect(q.isles).toBeUndefined()
    }
  }
  expect(plan(unitsOf(crowd(2), 4000), 113, 70).k).toBe(2)
})

test('역할별 섬 (터미널): 섬 아래 이름표 하나 「디자이너 ×3」, 섬 자리마다의 1/3 이름표는 없음, 「기타」 섬은 각자 이름표 · 이름표끼리 안 겹침', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 10, 24, 5, 0, 0) })
  on('command.register', () => ({ value: { command: 'termimates' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: {} }))
  on('agent.spawn', (_, e) => ({ model: 'claude-sonnet-5-5', agentId: 'a-' + e.tool_use_id }))
  await $.session.start({ cwd: '/work/demo', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: '회원가입', wait: false, origin: { kind: 'composer' } })
  const types = ['designer', 'designer', 'designer', 'executor', 'executor', 'executor', 'executor', 'verifier', 'Explore', 'planner']
  for (const [i, t] of types.entries()) {
    await $.agent.spawn({ tool_use_id: 't' + i, prompt: '일', description: t === 'designer' ? '시안' : t === 'executor' ? '구현' : `일 ${i}`, subagentType: t,
      provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false })
  }
  const ui = await $.ui.mount({ plugin: 'termimates', component: 'Pane', requestId: 'office', surface: 'terminal',
    props: { title: '사무실', isFocused: false, bodyColumns: 113, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} } })
  const btns = await ui.findAll({ type: 'Button' })
  const isle = btns.filter(b => b.key?.startsWith('isle-btn-')).map(b => b.text)
  expect(isle).toContain('디자이너 ×3')
  expect(isle).toContain('개발자 ×4')
  const tags = btns.filter(b => b.key?.startsWith('pick-') && b.key !== 'pick-main').map(b => b.text)
  expect(tags.some(t => /\d\/\d/.test(t))).toBe(false) // 섬 자리의 「디자이너 1/3」 은 안 그림
  expect(tags).toEqual(expect.arrayContaining(['QA', '리서처', '기획자'])) // 기타 섬은 각자
  // 섬 이름표를 누를 때마다 섬 안 자리를 차례로 고른다
  await ui.press({ key: btns.find(b => b.text === '디자이너 ×3')!.key! })
  expect((await ui.findAll({ type: 'Button' })).find(b => b.key?.startsWith('isle-btn-') && b.text === '디자이너 ×3')).toBeDefined()
  await ui.unmount()
})

test('촘촘한 윗부분: 붐벼서 보통 높이로는 섬이 안 들어갈 때만 벽 · 팀장 위쪽을 줄여 1.5배 섬, 들어가면 · 적으면 지금 그대로', () => {
  const lay = (n: number, w: number, r: number) => {
    const o = crowd(n)
    const us = unitsOf(o, 4000)
    const p = plan(us, w, r)
    return { p, L: layout(o, w, unitOf, familyOfW, { spots: p.spots, units: us, k: p.k, isles: p.isles, compact: p.compact }) }
  }
  // 113칸: 10 · 12명은 1.5배 섬이 세 줄 → 보통 윗부분은 66줄, 촘촘하면 62줄부터
  for (const n of [10, 12]) {
    const { p, L } = lay(n, 113, 62)
    expect(p.k).toBe(1.5)
    expect(p.compact).toBe(true)
    expect(p.isles!.length).toBe(3)
    expect(outOf(L).rows).toBeLessThanOrEqual(62)
    expect(L.wall).toBe(COMPACT_WALL)
    expect(L.seats[0]!.row).toBe(0) // 팀장 말풍선 줄이 벽 위
    expect(L.top).toBe(14)
    expect(Math.min(...L.seats.slice(1).map(s => s.row))).toBe(L.top)
    expect(plan(unitsOf(crowd(n), 4000), 113, 61).k).toBe(1) // 그보다 낮으면 예전처럼 1배
  }
  // 섬 두 줄(7명)은 48줄부터 (보통이면 53줄)
  expect(lay(7, 113, 48).p).toMatchObject({ k: 1.5, compact: true })
  // 보통 윗부분으로 들어가면 그대로 (113 × 70 은 10명도 보통)
  for (const n of [10, 12]) {
    const { p, L } = lay(n, 113, 70)
    expect(p.compact).toBeUndefined()
    expect([L.wall, L.top, L.seats[0]!.row]).toEqual([3, 17, 3])
  }
  // 113 × 38 · 40 은 1.5배 섬이 세 줄이라 촘촘해도 안 들어감 → 예전처럼 1배 (윗부분도 그대로)
  for (const r of [38, 40]) {
    const { p, L } = lay(10, 113, r)
    expect(p.k).toBe(1)
    expect(p.compact).toBeUndefined()
    expect([L.wall, L.top]).toEqual([3, 17])
  }
  // 적을 때(2명 · 6명)는 어떤 크기에서도 촘촘하지 않음
  for (const n of [2, 6]) for (const [w, r] of [[113, 38], [113, 40], [113, 70], [56, 70], [160, 90]] as const) {
    const { p, L } = lay(n, w, r)
    expect(p.compact).toBeUndefined()
    expect([L.wall, L.top]).toEqual([3, 17])
  }
  // 섬이 아닌데 compact 만 넘겨도 무시
  const o = crowd(6)
  const us = unitsOf(o, 4000)
  const q = plan(us, 113, 40)
  expect(layout(o, 113, unitOf, familyOfW, { spots: q.spots, units: us, k: q.k, compact: true }).top).toBe(17)
})

test('촘촘한 윗부분에서도 걷는 길 · 서류 · 사람이 겹치지 않음: 복도는 팀장 이름표 아래 ~ 첫 직원 줄 위, 서류는 그 복도 · 통로 바닥', () => {
  let o = crowd(10)
  o = onTodoMarks(o, 'c4', 'TodoWrite', { todos: [{ content: '아이콘', status: 'pending' }] }) // 둘째 섬 줄 개발자
  o = onMissed(o, 'c4', '', false, 5000)
  o = onTodoMarks(o, 'main', 'TodoWrite', { todos: [{ content: 'R', status: 'in_progress' }] })
  o = onMissed(o, undefined, '', false, 5000)
  const us = unitsOf(o, 6000)
  const p = plan(us, 113, 62)
  expect(p.compact).toBe(true)
  const L = layout(o, 113, unitOf, familyOfW, { spots: p.spots, units: us, k: p.k, isles: p.isles, compact: p.compact })
  const lead = L.seats[0]!
  const hallFoot = L.top * 2 - 1, standTop = hallFoot - 11 // 복도에 선 사람 (픽셀)
  expect(standTop).toBeGreaterThanOrEqual((lead.row + TAG_ROW + 1) * 2) // 팀장 이름표 줄을 안 덮는다
  const ps = paperSpots(o, L)
  expect(ps.length).toBe(2)
  const mainPaper = ps.find(x => x.p.who === 'main')!
  expect(mainPaper.k).toBe(0)
  expect(mainPaper.y + 3).toBe(hallFoot) // 큰 복도 바닥 (종이 두 줄 + 그림자 한 줄 바로 아래가 발 높이)
  const seatPaper = ps.find(x => x.p.who === 'c4')!
  const s = L.seats.find(x => x.ids?.includes('c4'))!
  expect(seatPaper.k).toBeGreaterThan(0)
  expect(seatPaper.y).toBeGreaterThanOrEqual((s.row - CH + TAG_ROW) * 2) // 앞줄 이름표 줄부터 (보통 윗부분과 같은 자리)
  expect(seatPaper.y + 3).toBeLessThanOrEqual(s.row * 2 + 2) // 그 자리 사람 머리 위 통로
  // 그림이 그려지고(색 칸이 다 채워짐) 크기는 layout 그대로
  const px = draw({ ...o, promptAt: 5500, handoffs: [{ at: 5800, from: 'c9', preview: '' }], shelf: [{ at: 5500, who: 'c3', book: 'x' }] }, L, 6500, 14)
  expect(px.length).toBe(L.cols * L.rows * 2)
  expect([...px].every(c => c !== 0)).toBe(true)
})

test('촘촘한 윗부분 (패널): 그림 몫이 보통 섬 높이보다 낮아도 1.5배 섬 · 섬 이름표 · 책장 단추가 그대로', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 10, 24, 5, 0, 0) })
  on('command.register', () => ({ value: { command: 'termimates' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: {} }))
  on('agent.spawn', (_, e) => ({ model: 'claude-sonnet-5-5', agentId: 'a-' + e.tool_use_id }))
  await $.session.start({ cwd: '/work/demo', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: '회원가입', wait: false, origin: { kind: 'composer' } })
  const types = ['designer', 'designer', 'designer', 'executor', 'executor', 'executor', 'executor', 'verifier', 'Explore', 'planner']
  for (const [i, t] of types.entries()) {
    await $.agent.spawn({ tool_use_id: 't' + i, prompt: '일', description: t === 'designer' ? '시안' : t === 'executor' ? '구현' : `일 ${i}`, subagentType: t,
      provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false })
  }
  const mount = (rows: number) => $.ui.mount({ plugin: 'termimates', component: 'Pane', requestId: 'office', surface: 'terminal',
    props: { title: '사무실', isFocused: false, bodyColumns: 113, placement: 'dock', scroll: { offset: 0, bodyRows: rows }, view: {} } })
  await (await mount(120)).unmount() // 카드 높이를 한 번 재 둔다 (그림 몫 = 패널 높이 - 위 글줄 - 카드)
  // 패널 89줄: 그림 몫이 62~65줄 → 보통 윗부분 섬(66줄)은 안 들어가고 촘촘한 윗부분으로 61줄
  const ui = await mount(89)
  const [r] = await ui.findAll({ type: 'Raster' })
  expect(r!.props.rows).toBe(61)
  expect(r!.props.columns).toBe(112)
  const btns = await ui.findAll({ type: 'Button' })
  expect(btns.filter(b => b.key?.startsWith('isle-btn-')).map(b => b.text)).toEqual(expect.arrayContaining(['디자이너 ×3', '개발자 ×4']))
  expect(btns.find(b => b.key === 'shelf')?.text).toContain('책장')
  expect(btns.find(b => b.key === 'pick-main')).toBeDefined()
  await ui.unmount()
})
