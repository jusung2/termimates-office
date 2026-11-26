// 시연: 「회원가입 화면 만들어줘」 를 받은 사무실이 어떻게 돌아가는지 가짜 장면으로 보여 준다.
// Claude 를 부르지 않는다(토큰 0). 실제 훅과 같은 함수(office.ts)로 장면을 만들어 실제와 똑같이 보인다.
// 실제 기록 · 오늘 전기세 저장소는 건드리지 않는다(시연 상태는 따로 둔다).

import type { Demo, Fill, Office, Power, Tok } from '../types'
import { addUsage, EMPTY, onComplete, onPrompt, onSpawn, onStart, onTodos, onToolEnd, onToolStart } from './office'
import { dayOf, EMPTY_POWER } from './power'

export type Run = (d: Demo, now: number) => Demo
export type Step = { wait: number; run: Run }

const O = (fn: (o: Office, now: number) => Office): Run => (d, now) => ({ ...d, office: fn(d.office, now) })
const P = (fn: (p: Power) => Power): Run => d => ({ ...d, power: fn(d.power) })
const all = (...fs: Run[]): Run => (d, now) => fs.reduce((x, f) => f(x, now), d)

const tk = (input: number, cacheRead: number, cacheWrite: number, output: number): Tok => ({ input, cacheRead, cacheWrite, output })
const fill = (tokens: number): Fill => ({ tokens, window: 200000 })

const use = (id: string, t: Tok, tokens: number): Run => P(p => addUsage(p, id, t, p.day, fill(tokens)))
const tool = (who: string, name: string, target?: string): Run => O((o, n) => onToolStart(o, who, name, target, undefined, n))
const done = (who: string, name: string, target?: string, err?: string): Run =>
  O((o, n) => onToolEnd(o, who, name, target, undefined, err !== undefined, err, n))
const hire = (id: string, type: string, description: string): Run =>
  O((o, n) => onSpawn(o, { id, type, description, background: false }, n))
const done2 = (who: string, name: string, next: string, target?: string): Run => all(done(who, name), tool(who, next, target))
const report = (id: string | undefined, answer: string): Run => O((o, n) => onComplete(o, id, answer, false, n))

const TODO = ['로그인 화면 살펴보기', '회원가입 순서 정하기', '화면 시안', '코드 짜기', '시험 돌리기']
/** 팀장의 할 일 목록: 앞 n 개는 끝, 그다음 하나는 하는 중 */
const todos = (n: number): Run => O(o => onTodos(o, 'TodoWrite', {
  todos: TODO.map((content, i) => ({ content, status: i < n ? 'completed' : i === n ? 'in_progress' : 'pending' })),
}))

const SRC = '/app/src/screens'
const EX = 'demo-explore'
const PL = 'demo-plan'
const DS = 'demo-design'
const DV = 'demo-dev'
const RV = 'demo-review'
const DV2 = 'demo-dev2'
const RV2 = 'demo-review2'
const QA1 = 'demo-qa1-1'
const QA2 = 'demo-qa1-2'
/** QA 팀원 (뒤에서 같이 돌림). 설명에 「QA 1팀 1-n」 이 있으면 사무실엔 팀 하나 = 「QA 1팀」 한 자리 (office.ts teamOf) */
const qa = (id: string, description: string): Run =>
  O((o, n) => onSpawn(o, { id, type: 'general-purpose', description, background: true }, n))

export const STEPS: Step[] = [
  // 사장님 지시 → 팀장이 읽고, 화면 파일이 어디 있는지 먼저 훑어본다
  { wait: 1200, run: O((o, n) => onPrompt(o, '회원가입 화면 만들어줘', n)) },
  // 팀장이 「ui-design」 책(스킬)을 본다 — 담당 디자이너가 아직 없으니 팀장이 직접 책장에 다녀온다
  { wait: 1800, run: tool('main', 'Skill', 'ui-design') },
  { wait: 5600, run: all(done('main', 'Skill', 'ui-design'), tool('main', 'Glob', 'src/screens/*.tsx')) },
  { wait: 1500, run: all(done('main', 'Glob', 'src/screens/*.tsx'), P(p => ({ ...p, lead: fill(48000) })), todos(0)) },
  // 팀장이 조사원 · 기획자에게 일을 나눈다 (동시에)
  { wait: 1200, run: hire(EX, 'Explore', '로그인 화면 코드 찾아 보기') },
  { wait: 800, run: hire(PL, 'Plan', '회원가입 순서 정리') },
  { wait: 2000, run: tool(EX, 'Grep', 'LoginForm') }, // 문으로 들어와 앉은 뒤
  { wait: 700, run: tool(PL, 'Read', '/app/docs/회원정책.md') },
  { wait: 1800, run: all(done(EX, 'Grep', 'LoginForm'), P(p => ({ ...p, workers: { ...p.workers, [EX]: fill(21000) } }))) },
  { wait: 400, run: tool(EX, 'Read', `${SRC}/Login.tsx`) },
  { wait: 1200, run: all(done(PL, 'Read', '/app/docs/회원정책.md'), tool(PL, 'TodoWrite')) },
  { wait: 1500, run: all(done(EX, 'Read', `${SRC}/Login.tsx`), tool(EX, 'SubagentHandback')) },
  {
    wait: 1300,
    run: all(report(EX, '로그인 화면은 src/screens/Login.tsx 예요. 입력칸 · 버튼 부품(LoginForm)을 그대로 다시 쓸 수 있어요.'),
      use(EX, tk(8000, 52000, 6000, 3500), 34000)),
  },
  { wait: 900, run: all(done(PL, 'TodoWrite'), tool(PL, 'SubagentHandback')) },
  {
    wait: 1300,
    run: all(report(PL, '이메일 → 비밀번호 → 비밀번호 확인 → 약관 동의 → 가입 완료, 5단계로 가요.'),
      use(PL, tk(6000, 41000, 5000, 4200), 28000), todos(2)),
  },
  // 두 보고를 받은 팀장이 디자이너에게 시안을 맡긴다
  { wait: 1600, run: all(use('main', tk(9000, 120000, 7000, 5000), 70000), hire(DS, 'general-purpose', '회원가입 화면 시안 디자인')) },
  // 이번엔 팀장이 「design-polish」 책을 보려는데 담당 디자이너가 있으니 디자이너가 다녀와 읽는다
  { wait: 2800, run: tool('main', 'Skill', 'design-polish') },
  { wait: 900, run: done('main', 'Skill', 'design-polish') },
  { wait: 8400, run: tool(DS, 'Read', `${SRC}/Login.css`) }, // 책 다녀와 다 읽은 뒤
  { wait: 1500, run: all(done(DS, 'Read', `${SRC}/Login.css`), tool(DS, 'Write', `${SRC}/SignUp.css`)) },
  { wait: 2200, run: all(done(DS, 'Write', `${SRC}/SignUp.css`), tool(DS, 'SubagentHandback')) },
  {
    wait: 1300,
    run: all(report(DS, '시안 완료: 주 색 #3B5BDB, 입력칸 4개, 가입 버튼은 화면 아래에 크게.'),
      use(DS, tk(9000, 70000, 8000, 9000), 52000), todos(3)),
  },
  // 시안을 받아 실무자에게 코드를 맡긴다 → 시험이 한 번 실패했다가 고쳐서 통과
  { wait: 1500, run: all(use('main', tk(5000, 90000, 3000, 4000), 92000), hire(DV, 'general-purpose', '회원가입 화면 코드 짜기')) },
  { wait: 2800, run: tool(DV, 'Write', `${SRC}/SignUp.tsx`) },
  { wait: 2200, run: all(done(DV, 'Write', `${SRC}/SignUp.tsx`), P(p => ({ ...p, workers: { ...p.workers, [DV]: fill(84000) } }))) },
  { wait: 400, run: tool(DV, 'Edit', '/app/src/App.tsx') },
  { wait: 1500, run: all(done(DV, 'Edit', '/app/src/App.tsx'), tool(DV, 'Bash', 'npm test')) },
  { wait: 2200, run: all(done(DV, 'Bash', 'npm test', '시험 1개 실패: 비밀번호 확인 칸이 없어요'), todos(4)) },
  { wait: 1200, run: tool(DV, 'Edit', `${SRC}/SignUp.tsx`) },
  { wait: 1500, run: all(done(DV, 'Edit', `${SRC}/SignUp.tsx`), tool(DV, 'Bash', 'npm test')) },
  { wait: 2000, run: all(done(DV, 'Bash', 'npm test'), tool(DV, 'SubagentHandback')) },
  {
    wait: 1300,
    run: all(report(DV, '회원가입 화면 완성: SignUp.tsx 새로 만들고 App.tsx 에 연결했어요. 시험 12개 모두 통과.'),
      use(DV, tk(15000, 160000, 12000, 21000), 141000)),
  },
  // 서로 검사하기: 리뷰어가 심사대에 앉아 검토 → 반려 → 개발자가 고쳐 오면 다시 검토 → 통과
  // 그동안 QA 1팀 두 명이 뒤에서 화면을 눌러 본다 (팀 하나 = 「QA 1팀」 한 자리, 팀원 점 둘)
  { wait: 1500, run: hire(RV, 'code-reviewer', '회원가입 코드 검토') },
  { wait: 600, run: all(qa(QA1, 'QA 1팀 1-1 회원가입 입력칸 눌러 보기'), qa(QA2, 'QA 1팀 1-2 가입 버튼 눌러 보기')) },
  { wait: 3600, run: all(tool(QA1, 'Bash', 'npm run e2e -- signup-fields'), tool(QA2, 'Bash', 'npm run e2e -- signup-button')) },
  { wait: 2800, run: tool(RV, 'Read', `${SRC}/SignUp.tsx`) }, // 문에서 심사대까지 걸어온 뒤
  { wait: 900, run: all(done(QA1, 'Bash', 'npm run e2e -- signup-fields'), report(QA1, '1-1: 입력칸 4개 모두 잘 들어가요.')) },
  { wait: 700, run: all(done(QA2, 'Bash', 'npm run e2e -- signup-button'), report(QA2, '1-2: 비밀번호 확인 칸이 비어도 가입 버튼이 눌려요.')) },
  { wait: 600, run: all(done(RV, 'Read', `${SRC}/SignUp.tsx`), tool(RV, 'Bash', 'npm test -- SignUp')) },
  { wait: 2000, run: all(done(RV, 'Bash', 'npm test -- SignUp'), tool(RV, 'SubagentHandback')) },
  {
    wait: 1300,
    run: all(report(RV, '판정: 반려\n이유: 비밀번호 확인 칸이 비어 있어도 가입 버튼이 눌려요.'), use(RV, tk(6000, 48000, 4000, 3800), 36000)),
  },
  { wait: 4500, run: hire(DV2, 'general-purpose', '회원가입 화면 고치기 (반려된 곳)') },
  { wait: 2800, run: tool(DV2, 'Edit', `${SRC}/SignUp.tsx`) },
  { wait: 1800, run: all(done(DV2, 'Edit', `${SRC}/SignUp.tsx`), tool(DV2, 'Bash', 'npm test')) },
  { wait: 2000, run: all(done(DV2, 'Bash', 'npm test'), tool(DV2, 'SubagentHandback')) },
  {
    wait: 1300,
    run: all(report(DV2, '회원가입 화면 완성: 비밀번호 확인 칸이 비면 가입 버튼을 막았어요. 시험 13개 모두 통과.'),
      use(DV2, tk(9000, 90000, 6000, 8000), 141000)),
  },
  { wait: 1500, run: hire(RV2, 'code-reviewer', '고친 회원가입 코드 다시 검토') },
  { wait: 7000, run: tool(RV2, 'Read', `${SRC}/SignUp.tsx`) },
  { wait: 2000, run: all(done(RV2, 'Read', `${SRC}/SignUp.tsx`), tool(RV2, 'SubagentHandback')) },
  { wait: 1300, run: all(report(RV2, '판정: 통과 ✓\nLGTM — 빈 칸 검사가 들어갔어요.'), use(RV2, tk(4000, 30000, 3000, 2000), 24000)) },
  // 팀장이 결과를 한 번 훑어보고 사장님께 보고
  { wait: 1200, run: tool('main', 'Read', `${SRC}/SignUp.tsx`) },
  { wait: 1500, run: done('main', 'Read', `${SRC}/SignUp.tsx`) },
  {
    wait: 1500,
    run: all(report(undefined, '회원가입 화면을 만들었어요. 이메일 · 비밀번호 · 비밀번호 확인 · 약관 동의 · 가입 버튼이 있고, 시험 12개가 통과했어요.'),
      use('main', tk(12000, 140000, 9000, 14000), 118000), todos(5)),
  },
]


/** 다 끝난 장면을 이만큼 보여 준 뒤 실제 사무실로 돌아간다 */
export const HOLD = 10000

export const IDLE_DEMO: Demo = { running: false, office: EMPTY, power: EMPTY_POWER, step: 0, total: 0 }

/** 시연 첫 장면: 팀장 혼자 출근해 있고, 오늘 전기세는 평소의 7할쯤 */
export function startDemo(now: number, total = STEPS.length, power?: Power, label?: string): Demo {
  if (power) return { running: true, step: 0, total, label, office: onStart(EMPTY, now), power }
  return {
    running: true, step: 0, total, label,
    office: onStart(EMPTY, now),
    power: { ...EMPTY_POWER, day: dayOf(now), today: 2800000, usual: 4000000, jobUsual: 900000, lead: fill(26000) },
  }
}
