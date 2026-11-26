import { expect, mock, test } from 'claude-code/testing'

import { EMPTY, jobOfW, onComplete, onSpawn, unitOf } from '../hooks/office'
import { layout } from '../hooks/scene'
import { jobOf, memberOf, teamOf } from '../hooks/words'

test('역할 · 팀 알아보기: 맡긴 일 설명으로', () => {
  expect(jobOf('general-purpose', 'QA 1팀 1-1 핵심 흐름')).toBe('QA')
  expect(jobOf('general-purpose', '회원가입 화면 시안 디자인')).toBe('디자이너')
  expect(jobOf('general-purpose', '코드 고치기')).toBe('개발자')
  expect(jobOf('oh-my-claudecode:designer', 'QA 아님')).toBe('디자이너') // 종류 이름이 분명하면 그걸로
  expect(teamOf('QA 1팀 1-1 핵심 흐름')).toBe('1')
  expect(teamOf('너는 QA team 3 의 한 명')).toBe('3')
  expect(teamOf('QA 2-3 권한')).toBe('2')
  expect(teamOf('2026-11-26 회의록 정리')).toBeUndefined() // 날짜는 팀이 아니다
  expect(memberOf('QA 1팀 1-2 화면 전환')).toBe('1-2')
})

test('QA 3팀 × 3명 = 사무실엔 세 자리 (팀 하나 = 한 자리)', () => {
  let o = EMPTY
  let t = 1000
  for (const n of [1, 2, 3]) {
    for (const team of [1, 2, 3]) {
      const id = `q${team}${n}`
      o = onSpawn(o, { id, type: 'general-purpose', description: `QA ${team}팀 ${team}-${n}`, background: true }, t++)
      if (n < 3) o = onComplete(o, id, '찾음', false, t++)
    }
  }
  const L = layout(o, 64, unitOf, jobOfW)
  expect(L.seats.map(s => s.key)).toEqual(['main', 'QA 1팀', 'QA 2팀', 'QA 3팀'])
  const one = L.seats[1]!
  expect(one.team).toBe(true)
  expect(one.members).toEqual(['done', 'done', 'think']) // 둘은 끝, 셋째가 일하는 중
  expect(one.worker?.member).toBe('1-3') // 대표는 지금 일하는 팀원
})

test('팀 자리 누르면 팀원 카드: 팀원 3명 · 상태 목록, general-purpose QA 는 개발자 자리 없음', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 10, 26, 3, 0, 0) })
  on('command.register', () => ({ value: { command: 'termimates' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [{ id: 'office', title: '사무실', isShown: true, isFocused: false, isPlaced: true }] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  // agent.spawn 마다 고유 agentId 반환, 순서 그대로 기록
  const agentIds: string[] = []
  on('agent.spawn', () => {
    const id = `qa-${agentIds.length + 1}`
    agentIds.push(id)
    return { model: 'claude-haiku-5-5', agentId: id }
  })

  await $.session.start({ cwd: '/work/demo', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'QA 돌려줘', wait: false, origin: { kind: 'composer' } })

  // QA 3팀 × 3명 에이전트 투입 (description 형식: 「QA N팀 N-N 설명」 — teamOf / memberOf 가 인식)
  const members = [
    [1, 1], [1, 2], [1, 3],
    [2, 1], [2, 2], [2, 3],
    [3, 1], [3, 2], [3, 3],
  ] as [number, number][]
  for (const [t, n] of members) {
    await $.agent.spawn({
      tool_use_id: `tid-${t}-${n}`, prompt: '', description: `QA ${t}팀 ${t}-${n} 핵심`,
      subagentType: 'general-purpose',
      provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-sonnet-5-5',
      background: true, fork: false,
    })
  }

  // 각 팀 2명씩 완료 (3번째는 일하는 중으로 남음)
  // agentIds 순서: q11=0, q12=1, q13=2, q21=3, q22=4, q23=5, q31=6, q32=7, q33=8
  for (const [i, [t, n]] of [[0, [1, 1]], [1, [1, 2]], [3, [2, 1]], [4, [2, 2]], [6, [3, 1]], [7, [3, 2]]] as [number, [number, number]][]) {
    await $.turn.complete({
      turnId: `tid-${t}-${n}`, agentId: agentIds[i]!,
      answer: `${t}-${n} 찾음`, durationMs: 1000, isAborted: false, reason: 'answer',
    })
  }

  const PANE = {
    plugin: 'termimates', component: 'Pane', requestId: 'office', surface: 'terminal',
    props: { title: '사무실', isFocused: false, bodyColumns: 72, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
  } as const

  const ui = await $.ui.mount(PANE)
  // 팀 자리 세 개 모두 보임
  for (const k of ['QA 1팀', 'QA 2팀', 'QA 3팀']) expect((await ui.find({ key: 'pick-' + k }))?.text).toContain(k)
  // general-purpose 여도 QA 팀 설명이면 「개발자」 자리가 아닌 팀 자리로 묶임
  expect(await ui.find({ key: 'pick-개발자' })).toBeUndefined()
  // QA 2팀 누르면 팀원 카드
  await ui.press({ key: 'pick-QA 2팀' })
  expect((await ui.find({ type: 'Text', text: /팀원 3명/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /2-2 {2}보고 완료 ✓/ }))?.text).toBeTruthy()
  await ui.unmount()
})
