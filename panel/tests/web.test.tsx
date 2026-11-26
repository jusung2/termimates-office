import { expect, mock, test } from 'claude-code/testing'

test('/termimates 웹: 주소를 알려 주고, 사무실 상태를 이 컴퓨터 파일에 적는다 (프로젝트마다 기억)', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 10, 26, 3, 0, 0) })
  const store: Record<string, unknown> = {}
  const files: Record<string, string> = {}
  const toasts: string[] = []
  on('command.register', () => ({ value: { command: 'termimates' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sess-9' }))
  on('store.get', (_, e) => ({ value: store[e.key] }))
  on('store.set', (_, e) => { store[e.key] = e.value; return { value: undefined } })
  on('store.keys', () => ({ value: Object.keys(store) }))
  const runs: string[][] = []
  on('process.run', (_, e) => { runs.push(e.argv); return { value: { exitCode: 0, stdout: '/Users/me\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } })
  on('fs.write', (_, e) => { files[e.path] = e.text; return { value: undefined } })
  on('ui.toast', (_, e) => { toasts.push(String(e.text ?? e)); return { value: undefined } })
  on('ui.panes', () => ({ value: [] }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  await $.session.start({ cwd: '/work/a', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'termimates', args: '웹', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  expect(toasts.some(t => t.includes('http://127.0.0.1:8766'))).toBe(true)
  expect(store['web:/work/a']).toBe(true)
  await clock.advance(10)
  expect(runs.some(a => a[0] === '/usr/bin/open' && a[1] === 'http://127.0.0.1:8766')).toBe(true)
  await $.agent.spawn({
    tool_use_id: 't1', prompt: '너는 QA 2팀의 2-1', description: 'QA 2팀 2-1 경계값', subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false,
  })
  await clock.advance(400)
  const body = files['/Users/me/.termimates/panel/sess-9.json']
  expect(body).toBeTruthy()
  const snap = JSON.parse(body!)
  expect(snap.units.map((u: { key: string }) => u.key)).toEqual(['QA 2팀'])
  expect(snap.office.lead).toBeTruthy()
  await $.command.run({ command: 'termimates', args: '웹', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  expect(store['web:/work/a']).toBe(false)
})

test('/reload-plugins 뒤 (세션 시작 없이 모듈만 새로): 웹을 켜 둔 프로젝트면 처음 오는 이벤트에서 스냅샷을 이어 쓰고, 브라우저는 안 연다', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 10, 26, 3, 0, 0) })
  const store: Record<string, unknown> = { welcomed: true, 'web:/work/a': true }
  const files: Record<string, string> = {}
  const runs: string[][] = []
  let opened = 0
  on('command.register', () => ({ value: { command: 'termimates' } }))
  on('session.cwd', () => ({ value: '/work/a' }))
  on('session.id', () => ({ value: 'sess-r' }))
  on('store.get', (_, e) => ({ value: store[e.key] }))
  on('store.set', (_, e) => { store[e.key] = e.value; return { value: undefined } })
  on('store.keys', () => ({ value: Object.keys(store) }))
  on('process.run', (_, e) => { runs.push(e.argv); return { value: { exitCode: 0, stdout: '/Users/me\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } })
  on('fs.write', (_, e) => { files[e.path] = e.text; return { value: undefined } })
  on('ui.open', () => { opened++; return { value: { isPlaced: true } } })
  on('ui.panes', () => ({ value: [] }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  // 세션 시작 이벤트 없이 바로 사장님 지시가 온다
  await $.prompt.submit({ text: '시연 보여 줘', wait: false, origin: { kind: 'composer' } })
  await clock.advance(1000)
  const body = files['/Users/me/.termimates/panel/sess-r.json']
  expect(body).toBeTruthy()
  expect(JSON.parse(body!).project).toBe('/work/a')
  expect(runs.some(a => a[0] === '/usr/bin/open' || a[0] === 'xdg-open')).toBe(false) // 브라우저는 사람이 켤 때만
  expect(opened).toBe(0) // 창 · 안내도 다시 안 연다
})

test('/resume (같은 프로세스에서 세션만 바뀜, 세션 시작 없음): 타이머 · 웹 스냅샷이 새 세션 id 로 이어지고 팀장이 다시 출근', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 10, 26, 3, 0, 0) })
  const store: Record<string, unknown> = { welcomed: true, 'web:/work/a': true }
  const files: Record<string, string> = {}
  let id = 'sess-1'
  on('command.register', () => ({ value: { command: 'termimates' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('session.id', () => ({ value: id }))
  on('store.get', (_, e) => ({ value: store[e.key] }))
  on('store.set', (_, e) => { store[e.key] = e.value; return { value: undefined } })
  on('store.keys', () => ({ value: Object.keys(store) }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '/Users/me\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  let writes2 = 0
  on('fs.write', (_, e) => { files[e.path] = e.text; if (e.path.endsWith('sess-2.json')) writes2++; return { value: undefined } })
  on('ui.panes', () => ({ value: [] }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  await $.session.start({ cwd: '/work/a', surface: 'terminal', isInteractive: true })
  await clock.advance(400)
  expect(files['/Users/me/.termimates/panel/sess-1.json']).toBeTruthy()
  await $.session.end({ reason: 'resume', sessionId: 'sess-1', resume: { id: 'sess-1' } as never })
  id = 'sess-2'
  await clock.advance(400)
  expect(JSON.parse(files['/Users/me/.termimates/panel/sess-1.json']!).office.lead.status).toBe('off') // 끝난 세션: 퇴근
  await $.prompt.submit({ text: '이어서 하자', wait: false, origin: { kind: 'composer' } })
  await clock.advance(400)
  const snap = JSON.parse(files['/Users/me/.termimates/panel/sess-2.json'] ?? 'null')
  expect(snap?.session).toBe('sess-2') // 새 세션 id 로 이어 씀
  expect(snap.office.prompt).toBe('이어서 하자')
  // 타이머(0.3초 스냅샷)는 멈추지 않았다: 훅은 스냅샷을 직접 안 쓰니, 새 직원이 파일에 보이면 타이머가 쓴 것
  const before = writes2
  await $.agent.spawn({
    tool_use_id: 't1', prompt: '', description: '로그인 고치기', subagentType: 'executor',
    provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false,
  })
  await clock.advance(400)
  expect(writes2).toBeGreaterThan(before)
  expect(JSON.parse(files['/Users/me/.termimates/panel/sess-2.json']!).units.map((u: { key: string }) => u.key)).toEqual(['개발자'])
  expect(snap.office.lead.recent.some(([, t]: [number, string]) => t === '퇴근')).toBe(true)
})
