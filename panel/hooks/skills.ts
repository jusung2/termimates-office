// 스킬(책) → 한 줄 설명 · 담당 역할.
// 책장 목록의 한 줄 설명과, 스킬을 쓸 때 책장에 다녀올 직원을 고르는 데 쓴다.
// 1) 이 컴퓨터의 ~/.termimates/skill-notes.json  { "스킬 이름": { "note": "쉬운 한 줄 설명", "role": "디자이너" } }
// 2) 없으면: 설명 = 스킬 description 첫 문장, 담당 = 이름 · 설명 낱말 규칙  3) 그래도 없으면 담당은 팀장.

type Local = Record<string, { note?: string; role?: string }>
let LOCAL: Local = {}

const ROLE_IDS: Record<string, string> = {
  lead: '팀장', planner: '기획자', designer: '디자이너', developer: '개발자', qa: 'QA', researcher: '리서처',
}
const ROLES = new Set(['팀장', '기획자', '디자이너', '개발자', 'QA', '리서처'])

/** 이 컴퓨터의 skill-notes.json 내용을 넣는다 (모양이 이상한 줄은 건너뜀) */
export function setLocalNotes(data: unknown): number {
  const out: Local = {}
  if (data && typeof data === 'object') {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (!v || typeof v !== 'object' || k.startsWith('_')) continue
      const r = v as Record<string, unknown>
      const role = typeof r.role === 'string' ? (ROLE_IDS[r.role] ?? r.role) : undefined
      out[k] = { note: typeof r.note === 'string' ? r.note : undefined, role: role && ROLES.has(role) ? role : undefined }
    }
  }
  LOCAL = out
  return Object.keys(out).length
}

const KEYWORDS: [RegExp, string][] = [
  [/\b(qa|tests?|testing|review)\b|테스트|검수|리뷰/i, 'QA'],
  [/\b(design|ui|ux|animate|animation|image|images)\b|디자인|애니메이션|그림|이미지/i, '디자이너'],
  [/\b(research|browser|search|web)\b|조사|검색|브라우저|웹/i, '리서처'],
  [/\b(plan|plans|planning|spec|specs)\b|기획|계획/i, '기획자'],
  [/\b(build|release|code|deploy|deployment)\b|빌드|출시|배포|코드/i, '개발자'],
]

const bareOf = (name: string) => name.split(':').pop() ?? name

/** 책장 목록의 한 줄 설명 */
export function skillNote(name: string, description = ''): string {
  const own = LOCAL[name]?.note ?? LOCAL[bareOf(name)]?.note
  if (own) return own
  const first = description.replace(/\s+/g, ' ').trim().split(/(?<=[.!?。])\s|(?<=다\.)\s| - | — /)[0] ?? ''
  return first.length > 70 ? first.slice(0, 69) + '…' : first || '(설명 없음)'
}

/** 이 스킬의 담당 역할 (기획자 · 디자이너 · 개발자 · QA · 리서처 · 팀장) */
export function skillRole(name: string, description = ''): string {
  const own = LOCAL[name]?.role ?? LOCAL[bareOf(name)]?.role
  if (own) return own
  const text = `${bareOf(name).replace(/[-_]/g, ' ')} ${description}`
  for (const [re, role] of KEYWORDS) if (re.test(text)) return role
  return '팀장'
}
