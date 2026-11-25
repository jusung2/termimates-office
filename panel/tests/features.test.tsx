import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'termimates', component: 'Pane', requestId: 'office', surface: 'terminal',
  props: { title: '사무실', isFocused: false, bodyColumns: 72, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

/** 기본 엔진 흉내 + 저장소 · 파일 · 입력창 */
function engine(on: On, files: Record<string, string> = {}) {
  const clock = mock.clock(on, { now: Date.UTC(2026, 10, 26, 3, 0, 0) })
  const store: Record<string, unknown> = { welcomed: true }
  const filled: string[] = []
  const notes: string[] = []
  on('command.register', () => ({ value: { command: 'termimates' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('store.get', (_, e) => ({ value: store[e.key] }))
  on('store.set', (_, e) => { store[e.key] = e.value; return { value: undefined } })
  on('store.keys', () => ({ value: Object.keys(store) }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '/home/me\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.read', (_, e) => (e.path in files ? { value: files[e.path]! } : { deny: 'no file' }) as never)
  on('fs.list', (_, e) => ({ value: Object.keys(files).filter(p => p.startsWith(e.path + '/')).map(p => ({ name: p.slice(e.path.length + 1), kind: 'file', size: 1, mtimeMs: 0, isLink: false })) as never }))
  on('prompt.fill', (_, e) => { filled.push(e.text); return { isFilled: true } as never })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.notify', (_, e) => { notes.push(String(e.text)); return { value: { isSent: true, channel: 'terminal_bell' } as never } })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  return { clock, store, filled, notes }
}

const spawnArgs = (type: string, description: string) => ({
  tool_use_id: 't-' + type, prompt: '일', description, subagentType: type,
  provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false,
}) as const

test('🔔 질문에 답을 기다리면 사장님 확인 필요 + 12초 뒤 맥 알림, 답하면 사라짐', async ($, on) => {
  const { clock, notes } = engine(on)
  let answer = () => {}
  const gate = new Promise<void>(r => { answer = r })
  on('tool.check', async () => { await gate; return { decision: 'allow' } as never }) // 질문 창: 사장님이 답할 때까지 기다림
  on('tool.run', () => ({ result: {} }) as never)
  await $.session.start({ cwd: '/work/a', surface: 'terminal', isInteractive: true })
  const call = $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  await clock.settle()
  let ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /사장님 확인 필요 — 질문에 답해 주세요/ }))?.text).toBeTruthy()
  await ui.unmount()
  await clock.advance(12500)
  expect(notes.some(n => n.includes('사장님 확인이 필요해요'))).toBe(true)
  answer()
  await call
  ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /사장님 확인 필요/ })).toBeUndefined()
  await ui.unmount()
})

test('🔔 답할 사람이 없는 허락(거절로 끝남)에는 사장님을 부르지 않는다', async ($, on) => {
  const { clock, notes } = engine(on)
  on('tool.check', () => ({ decision: 'ask' }) as never) // 시험에는 답할 사람이 없다 (approver 없음) → 거절
  await $.session.start({ cwd: '/work/a', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  await clock.advance(15000)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /사장님 확인 필요/ })).toBeUndefined()
  expect(notes).toEqual([])
  await ui.unmount()
})

test('👥 명부: 내가 만든 에이전트 목록, 「맡기기」 는 입력창에 문장만', async ($, on) => {
  const { filled } = engine(on, {
    '/work/a/.claude/agents/copywriter.md': '---\nname: copywriter\ndescription: 광고 문구를 써요. 짧고 굵게.\n---\n본문',
    '/home/me/.claude/agents/sec.md': '---\nname: security-reviewer\ndescription: "보안 구멍을 찾아요"\n---\n',
  })
  await $.session.start({ cwd: '/work/a', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'tab-roster' })
  expect((await ui.find({ type: 'Text', text: /광고 문구를 써요\.$/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /보안 구멍을 찾아요/ }))?.text).toBeTruthy()
  await ui.press({ key: 'hire-copywriter' })
  expect(filled).toEqual(['copywriter 에이전트에게 맡겨 줘: '])
  await ui.unmount()
})

test('📚 책장 「쓰기」 는 입력창에 /스킬 만 넣는다', async ($, on) => {
  const { filled } = engine(on)
  on('command.list', () => ({ value: [{ name: 'ui-design', description: '화면을 디자인해요.', source: 'user' }] as never }))
  await $.session.start({ cwd: '/work/a', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'shelf' })
  await ui.press({ key: 'use-ui-design' })
  expect(filled).toEqual(['/ui-design '])
  await ui.unmount()
})

test('🎬 일이 끝나면 보고서, ▶ 다시 보기는 방금 일을 빠르게 다시 튼다', async ($, on) => {
  const { clock } = engine(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/work/a', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: '회원가입 화면 만들어줘', wait: false, origin: { kind: 'composer' } })
  await clock.advance(1000)
  await $.agent.spawn(spawnArgs('general-purpose', '회원가입 화면 시안 디자인'))
  await clock.advance(2000)
  await $.tool.call({ tool: 'Write', file_path: '/app/SignUp.css', content: 'x', agentId: 'a1' })
  await clock.advance(60000)
  await $.turn.complete({ turnId: 'w', agentId: 'a1', answer: '시안 완료', durationMs: 1, isAborted: false, reason: 'answer' })
  await $.turn.complete({ turnId: 'm', answer: '다 했어요', durationMs: 1, isAborted: false, reason: 'answer' })
  let ui = await $.ui.mount(PANE)
  await ui.press({ key: 'report' })
  expect((await ui.find({ type: 'Text', text: /이번 일 보고서 — 「회원가입 화면 만들어줘」/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /디자이너 — 1분 · 서류 1장/ }))?.text).toBeTruthy()
  await ui.press({ key: 'replay' })
  await ui.unmount()
  await clock.advance(3000)
  ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /▶ 다시 보기 중/ }))?.text).toBeTruthy()
  await ui.unmount()
})

test('✏️ 이름: 내가 만든 에이전트는 그 이름 그대로, 눌러서 바꾸면 앞으로 그 이름 (roles.json 도)', async ($, on) => {
  const { store } = engine(on, { '/home/me/.termimates/roles.json': '{"security-reviewer": "보안 담당"}' })
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'b' + ++n }))
  await $.session.start({ cwd: '/work/a', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawnArgs('copywriter', '광고 문구'))
  await $.agent.spawn(spawnArgs('security-reviewer', '보안 점검'))
  await $.agent.spawn(spawnArgs('general-purpose', '코드 짜기'))
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ key: 'pick-copywriter' }))?.text).toContain('copywriter') // 이름 그대로
  expect((await ui.find({ key: 'pick-보안 담당' }))?.text).toContain('보안 담당') // roles.json
  expect((await ui.find({ key: 'pick-개발자' }))?.text).toContain('개발자') // 기본 에이전트는 쉬운 역할
  await ui.press({ key: 'pick-copywriter' })
  await ui.input({ key: 'rename-copywriter-0', text: '카피라이터' })
  expect((await ui.find({ key: 'pick-카피라이터' }))?.text).toContain('카피라이터')
  expect(store.names).toEqual({ copywriter: '카피라이터' })
  await ui.press({ key: 'pick-개발자' })
  expect(await ui.find({ key: 'rename-general-purpose-1' })).toBeUndefined() // 이름으로 일을 모르는 종류는 이름 바꾸기 없음
  await ui.unmount()
})
