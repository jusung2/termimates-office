import { expect, test } from 'claude-code/testing'

import { jobOfW } from '../hooks/office'
import { tagText } from '../hooks/register'
import { jobOf } from '../hooks/words'
import type { Worker } from '../types'

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
