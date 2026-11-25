import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { dayOf, man } from '../hooks/power'

const NOW = Date.UTC(2026, 10, 25, 5, 0, 0)

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

const usage = (input: number, cacheRead: number, output: number) => ({
  input_tokens: input, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: 0, output_tokens: output,
  model: 'claude-opus-5-5',
})

/** 엔진 흉내: 저장소는 메모리, 대화량 · 직원 목록은 정해 둔 값 */
function engine(on: On, store: Record<string, unknown>, ctx: { tokens?: number }) {
  mock.clock(on, { now: NOW })
  on('command.register', () => ({ value: { command: 'termimates' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.usage', () => ({
    value: { startedAt: NOW, context: { tokens: ctx.tokens, window: 200000, percent: undefined }, rateLimits: [] },
  }))
  on('agent.list', () => ({ value: [{ id: 'a-designer', tokenCount: 50000, contextWindowSize: 200000 }] as never }))
  on('store.get', (_, e) => ({ value: store[e.key] }))
  on('store.set', (_, e) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    delete store[e.key]
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(store) }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: {} }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a-designer' }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
}

const has = async (ui: { find: (q: { type: 'Text'; text: RegExp }) => Promise<{ text?: string } | undefined> }, re: RegExp) =>
  expect((await ui.find({ type: 'Text', text: re }))?.text, String(re)).toBeTruthy()

test('전기세 · 피로도: 팀장 · 직원 몫, 오늘 합계와 평소 대비, 모든 화면에서', async ($, on) => {
  const today = dayOf(NOW)
  const yesterday = dayOf(NOW - 86400000)
  const old = dayOf(NOW - 20 * 86400000)
  // 어제는 다른 두 세션이 합쳐 100만, 20일 전 기록은 지워져야 한다
  const store: Record<string, unknown> = {
    [`day:${yesterday}:s-a`]: 600000, [`day:${yesterday}:s-b`]: 400000, [`day:${old}:s-c`]: 5, jobs: [400000],
  }
  const ctx: { tokens?: number } = {}
  engine(on, store, ctx)
  await $.session.start({ cwd: '/work/demo', surface: 'terminal', isInteractive: true })
  expect(store[`day:${yesterday}:sum`]).toBe(1000000)
  expect(store[`day:${old}:s-c`]).toBeUndefined()

  await $.prompt.submit({ text: '로그인 화면 만들어줘', wait: false, origin: { kind: 'composer' } })
  await $.agent.spawn({
    tool_use_id: 't1', prompt: '시안', description: '로그인 화면 시안', subagentType: 'designer',
    provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false,
  })
  // 직원 한 차례: 12만 (일반 2만 · 할인 9만 · 고출력 1만)
  await $.turn.complete({ turnId: 'w1', agentId: 'a-designer', answer: '시안 완료', durationMs: 900, isAborted: false,
    reason: 'answer', usage: usage(20000, 90000, 10000) })
  // 팀장 한 차례: 40만, 그 뒤 엔진이 잰 대화량 13.6만 / 20만 = 68%
  ctx.tokens = 136000
  await $.turn.complete({ turnId: 'm1', answer: '다 했어요', durationMs: 900, isAborted: false, reason: 'answer',
    usage: usage(30000, 350000, 20000) })
  await $.session.measure({ context: { tokens: 136000, window: 200000, percent: 68 }, rateLimits: [], changed: ['context'] })

  expect(store[`day:${today}:sess-1`]).toBe(520000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await has(ui, /68% 하품/)
    await has(ui, /오늘 52만/)
    await has(ui, /평소의 52%/)
    await has(ui, new RegExp(man(520000)))
    await has(ui, /사무실 표시 0/)
    await ui.press({ key: 'pick-main' })
    await has(ui, /피로도: 68% 하품/)
    await has(ui, /전기세 몫 \(이번 세션\): 40만/)
    await ui.press({ key: 'pick-디자이너' })
    await has(ui, /피로도: 25% 쌩쌩/)
    await has(ui, /전기세 몫: 12만 · 일반 2만 · 할인 9만 · 고출력 1만/)
    await ui.unmount()
  }

  // 70% 넘으면 새 세션 권하기, 새 지시가 오면 이번 일은 0 부터
  await $.session.measure({ context: { tokens: 150000, window: 200000, percent: 75 }, rateLimits: [], changed: ['context'] })
  await $.prompt.submit({ text: '다음 일', wait: false, origin: { kind: 'composer' } })
  expect(store.jobs).toEqual([400000, 520000])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await has(ui, /75% 피곤/)
  await has(ui, /피로도를 누르면 정리하는 법이 나와요/)
  await has(ui, /^0$/) // 이번 일 숫자 칸
  await ui.unmount()
})

test('대화 정리(compact) 뒤에는 피로가 풀린다', async ($, on) => {
  const store: Record<string, unknown> = {}
  const ctx: { tokens?: number } = { tokens: 180000 }
  engine(on, store, ctx)
  on('session.compact', (_, e) => ({ messages: e.messages, tokensAfter: 20000 }))
  await $.session.start({ cwd: '/work/demo', surface: 'terminal', isInteractive: true })
  await $.session.measure({ context: { tokens: 180000, window: 200000, percent: 90 }, rateLimits: [], changed: ['context'] })
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await has(ui, /90% 녹초/)
  await ui.unmount()

  ctx.tokens = undefined // 정리 직후엔 엔진도 아직 안 잼
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: '지금까지 한 일 요약', toolUses: [] }] })
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await has(ui, /10% 쌩쌩/)
  await ui.press({ key: 'pick-main' })
  await has(ui, /정리 끝, 피로가 풀렸어요/)
  await ui.unmount()
})

test('피로도를 누르면 단계별 정리 안내, 단추는 입력창에 글만 넣는다 (보내지 않음)', async ($, on) => {
  const store: Record<string, unknown> = { welcomed: true }
  const ctx: { tokens?: number } = {}
  engine(on, store, ctx)
  const filled: string[] = []
  on('prompt.fill', (_, e) => { filled.push(e.text); return { isFilled: true } as never })
  on('ui.toast', () => ({ value: undefined }))
  await $.session.start({ cwd: '/work/demo', surface: 'terminal', isInteractive: true })
  await $.session.measure({ context: { tokens: 160000, window: 200000, percent: 80 }, rateLimits: [], changed: ['context'] })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'fatigue' })
  expect((await ui.find({ type: 'Text', text: /80% 피곤 — 정리할 때예요/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /HANDOFF\.md/ }))?.text).toBeTruthy()
  await ui.press({ key: 'fill-compact' })
  await ui.press({ key: 'fill-note' })
  expect(filled[0]).toBe('/compact')
  expect(filled[1]).toContain('HANDOFF.md')
  await ui.press({ key: 'tired-close' })
  expect(await ui.find({ type: 'Text', text: /정리할 때예요/ })).toBeUndefined()
  await ui.unmount()
})
