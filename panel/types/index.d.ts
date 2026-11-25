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
  job?: string // 짧은 한글 역할 (기획자 · 디자이너 · 개발자 · QA · 리서처). 맡긴 일 설명으로도 정함
  team?: string // 팀 번호 (「QA 1팀」 의 1). 있으면 사무실엔 팀 하나 = 한 자리
  member?: string // 팀 안 번호 (「1-2」)
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
}

export type View = {
  tab: 'office' | 'library'; selected: string; skill?: string
  talks?: number // 보낸 말 수 (입력칸 새로)
  shelf?: boolean // 사무실에서 책장을 눌러 스킬 목록을 펼쳤나
  shelfMore?: boolean // 플러그인 스킬까지 펼쳤나
  guide?: boolean // 처음 쓰는 사람 안내 카드
  tired?: boolean // 피로도를 눌러 정리 안내를 펼쳤나
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
}

/** 시연 (/termimates 시연): 가짜 장면. 실제 사무실 · 전기세와 따로 둔다 */
export type Demo = { running: boolean; office: Office; power: Power; step: number; total: number }

declare module 'claude-code' {
  interface PluginState {
    termimates: { office: Shaped<Office>; view: Shaped<View>; power: Shaped<Power>; demo: Shaped<Demo> }
  }
}
