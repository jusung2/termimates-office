// 전기세(토큰) · 피로도(컨텍스트) 계산. 순수 함수만 둔다.
// 숫자는 엔진이 이미 센 것(turn.complete 의 usage, session.measure 의 context)만 쓴다 → 모델 호출 없음, 토큰 0.
// 일반 = 새로 읽음 + 캐시에 새로 씀, 할인 = 다시 읽음, 고출력 = 써냄.

import type { Fill, Power, Tok } from '../types'

export const ZERO: Tok = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }

export const EMPTY_POWER: Power = {
  job: ZERO, session: ZERO, byWorker: {}, workers: {}, day: '', mine: 0, today: 0,
}

type ApiUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export function tokOf(u: ApiUsage): Tok {
  return {
    input: u.input_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
    cacheWrite: u.cache_creation_input_tokens || 0,
    output: u.output_tokens || 0,
  }
}

export function plus(a: Tok | undefined, b: Tok): Tok {
  const x = a ?? ZERO
  return { input: x.input + b.input, cacheRead: x.cacheRead + b.cacheRead, cacheWrite: x.cacheWrite + b.cacheWrite,
    output: x.output + b.output }
}

export const sum = (t: Tok | undefined): number => (t ? t.input + t.cacheRead + t.cacheWrite + t.output : 0)

/** 쉬운 숫자: 9,800 · 1.2만 · 42만 · 1.3억 */
export function man(n: number): string {
  const v = Math.max(0, Math.round(n))
  if (v < 10000) return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  if (v < 100000) return `${Math.round(v / 1000) / 10}만`
  if (v < 100000000) return `${Math.round(v / 10000)}만`
  return `${Math.round(v / 10000000) / 10}억`
}

/** 일반 3만 · 할인 37만 · 고출력 2만 */
export function parts(t: Tok): string {
  return `일반 ${man(t.input + t.cacheWrite)} · 할인 ${man(t.cacheRead)} · 고출력 ${man(t.output)}`
}

// 피로도 단계 (따뜻한 색 = 사람)
export const STAGES = [
  { upto: 40, name: '쌩쌩', color: '#3FA66B' },
  { upto: 70, name: '하품', color: '#E0B23A' },
  { upto: 90, name: '피곤', color: '#E07A3A' },
  { upto: Infinity, name: '녹초', color: '#C9423A' },
] as const

export function percentOf(f: Fill | undefined): number | undefined {
  if (!f || !f.window || f.tokens <= 0) return undefined
  return Math.round((f.tokens / f.window) * 100)
}

export function stageOf(pct: number) {
  return STAGES.find(s => pct < s.upto) ?? STAGES[3]
}

/** 피로도 안내: 단계별로 지금 할 일 (/compact, 또는 기록하고 /clear) */
export function adviceOf(pct: number | undefined): { title: string; lines: string[]; act: boolean } {
  if (pct === undefined) return { title: '아직 안 잼', lines: ['Claude 가 한 번 대답하면 대화가 얼마나 찼는지 재요.'], act: false }
  if (pct < 40) return { title: `${pct}% 쌩쌩 — 괜찮아요`, lines: ['그대로 일하면 돼요.'], act: false }
  if (pct < 70) {
    return { title: `${pct}% 하품 — 아직 괜찮아요`,
      lines: ['하던 일을 이어 가는 거면 그대로 두세요.',
        'Claude 는 대답할 때마다 지금까지 대화를 처음부터 다시 읽어요. 상관없는 새 일을 여기서 시키면 앞 이야기까지 매번 다시 읽느라 전기세가 더 나와요.',
        '→ 새 일이면 /clear 로 새 대화를 열고 시키세요.'], act: true }
  }
  const head = pct < 90 ? `${pct}% 피곤 — 정리할 때예요` : `${pct}% 녹초 — 곧 Claude 가 알아서 정리(자동 compact)해요`
  return { title: head, lines: [
    '하던 일을 마무리하고 둘 중 하나:',
    '① 같은 일을 이어 갈 거면 → /compact  (지금까지를 요약해서 대화를 가볍게. 흐름은 남아요)',
    '② 다른 일로 넘어갈 거면 → 지금까지 한 일 · 정한 것 · 남은 일을 파일(예: HANDOFF.md)에 적게 한 뒤 → /clear 로 새로 시작',
    '   새 대화에서 「HANDOFF.md 읽고 이어서 하자」 하면 돼요. /clear 는 대화를 비워서 되돌릴 수 없으니 적는 것부터.',
  ], act: true }
}

/** 막대 칸: [찬 칸, 빈 칸] */
export function bar(frac: number, cells: number): [number, number] {
  const n = Math.max(0, Math.min(cells, Math.round(Math.max(0, Math.min(1, frac)) * cells)))
  return [n, cells - n]
}

// 전기 계량기 색 (시안 LED = 전기)
export const LED = { on: '#2BB3C0', off: '#2A4250', num: '#5CE1E6', warn: '#E07A3A' } as const

/** 이 컴퓨터 시간 기준 날짜 YYYY-MM-DD */
export function dayOf(now: number): string {
  const d = new Date(now)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** store 키: 세션마다 자기 키만 쓴다 (여러 창이 같이 써도 서로 덮어쓰지 않음) */
export const dayKey = (day: string, sid: string) => `day:${day}:${sid}`

/** 날짜별 합계 → 오늘 합계와 최근 7일(오늘 빼고, 기록 있는 날) 하루 평균 */
export function baseline(totals: Record<string, number>, today: string): { today: number; usual?: number } {
  const past = Object.keys(totals).filter(d => d < today && totals[d]! > 0).sort().slice(-7)
  const usual = past.length ? past.reduce((n, d) => n + totals[d]!, 0) / past.length : undefined
  return { today: totals[today] ?? 0, usual }
}

/** 이 날짜보다 오래된(14일 넘은) 기록인가 */
export function isOld(day: string, today: string): boolean {
  const t = Date.parse(today + 'T00:00:00Z')
  const d = Date.parse(day + 'T00:00:00Z')
  return Number.isFinite(t) && Number.isFinite(d) && t - d > 14 * 86400000
}

export const average = (xs: number[]): number | undefined =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined
