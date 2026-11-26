import { expect, test } from 'claude-code/testing'

import { donePaper, EMPTY, isAsk, missedIn, onComplete, onMissed, onPrompt, onSpawn, onTodoMarks, paperLine, pickPaper } from '../hooks/office'
import type { Office } from '../types'

const todo = (o: Office, who: string, items: [string, string][]) =>
  onTodoMarks(o, who, 'TodoWrite', { todos: items.map(([content, status]) => ({ content, status, activeForm: content })) })
const papers = (o: Office) => (o.papers ?? []).map(p => [p.who, p.why, p.text])

test('놓친 일 ①: 팀장 차례가 끝났는데 할 일 목록에 안 끝난 줄 → 줄마다 서류, 나중에 끝내면 사라짐', () => {
  let o = onPrompt(EMPTY, '로그인 만들어줘', 1000)
  o = todo(o, 'main', [['화면 만들기', 'completed'], ['시험 돌리기', 'in_progress'], ['README 고치기', 'pending']])
  o = onMissed(onComplete(o, undefined, '다 했어요', false, 2000), undefined, '다 했어요', false, 2000)
  expect(papers(o)).toEqual([['main', 'todo', '시험 돌리기'], ['main', 'todo', 'README 고치기']])
  expect(o.lead.recent[0]![1]).toContain('📄 놓친 일 서류: 「README 고치기」 — 팀장 자리') // 사무실 소식 한 줄
  o = onMissed(o, undefined, '', false, 3000)
  expect(o.papers).toHaveLength(2) // 같은 줄은 또 안 떨어뜨림
  o = todo(o, 'main', [['화면 만들기', 'completed'], ['시험 돌리기', 'completed'], ['README 고치기', 'pending']])
  expect(papers(o)).toEqual([['main', 'todo', 'README 고치기']]) // 끝낸 줄의 서류는 사라짐
  // 다 끝난 목록이면 서류 없음
  let q = todo(onPrompt(EMPTY, 'x', 1), 'main', [['a', 'completed']])
  q = onMissed(q, undefined, '', false, 5)
  expect(q.papers ?? []).toEqual([])
})

test('놓친 일 ①: 직원이 TaskCreate 로 적은 일은 그 직원 차례가 끝날 때, TaskUpdate completed 면 사라지고 deleted 면 없어짐', () => {
  let o = onSpawn(onPrompt(EMPTY, '고쳐 줘', 1000), { id: 'd1', type: 'executor', description: '로그인 고치기', background: true }, 1100)
  o = onTodoMarks(o, 'd1', 'TaskCreate', { subject: '비밀번호 칸 검사', description: '' }, { task: { id: '7', subject: '비밀번호 칸 검사' } })
  o = onTodoMarks(o, 'd1', 'TaskCreate', { subject: '버튼 색', description: '' }, { task: { id: '8', subject: '버튼 색' } })
  o = onTodoMarks(o, 'd1', 'TaskCreate', { subject: '결과 없는 호출', description: '' }, undefined) // id 를 모르면 흔적 없음
  o = onMissed(o, undefined, '', false, 1500) // 팀장 차례 끝: 팀장이 적은 줄이 아니라 서류 없음
  expect(o.papers ?? []).toEqual([])
  o = onMissed(onComplete(o, 'd1', '고쳤어요', false, 2000), 'd1', '고쳤어요', false, 2000)
  expect(o.papers!.map(p => [p.unit, p.text, p.ref])).toEqual([['개발자', '비밀번호 칸 검사', 'task:7'], ['개발자', '버튼 색', 'task:8']])
  o = onTodoMarks(o, 'main', 'TaskUpdate', { taskId: '7', status: 'completed' })
  o = onTodoMarks(o, 'main', 'TaskUpdate', { taskId: '8', status: 'deleted' })
  expect(o.papers).toEqual([])
})

test('놓친 일 ②: 「했어?」 류로 물은 차례의 답에 「깜빡」 류가 있으면 서류 (그 문장을 짧게), 아니면 없음', () => {
  expect(isAsk('테스트 다 돌렸어?')).toBe(true)
  expect(isAsk('README 도 확인했어?')).toBe(true)
  expect(isAsk('로그인 화면 만들어줘')).toBe(false)
  expect(missedIn('네. 죄송해요, 로그인 시험은 깜빡했어요. 지금 돌릴게요.')).toBe('로그인 시험은 깜빡했어요.')
  expect(missedIn('확인해 보니 놓친 건 없어요.')).toBeUndefined()
  expect(missedIn('다 했어요 ✓')).toBeUndefined()
  const ask = (q: string, a: string) => {
    const o = { ...onPrompt(EMPTY, q, 1000), asked: isAsk(q) }
    return onMissed(onComplete(o, undefined, a, false, 2000), undefined, a, false, 2000)
  }
  expect(papers(ask('README 고쳤어?', 'README 의 설치 줄은 아직 안 했어요.'))).toEqual([['main', 'said', 'README 의 설치 줄은 아직 안 했어요.']])
  expect(ask('README 고쳤어?', '네, 다 고쳤어요.').papers ?? []).toEqual([])
  expect(ask('README 고쳐 줘', '설치 줄은 깜빡했어요.').papers ?? []).toEqual([]) // 물음이 아니면 안 봄 (짐작 안 함)
  expect(ask('README 고쳤어?', '깜빡했어요.').asked).toBe(false) // 한 번만
})

test('놓친 일 ③: 직원이 중단되면 서류 (맡긴 일 글로)', () => {
  let o = onSpawn(onPrompt(EMPTY, '조사', 1000), { id: 'x1', type: 'Explore', description: '결제 코드 찾아 보기', background: true }, 1100)
  o = onMissed(onComplete(o, 'x1', '', true, 2000), 'x1', '', true, 2000)
  expect(o.papers!.map(p => [p.who, p.unit, p.why, p.text])).toEqual([['x1', '리서처', 'abort', '결제 코드 찾아 보기']])
  // 끝까지 한 직원은 서류 없음
  let q = onSpawn(onPrompt(EMPTY, '조사', 1000), { id: 'x2', type: 'Explore', description: '찾기', background: true }, 1100)
  q = onMissed(onComplete(q, 'x2', '찾음', false, 2000), 'x2', '찾음', false, 2000)
  expect(q.papers ?? []).toEqual([])
})

test('서류 줍기: 팀장이 주우러 감 → 입력창 문장 → 서류 없어짐 (못 넘기면 바닥에 도로)', () => {
  let o = todo(onPrompt(EMPTY, 'x', 1000), 'main', [['시험 돌리기', 'pending']])
  o = onMissed(o, undefined, '', false, 2000)
  const id = o.papers![0]!.id
  o = pickPaper(o, id, 3000)
  expect(o.papers![0]!.picked).toBe(3000)
  expect(o.lead.action).toContain('놓친 일 서류')
  expect(pickPaper(o, id, 3500).papers![0]!.picked).toBe(3000) // 두 번 눌러도 한 번
  expect(paperLine(o.papers![0]!)).toBe('놓친 일 다시 확인: 시험 돌리기')
  expect(donePaper(o, id, 4000, true).papers![0]!.picked).toBeUndefined()
  expect(donePaper(o, id, 4000).papers).toEqual([])
  // 넘긴 뒤 또 차례가 끝났는데 여전히 안 끝났으면 새 서류
  expect(onMissed(donePaper(o, id, 4000), undefined, '', false, 5000).papers).toHaveLength(1)
})
