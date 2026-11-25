import { expect, test } from 'claude-code/testing'
import { EMPTY, onStart, onWait, onWaitEnd } from '../hooks/office'

test('사장님 확인: 기다리면 손 들고, 끝나면 내린다', () => {
  let o = onStart(EMPTY, 0)
  o = onWait(o, 'main', 'Bash · npm publish 허락해 주세요', 1000, 'toolu_1')
  expect(o.waiting).toEqual({ at: 1000, who: 'main', what: 'Bash · npm publish 허락해 주세요', id: 'toolu_1' })
  expect(o.lead.status).toBe('ask')
  o = onWaitEnd(o, 2000)
  expect(o.waiting).toBeUndefined()
  expect(o.lead.status).toBe('think')
})
