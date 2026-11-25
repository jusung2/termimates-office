import { expect, mock, test } from 'claude-code/testing'

import { HOLD, STEPS } from '../hooks/demo'

const PANE = {
  plugin: 'termimates',
  component: 'Pane',
  requestId: 'office',
  props: {
    title: '사무실',
    isFocused: false,
    bodyColumns: 72,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

test('/termimates 시연: 가짜 「회원가입 화면」 장면이 돌고, 끝나면 실제 사무실로 돌아온다 (저장소 안 건드림)', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 10, 25, 12, 0, 0) })
  const store: Record<string, unknown> = {}
  const writes: string[] = []
  on('command.register', () => ({ value: { command: 'termimates' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [{ id: 'office', title: '사무실', isShown: true, isFocused: false, isPlaced: true }] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('store.get', (_, e) => ({ value: store[e.key] }))
  on('store.set', (_, e) => {
    writes.push(e.key)
    store[e.key] = e.value
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(store) }))
  await $.session.start({ cwd: '/work/demo', surface: 'terminal', isInteractive: true })
  const demo = () => $.command.run({
    command: 'termimates', args: '시연', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 },
  })
  const at = (n: number) => STEPS.slice(0, n).reduce((t, s) => t + s.wait, 0)
  const has = async (ui: { find: (q: { type: 'Text'; text: RegExp }) => Promise<{ text?: string } | undefined> }, re: RegExp) =>
    expect((await ui.find({ type: 'Text', text: re }))?.text, String(re)).toBeTruthy()

  await demo()
  await clock.advance(at(5) + 10) // 지시 → 팀장이 훑어봄 → 조사원 · 기획자 입사
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await has(ui, /▶ 시연 중 5\//)
  await has(ui, /사장님 지시 「회원가입 화면 만들어줘」/)
  await ui.press({ key: 'pick-리서처' })
  await has(ui, /맡은 일: 로그인 화면 코드 찾아 보기/)
  await ui.unmount()

  await clock.advance(at(STEPS.length) - at(5)) // 끝까지
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await has(ui, new RegExp(`▶ 시연 중 ${STEPS.length}/${STEPS.length}`))
  await ui.press({ key: 'pick-개발자' })
  await has(ui, /넘긴 서류: 「회원가입 화면 완성/)
  await has(ui, /피로도: 71% 피곤/)
  await ui.press({ key: 'pick-main' })
  await has(ui, /마지막으로 한 말: 회원가입 화면을 만들었어요/)
  await ui.unmount()

  await clock.advance(HOLD + 10) // 잠깐 보여 준 뒤 실제 사무실로
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /▶ 시연 중/ })).toBeUndefined()
  await has(ui, /아직 사장님 지시 없음/)
  await ui.unmount()
  expect(writes.filter(k => k.startsWith('day:') || k === 'jobs')).toEqual([]) // 시연은 오늘 전기세에 안 들어감
})

test('/termimates 시연 을 다시 치면 그 자리에서 멈춘다', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 10, 25, 12, 0, 0) })
  on('command.register', () => ({ value: { command: 'termimates' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [{ id: 'office', title: '사무실', isShown: true, isFocused: false, isPlaced: true }] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work/demo', surface: 'terminal', isInteractive: true })
  const demo = () => $.command.run({
    command: 'termimates', args: '시연', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 },
  })
  await demo()
  await clock.advance(5000)
  await demo()
  await clock.advance(1000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /▶ 시연 중/ })).toBeUndefined()
  await ui.unmount()
})
