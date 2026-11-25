import { expect, test } from 'claude-code/testing'

import { EMPTY, jobOfW, onComplete, onSpawn, unitOf } from '../hooks/office'
import { draw, isMoving, layout } from '../hooks/scene'

test('서류 들고 걷기 · 서류 날리기: 가는 내내 그림이 깨지지 않고, 끝나면 멈춘다', () => {
  const t0 = 1_000_000
  let o = onSpawn(EMPTY, { id: 'a1', type: 'Explore', description: '찾기', background: false }, t0)
  o = onSpawn(o, { id: 'a2', type: 'Plan', description: '정리', background: false }, t0)
  o = onComplete(o, 'a1', '찾았어요', false, t0 + 2000)
  for (const width of [24, 60, 120]) {
    const L = layout(o, width, unitOf, jobOfW)
    for (let ms = 0; ms <= 12000; ms += 100) {
      const px = draw(o, L, t0 + ms, 12)
      expect(px.length).toBe(L.cols * L.rows * 2)
    }
  }
  expect(isMoving(o, t0 + 2500)).toBe(true) // 서류 들고 걷는 중
  expect(isMoving(o, t0 + 2000 + 7000)).toBe(true) // 보고 다녀와서 문으로 퇴근하는 중
  expect(isMoving(o, t0 + 2000 + 9000)).toBe(false) // 다 끝남
})
