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
  on('process.run', () => ({ value: { exitCode: 0, stdout: '/Users/me\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.write', (_, e) => { files[e.path] = e.text; return { value: undefined } })
  on('ui.toast', (_, e) => { toasts.push(String(e.text ?? e)); return { value: undefined } })
  on('ui.panes', () => ({ value: [] }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  await $.session.start({ cwd: '/work/a', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'termimates', args: '웹', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  expect(toasts.some(t => t.includes('http://127.0.0.1:8766'))).toBe(true)
  expect(store['web:/work/a']).toBe(true)
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
