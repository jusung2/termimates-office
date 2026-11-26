// 다시 보기 · 보고서: 이번 일에서 일어난 일을 적어 두었다가, 시연과 같은 장치로 빠르게 다시 틀고, 끝나면 한 장으로 정리한다.
// 실제 훅과 같은 함수(office.ts)로 장면을 다시 만들어서 실제와 똑같이 보인다. 토큰 0.

import type { Demo, LogEntry, Office, Power, Report } from '../types'
import type { Step } from './demo'
import { onComplete, onPrompt, onSpawn, onTodos, onToolEnd, onToolStart, unitOf } from './office'
import type { Spawn } from './office'
import { sum } from './power'

const O = (fn: (o: Office, now: number) => Office) => (d: Demo, now: number): Demo => ({ ...d, office: fn(d.office, now) })

/** 적어 둔 일 → 다시 보기 단계 (speed 배 빠르게, 한 단계는 0.12~2.2초 사이) */
export function stepsFromLog(log: LogEntry[], speed = 4): Step[] {
  const out: Step[] = []
  let prev = log[0]?.t ?? 0
  for (const e of log) {
    const wait = out.length ? Math.max(120, Math.min(2200, (e.t - prev) / speed)) : 800
    prev = e.t
    const a = e.a
    switch (e.k) {
      case 'prompt': out.push({ wait, run: O((o, n) => onPrompt(o, String(a[0] ?? ''), n)) }); break
      case 'spawn': out.push({ wait, run: O((o, n) => onSpawn(o, a[0] as Spawn, n)) }); break
      case 'start': {
        const [who, tool, target, sub, raw] = a as [string, string, string | undefined, string | undefined, Record<string, unknown> | undefined]
        out.push({ wait, run: O((o, n) => onToolStart(who === 'main' && raw ? onTodos(o, tool, raw) : o, who, tool, target, sub, n)) })
        break
      }
      case 'end': {
        const [who, tool, target, sub, failed, err] = a as [string, string, string | undefined, string | undefined, boolean, string | undefined]
        out.push({ wait, run: O((o, n) => onToolEnd(o, who, tool, target, sub, failed, err, n)) })
        break
      }
      case 'done': out.push({ wait, run: O((o, n) => onComplete(o, a[0] as string | undefined, String(a[1] ?? ''), a[2] === true, n)) }); break
    }
  }
  return out
}

/** 이번 일 보고서: 누가 · 얼마나 · 서류 몇 장 · 실패 몇 번 · 전기세 */
export function reportOf(o: Office, from: number, now: number, pw: Power): Report {
  const by = pw.jobBy ?? {}
  const ws = o.workers.filter(w => w.started >= from - 1000)
  const keys = [...new Set(ws.map(unitOf))]
  const units = keys.map(key => {
    const list = ws.filter(w => unitOf(w) === key)
    const start = Math.min(...list.map(w => w.started))
    const end = Math.max(...list.map(w => w.ended ?? now))
    return {
      key, people: list.length, mins: Math.max(1, Math.round((end - start) / 60000)),
      fails: list.reduce((n, w) => n + w.recent.filter(([, t]) => t.startsWith('실패')).length, 0),
      papers: o.handoffs.filter(h => h.at >= from && list.some(w => w.id === h.from)).length,
      tokens: list.reduce((n, w) => n + sum(by[w.id]), 0),
    }
  })
  const leadFails = o.lead.recent.filter(([t, x]) => t >= from && x.startsWith('실패')).length
  const tokens = Object.values(by).reduce((n, t) => n + sum(t), 0)
  const topEntry = [...units.map(u => [u.key, u.tokens] as [string, number]), ['팀장', sum(by.main)] as [string, number]]
    .sort((a, b) => b[1] - a[1])[0]
  const reviews = (o.reviews ?? []).filter(r => r.at >= from).map(r => {
    const by = o.workers.find(w => w.id === r.by)
    return { by: by ? unitOf(by) : '검사 직원', unit: r.unit, verdict: r.verdict, reason: r.reason, nth: r.nth }
  })
  return {
    at: now, prompt: o.prompt ?? '', mins: Math.max(1, Math.round((now - from) / 60000)),
    fails: units.reduce((n, u) => n + u.fails, 0) + leadFails, papers: units.reduce((n, u) => n + u.papers, 0), tokens,
    top: topEntry && topEntry[1] > 0 ? topEntry[0] : undefined, units,
    ...(reviews.length ? { reviews } : {}),
  }
}

