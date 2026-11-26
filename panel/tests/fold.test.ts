import { expect, mock, test } from 'claude-code/testing'

import { STEPS } from '../hooks/demo'

import { boardOf, EMPTY, familyOfW, fold, foldSteps, LINGER_MS, onComplete, webSeats, onPrompt, onSpawn, onToolStart, unitOf, unitsOf } from '../hooks/office'
import type { Spawn } from '../hooks/office'
import { draw, isMoving, layout, leavingOf, outOf, perRowOf, plan, xOf, zoom } from '../hooks/scene'
import { jobOf } from '../hooks/words'
import type { Office } from '../types'

const sp = (id: string, type: string, description: string, x: Partial<Spawn> = {}): Spawn => ({ id, type, description, background: true, ...x })
function build(list: [string, string, string, Partial<Spawn>?][]): Office {
  let o = onPrompt(EMPTY, '회원가입 만들어줘', 1000)
  let t = 2000
  for (const [id, type, d, x] of list) {
    o = onSpawn(o, sp(id, type, d, x), (t += 10))
    o = onToolStart(o, id, 'Edit', 'a.ts', undefined, t)
  }
  return o
}

test('이름표: 플러그인이 깔아 둔 designer · executor 는 쉬운 역할, 내가 지은 copywriter 는 그대로', () => {
  expect(jobOf('designer')).toBe('디자이너')
  expect(jobOf('executor')).toBe('개발자')
  expect(jobOf('critic')).toBe('QA')
  expect(jobOf('copywriter')).toBe('copywriter')
  const o = build([['d1', 'designer', '시안'], ['d2', 'designer', '시안 2'], ['e1', 'executor', '구현']])
  expect(unitsOf(o).map(u => u.key)).toEqual(['디자이너', '개발자']) // 스크린샷의 「designer ×3」 → 「디자이너」
})

test('접기: 넉넉하면 같은 일 직원을 나란히 → 모자라면 한 자리 → 같은 직군 접기 → +n명', () => {
  const o = build([
    ['x1', 'Explore', '조사 1'], ['x2', 'Explore', '조사 2'], ['x3', 'Explore', '조사 3'], ['x4', 'Explore', '조사 4'],
    ['q1', 'general-purpose', 'QA 1팀 1-1'], ['q2', 'general-purpose', 'QA 2팀 2-1'], ['q3', 'general-purpose', 'QA 3팀 3-1'],
    ['p1', 'Plan', '기획'], ['w1', 'copywriter', '문구'],
  ])
  const steps = foldSteps(unitsOf(o))
  expect(steps[0]!.filter(s => s.kind === 'twin').map(s => s.label)).toEqual(['리서처 1/4', '리서처 2/4', '리서처 3/4', '리서처 4/4'])
  expect(fold(steps, 20).length).toBe(9) // 다 펼침: 리서처 4 + QA 3팀 + 기획 + 문구
  expect(fold(steps, 6).map(s => s.label)).toEqual(['리서처', 'QA 1팀', 'QA 2팀', 'QA 3팀', '기획자', 'copywriter']) // 리서처 ×4 한 자리
  expect(fold(steps, 4).map(s => s.label)).toEqual(['리서처', 'QA ×3', '기획자', 'copywriter']) // 팀 셋 → 같은 직군 한 자리
  const tight = fold(steps, 3)
  expect(tight.map(s => s.label)).toEqual(['리서처', 'QA ×3', '+2명']) // 그래도 넘치면 +n
  expect(tight[2]!.units).toEqual(['기획자', 'copywriter'])
  expect(fold(steps, 0).length).toBe(1) // 문턱이 0 이어도 한 자리는
})

test('층: 직원이 부른 직원은 그 파트장 아래 따로 (같은 역할이어도 안 섞임), 터미널은 파트장 자리에 +n 만', () => {
  const o = build([['L1', 'executor', '개발 이끌기'], ['k1', 'executor', '개발 1', { parentAgentId: 'L1' }],
    ['k2', 'executor', '개발 2', { parentAgentId: 'L1' }], ['k3', 'designer', '아이콘', { parentAgentId: 'k1' }], ['p1', 'Plan', '기획']])
  const us = unitsOf(o)
  expect(us.map(u => [u.key, u.boss ?? '', u.kids])).toEqual([
    ['개발자', '', 3], ['개발자 · 개발자 파트', '개발자', 0], ['디자이너 · 개발자 파트', '개발자', 0], ['기획자', '', 0], // 손주도 맨 위 파트장
  ])
  const p = plan(us, 140, 40)
  expect(p.spots.map(s => s.key)).toEqual(['개발자', '기획자'])
  const L = layout(o, 140, unitOf, familyOfW, { spots: p.spots, units: us, k: p.k })
  expect(L.seats.find(s => s.key === '개발자')?.kids).toBe(3)
  expect(foldSteps(us.filter(u => u.boss))[0]!.map(s => s.label)).toEqual(['개발자 1/2', '개발자 2/2', '디자이너']) // 웹 파트 줄 이름표엔 파트 이름 뺌
})

test('반복 ⟳n: 같은 자리 일이 반려된 횟수 (이번 일 안에서)', () => {
  let o = onPrompt(EMPTY, '가입', 1000)
  let t = 2000
  for (let r = 1; r <= 3; r++) {
    o = onSpawn(o, sp('v' + r, 'general-purpose', '가입 코드 구현'), (t += 10))
    o = onComplete(o, 'v' + r, '완료', false, (t += 10))
    o = onSpawn(o, sp('r' + r, 'code-reviewer', '가입 코드 검토'), (t += 10))
    o = onComplete(o, 'r' + r, '반려: 비밀번호 확인 칸 검사 없음', false, (t += 10))
  }
  expect(unitsOf(o).find(u => u.key === '개발자')?.loop).toBe(3)
  const board = boardOf(o)!
  expect(board.map(c => c.name)).toEqual(['대기', '진행', '완료', '반려'])
  expect(board.find(c => c.name === '반려')!.cards.map(c => c.loop)).toEqual([1, 2, 3])
})

test('칸반: 맡긴 일에 단계 낱말이 없고 검사도 없으면 안 그림 (화이트보드는 할 일 목록 그대로)', () => {
  expect(boardOf(build([['a', 'general-purpose', '이것 좀'], ['b', 'general-purpose', '저것 좀']]))).toBeUndefined()
  const kb = boardOf(build([['a', 'general-purpose', '로그인 구현'], ['b', 'general-purpose', '로그인 테스트']]))!
  expect(kb.find(c => c.name === '진행')!.cards.map(c => c.text)).toEqual(['개발·로그인 구현', '검사·로그인 테스트'])
})

test('터미널 크기: 사람이 적고 남으면 2배 → 1.5배, 많거나 낮으면 1배로 줄 수에 맞춰 접기', () => {
  const two = build([['d1', 'designer', '시안'], ['e1', 'executor', '구현']])
  expect(plan(unitsOf(two), 113, 70).k).toBe(2)
  expect(plan(unitsOf(two), 113, 43).k).toBe(1.5) // 2배(52줄)는 안 들어가도 1.5배(39줄)는
  expect(plan(unitsOf(two), 113, 38).k).toBe(1) // 높이가 모자람
  expect(plan(unitsOf(two), 80, 70).k).toBe(1.5) // 반 폭(40)엔 팀장 · 책장이 안 들어가도 80 ÷ 1.5 = 53 은 들어감
  expect(plan(unitsOf(two), 60, 70).k).toBe(1)
  const many = build(Array.from({ length: 14 }, (_, i) => [`w${i}`, ['Explore', 'Plan', 'designer', 'executor', 'copywriter', 'writer', 'git-master'][i % 7]!, `일 ${i} 팀${i}`] as [string, string, string]))
  const p = plan(unitsOf(many), 60, 30)
  expect(p.k).toBe(1)
  expect(p.spots.length).toBeLessThanOrEqual(perRowOf(60)) // 30줄이면 직원 줄 하나
  expect(p.spots.some(s => s.kind === 'fold' || s.kind === 'more')).toBe(true)
})

test('자리 가운데: 직원 둘이면 왼쪽에 몰리지 않고 가운데에 고르게', () => {
  const o = build([['d1', 'designer', '시안'], ['e1', 'executor', '구현']])
  const L = layout(o, 113, unitOf, familyOfW)
  const staff = L.seats.filter(s => s.key !== 'main')
  const mid = (staff[0]!.col + staff[1]!.col + 12) / 2
  expect(Math.abs(mid - L.cols / 2)).toBeLessThanOrEqual(3)
  expect(staff[1]!.col - staff[0]!.col).toBeGreaterThan(12) // 자리 사이를 조금 띄움
})

test('패널: 넓고 높으면 2배 그림 (이름표 · 말풍선 자리도 2배), 좁으면 1배', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 10, 26, 3, 0, 0) })
  on('command.register', () => ({ value: { command: 'termimates' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [{ id: 'office', title: '사무실', isShown: true, isFocused: false, isPlaced: true }] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work/demo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'termimates', args: '시연', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  await clock.advance(STEPS.reduce((n, s) => n + s.wait, 0) + 10)
  const pane = (cols: number, rows: number) => ({
    plugin: 'termimates', component: 'Pane', requestId: 'office', surface: 'terminal',
    props: { title: '사무실', isFocused: false, bodyColumns: cols, placement: 'dock', scroll: { offset: 0, bodyRows: rows }, view: {} },
  }) as const
  let ui = await $.ui.mount(pane(160, 100))
  expect((await ui.find({ type: 'Raster' }))?.props.rows).toBe(52) // 1배 26줄 → 2배
  expect((await ui.find({ key: 'pick-리서처' }))?.text).toBeTruthy() // 회원가입 시연: 조사 직원 자리
  await ui.unmount()
  ui = await $.ui.mount(pane(160, 40))
  expect((await ui.find({ type: 'Raster' }))?.props.rows).toBe(26)
  await ui.unmount()
})

test('1.5배: 자리를 12칸 무늬에 맞춰 두 눈 · 얼굴이 좌우 대칭으로 커진다', () => {
  const o = build([['d1', 'designer', '시안'], ['e1', 'executor', '구현'], ['p1', 'Plan', '기획']])
  const us = unitsOf(o)
  const L = layout(o, 113, unitOf, familyOfW, { spots: foldSteps(us)[0], units: us, k: 1.5 })
  const lead = L.seats[0]!
  for (const s of L.seats) {
    expect((((s.col - lead.col) % 12) + 12) % 12).toBe(0)
    // 눈은 자리 왼쪽에서 4 · 7번째 칸: 둘 다 두 칸
    expect(xOf(L, s.col + 5) - xOf(L, s.col + 4)).toBe(2)
    expect(xOf(L, s.col + 8) - xOf(L, s.col + 7)).toBe(2)
  }
  expect(outOf(L).cols).toBeLessThanOrEqual(113)
  expect(zoom(draw(o, L, 3000, 12), L).length).toBe(outOf(L).cols * outOf(L).rows * 2)
})

test('패널 113 × 60 · 직원 2명 · 팀장 카드: 카드 높이만큼 뺀 그림 몫에 1.5배가 들어간다', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 10, 24, 5, 0, 0) })
  on('command.register', () => ({ value: { command: 'termimates' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: {} }))
  on('agent.spawn', (_, e) => ({ model: 'claude-sonnet-5-5', agentId: 'a-' + e.tool_use_id }))
  await $.session.start({ cwd: '/work/demo', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: '괜찮아 집이랑 똑같이 둘래', wait: false, origin: { kind: 'composer' } })
  for (const [i, t] of ['designer', 'executor'].entries()) {
    await $.agent.spawn({ tool_use_id: 't' + i, prompt: '일', description: `${['시안', '구현'][i]} 맡은 일`, subagentType: t,
      provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false })
  }
  for (let i = 0; i < 8; i++) await $.tool.call({ tool: 'Read', file_path: `/work/demo/f${i}.ts` }) // 팀장 「한 일」 이 넉넉히 쌓임 → 카드엔 4줄만
  const PANE = { plugin: 'termimates', component: 'Pane', requestId: 'office', surface: 'terminal',
    props: { title: '사무실', isFocused: false, bodyColumns: 113, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } } as const
  let ui = await $.ui.mount(PANE) // 처음엔 카드 높이를 몰라 기본 몫
  await ui.unmount()
  ui = await $.ui.mount(PANE) // 지난 카드 높이로
  expect((await ui.find({ type: 'Raster' }))?.props.rows).toBe(39)
  expect((await ui.findAll({ type: 'Text', text: /^ {2}\d\d:\d\d {2}/ })).length).toBeLessThanOrEqual(4)
  await ui.unmount()
})

test('반복 ⟳n 은 앞 사람이 끝난 뒤 다시 맡긴 일만 (같은 설명으로 동시에 여럿 = 병렬, 반복 아님)', () => {
  const par = build([['x1', 'Explore', '자료 조사'], ['x2', 'Explore', '자료 조사'], ['x3', 'Explore', '자료 조사'], ['x4', 'Explore', '자료 조사']])
  expect(unitsOf(par)[0]!.loop).toBe(0)
  let o = onPrompt(EMPTY, '가입', 1000)
  o = onSpawn(o, sp('a', 'general-purpose', '가입 고치기'), 2000)
  o = onComplete(o, 'a', '고쳤어요', false, 3000)
  o = onSpawn(o, sp('b', 'general-purpose', '가입 고치기'), 4000)
  expect(unitsOf(o)[0]!.loop).toBe(1)
})

test('나란히 앉은 직원 하나가 끝나도 퇴근 걸음이 끝날 때까지 자리는 그대로 (뒤 자리가 당겨지지 않게)', () => {
  let o = build([['x1', 'Explore', '조사 1'], ['x2', 'Explore', '조사 2'], ['x3', 'Explore', '조사 3'], ['p1', 'Plan', '기획']])
  const before = foldSteps(unitsOf(o, 5000))[0]!.map(s => s.key)
  o = onComplete(o, 'x2', '찾았어요', false, 6000)
  expect(foldSteps(unitsOf(o, 6500))[0]!.map(s => s.key)).toEqual(before) // 막 끝남: 자리 유지
  expect(foldSteps(unitsOf(o, 6000 + LINGER_MS + 1))[0]!.map(s => s.key)).toEqual(['리서처#1', '리서처#2', '기획자']) // 퇴근 뒤엔 줄어듦
  const L = layout(o, 140, unitOf, familyOfW, { spots: foldSteps(unitsOf(o, 6500))[0], units: unitsOf(o, 6500) })
  expect(L.seats.find(s => s.key === '리서처#2')?.worker?.id).toBe('x2') // 그 자리엔 끝난 그 사람 (보고 · 퇴근 걸음)
})

test('검사 대상 짐작은 이번 사장님 지시 안의 직원만', () => {
  let o = onPrompt(EMPTY, '지난 일', 1000)
  o = onSpawn(o, sp('old', 'general-purpose', '예전 구현'), 2000)
  o = onComplete(o, 'old', '완료', false, 3000)
  o = onPrompt(o, '새 일', 10000)
  o = onSpawn(o, sp('r1', 'code-reviewer', '코드 검토'), 11000)
  expect(o.workers.find(w => w.id === 'r1')?.reviewOf).toBeUndefined()
  o = onSpawn(o, sp('dev', 'general-purpose', '새 구현'), 12000)
  o = onComplete(o, 'dev', '완료', false, 13000)
  o = onSpawn(o, sp('r2', 'code-reviewer', '코드 검토'), 14000)
  expect(o.workers.find(w => w.id === 'r2')?.reviewOf).toBe('dev')
})

test('이름표: 흔한 표준 에이전트 이름과 정확히 같을 때만 쉬운 역할, 내가 지은 이름은 역할 낱말이 들어 있어도 그대로', () => {
  for (const [n, role] of [['designer', '디자이너'], ['executor', '개발자'], ['critic', 'QA'], ['debugger', '개발자'], ['reviewer', 'QA'], ['planner', '기획자'],
    ['researcher', '리서처'], ['tester', 'QA'], ['qa-tester', 'QA'], ['document-specialist', '리서처'], ['oh-my-claudecode:document-specialist', '리서처']]) expect(jobOf(n!)).toBe(role)
  for (const n of ['api-builder', 'backend-dev', 'my-coder', 'code-simplifier', 'spec-writer', 'reviewer-bot', 'ui-designer', 'writer', 'tracer', 'codex', 'docker-helper']) {
    expect(jobOf(n)).toBe(n)
  }
})

test('터미널 이름표: 옆자리와 붙어 있으면 자리 폭보다 두 칸 좁게, 넘치면 나란히 자리 번호 → 띄어쓰기 → 「…」 순으로 줄임', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 10, 24, 5, 0, 0) })
  on('command.register', () => ({ value: { command: 'termimates' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: {} }))
  on('agent.spawn', (_, e) => ({ model: 'claude-sonnet-5-5', agentId: 'a-' + e.tool_use_id }))
  await $.session.start({ cwd: '/work/demo', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: '회원가입', wait: false, origin: { kind: 'composer' } })
  const types = ['Explore', 'designer', 'executor', 'Plan', 'Explore', 'test-engineer', 'executor', 'designer', 'writer', 'Explore', 'code-reviewer', 'executor']
  for (const [i, t] of types.entries()) {
    await $.agent.spawn({ tool_use_id: 't' + i, prompt: '일', description: `일 ${i}`, subagentType: t,
      provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false })
  }
  const ui = await $.ui.mount({ plugin: 'termimates', component: 'Pane', requestId: 'office', surface: 'terminal',
    props: { title: '사무실', isFocused: false, bodyColumns: 113, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } })
  const dw = (s: string) => [...s].reduce((n, ch) => n + ((ch.codePointAt(0) ?? 0) > 0x1100 ? 2 : 1), 0)
  const tags = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('pick-') && b.key !== 'pick-main')
  // 「디자이너 1/2」(12칸)은 10칸에 안 들어감 → 번호를 뺀 「디자이너」 (「디자이너1/2」 처럼 붙여 옆자리와 이어 읽히지 않게)
  expect(tags.some(b => b.text === '디자이너')).toBe(true)
  expect(tags.some(b => /\d\/\d/.test(b.text) && !/ /.test(b.text))).toBe(false)
  for (const b of tags) expect(dw(b.text)).toBeLessThanOrEqual(10)
  await ui.unmount()
})

test('나란히 자리: 끝난 사람 자리에 새 사람이 이어 앉고, 일하던 사람 자리 번호는 안 바뀐다 (15초 뒤 출렁임 없음)', () => {
  // 재현 1: 리서처 a · b 나란히 → a 끝남 → 8초 안에 c 출근 → c 가 a 자리(#1)에, b 는 계속 #2
  let o = onPrompt(EMPTY, '조사', 1000)
  o = onSpawn(o, sp('a', 'Explore', '조사 a'), 2000)
  o = onSpawn(o, sp('b', 'Explore', '조사 b'), 2100)
  o = onComplete(o, 'a', '찾음', false, 10000)
  o = onSpawn(o, sp('c', 'Explore', '조사 c'), 17000)
  const who = (t: number) => foldSteps(unitsOf(o, t))[0]!.map(s => s.who)
  expect(who(17500)).toEqual(['c', 'b'])
  expect(who(10000 + LINGER_MS + 5000)).toEqual(['c', 'b']) // a 퇴근이 끝난 뒤에도 그대로
  // 재현 2: 개발자 혼자 끝남 → 4초 뒤 새 개발자 → 두 자리로 안 늘고 그 자리에 이어 앉음
  let p = onPrompt(EMPTY, '개발', 1000)
  p = onSpawn(p, sp('x', 'general-purpose', '구현 1'), 2000)
  p = onComplete(p, 'x', '완료', false, 5000)
  p = onSpawn(p, sp('y', 'general-purpose', '구현 2'), 9000)
  for (const t of [9500, 5000 + LINGER_MS + 1000]) {
    const st = foldSteps(unitsOf(p, t))[0]!
    expect(st.map(s => s.kind)).toEqual(['unit'])
  }
})

test('웹 자리: 심사대에 간 검사 직원은 같은 자리에 검사 아닌 직원이 있어도 자리 계산에서 빠진다', () => {
  let o = onPrompt(EMPTY, '가입', 1000)
  o = onSpawn(o, sp('t1', 'test-engineer', '가입 테스트 짜기'), 2000)
  o = onSpawn(o, sp('r1', 'code-reviewer', '가입 코드 검토'), 2100)
  const u = unitsOf(o, 3000)
  expect(u.map(x => x.key)).toEqual(['QA']) // 둘 다 QA 자리
  const web = webSeats(o, 3000)
  expect(web.steps.main[0]!.map(s => s.kind)).toEqual(['unit']) // 「QA 2/2 · 심사대」 같은 빈 나란히 자리 없음
  expect(web.units[0]!.worker).toBe('t1') // 대표는 자리에 있는 직원
  expect(foldSteps(u)[0]!.map(s => s.kind)).toEqual(['twin', 'twin']) // 터미널(심사대 없음)은 그대로 둘
})

test('칸반: 반려 뒤 같은 자리의 이어지는 일이 통과하면 처음 카드는 반려 칸에서 빠진다', () => {
  let o = onPrompt(EMPTY, '가입', 1000)
  o = onSpawn(o, sp('v1', 'general-purpose', '가입 구현'), 2000)
  o = onComplete(o, 'v1', '완료', false, 3000)
  o = onSpawn(o, sp('r1', 'code-reviewer', '가입 코드 검토'), 4000)
  o = onComplete(o, 'r1', '판정: 반려\n이유: 빈 칸 검사 없음', false, 5000)
  expect(boardOf(o)!.find(c => c.name === '반려')!.cards.length).toBe(1)
  o = onSpawn(o, sp('v2', 'general-purpose', '가입 구현'), 6000)
  o = onComplete(o, 'v2', '고쳤어요', false, 7000)
  o = onSpawn(o, sp('r2', 'code-reviewer', '가입 코드 검토'), 8000)
  o = onComplete(o, 'r2', '판정: 통과', false, 9000)
  expect(boardOf(o)!.find(c => c.name === '반려')!.cards.length).toBe(0)
})

test('청록 깔개(나란히 자리)를 누르면 카드 맨 위에 「같은 일을 나눠서 동시에 하는 직원들이에요 (n명)」', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 10, 24, 5, 0, 0) })
  on('command.register', () => ({ value: { command: 'termimates' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: {} }))
  on('agent.spawn', (_, e) => ({ model: 'claude-sonnet-5-5', agentId: 'a-' + e.tool_use_id }))
  await $.session.start({ cwd: '/work/demo', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: '조사해 줘', wait: false, origin: { kind: 'composer' } })
  for (const i of [1, 2, 3]) {
    await $.agent.spawn({ tool_use_id: 't' + i, prompt: '일', description: `자료 조사 ${i}`, subagentType: 'Explore',
      provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false })
  }
  // 깔개 줄 글 「같은 일 ×3」: 1배 · 1.5배 · 2배 모두 이름표 줄 아래 · 아랫줄 말풍선 위 (통로 칸)
  for (const [cols, rows, k] of [[113, 40, 1], [113, 70, 1.5], [160, 100, 2]] as const) {
    const u = await $.ui.mount({ plugin: 'termimates', component: 'Pane', requestId: 'office', surface: 'terminal',
      props: { title: '사무실', isFocused: false, bodyColumns: cols, placement: 'dock', scroll: { offset: 0, bodyRows: rows }, view: {} } })
    await u.unmount()
    const u2 = await $.ui.mount({ plugin: 'termimates', component: 'Pane', requestId: 'office', surface: 'terminal',
      props: { title: '사무실', isFocused: false, bodyColumns: cols, placement: 'dock', scroll: { offset: 0, bodyRows: rows }, view: {} } })
    const raster = (await u2.find({ type: 'Raster' }))!.props.rows as number
    expect(raster).toBe(k === 1 ? 26 : k === 1.5 ? 39 : 52)
    const label = await u2.find({ key: 'twin-리서처' })
    const tag = await u2.find({ key: 'tag-리서처#1' })
    expect((await u2.find({ key: 'twin-btn-리서처' }))?.text).toMatch(/^같은 ?일 ?×3$/)
    expect(label!.props.top as number).toBeGreaterThan(tag!.props.top as number) // 이름표 줄 아래
    expect(label!.props.top as number).toBeLessThan(raster) // 그림 안 (통로 칸)
    await u2.unmount()
  }
  const ui = await $.ui.mount({ plugin: 'termimates', component: 'Pane', requestId: 'office', surface: 'terminal',
    props: { title: '사무실', isFocused: false, bodyColumns: 113, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } })
  await ui.press({ key: 'pick-리서처#2' })
  expect((await ui.find({ type: 'Text', text: /같은 일을 나눠서 동시에 하는 직원들이에요 \(3명\)/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /같은 일 직원 3명/ }))?.text).toBeTruthy() // 목록 · 상태
  await ui.unmount()
})

test('자리 이어받기: 나가던 직원은 새 직원이 그 자리에 앉아도 끝까지 걸어 나간다 (한 자리 · 나란히 자리 둘 다)', () => {
  // 한 자리: 개발자 a 가 보고하고 나가는 중(끝난 지 3초)에 같은 자리 개발자 b 출근
  let o = build([['a', 'executor', '구현']])
  o = onComplete(o, 'a', '완료', false, 5000)
  o = onSpawn(o, sp('b', 'executor', '구현 2'), 8000)
  const at = (now: number) => {
    const units = unitsOf(o, now)
    const L = layout(o, 120, unitOf, familyOfW, { spots: plan(units, 120, 60).spots, units })
    const seat = L.seats.find(x => x.key === '개발자')!
    return { seat, walk: leavingOf(o, L, seat, now) }
  }
  expect(at(9000).seat.worker?.id).toBe('b') // 자리는 새 사람 몫
  expect(at(9000).walk.map(x => x.w.id)).toEqual(['a']) // 앞사람은 따로 걷는 중 (안 사라짐)
  expect(at(9000).walk[0]!.m.p).toBeGreaterThan(0) // 서류 들고 팀장에게 가는 길
  expect(at(5000 + 6000 + 1500 + 1000).walk[0]!.m.pts.at(-1)!.x).toBeLessThan(0) // 그다음 문(왼쪽 밖)으로
  expect(at(5000 + LINGER_MS + 1).walk).toEqual([]) // 다 나간 뒤엔 없음
  expect(isMoving(o, 9000)).toBe(true)

  // 나란히 자리: 리서처 x1 · x2 동시에, x1 이 끝나고 x3 이 그 자리를 이어받아도 x1 은 그 자리에서 걸어 나간다
  let p = build([['x1', 'Explore', '조사 1'], ['x2', 'Explore', '조사 2']])
  p = onComplete(p, 'x1', '찾음', false, 5000)
  p = onSpawn(p, sp('x3', 'Explore', '조사 3'), 7000)
  const units = unitsOf(p, 8000)
  const steps = foldSteps(units)
  expect(steps[0]!.find(x => x.who === 'x3')?.leaving).toEqual(['x1'])
  const L = layout(p, 120, unitOf, familyOfW, { spots: steps[0]!, units })
  const twin = L.seats.find(x => x.worker?.id === 'x3')!
  expect(leavingOf(p, L, twin, 8000).map(x => x.w.id)).toEqual(['x1'])
  // 웹 스냅샷도 같은 몫 (office.js 가 sp.leaving 으로 따로 걷게 그린다)
  expect(webSeats(p, 8000).steps.main[0]!.find(x => x.who === 'x3')?.leaving).toEqual(['x1'])
  // 접어 한 자리로 보여도 나가는 사람은 남는다
  expect(webSeats(p, 8000).steps.main[1]!.find(x => x.key === '리서처')?.leaving).toEqual(['x1'])
})
