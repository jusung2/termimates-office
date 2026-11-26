import { expect, mock, test } from 'claude-code/testing'

import { EMPTY, onSpawn } from '../hooks/office'
import { isPartner, personaOf, setRoles, tierOfModel, tierText } from '../hooks/words'

test('직급 배지: 모델 이름으로 인턴 · 주니어 · 시니어, 모르면 없음', () => {
  expect(tierOfModel('claude-haiku-5-5')).toBe('intern')
  expect(tierOfModel('claude-sonnet-5-5')).toBe('junior')
  expect(tierOfModel('claude-opus-5-5')).toBe('senior')
  expect(tierOfModel('opus')).toBe('senior') // Agent 호출에 적힌 별명도
  expect(tierOfModel('some-other-model')).toBeUndefined()
  expect(tierOfModel(undefined)).toBeUndefined()
  expect(tierText('junior')).toBe('★★ 주니어')
  expect(tierText('partner')).toBe('🤝 협력사')
})

test('협력사: 종류 이름 · 이름의 낱말(codex · gemini · ccg)로만 알아본다 (맡긴 일 설명은 안 봄) — 에이전트 팀원(teammate)과는 따로', () => {
  expect(isPartner('oh-my-claudecode:codex-worker')).toBe(true)
  expect(isPartner('oh-my-claudecode:gemini')).toBe(true)
  expect(isPartner('general-purpose', 'ccg')).toBe(true)
  expect(isPartner('general-purpose', 'reviewer', '코드 리뷰')).toBe(false)
  expect(isPartner('codexample')).toBe(false) // 낱말 일부만 같으면 아님
  // Claude 직원이 설명에 「gemini 문서 조사」 를 맡아도 협력사가 아니라 모델 직급
  const g = onSpawn(EMPTY, { id: 'g1', type: 'Explore', description: 'gemini 문서 조사', background: true, model: 'claude-haiku-5-5' }, 1)
  expect(g.workers[0]!.tier).toBe('intern')
  // 팀원으로 불렸어도 바깥 AI 가 아니면 협력사 아님, Claude 모델이면 그 직급
  const o = onSpawn(EMPTY, { id: 't1', type: 'general-purpose', description: '화면 고치기', background: true, teammate: true, model: 'claude-sonnet-5-5' }, 1)
  expect(o.workers[0]!.tier).toBe('junior')
  const p = onSpawn(EMPTY, { id: 'c1', type: 'codex', description: '리뷰', background: true, model: 'claude-sonnet-5-5' }, 1)
  expect(p.workers[0]!.tier).toBe('partner') // 바깥 AI 이름이 모델보다 먼저
})

test('페르소나 뽑기: 「너는 … 야」 처럼 성격 · 역할을 입힌 것만, 애매하면 안 뽑음', () => {
  expect(personaOf('너는 까칠한 시니어 리뷰어야. 이 PR 을 봐 줘')).toBe('까칠한 시니어 리뷰어')
  expect(personaOf('당신은 꼼꼼한 보안 전문가입니다.')).toBe('꼼꼼한 보안 전문가')
  expect(personaOf('You are a grumpy senior reviewer. Look at this diff.')).toBe('grumpy senior reviewer')
  // 안 되는 예
  expect(personaOf('너는 QA team 3 의 한 명')).toBeUndefined() // 역할 이름으로 안 끝남
  expect(personaOf('너는 QA 2팀의 2-1')).toBeUndefined()
  expect(personaOf('너는 이 파일을 고쳐야 해')).toBeUndefined() // 문장이지 성격이 아님
  expect(personaOf('너는 리뷰어야')).toBeUndefined() // 한 낱말 = 그냥 역할
  expect(personaOf('You are a helpful assistant.')).toBeUndefined()
  expect(personaOf('로그인 화면 시안')).toBeUndefined()
  expect(personaOf(undefined)).toBeUndefined()
  // 직원에 붙는다
  const o = onSpawn(EMPTY, { id: 'r1', type: 'code-reviewer', description: 'PR 리뷰', background: true,
    prompt: '너는 까칠한 시니어 리뷰어다. 봐 줘', model: 'claude-haiku-5-5' }, 1)
  expect(o.workers[0]!.persona).toBe('까칠한 시니어 리뷰어')
  expect(o.workers[0]!.tier).toBe('intern')
})

test('roles.json 이 먼저: 사용자가 정한 페르소나 · 모델이 뽑은 것보다 우선', () => {
  setRoles({ 'oh-my-claudecode:code-reviewer': { persona: '까칠한 시니어', model: 'opus' }, executor: { model: 'haiku' }, writer: '글쓴이' })
  try {
    const a = onSpawn(EMPTY, { id: 'a', type: 'oh-my-claudecode:code-reviewer', description: '리뷰', background: true,
      prompt: '너는 친절한 주니어 개발자야', model: 'claude-sonnet-5-5' }, 1).workers[0]!
    expect(a.persona).toBe('까칠한 시니어')
    expect(a.tier).toBe('senior')
    expect(a.model).toBe('opus')
    const b = onSpawn(EMPTY, { id: 'b', type: 'oh-my-claudecode:executor', description: '구현', background: true, model: 'claude-opus-5-5' }, 1).workers[0]!
    expect(b.tier).toBe('intern') // 짧은 이름(executor)으로 적어도 맞춘다
    const c = onSpawn(EMPTY, { id: 'c', type: 'writer', description: '문서', background: true }, 1).workers[0]!
    expect(c.tier).toBeUndefined() // 글자 값은 이름표 이름일 뿐 → 직급 모름 = 배지 없음
  } finally {
    setRoles({})
  }
})

test('실제 훅: agent.spawn 결과의 model 로 직급, roles.json 페르소나가 카드에 보인다', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 10, 26, 3, 0, 0) })
  const files: Record<string, string> = {
    '/home/me/.termimates/roles.json': JSON.stringify({ 'code-reviewer': { name: '리뷰 담당', persona: '까칠한 시니어' } }),
  }
  on('command.register', () => ({ value: { command: 'termimates' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('store.get', (_, e) => ({ value: e.key === 'welcomed' ? true : undefined }))
  on('store.set', () => ({ value: undefined }))
  on('store.keys', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '/home/me\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.read', (_, e) => (e.path in files ? { value: files[e.path]! } : { deny: 'no file' }) as never)
  on('fs.list', () => ({ value: [] as never }))
  let n = 0
  on('agent.spawn', (_, e) => ({ model: e.subagentType === 'code-reviewer' ? 'claude-opus-5-5' : 'claude-haiku-5-5', agentId: 'a' + ++n }))
  await $.session.start({ cwd: '/work/a', surface: 'terminal', isInteractive: true })
  const args = (type: string, description: string) => ({
    tool_use_id: 't-' + type, prompt: '일', description, subagentType: type,
    provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false,
  }) as const
  await $.agent.spawn(args('code-reviewer', 'PR 리뷰'))
  await $.agent.spawn(args('designer', '시안'))
  const ui = await $.ui.mount({
    plugin: 'termimates', component: 'Pane', requestId: 'office', surface: 'terminal',
    props: { title: '사무실', isFocused: false, bodyColumns: 72, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
  })
  expect((await ui.find({ type: 'Text', text: ' ★' }))?.text).toBe(' ★') // 자리에 들어가면 이름표 뒤에 별 (designer = 인턴)
  expect((await ui.find({ type: 'Text', text: / ★★★$/ }))).toBeUndefined() // 「리뷰 담당」 은 길어서 별을 이름표에 안 붙임 (카드에서 봄)
  await ui.press({ key: 'pick-리뷰 담당' })
  expect((await ui.find({ type: 'Text', text: /모델 직급: ★★★ 시니어 · claude-opus-5-5/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /페르소나: 「까칠한 시니어」/ }))?.text).toBeTruthy()
  await ui.unmount()
})
