import { expect, test } from 'claude-code/testing'

import { EMPTY, onSpawn, onToolStart, readerOf } from '../hooks/office'
import { setLocalNotes, skillNote, skillRole } from '../hooks/skills'

test('스킬 담당 · 한 줄 설명: 이 컴퓨터 설정 → 이름 · 설명 낱말 → 팀장', () => {
  setLocalNotes({})
  expect(skillRole('qa-checklist')).toBe('QA')
  expect(skillRole('ui-design')).toBe('디자이너')
  expect(skillRole('web-scraper')).toBe('리서처')
  expect(skillRole('weekly', '배포 전에 빌드 확인')).toBe('개발자')
  expect(skillRole('something-else')).toBe('팀장')
  expect(skillNote('weekly', '이번 주 커밋을 모아요. 금요일마다.')).toBe('이번 주 커밋을 모아요.')
  // 이 컴퓨터의 ~/.termimates/skill-notes.json 이 있으면 그게 먼저
  setLocalNotes({ 'my-tool': { note: '내가 만든 도구예요', role: 'designer' }, _안내: ['무시'] })
  expect(skillNote('my-tool')).toBe('내가 만든 도구예요')
  expect(skillRole('plugin:my-tool')).toBe('디자이너')
  setLocalNotes({})
})

test('책 꺼내러 가는 사람: 담당 직원이 있으면 그 직원, 없으면 팀장, 직원이 직접 쓰면 그 직원', () => {
  setLocalNotes({})
  const t = 1000
  let o = onSpawn(EMPTY, { id: 'd1', type: 'designer', description: '시안', background: true }, t)
  o = onSpawn(o, { id: 'x1', type: 'Explore', description: '찾기', background: true }, t)
  expect(readerOf(o, 'main', 'ui-design')).toBe('d1') // 담당 디자이너가 사무실에 있음
  expect(readerOf(o, 'main', 'qa-checklist')).toBe('main') // QA 직원 없음 → 팀장
  expect(readerOf(o, 'main', 'something-else')).toBe('main') // 담당이 팀장
  expect(readerOf(o, 'x1', 'ui-design')).toBe('x1') // 리서처가 직접 썼으면 리서처가 읽는다
  const after = onToolStart(o, 'main', 'Skill', 'animate', undefined, t + 10)
  expect(after.shelf?.at(-1)).toEqual({ at: t + 10, who: 'd1', book: 'animate' })
})
