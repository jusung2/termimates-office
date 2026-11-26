export type Status =
  | 'desk' | 'idle' | 'think' | 'work' | 'handoff' | 'ask'
  | 'wait_report' | 'done' | 'off' | 'unfinished'

export type Worker = {
  id: string
  role: string
  name?: string
  task: string
  status: Status
  tool?: string
  target?: string
  action: string
  since: number
  started: number
  ended?: number
  handback?: string
  background: boolean
  teammate?: boolean
  error?: string
  recent: [number, string][]
  job?: string // 이름표: 사용자가 정한 이름 · 내가 만든 에이전트 이름 그대로 · 기본/플러그인은 쉬운 역할
  family?: string // 생김새용 기본 역할 (기획자 · 디자이너 · 개발자 · QA · 리서처)
  team?: string // 팀 번호 (「QA 1팀」 의 1). 있으면 사무실엔 팀 하나 = 한 자리
  member?: string // 팀 안 번호 (「1-2」)
  model?: string // 일하는 모델 (agent.spawn 결과의 model, 또는 roles.json)
  tier?: 'intern' | 'junior' | 'senior' | 'partner' // 직급 배지: 인턴 · 주니어 · 시니어 · 협력사(바깥 AI). 모르면 없음
  persona?: string // 맡긴 일에서 입힌 성격 · 역할 (「까칠한 시니어 리뷰어」). 애매하면 없음
  parent?: string // 이 직원에게 일을 맡긴 직원 id (팀장이 맡겼으면 없음)
  part?: string // 층: 이 직원을 부른 파트장 자리 이름 (「개발자」). 손주 직원도 맨 위 파트장. 팀장이 불렀으면 없음
  checker?: boolean // 검사 직원 (남이 한 일을 보고 통과 · 반려를 정함) → 웹 사무실 심사대에 앉는다
  reviewOf?: string // 검사 직원이 보는 서류를 만든 직원 id (출근 직전 같은 부모 아래 막 끝난 직원으로 짐작). 모르면 없음
}

/** 검사 한 번의 결과 (검사 직원이 끝날 때 마지막 글에서 뽑음). pass 통과 · reject 반려 · done 애매해서 「검토 끝」 */
export type Review = {
  at: number; by: string; of?: string; unit?: string // unit: 서류를 만든 자리 이름 (「개발자」)
  verdict: 'pass' | 'reject' | 'done'; reason?: string; nth?: number // nth: 같은 자리 일이 이번 일에서 몇 번째 반려인지
}

export type Office = {
  prompt?: string
  promptAt?: number
  said?: string
  lead: Worker
  workers: Worker[]
  handoffs: { at: number; from: string; preview: string }[]
  assigns: { at: number; to: string }[]
  skillUses: Record<string, { count: number; last: number }>
  shelf?: { at: number; who: string; book: string }[] // 책장에 책(스킬) 꺼내러 간 일 (who: 'main' 또는 직원 id)
  todos?: { text: string; state: 'todo' | 'doing' | 'done' }[] // 팀장의 할 일 목록 (웹 화이트보드)
  waiting?: { at: number; who: string; what: string; id?: string } // 사장님 확인(허락 · 질문)을 기다리는 중 (id = 그 호출)
  reviews?: Review[] // 서로 검사하기 결과 (최근 20개)
  marks?: TodoMark[] // 할 일 흔적 (TodoWrite · TaskCreate · TaskUpdate 호출에서만). 놓친 일 서류를 가리는 데 쓴다
  papers?: Paper[] // 놓친 일 서류 (바닥에 떨어진 것)
  asked?: boolean // 이번 사장님 지시가 「했어?」 · 「확인했어?」 같은 물음인가 (팀장 답에서 「깜빡」 같은 말을 찾는다)
}

/** 할 일 한 줄의 흔적. key: TodoWrite 는 「todo:<누구>:<내용>」, TaskCreate 는 「task:<id>」. who = 적은 사람 ('main' 또는 직원 id) */
export type TodoMark = { key: string; who: string; text: string; state: 'todo' | 'doing' | 'done' }

/** 놓친 일 서류: 흔적 있는 것만 (todo = 차례가 끝났는데 할 일 목록에 안 끝난 줄 · said = 「했어?」 물음의 답에 「깜빡」 류 · abort = 직원 중단).
 *  who · unit = 그 일을 맡았던 사람 · 자리 (그 자리 근처 바닥에 떨어진다). ref = 할 일 흔적 key (그 줄이 끝나면 서류도 사라짐).
 *  picked = 팀장이 주우러 간 때 (줍고 돌아와 확인한 뒤 입력창에 「놓친 일 다시 확인: …」, 그다음 없어짐) */
export type Paper = {
  id: string; at: number; who: string; unit: string; why: 'todo' | 'said' | 'abort'; text: string; ref?: string; picked?: number
}

export type View = {
  tab: 'office' | 'library' | 'roster'; selected: string; skill?: string
  report?: boolean // 이번 일 보고서 카드
  talks?: number // 보낸 말 수 (입력칸 새로)
  shelf?: boolean // 사무실에서 책장을 눌러 스킬 목록을 펼쳤나
  shelfMore?: boolean // 플러그인 스킬까지 펼쳤나
  guide?: boolean // 처음 쓰는 사람 안내 카드
  tired?: boolean // 피로도를 눌러 정리 안내를 펼쳤나
  cardOpen?: number // 붐벼서 한 줄로 접힌 아래 카드를 사장님이 펼쳐 뒀나 (펼친 때의 「안 붐빈 횟수」 + 1 — 그 뒤로 한 번이라도 안 붐볐으면 무효)
}

/** 토큰 네 갈래 (API 이름: input · cache_read · cache_creation · output) */
export type Tok = { input: number; cacheRead: number; cacheWrite: number; output: number }

/** 들고 있는 대화량 (피로도) */
export type Fill = { tokens: number; window: number }

/** 전기세(토큰) · 피로도(컨텍스트). 엔진이 이미 센 숫자만 모은다 → 토큰 0 */
export type Power = {
  job: Tok // 이번 일: 사장님 지시 하나부터 다음 지시 전까지
  session: Tok // 이 세션 합계
  byWorker: Record<string, Tok> // 'main'(팀장) 또는 직원 agentId 별 몫
  lead?: Fill // 팀장 피로도
  workers: Record<string, Fill> // 직원 피로도 (마지막으로 본 값)
  day: string // 오늘 날짜 (YYYY-MM-DD, 이 컴퓨터 시간)
  mine: number // 이 세션이 오늘 쓴 몫
  today: number // 오늘 모든 세션 합계
  usual?: number // 최근 7일(오늘 빼고) 하루 평균
  jobUsual?: number // 최근 일들의 평균
  jobBy?: Record<string, Tok> // 이번 일에서 사람별 몫 (보고서용)
}

/** 시연 (/termimates 시연) · 다시 보기: 가짜 장면. 실제 사무실 · 전기세와 따로 둔다 */
export type Demo = { running: boolean; office: Office; power: Power; step: number; total: number; label?: string }

/** 이번 일에서 일어난 일 (다시 보기용). k: prompt · spawn · start · end · done */
export type LogEntry = { t: number; k: string; a: unknown[] }

/** 이번 일 보고서 */
export type Report = {
  at: number; prompt: string; mins: number; fails: number; papers: number; tokens: number; top?: string
  units: { key: string; people: number; mins: number; fails: number; papers: number; tokens: number }[]
  reviews?: { by: string; unit?: string; verdict: Review['verdict']; reason?: string; nth?: number }[] // 검사 결과 한 줄씩 (by: 검사한 자리)
}

export type Replay = { from: number; log: LogEntry[]; report?: Report }

declare module 'claude-code' {
  interface PluginState {
    termimates: { office: Shaped<Office>; view: Shaped<View>; power: Shaped<Power>; demo: Shaped<Demo>; replay: Shaped<Replay> }
  }
}
