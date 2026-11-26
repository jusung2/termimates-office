import { expect, mock, test } from 'claude-code/testing'

import { PICK_MS } from '../hooks/office'

const PANE = {
  plugin: 'termimates', component: 'Pane', requestId: 'office', surface: 'terminal',
  props: { title: '사무실', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

test('📄 놓친 일 서류 (터미널): 팀장 차례가 끝났는데 할 일이 남으면 바닥에 서류 · 숫자 키로 고르면 팀장이 주워 와 입력창에 문장', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 10, 26, 3, 0, 0) })
  const filled: string[] = []
  on('command.register', () => ({ value: { command: 'termimates' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('prompt.fill', (_, e) => { filled.push(e.text); return { isFilled: true } as never })
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.toast', () => ({ value: undefined }))
  await $.session.start({ cwd: '/work/a', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: '로그인 화면 만들어줘', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: 'TodoWrite', todos: [
    { content: '화면 만들기', status: 'completed', activeForm: '만드는 중' },
    { content: '시험 돌리기', status: 'pending', activeForm: '돌리는 중' },
  ] } as never)
  await $.turn.complete({ turnId: 't1', answer: '화면을 만들었어요', durationMs: 1000, isAborted: false, reason: 'answer' })
  let ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /📄 놓친 일 1장/ }))?.text).toBeTruthy()
  const btn = await ui.find({ type: 'Button', text: /\[1\] 시험 돌리기/ })
  expect(btn?.props.hotkey).toBe('1') // 마우스 없이 숫자 키로
  expect((await ui.find({ type: 'Text', text: /^1$/ }))?.text).toBe('1') // 바닥 서류 옆 번호
  await ui.press({ key: btn!.props.key as string })
  await clock.advance(PICK_MS - 100)
  expect(filled).toEqual([]) // 팀장이 걸어가 줍고 돌아와 읽는 동안은 아직
  await clock.advance(200)
  expect(filled).toEqual(['놓친 일 다시 확인: 시험 돌리기']) // 보내기는 사람이
  await ui.unmount()
  ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /📄 놓친 일 \d+장/ })).toBeUndefined() // 넘긴 서류는 사라짐
  await ui.press({ key: 'pick-main' })
  expect((await ui.find({ type: 'Text', text: /📄 놓친 일 서류: 「시험 돌리기」 — 팀장 자리/ }))?.text).toBeTruthy() // 사무실 소식(한 일)에 한 줄
  await ui.unmount()
})

test('📄 놓친 일 서류 (웹에서 누름): serve.py 가 적은 <세션>.pick 을 읽고 비운 뒤 같은 줍기 → 입력창 (못 넣으면 복사)', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 10, 26, 3, 0, 0) })
  const store: Record<string, unknown> = { welcomed: true, 'web:/work/a': true }
  const files: Record<string, string> = {}
  const copied: string[] = []
  on('command.register', () => ({ value: { command: 'termimates' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sess-p' }))
  on('store.get', (_, e) => ({ value: store[e.key] }))
  on('store.set', (_, e) => { store[e.key] = e.value; return { value: undefined } })
  on('store.keys', () => ({ value: Object.keys(store) }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '/Users/me\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.write', (_, e) => { files[e.path] = e.text; return { value: undefined } })
  on('fs.exists', (_, e) => ({ value: e.path in files }))
  on('fs.read', (_, e) => (e.path in files ? { value: files[e.path] } : { deny: '없음' }) as never)
  on('ui.panes', () => ({ value: [] }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('prompt.fill', () => ({ isFilled: false }) as never) // 대화 상자가 떠 있어 못 넣음
  on('ui.copy', (_, e) => { copied.push(e.text); return { value: { isCopied: true } } as never })
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'x1' }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.toast', () => ({ value: undefined }))
  await $.session.start({ cwd: '/work/a', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: '결제 코드 찾아 줘', wait: false, origin: { kind: 'composer' } })
  await $.agent.spawn({
    tool_use_id: 't1', prompt: '', description: '결제 코드 찾아 보기', subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false,
  })
  await $.turn.complete({ turnId: 't1', agentId: 'x1', answer: '', durationMs: 1000, isAborted: true, reason: 'aborted' } as never)
  await clock.advance(400)
  const snapPath = '/Users/me/.termimates/panel/sess-p.json'
  const paper = JSON.parse(files[snapPath]!).office.papers[0]
  expect([paper.unit, paper.why, paper.text]).toEqual(['리서처', 'abort', '결제 코드 찾아 보기'])
  files['/Users/me/.termimates/panel/sess-p.pick'] = JSON.stringify({ id: paper.id, at: 1 }) + '\n'
  await clock.advance(700)
  expect(files['/Users/me/.termimates/panel/sess-p.pick']).toBe('') // 읽고 비움 (또 줍지 않게)
  expect(JSON.parse(files[snapPath]!).office.papers[0].picked).toBeTruthy() // 웹 그림이 팀장 걸음을 그린다
  await clock.advance(PICK_MS + 400)
  expect(copied).toEqual(['놓친 일 다시 확인: 결제 코드 찾아 보기'])
  expect(JSON.parse(files[snapPath]!).office.papers).toEqual([])
})
