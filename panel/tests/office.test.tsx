import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'termimates',
  component: 'Pane',
  requestId: 'office',
  props: {
    title: '사무실',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

function engine(on: On) {
  mock.clock(on, { now: Date.UTC(2026, 10, 24, 5, 0, 0) })
  on('command.register', () => ({ value: { command: 'termimates' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: {} }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a-designer' }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
}

test('/termimates 는 켜고 끄는 스위치: 열려 있으면 닫고, 닫혀 있으면 연다', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 10, 24, 5, 0, 0) })
  on('command.register', () => ({ value: { command: 'termimates' } }))
  let shown = false
  on('ui.panes', () => ({
    value: shown ? [{ id: 'office', title: '사무실', isShown: true, isFocused: false, isPlaced: true }] : [],
  }))
  on('ui.open', () => { shown = true; return { value: { isPlaced: true } } })
  on('ui.close', () => { shown = false; return { value: undefined } })
  const run = () => $.command.run({
    command: 'termimates', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 },
  })

  await run()
  expect(shown).toBe(true)
  await run()
  expect(shown).toBe(false)
  await run()
  expect(shown).toBe(true)
})

test('하루 일과: 지시 → 직원 투입 → 일 → 서류 보고, 모든 화면에서', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/work/demo', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: '로그인 화면 만들어줘', wait: false, origin: { kind: 'composer' } })
  await $.agent.spawn({
    tool_use_id: 't1', prompt: '시안', description: '로그인 화면 시안', subagentType: 'designer',
    provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false,
  })
  await $.tool.call({ tool: 'Read', file_path: '/work/demo/README.md', agentId: 'a-designer' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /사장님 지시 「로그인 화면 만들어줘」/ }))?.text).toBeTruthy()
    await ui.press({ key: 'pick-디자이너' })
    expect((await ui.find({ type: 'Text', text: /맡은 일: 로그인 화면 시안/ }))?.text).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /README\.md」 읽음/ }))?.text).toBeTruthy()
    await ui.press({ key: 'pick-main' })
    await ui.unmount()
  }

  // 직원이 보고를 마치면: 서류가 팀장에게 가고, 팀장은 받은 서류를 본다
  await $.turn.complete({ turnId: 'x', agentId: 'a-designer', answer: '시안 완료: 주 색 #3B5BDB', durationMs: 900, isAborted: false, reason: 'answer' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'pick-디자이너' })
  expect((await ui.find({ type: 'Text', text: /넘긴 서류: 「시안 완료/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /보고 완료/ }))?.text).toBeTruthy()
  await ui.unmount()
})

test('말풍선은 자리가 남으면 넓어지고, 좁으면 짧은 말로 바뀐다 (잘리지 않음)', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 10, 24, 5, 0, 0) })
  on('command.register', () => ({ value: { command: 'termimates' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('agent.spawn', (_, e) => ({ model: 'claude-haiku-5-5', agentId: 'a-' + e.subagentType }))
  let open = () => {}
  const gate = new Promise<void>(r => { open = r })
  on('tool.call', async () => { await gate; return { result: {} } }) // 일하는 중인 채로 화면을 본다
  await $.session.start({ cwd: '/work/demo', surface: 'terminal', isInteractive: true })

  // 팀장은 그 줄에 혼자라 「지시 기다려요」 가 다 보인다
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^ 지시 기다려요 $/ }))?.text).toBeTruthy()
  await ui.unmount()

  await $.prompt.submit({ text: '정리해줘', wait: false, origin: { kind: 'composer' } })
  const spawn = (t: string) => $.agent.spawn({
    tool_use_id: 't-' + t, prompt: '일', description: '일', subagentType: t,
    provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false,
  })
  await spawn('designer')
  await spawn('Explore')
  await spawn('Plan')
  const calls = ['a-designer', 'a-Explore', 'a-Plan'].map(id =>
    $.tool.call({ tool: 'Read', file_path: '/work/demo/very-long-component-name.tsx', agentId: id }))
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const texts: string[] = []
  for (const k of ['디자이너', '리서처', '기획자']) texts.push((await ui.find({ key: 'bubble-' + k }))?.text ?? '')
  expect(texts.every(t => t.includes('읽는 중'))).toBe(true)
  for (const t of texts) expect(t.includes('…')).toBe(false) // 잘린 글이 없다
  expect(texts.some(t => t.trim() === '읽는 중')).toBe(true) // 가운데 자리는 짧은 말
  await ui.unmount()
  open()
  await Promise.all(calls)
})

test('직원을 누르면 말 걸기: 팀장 = 대화창에, 직원 = 그 에이전트에게. 이름은 짧은 한글 역할, 가운데', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 10, 24, 5, 0, 0) })
  on('command.register', () => ({ value: { command: 'termimates' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a-designer' }))
  const sentToLead: string[] = []
  const sentToAgent: { to: unknown; text: string }[] = []
  on('prompt.submit', (_, e) => { sentToLead.push(e.text); return { text: e.text } })
  on('session.send', (_, e) => { sentToAgent.push({ to: e.to, text: e.text }); return { isDelivered: true } })
  on('ui.toast', () => ({ value: undefined }))
  await $.session.start({ cwd: '/work/demo', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({
    tool_use_id: 't1', prompt: '시안', description: '로그인 화면 시안', subagentType: 'oh-my-claudecode:designer',
    provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false,
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // 긴 에이전트 이름 대신 「디자이너」, 자리 가운데
  const tag = await ui.find({ key: 'pick-디자이너' })
  expect(tag?.text).toBe('디자이너')

  await ui.press({ key: 'pick-main' })
  await ui.input({ key: 'talk-0', text: '진행 상황 알려줘' })
  expect(sentToLead).toContain('진행 상황 알려줘')

  await ui.press({ key: 'pick-디자이너' })
  await ui.input({ key: 'talk-1', text: '버튼 색 더 진하게' })
  expect(sentToAgent).toEqual([{ to: 'a-designer', text: '버튼 색 더 진하게' }])
  expect((await ui.find({ type: 'Text', text: /사장님이 말 걺: 「버튼 색 더 진하게」/ }))?.text).toBeTruthy()
  await ui.unmount()
})

test('사무실은 저절로 안 열린다: /termimates 로 켜 둔 프로젝트만 다음 세션에 다시 열린다', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 10, 26, 5, 0, 0) })
  const store: Record<string, unknown> = { welcomed: true } // 처음 안내는 이미 봄
  let opened = 0
  let shown = false
  on('command.register', () => ({ value: { command: 'termimates' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('store.get', (_, e) => ({ value: store[e.key] }))
  on('store.set', (_, e) => { store[e.key] = e.value; return { value: undefined } })
  on('store.keys', () => ({ value: Object.keys(store) }))
  on('ui.panes', () => ({ value: shown ? [{ id: 'office', title: '사무실', isShown: true, isFocused: false, isPlaced: true }] : [] }))
  on('ui.open', () => { opened++; shown = true; return { value: { isPlaced: true } } })
  on('ui.close', () => { shown = false; return { value: undefined } })
  const run = () => $.command.run({ command: 'termimates', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })

  await $.session.start({ cwd: '/work/a', surface: 'terminal', isInteractive: true })
  expect(opened).toBe(0) // 처음엔 안 열림
  await run()
  expect(store['open:/work/a']).toBe(true)
  await $.session.start({ cwd: '/work/a', surface: 'terminal', isInteractive: true }) // 같은 프로젝트 새 세션
  expect(opened).toBe(2)
  await $.session.start({ cwd: '/work/b', surface: 'terminal', isInteractive: true }) // 다른 프로젝트는 안 열림
  expect(opened).toBe(2)
  await $.session.start({ cwd: '/work/a', surface: 'terminal', isInteractive: true })
  await run() // 끄면
  expect(store['open:/work/a']).toBe(false)
})

test('책장을 누르면 스킬 목록이 한 줄 설명과 함께 펼쳐진다 (플러그인 스킬은 더 보기)', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 10, 26, 5, 0, 0) })
  on('command.register', () => ({ value: { command: 'termimates' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.list', () => ({ value: [
    { name: 'ui-design', description: '휴대폰 앱 화면과 흐름을 디자인해요. 시안까지.', source: 'user' },
    { name: 'weekly-report', description: '이번 주 커밋을 모아 보고서를 써요. 금요일마다.', source: 'user' },
    { name: 'vercel:deploy', description: 'Deploy the current project to Vercel. Pass prod for production.', source: 'plugin', plugin: 'vercel' },
    { name: 'termimates', description: '사무실', source: 'plugin', plugin: 'termimates' },
  ] as never }))
  await $.session.start({ cwd: '/work/a', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'shelf' })
  expect((await ui.find({ type: 'Text', text: /휴대폰 앱 화면과 흐름을 디자인해요\.$/ }))?.text).toBeTruthy() // 설명 첫 문장
  expect((await ui.find({ type: 'Text', text: /내 스킬 2개/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /플러그인 스킬 1개/ }))?.text).toBeTruthy() // termimates 자기 명령은 빠짐
  expect((await ui.find({ type: 'Text', text: /vercel 1 {2}▾ 펼치기/ }))?.text).toBeTruthy()
  await ui.press({ key: 'shelf-more' })
  expect((await ui.find({ type: 'Text', text: /Deploy the current project to Vercel\.$/ }))?.text).toBeTruthy()
  await ui.press({ key: 'shelf' })
  expect(await ui.find({ type: 'Text', text: /휴대폰 앱 화면과 흐름을 디자인해요/ })).toBeUndefined()
  await ui.unmount()
})

test('처음 깐 사람: 첫 세션에 한 번만 열리고 안내 카드, 「알겠어요」 로 닫힘, 다음 세션엔 저절로 안 열림', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 10, 26, 5, 0, 0) })
  const store: Record<string, unknown> = {}
  let opened = 0
  on('command.register', () => ({ value: { command: 'termimates' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('store.get', (_, e) => ({ value: store[e.key] }))
  on('store.set', (_, e) => { store[e.key] = e.value; return { value: undefined } })
  on('store.keys', () => ({ value: Object.keys(store) }))
  on('ui.open', () => { opened++; return { value: { isPlaced: true } } })
  await $.session.start({ cwd: '/work/a', surface: 'terminal', isInteractive: true })
  expect(opened).toBe(1)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /처음 오셨나요/ }))?.text).toBeTruthy()
  await ui.press({ key: 'guide-ok' })
  expect(await ui.find({ type: 'Text', text: /처음 오셨나요/ })).toBeUndefined()
  await ui.press({ key: 'tab-help' })
  expect((await ui.find({ type: 'Text', text: /처음 오셨나요/ }))?.text).toBeTruthy() // ? 도움말 로 다시
  await ui.unmount()
  await $.session.start({ cwd: '/work/b', surface: 'terminal', isInteractive: true })
  expect(opened).toBe(1) // 두 번째 세션은 저절로 안 열림
})
