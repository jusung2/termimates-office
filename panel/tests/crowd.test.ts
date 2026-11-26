import { expect, test } from 'claude-code/testing'

import { EMPTY, jobOfW, LINGER_MS, onComplete, onPrompt, onSpawn, onToolStart, onTurnStart, settleIdle, unitsOf } from '../hooks/office'
import type { Spawn } from '../hooks/office'
import { tagText } from '../hooks/register'
import { jobOf } from '../hooks/words'
import type { Worker } from '../types'

const sp = (id: string, type: string, description: string, x: Partial<Spawn> = {}): Spawn => ({ id, type, description, background: true, ...x })
// 한글 · 한자는 두 칸, 「…」 같은 문장 부호(0x2000~0x2e7f)는 한 칸 (register.tsx dw 와 같은 셈)
const dw = (s: string) => [...s].reduce((n, ch) => { const c = ch.codePointAt(0) ?? 0; return n + (c > 0x1100 && !(c >= 0x2000 && c < 0x2e80) ? 2 : 1) }, 0)

test('이름표 줄이기: 그대로 → 나란히 자리 번호 빼기 → 띄어쓰기 빼기 → 「…」, 언제나 room 안', () => {
  expect(tagText({ name: '디자이너 1/3', kind: 'twin', count: 1 }, 16)).toBe('디자이너 1/3')
  expect(tagText({ name: '디자이너 1/3', kind: 'twin', count: 1 }, 10)).toBe('디자이너') // 「디자이너1/3」 로 붙이지 않음
  expect(tagText({ name: 'designer 1/3', kind: 'twin', count: 1 }, 10)).toBe('designer')
  expect(tagText({ name: '리서처', kind: 'fold', count: 3 }, 10)).toBe('리서처')
  expect(tagText({ name: '개발자', kind: 'unit', count: 2 }, 10)).toBe('개발자 ×2')
  expect(tagText({ name: 'QA 1팀', kind: 'unit', count: 3 }, 8)).toBe('QA1팀×3') // 번호 없는 자리는 띄어쓰기부터
  const long = tagText({ name: 'document-specialist 2/2', kind: 'twin', count: 1 }, 10)
  expect(long.endsWith('…')).toBe(true)
  expect(dw(long)).toBeLessThanOrEqual(10)
})

test('표준 이름(designer · executor)은 플러그인 접두사가 붙어도 쉬운 역할, 예전 규칙으로 저장된 직원도 다시 고름 · 내가 지은 이름은 그대로', () => {
  expect(jobOf('oh-my-claudecode:designer')).toBe('디자이너')
  expect(jobOf('oh-my-claudecode:executor')).toBe('개발자')
  expect(jobOf('my-plugin:verifier')).toBe('QA')
  expect(jobOf('copywriter')).toBe('copywriter')
  // 규칙이 생기기 전에 출근해 job 에 종류 이름 그대로(「designer」) 저장된 직원 (실제 스냅샷: role designer · job designer)
  const old = (role: string, job: string): Worker => ({ id: 'x', role, job, task: '', status: 'idle', action: '', since: 0, started: 0, background: true, recent: [] })
  expect(jobOfW(old('designer', 'designer'))).toBe('디자이너')
  expect(jobOfW(old('executor', 'executor'))).toBe('개발자')
  expect(jobOfW(old('oh-my-claudecode:designer', 'designer'))).toBe('디자이너')
  expect(jobOfW(old('copywriter', 'copywriter'))).toBe('copywriter') // 내가 지은 이름
  expect(jobOfW(old('designer', '시안 담당'))).toBe('시안 담당') // 사용자가 바꾼 이름
})

test('팀원(이름 붙여 부른 에이전트)도 한 차례 끝나면 서류 보고 → 퇴근, 메시지 받아 다시 일하면 다시 출근', () => {
  let o = onPrompt(EMPTY, '시안', 1000)
  for (const n of ['a', 'b', 'c']) o = onSpawn(o, sp(n, 'designer', `시안 ${n}`, { teammate: true, name: `plan-${n}` }), 2000)
  o = onComplete(o, 'a', '시안 완료', false, 5000)
  const a = o.workers.find(w => w.id === 'a')!
  expect(a.status).toBe('done')
  expect(a.ended).toBe(5000)
  // 퇴근 걸음이 끝나면 자리에서 빠진다 (예전엔 몇 시간씩 「쉬는 중」 으로 남음)
  const present = (t: number) => unitsOf(o, t).flatMap(u => u.present.map(w => w.id))
  expect(present(5000 + LINGER_MS + 1000)).toEqual(['b', 'c'])
  // SendMessage 로 다시 깨우면 같은 id 로 차례가 시작 → 다시 출근
  o = onTurnStart(o, 'a', 60000)
  const back = o.workers.find(w => w.id === 'a')!
  expect(back.ended).toBeUndefined()
  expect(back.started).toBe(60000)
  expect(present(60001)).toContain('a')
  o = onComplete(o, 'a', '또 완료', false, 70000)
  o = onToolStart(o, 'a', 'Edit', 'x.ts', undefined, 80000) // 도구부터 와도 다시 출근
  expect(o.workers.find(w => w.id === 'a')!.ended).toBeUndefined()
})

test('예전 규칙으로 저장된 「쉬는 중」 팀원은 다시 불러올 때 퇴근 처리 (일하는 팀원 · 일반 직원은 그대로)', () => {
  const w = (id: string, x: Partial<Worker>): Worker => ({ id, role: 'designer', task: '', status: 'idle', action: '', since: 100, started: 0, background: true, recent: [], ...x })
  const o = { ...EMPTY, workers: [w('t1', { teammate: true }), w('t2', { teammate: true, status: 'work' }), w('s1', { status: 'idle' })] }
  const out = settleIdle(o)
  expect(out.workers.map(x => x.ended)).toEqual([100, undefined, undefined])
  expect(settleIdle(out)).toBe(out)
})
