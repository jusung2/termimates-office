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

export function jobOf(type: string, text = ''): string {
  if (type === 'main') return '팀장'
  const bare = type.split(':').pop() ?? type
  if (!GENERIC.test(bare)) return title(type)
  for (const [re, name] of TEXT_ROLES) if (re.test(text)) return name
  return '개발자'
}

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
