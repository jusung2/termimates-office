import { expect, mock, test } from 'claude-code/testing'

import { HOLD, QA_STEPS } from '../hooks/demo'
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

test('/termimates 시연 qa: 팀 자리 셋, 팀원 카드, 끝나면 실제 사무실로', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 10, 26, 3, 0, 0) })
  on('command.register', () => ({ value: { command: 'termimates' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [{ id: 'office', title: '사무실', isShown: true, isFocused: false, isPlaced: true }] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work/demo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'termimates', args: '시연 qa', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  const total = QA_STEPS.reduce((n, s) => n + s.wait, 0)
  await clock.advance(total + 10)
  const PANE = {
    plugin: 'termimates', component: 'Pane', requestId: 'office', surface: 'terminal',
    props: { title: '사무실', isFocused: false, bodyColumns: 72, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
  } as const
  let ui = await $.ui.mount(PANE)
  for (const k of ['QA 1팀', 'QA 2팀', 'QA 3팀']) expect((await ui.find({ key: 'pick-' + k }))?.text).toContain(k)
  expect(await ui.find({ key: 'pick-개발자' })).toBeUndefined() // general-purpose 지만 QA 로 보인다
  await ui.press({ key: 'pick-QA 2팀' })
  expect((await ui.find({ type: 'Text', text: /팀원 3명/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /2-2 {2}보고 완료 ✓ — QA 2팀 2-2/ }))?.text).toBeTruthy()
  await ui.unmount()
  await clock.advance(HOLD + 10)
  ui = await $.ui.mount(PANE)
  expect(await ui.find({ key: 'pick-QA 1팀' })).toBeUndefined()
  await ui.unmount()
})
