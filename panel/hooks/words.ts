// 쉬운 말: 직책 이름, 도구 -> 「지금 하는 일」, 말풍선용 짧은 말.

// 직책: 에이전트 종류 이름을 짧은 한글 역할 하나로 (기획자 · 디자이너 · 개발자 · QA · 리서처).
// 같은 역할은 한 자리 · 한 직원으로 모인다(직원 = 역할). 이름 낱말로 고르고, 안 맞으면 개발자.
const ROLE_WORDS: [RegExp, string][] = [
  [/^(design|ui|ux|visual|art|image|illustrat|style|brand)/, '디자이너'],
  [/^(qa|test|verif|review|critic|skeptic|audit|check|judge|lint)/, 'QA'],
  [/^(plan|architect|analy|brief|spec|pm|product|strateg)/, '기획자'],
  [/^(explor|research|scout|search|fetch|doc|scientist|reader|guide|web|investig)/, '리서처'],
]

export function title(role: string | undefined): string {
  if (!role) return '직원'
  if (role === 'main') return '팀장'
  const words = role.toLowerCase().split(/[^a-z]+/).filter(Boolean)
  for (const [re, name] of ROLE_WORDS) if (words.some(w => re.test(w))) return name
  return '개발자'
}

// 에이전트 종류가 「general-purpose」 처럼 이름만으로 일을 알 수 없을 때는 맡긴 일 설명 · 이름으로 역할을 정한다
const GENERIC = /^(general-purpose|claude|fork|default|agent|worker|subagent|task|)$/i
const TEXT_ROLES: [RegExp, string][] = [
  [/\bqa\b|\btest|테스트|검수|품질/i, 'QA'],
  [/\bdesign|\bui\b|\bux\b|디자인|디자이너|시안/i, '디자이너'],
  [/\bplan|\bspec\b|기획|계획/i, '기획자'],
  [/\bresearch|\bexplor|\bsearch|조사|검색|리서치/i, '리서처'],
]

/** 생김새(옷 · 소품)용 기본 역할 다섯 + 팀장. 이름이 뭐든 비슷한 쪽으로 고른다 (안 맞으면 개발자 모습) */
export function familyOf(type: string, text = ''): string {
  if (type === 'main') return '팀장'
  const bare = type.split(':').pop() ?? type
  if (!GENERIC.test(bare)) {
    const t = title(type)
    if (t !== '개발자' || /dev|code|engineer|build|exec|impl/i.test(bare)) return t
  }
  for (const [re, name] of TEXT_ROLES) if (re.test(`${bare} ${text}`)) return name
  return '개발자'
}

// 이름표: 기본 다섯 역할은 기본일 뿐 — 사람마다 쓰는 에이전트가 다르니 이름은 열려 있다:
// 1) 사용자가 정한 이름 (패널에서 바꾼 이름 · ~/.termimates/roles.json)
// 2) 사용자가 직접 만든 에이전트(.claude/agents)는 그 이름 그대로
// 3) Claude 기본 · 플러그인 에이전트(이름만으론 일을 모름)는 쉬운 역할 (기획자 · 디자이너 · 개발자 · QA · 리서처)
let NAMES: Record<string, string> = {}
export function setNames(map: Record<string, string>): void {
  NAMES = {}
  for (const [k, v] of Object.entries(map ?? {})) if (typeof v === 'string' && v.trim()) NAMES[k] = v.trim().slice(0, 20)
}
export const namesNow = (): Record<string, string> => ({ ...NAMES })
/** 「general-purpose」 처럼 이름만으론 무슨 일인지 모르는 종류 (이름을 바꾸면 전부 바뀌니까 이름 바꾸기를 안 보임) */
export const isGeneric = (type: string): boolean => GENERIC.test(type.split(':').pop() ?? type)
const BUILTIN = /^(general-purpose|claude|fork|default|agent|worker|subagent|task|explore|plan|statusline-setup|claude-code-guide|web-fetch|output-style-setup|)$/i

export function jobOf(type: string, text = ''): string {
  if (type === 'main') return '팀장'
  const bare = type.split(':').pop() ?? type
  const own = NAMES[type] ?? NAMES[bare]
  if (own) return own
  if (!type.includes(':') && !BUILTIN.test(bare)) return bare // 내가 만든 에이전트: 이름 그대로
  return familyOf(type, text)
}


// -- 직급 · 페르소나 -------------------------------------------------------------------------
// 직급: 그 직원이 어떤 모델로 일하는지. haiku = 인턴, sonnet = 주니어, opus = 시니어, 바깥 AI(codex · gemini 등) = 협력사.
// 모르면 없음 (배지를 안 그린다).
export type Tier = 'intern' | 'junior' | 'senior' | 'partner'
export const TIERS: Record<Tier, { stars: string; name: string }> = {
  intern: { stars: '★', name: '인턴' },
  junior: { stars: '★★', name: '주니어' },
  senior: { stars: '★★★', name: '시니어' },
  partner: { stars: '🤝', name: '협력사' },
}
export const tierText = (t: Tier): string => `${TIERS[t].stars} ${TIERS[t].name}`

const PARTNER = /^(codex|gemini|ccg|gpt|openai|grok)$/
const words = (s: string | undefined): string[] => (s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

/** 바깥 AI 에게 맡긴 직원인가: 에이전트 종류 이름 · 이름에 codex · gemini 같은 낱말이 있으면.
 *  맡긴 일 설명은 안 본다 (Claude 직원이 「gemini 문서 조사」 를 맡아도 협력사가 아님).
 *  (Worker.teammate 는 Claude Code 에이전트 팀원이라는 뜻이라 여기서 안 씀) */
export function isPartner(...texts: (string | undefined)[]): boolean {
  return texts.some(t => words(t).some(w => PARTNER.test(w)))
}

/** 모델 이름(「claude-haiku-5-5」 · 「haiku」 · 「opus」) → 직급. 모르는 모델이면 없음 */
export function tierOfModel(model: string | undefined): Tier | undefined {
  const ws = words(model)
  if (ws.some(w => PARTNER.test(w))) return 'partner'
  if (ws.includes('opus')) return 'senior'
  if (ws.includes('sonnet')) return 'junior'
  if (ws.includes('haiku')) return 'intern'
  return undefined
}

// 페르소나: 맡긴 일에 「너는 까칠한 시니어 리뷰어야」 처럼 성격 · 역할을 입혔을 때 그 이름.
// 보수적으로 뽑는다: 「너는/당신은 … (이)야/다/입니다」 또는 「You are a … reviewer」 꼴이고, 두 낱말 이상이며,
// 끝 낱말이 사람 역할 이름일 때만. 숫자(팀 번호)나 문장 부호가 섞이면 안 뽑는다 — 애매하면 안 보여 준다.
const KO_ROLE = /(리뷰어|검토자|개발자|디자이너|기획자|전문가|엔지니어|담당자|테스터|아키텍트|설계자|매니저|비평가|평론가|멘토|분석가|작가|편집자|리서처|연구원|검사관|감독관|감사관|심사위원|코치|선배|리더|컨설턴트|해커|교수|선생님|PM|QA)$/i
const EN_ROLE = /^(reviewer|engineer|developer|designer|architect|critic|tester|expert|analyst|writer|editor|researcher|planner|manager|mentor|auditor|consultant|hacker|lead|coach|judge|skeptic)$/i
const KO_PERSONA = /(?:^|[\s"'「(])(?:너는|당신은)\s+(.{2,24}?)\s*(?:이다|입니다|이야|야|다|예요|이에요)(?=$|[\s.,!?~"'」)])/
const EN_PERSONA = /\byou are (?:an?|the)\s+([a-z][a-z\- ]{2,40}?)(?=$|[.,;:!\n]|\s+(?:who|that|and|with|for|in|on)\b)/i

export function personaOf(text: string | undefined): string | undefined {
  const t = text ?? ''
  const ok = (c: string, role: RegExp) => {
    const ws = c.trim().split(/\s+/)
    return ws.length >= 2 && ws.length <= 5 && !/[\d.,!?:;「」"'()[\]{}/]/.test(c) && role.test(ws[ws.length - 1] ?? '')
  }
  const ko = KO_PERSONA.exec(t)?.[1]?.trim()
  if (ko && ok(ko, KO_ROLE)) return clip(ko, 16)
  const en = EN_PERSONA.exec(t)?.[1]?.trim()
  if (en && ok(en, EN_ROLE)) return clip(en, 24)
  return undefined
}

// 사용자가 직접 정한 직급 · 페르소나 (~/.termimates/roles.json 의 { "종류": { "persona": …, "model": … } })
export type RoleSet = { persona?: string; model?: string }
let ROLES: Record<string, RoleSet> = {}
export function setRoles(map: Record<string, unknown>): void {
  ROLES = {}
  for (const [k, v] of Object.entries(map ?? {})) {
    if (!v || typeof v !== 'object') continue
    const r = v as Record<string, unknown>
    const persona = typeof r.persona === 'string' && r.persona.trim() ? clip(r.persona, 24) : undefined
    const model = typeof r.model === 'string' && r.model.trim() ? r.model.trim() : undefined
    if (persona || model) ROLES[k] = { persona, model }
  }
}
export const roleOf = (type: string): RoleSet | undefined => ROLES[type] ?? ROLES[type.split(':').pop() ?? type]

/** 팀 번호: 「1팀」 「team 2」 「팀3」, 없으면 팀원 번호 「1-2」 의 앞 숫자 (날짜 같은 큰 숫자는 빼고) */
export function teamOf(text: string): string | undefined {
  const m = /(\d{1,2})\s*팀|팀\s*(\d{1,2})|\bteam[\s_-]*(\d{1,2})\b/i.exec(text) ?? undefined
  if (m) return m[1] ?? m[2] ?? m[3]
  return memberOf(text)?.split('-')[0]
}

/** 팀 안 번호 「1-2」 */
export function memberOf(text: string): string | undefined {
  return /(?<![\d-])(\d{1,2})-(\d{1,2})(?![\d-])/.exec(text)?.slice(1, 3).join('-')
}

export function clip(s: string | undefined, n: number): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t.length <= n ? t : t.slice(0, n - 1) + '…'
}

function base(p: string): string {
  const parts = p.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || p
}

function shortPath(p: string): string {
  const parts = p.split('/').filter(Boolean)
  const tail = parts.slice(-2).join('/')
  return p.length <= 30 ? p : '…/' + (tail.length <= 30 ? tail : parts[parts.length - 1])
}

// 도구 입력에서 '무엇을' 하나만
export function targetOf(e: Record<string, unknown>): string | undefined {
  for (const k of ['file_path', 'notebook_path', 'pattern', 'url', 'query', 'skill', 'description', 'command', 'path']) {
    const v = e[k]
    if (typeof v === 'string' && v) return k === 'command' ? clip(v, 60) : clip(v, 160)
  }
  return undefined
}

export function actionText(tool: string, target?: string, sub?: string): string {
  const t = target ?? ''
  const f = shortPath(t)
  switch (tool) {
    case 'Read': return t ? `「${f}」 읽는 중` : '파일 읽는 중'
    case 'Edit': case 'MultiEdit': return t ? `「${f}」 고치는 중` : '파일 고치는 중'
    case 'Write': return t ? `「${f}」 새로 쓰는 중` : '파일 쓰는 중'
    case 'NotebookEdit': return `노트북 「${f}」 고치는 중`
    case 'Bash': return t ? `명령 실행 중: ${t}` : '명령 실행 중'
    case 'Grep': return t ? `'${t}' 들어간 곳 찾는 중` : '내용 찾는 중'
    case 'Glob': return t ? `'${t}' 모양 파일 찾는 중` : '파일 찾는 중'
    case 'WebSearch': return `웹에서 '${t}' 검색하는 중`
    case 'WebFetch': return `웹페이지 읽는 중: ${t}`
    case 'Agent': case 'Task': return `${title(sub ?? 'general-purpose')}에게 일 맡기는 중: ${t}`
    case 'Skill': return `스킬 「${t}」 꺼내 보는 중`
    case 'TodoWrite': case 'TaskCreate': case 'TaskUpdate': case 'TaskList': case 'TaskGet': return '할 일 목록 정리하는 중'
    case 'AskUserQuestion': return '사장님께 물어보는 중'
    case 'SendMessage': return '다른 직원에게 메시지 보내는 중'
    case 'Workflow': return '여러 직원에게 단계별로 일 나눠 주는 중'
    case 'ToolSearch': return '쓸 도구 찾아보는 중'
    case 'LSP': return '코드 구조 살펴보는 중'
  }
  if (tool.startsWith('mcp__')) {
    const [, server, name] = tool.split('__')
    return name ? `${server} 도구 쓰는 중 (${name})` : `${server} 도구 쓰는 중`
  }
  return t ? `${tool} 쓰는 중: ${t}` : `${tool} 쓰는 중`
}

export function doneText(tool: string, target?: string, sub?: string): string {
  const t = target ?? ''
  const f = shortPath(t)
  switch (tool) {
    case 'Read': return `「${f}」 읽음`
    case 'Edit': case 'MultiEdit': return `「${f}」 고침`
    case 'Write': return `「${f}」 씀`
    case 'Bash': return `명령 실행: ${t}`
    case 'Grep': return `'${t}' 찾아봄`
    case 'Glob': return `'${t}' 파일 찾아봄`
    case 'WebSearch': return `웹 검색: ${t}`
    case 'WebFetch': return `웹페이지 읽음: ${t}`
    case 'Agent': case 'Task': return `${title(sub ?? 'general-purpose')}에게 일 맡김: ${t}`
    case 'Skill': return `스킬 「${t}」 봄`
    case 'AskUserQuestion': return '사장님께 물어봄'
  }
  if (tool.startsWith('mcp__')) return `${tool.split('__')[1]} 도구 씀`
  return t ? `${tool} 씀: ${t}` : `${tool} 씀`
}

// 말풍선 글: 긴 것부터 짧은 것 순. 자리가 좁으면 들어가는 것 중 가장 긴 걸 쓴다 (자세한 건 카드에)
const BUBBLE: Record<string, string[]> = {
  think: ['생각 중…'], handoff: ['서류 전달!'], ask: ['지시 기다려요', '지시 대기'],
  wait_report: ['보고 기다리는 중', '보고 기다림'], done: ['보고 완료 ✓'], idle: ['쉬는 중'],
  unfinished: ['못 끝냈어요…', '못 끝냄'],
}

const VERB: Record<string, string> = {
  Read: '읽는 중', Edit: '고치는 중', MultiEdit: '고치는 중', NotebookEdit: '고치는 중', Write: '쓰는 중', Bash: '실행 중',
  Grep: '찾는 중', Glob: '찾는 중', WebSearch: '검색 중', WebFetch: '읽는 중', Skill: '스킬 읽는 중',
}

export function bubbles(status: string, tool?: string, target?: string): string[] {
  if (status !== 'work') return BUBBLE[status] ?? []
  const t = target ?? ''
  const short = VERB[tool ?? ''] ?? '일하는 중'
  let long: string | undefined
  switch (tool) {
    case 'Read': case 'Edit': case 'MultiEdit': case 'NotebookEdit': case 'Write': case 'WebFetch':
      long = t ? `${base(t)} ${short}` : undefined
      break
    case 'Bash': {
      const first = base(t.split(/\s+/)[0] ?? '')
      long = first ? `${first} 실행 중` : undefined
      break
    }
    case 'Grep': long = t ? `'${t}' 찾는 중` : undefined; break
    case 'WebSearch': long = t ? `'${t}' 검색 중` : undefined; break
    case 'Skill': long = t ? `스킬 「${t}」 읽는 중` : undefined; break
    default: long = bubble(status, tool, target)
  }
  return long && long !== short ? [long, short] : [short]
}

export function bubble(status: string, tool?: string, target?: string): string | undefined {
  if (status !== 'work') return BUBBLE[status]?.[0]
  const t = target ?? ''
  const f = clip(base(t), 12)
  switch (tool) {
    case 'Read': return t ? `${f} 읽는 중` : '읽는 중'
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return t ? `${f} 고치는 중` : '고치는 중'
    case 'Write': return t ? `${f} 쓰는 중` : '쓰는 중'
    case 'Bash': {
      const first = base(t.split(/\s+/)[0] ?? '')
      return first ? `${clip(first, 10)} 실행 중` : '명령 실행 중'
    }
    case 'Grep': return t ? `'${clip(t, 8)}' 찾는 중` : '찾는 중'
    case 'Glob': return '파일 찾는 중'
    case 'WebSearch': return '웹 검색 중'
    case 'WebFetch': return '웹 읽는 중'
    case 'Agent': case 'Task': return '일 맡기는 중'
    case 'Skill': return `스킬 ${clip(t, 10)}`
    case 'AskUserQuestion': return '사장님께 질문!'
    case 'TodoWrite': case 'TaskCreate': case 'TaskUpdate': return '할 일 정리 중'
  }
  if (tool?.startsWith('mcp__')) return `${clip(tool.split('__')[1], 8)} 쓰는 중`
  return `${clip(tool ?? '도구', 10)} 쓰는 중`
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}초`
  if (s < 3600) return `${Math.floor(s / 60)}분`
  if (s < 86400) return `${Math.floor(s / 3600)}시간`
  return `${Math.floor(s / 86400)}일`
}

export function hhmm(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// -- 서로 검사하기 (심사대) ---------------------------------------------------------------------
// 검사 직원 = 남이 한 일을 보고 통과 · 반려를 정하는 직원.
// 1) 에이전트 종류 이름에 review · critic · verifier · judge · skeptic · audit 가 있으면 검사 직원.
// 2) 종류 이름만으론 모를 때(general-purpose 같은 것)는 맡긴 일 설명 · 이름에 검토 · 리뷰 · 심사 · 검증 · review 같은 말이
//    있고, 「구현 · 고치기 · 만들기」 처럼 자기가 직접 만드는 말이 없을 때만.
// 3) QA · test 종류는 원래 「테스트 돌리기」 담당이라 검사 직원이 아니다. 맡긴 일에 검토 · 리뷰 · 심사 · 승인 · review ·
//    approve 처럼 「남의 결과를 보고 판정」 하는 말이 있을 때만 검사 직원. (검증 · verify 는 테스트 돌리기에도 쓰는 말이라 QA 에선 안 셈)
const CHECK_TYPE = /^(review|critic|verif|judge|skeptic|audit)/
const CHECK_TEXT = /review|critic|verif|judge|검토|리뷰|심사|검증|평가해/i
const CHECK_QA = /review|critic|judge|approv|검토|리뷰|심사|승인/i
const MAKE_TEXT = /implement|\bbuild|\bwrite|\bfix|\badd\b|\bcreate|구현|만들|작성|고치|고쳐|수정해|추가/i

export function isChecker(type: string, text = ''): boolean {
  if (type === 'main') return false
  const bare = (type.split(':').pop() ?? type).toLowerCase()
  const ws = bare.split(/[^a-z]+/).filter(Boolean)
  if (ws.some(w => CHECK_TYPE.test(w))) return true
  if (ws.some(w => /^(qa|test)/.test(w))) return CHECK_QA.test(text)
  if (!GENERIC.test(bare)) return false // 다른 일 하는 종류(executor · designer …)는 맡긴 일 글로 안 바꾼다
  return CHECK_TEXT.test(text) && !MAKE_TEXT.test(text)
}

// 검사 결과: 검사 직원이 끝날 때 남긴 마지막 글에서 통과 / 반려를 보수적으로 뽑는다. 애매하면 「검토 끝」(done).
// 「판정: … 」 「결과: … 」 같은 줄이 있으면 그 줄을 먼저 본다. 둘 다 섞여 있으면 센 말이 이긴다:
// 센 반려(반려 · REJECT · changes requested · 통과 못 함)만 있으면 반려, 센 통과(통과 · 승인 · LGTM · APPROVE)만 있고
// 약한 반려(실패 · 수정 필요)도 없으면 통과. 「실패 0건 · 실패 없음」 은 반려로 세지 않는다.
export type Verdict = 'pass' | 'reject' | 'done'
const NO_FAIL = /(?:실패|오류|에러)\s*(?:한\s*\S*\s*)?(?:없|0\s*(?:건|개|번)?)|(?:\b0|\bno|\bzero)\s+(?:fail(?:ed|ures?|s)?|errors?)\b/gi
const NEG_PASS = /통과\s*(?:못|하지\s*못|하지\s*않|안\s*됨|불가|실패)|미통과|미승인|승인\s*(?:못|불가|거절|하지\s*않)|(?:not|n't|cannot)\s+(?:be\s+)?(?:approv\w*|pass\w*|lgtm)/gi
const STRONG_REJECT = /반려|불합격|\breject(?:ed)?\b|changes?\s+requested|request(?:ing|ed)?\s+changes/i
const WEAK_REJECT = /실패|수정\s*(?:이\s*)?필요|고쳐야|다시\s*해야|\bfail(?:ed|s|ure)?\b|needs?\s+(?:changes|work|revision|fix)/i
const STRONG_PASS = /통과|승인|합격|\blgtm\b|\bapprov(?:e|ed)\b/i
const WEAK_PASS = /\bpass(?:ed|es)?\b|문제\s*없/i
const VERDICT_LINE = /^[\s#*>\-|]*(?:최종\s*)?(?:판정|결과|결론|verdict|result|decision|status)\s*[:：]/i

function judge(text: string): Verdict | undefined {
  const t = text.replace(NO_FAIL, ' ')
  const negPass = new RegExp(NEG_PASS.source, 'i').test(t)
  const rest = t.replace(NEG_PASS, ' ')
  const sr = negPass || STRONG_REJECT.test(rest), wr = WEAK_REJECT.test(rest)
  const sp = STRONG_PASS.test(rest), wp = WEAK_PASS.test(rest)
  if (sr && !sp) return 'reject'
  if (sp && !sr && !wr) return 'pass'
  if (!sr && !sp) {
    if (wr && !wp) return 'reject'
    if (wp && !wr) return 'pass'
  }
  return undefined
}

export function verdictOf(text: string | undefined): Verdict {
  const t = text ?? ''
  const line = t.split('\n').find(l => VERDICT_LINE.test(l))
  return (line && judge(line)) || judge(t) || 'done'
}

/** 반려 이유 한 줄: 「이유 · 사유 · because」 줄, 없으면 판정 줄 바로 다음 줄, 없으면 반려 말이 든 줄(그 말만 있으면 안 씀).
 *  못 뽑으면 없음 — 이유 없이 「반려」 만 보여 준다 */
export function reasonOf(text: string | undefined): string | undefined {
  const lines = (text ?? '').split('\n').map(l => l.replace(/^[\s#*>\-|•·\d.)]]+/, '').replace(/\*\*/g, '').trim()).filter(Boolean)
  const why = lines.find(l => /^(?:반려\s*)?(?:이유|사유|원인|reason|because|why)\s*[:：]?/i.test(l) || /때문/.test(l))
  const strip = (l: string) => l
    .replace(/^(?:최종\s*)?(?:판정|결과|결론|verdict|result|decision|status|반려\s*이유|이유|사유|원인|reason|why)\s*[:：]\s*/i, '')
    .replace(/^(?:반려|reject(?:ed)?|fail(?:ed)?|changes\s+requested)\s*(?:✗|❌)?\s*[:：—–-]\s*/i, '').trim()
  const bare = (l: string) => strip(l).replace(/[\s✗❌✕x!.,:：()（）-]|반려|reject(?:ed)?|changes\s+requested|fail(?:ed)?|실패|수정\s*필요/gi, '').length < 4
  if (why && !bare(why)) return clip(strip(why), 60)
  const i = lines.findIndex(l => VERDICT_LINE.test(l))
  if (i >= 0 && lines[i + 1] && !bare(lines[i + 1]!)) return clip(strip(lines[i + 1]!), 60)
  const hit = lines.find(l => (STRONG_REJECT.test(l) || WEAK_REJECT.test(l)) && !bare(l))
  return hit ? clip(strip(hit), 60) : undefined
}

/** 반려 몇 번째: ① ② ③ … (번호판용) */
export const circled = (n: number): string => (n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : `${n}.`)
