import { expect, test } from 'claude-code/testing'

import { EMPTY, onComplete, onPrompt, onSpawn, reviewLine } from '../hooks/office'
import type { Spawn } from '../hooks/office'
import { reportOf } from '../hooks/replay'
import { EMPTY_POWER } from '../hooks/power'
import { isChecker, reasonOf, verdictOf } from '../hooks/words'

test('검사 직원 알아보기: 종류 이름 · 맡긴 일 (되는 예)', () => {
  expect(isChecker('oh-my-claudecode:code-reviewer')).toBe(true)
  expect(isChecker('critic')).toBe(true)
  expect(isChecker('verifier')).toBe(true)
  expect(isChecker('llm-judge')).toBe(true)
  expect(isChecker('security-auditor')).toBe(true)
  expect(isChecker('general-purpose', '회원가입 코드 검토')).toBe(true)
  expect(isChecker('general-purpose', 'Review the PR diff')).toBe(true)
  expect(isChecker('general-purpose', '결과 심사')).toBe(true)
  // QA 종류는 「남의 결과를 보고 판정」 하는 말이 있을 때만
  expect(isChecker('qa-tester', '개발자 결과 검토하고 승인 여부 판단')).toBe(true)
})

test('검사 직원 알아보기: 안 되는 예 (QA 테스트 돌리기 · 직접 만드는 일 · 다른 종류)', () => {
  expect(isChecker('qa-tester', '로그인 테스트 돌리고 결과 검증')).toBe(false) // 테스트 돌리기 = 원래 QA 일
  expect(isChecker('test-engineer', 'verify build passes')).toBe(false)
  expect(isChecker('general-purpose', 'QA 1팀 1-1 핵심 흐름')).toBe(false)
  expect(isChecker('general-purpose', '리뷰 반영해서 코드 고치기')).toBe(false) // 검토 말이 있어도 자기가 고치는 일
  expect(isChecker('general-purpose', 'Implement login and verify')).toBe(false)
  expect(isChecker('executor', '구현 후 검증')).toBe(false) // 일하는 종류는 맡긴 일 글로 안 바꿈
  expect(isChecker('designer', '시안 검토')).toBe(false)
  expect(isChecker('main', '검토')).toBe(false)
})

test('통과 · 반려 · 애매 뽑기 (보수적으로)', () => {
  expect(verdictOf('판정: 반려\n이유: 빈 칸 검사가 없어요')).toBe('reject')
  expect(verdictOf('REJECT — missing tests')).toBe('reject')
  expect(verdictOf('All tests passed. Changes requested on naming.')).toBe('reject') // 센 반려가 약한 통과를 이김
  expect(verdictOf('통과 못 함: 비밀번호 확인 칸이 없음')).toBe('reject')
  expect(verdictOf('테스트 2개 실패, 수정 필요')).toBe('reject')
  expect(verdictOf('LGTM 👍')).toBe('pass')
  expect(verdictOf('검토 결과 통과입니다. 실패한 테스트 없음.')).toBe('pass') // 「실패 … 없음」 은 반려가 아님
  expect(verdictOf('APPROVED. 0 failures.')).toBe('pass')
  expect(verdictOf('결과: PASS')).toBe('pass')
  // 애매하면 「검토 끝」
  expect(verdictOf('코드를 읽어 봤어요. 구조가 깔끔하네요.')).toBe('done')
  expect(verdictOf('승인. 다만 테스트 하나는 실패')).toBe('done') // 센 통과 + 약한 반려
  expect(verdictOf('')).toBe('done')
  // 판정 줄이 있으면 그 줄이 먼저
  expect(verdictOf('지난번엔 반려했지만\n최종 판정: 통과 ✓')).toBe('pass')
})

test('반려 이유: 리뷰어 글에서 뽑을 수 있을 때만 한 줄', () => {
  expect(reasonOf('판정: 반려\n이유: 비밀번호 확인 칸이 비어도 가입돼요.')).toBe('비밀번호 확인 칸이 비어도 가입돼요.')
  expect(reasonOf('**판정: 반려**\n- 빈 칸 검사가 없어요')).toBe('빈 칸 검사가 없어요')
  expect(reasonOf('REJECT: the login form has no error message')).toBe('the login form has no error message')
  expect(reasonOf('반려 ✗')).toBeUndefined() // 반려 말뿐 → 이유 없음
  expect(reasonOf('')).toBeUndefined()
})

const sp = (id: string, type: string, description: string, x: Partial<Spawn> = {}): Spawn => ({ id, type, description, background: false, ...x })

test('검사 대상 짐작 · 결과 · 반려 횟수 · 소식 · 보고서', () => {
  let o = onPrompt(EMPTY, '회원가입 만들어줘', 1000)
  o = onSpawn(o, sp('d1', 'general-purpose', '회원가입 코드 짜기'), 2000)
  o = onSpawn(o, sp('x1', 'Explore', '다른 곳 조사', { parentAgentId: 'someone' }), 2100) // 다른 부모 → 대상 아님
  o = onComplete(o, 'd1', '완성', false, 3000)
  o = onComplete(o, 'x1', '찾음', false, 3500)
  o = onSpawn(o, sp('r1', 'code-reviewer', '회원가입 코드 검토'), 4000)
  const r1 = o.workers.find(w => w.id === 'r1')!
  expect(r1.checker).toBe(true)
  expect(r1.reviewOf).toBe('d1')
  o = onComplete(o, 'r1', '판정: 반려\n이유: 빈 칸 검사가 없어요', false, 5000)
  expect(o.reviews).toEqual([{ at: 5000, by: 'r1', of: 'd1', unit: '개발자', verdict: 'reject', reason: '빈 칸 검사가 없어요', nth: 1 }])
  expect(o.workers.find(w => w.id === 'r1')!.recent[0]![1]).toBe('검토: 개발자 서류 반려 ✗ — 빈 칸 검사가 없어요') // 사무실 소식 한 줄
  // 고쳐 와서 또 반려 → 2번째, 그다음 통과
  o = onSpawn(o, sp('d2', 'general-purpose', '반려된 곳 고치기'), 6000)
  o = onComplete(o, 'd2', '고침', false, 7000)
  o = onSpawn(o, sp('r2', 'code-reviewer', '다시 검토'), 8000)
  expect(o.workers.find(w => w.id === 'r2')!.reviewOf).toBe('d2')
  o = onComplete(o, 'r2', 'REJECT', false, 9000)
  expect(o.reviews![1]).toMatchObject({ verdict: 'reject', nth: 2, reason: undefined })
  expect(reviewLine(o.reviews![1]!)).toBe('검토: 개발자 서류 반려 ✗ (2번째)')
  o = onSpawn(o, sp('r3', 'code-reviewer', '마지막 검토'), 10000)
  o = onComplete(o, 'r3', 'LGTM', false, 11000)
  expect(o.reviews![2]).toMatchObject({ verdict: 'pass', of: 'd2' })
  // 새 지시가 오면 반려 횟수는 처음부터
  o = onPrompt(o, '다음 일', 12000)
  o = onSpawn(o, sp('d3', 'general-purpose', '다른 코드'), 12100)
  o = onComplete(o, 'd3', '끝', false, 12200)
  o = onSpawn(o, sp('r4', 'critic', '검토'), 12300)
  o = onComplete(o, 'r4', '반려', false, 12400)
  expect(o.reviews![3]).toMatchObject({ verdict: 'reject', nth: 1 })
  // 보고서: 이번 일 검사 결과
  const rep = reportOf(o, 12000, 13000, EMPTY_POWER)
  expect(rep.reviews).toEqual([{ by: 'QA', unit: '개발자', verdict: 'reject', reason: undefined, nth: 1 }])
})

test('검사 직원이 없으면 그대로: 검사 표시 · 결과가 안 생김', () => {
  let o = onSpawn(EMPTY, sp('d1', 'general-purpose', '코드 짜기'), 1)
  o = onSpawn(o, sp('q1', 'qa-tester', '로그인 테스트 돌리기'), 2)
  o = onComplete(o, 'd1', '반려할 것 없이 완성', false, 3) // 검사 직원이 아닌 글에 반려 말이 있어도
  o = onComplete(o, 'q1', '테스트 1개 실패', false, 4)
  expect(o.reviews).toBeUndefined()
  expect(o.workers.some(w => w.checker || w.reviewOf)).toBe(false)
  // 끝난 직원이 없으면 대상을 짐작하지 않음
  const p = onSpawn(EMPTY, sp('r1', 'verifier', '검증'), 1)
  expect(p.workers[0]!.reviewOf).toBeUndefined()
  // 멈춘(중단) 검사는 결과를 안 남김
  expect(onComplete(p, 'r1', '반려', true, 2).reviews).toBeUndefined()
})
