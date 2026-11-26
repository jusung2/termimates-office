/* TermiMates 웹 사무실.
 * 패널(mod)이 적어 둔 사무실 상태(~/.termimates/panel/<세션>.json)를 서버(serve.py)에서 받아 그린다.
 * 배치 · 움직임 규칙은 패널(scene.ts)과 같다: 위에 팀장, 아래 큰 복도(왼쪽 문 · 오른쪽 책장), 그 아래 직원 자리.
 * 한 자리 = 한 명 또는 한 팀. 캐릭터는 sprites.js(48×64, 부품 조합). 창 크기에 맞춰 배치 · 배율이 바뀐다.
 * AI 를 부르지 않는다(토큰 0). 밖으로 보내는 것 없음.
 */
(function () {
  'use strict';
  const S = window.Sprites;
  const $ = (id) => document.getElementById(id);
  const stage = $('stage'), canvas = $('office'), ctx = canvas.getContext('2d');
  const world = document.createElement('canvas'), wctx = world.getContext('2d');
  const bg = document.createElement('canvas'), bctx = bg.getContext('2d');

  // ---- 시간 규칙 ----
  const ASSIGN_MS = 1300, READ_MS = 4000, BOSS_MS = 7000, STAMP_MS = 1800; // STAMP_MS: 심사대에서 도장 찍고 서류가 날아가는 시간
  const WALK_SPEED = 0.09; // 걷는 속도 (월드 픽셀/ms). 거리 ÷ WALK_SPEED = 순수 걷기 시간.
  // 놓친 일 서류: 팀장이 걸어가 줍고 돌아오는 시간 · 그 뒤 자리에서 읽고 입력창에 넣기까지 (패널 office.ts PICK_WALK_MS · PICK_MS 와 같게)
  const PICK_WALK_MS = 5600, PICK_MS = 7000;

  // ---- 배치 치수 (월드 픽셀 = 캐릭터 픽셀) ----
  const SLOT_W = 100, ROW_H = 128, WALL_H = 72, SIDE = 64, RIGHT = 16, SHELF_W = 112, MIN_W = 380;
  const PART_PAD = 20; // 파트 줄 위 「▸ 개발자 파트」 띠 높이
  const FOOT = S.FOOT, SW = S.W;

  // ---- 상태 ----
  let bossAt = null; // 사장님이 지금 어디 있는지 (말풍선용)
  const boxes = { bubbles: [], tags: [] }; // 지난 장면의 말풍선 · 묶음 글 자리 (기기 픽셀, 겹침 시험용)
  let snap = null, sel = null, L = null, sd = 2, dpr = 1, lastBgKey = '', hits = [], hover = null;
  const qs = new URLSearchParams(location.search);
  const session = qs.get('session') || 'auto';
  // 소개 사진용: ?hour=14 (낮 · 밤 고정) · ?sel=QA 1팀 (카드 열기) · ?news=open (게시판 펼치기)
  const hourOf = (now) => (qs.has('hour') ? Number(qs.get('hour')) : new Date(now).getHours());

  // ---- 작은 도구 ----
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
  const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const base = (p) => { const a = String(p || '').replace(/\/+$/, '').split('/'); return a[a.length - 1] || String(p || ''); };
  function man(n) {
    const v = Math.max(0, Math.round(n || 0));
    if (v < 10000) return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    if (v < 100000) return Math.round(v / 1000) / 10 + '만';
    if (v < 100000000) return Math.round(v / 10000) + '만';
    return Math.round(v / 10000000) / 10 + '억';
  }
  const sumT = (t) => (t ? t.input + t.cacheRead + t.cacheWrite + t.output : 0);
  const parts = (t) => `일반 ${man(t.input + t.cacheWrite)} · 할인 ${man(t.cacheRead)} · 고출력 ${man(t.output)}`;
  const STAGES = [[40, '쌩쌩', '#3FA66B'], [70, '하품', '#E0B23A'], [90, '피곤', '#E07A3A'], [1e9, '녹초', '#C9423A']];
  const stageOf = (p) => STAGES.find((s) => p < s[0]);
  const pctOf = (f) => (f && f.window && f.tokens > 0 ? Math.round((f.tokens / f.window) * 100) : null);
  const hhmm = (ms) => { const d = new Date(ms), p = (n) => String(n).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())}`; };
  function ago(ms) { const s = Math.max(0, Math.floor(ms / 1000)); return s < 60 ? `${s}초` : s < 3600 ? `${Math.floor(s / 60)}분` : `${Math.floor(s / 3600)}시간`; }

  const LOOK = { 팀장: 'lead', 기획자: 'planner', 디자이너: 'designer', 개발자: 'developer', QA: 'qa', 리서처: 'researcher' };
  const lookOf = (job) => LOOK[job] || 'guest';

  // ---- 말풍선 글 (패널 words.ts 와 같은 뜻) ----
  // 직급 배지: 모델 직급 (haiku 인턴 · sonnet 주니어 · opus 시니어 · 바깥 AI 협력사). 글자 말고 색으로도 구분
  const TIER = {
    intern: { stars: '★', name: '인턴', bg: '#1c3d73', fg: '#a5d8ff' },
    junior: { stars: '★★', name: '주니어', bg: '#1b4d2e', fg: '#b2f2bb' },
    senior: { stars: '★★★', name: '시니어', bg: '#5c4305', fg: '#ffe066' },
    partner: { stars: '🤝', name: '협력사', bg: '#3d2466', fg: '#e5dbff' },
  };
  const BUBBLE = { think: '생각 중…', handoff: '서류 전달!', ask: '지시 기다려요', wait_report: '보고 기다리는 중', done: '보고 완료 ✓', idle: '쉬는 중', unfinished: '못 끝냈어요…' };
  const VERB = { Read: '읽는 중', Edit: '고치는 중', MultiEdit: '고치는 중', NotebookEdit: '고치는 중', Write: '쓰는 중', Bash: '실행 중',
    Grep: '찾는 중', Glob: '찾는 중', WebSearch: '검색 중', WebFetch: '읽는 중', Skill: '스킬 읽는 중', Agent: '일 맡기는 중', Task: '일 맡기는 중',
    AskUserQuestion: '사장님께 질문!', TodoWrite: '할 일 정리 중', TaskCreate: '할 일 정리 중', TaskUpdate: '할 일 정리 중' };
  // 말풍선 앞 작은 아이콘: 무슨 일인지 한눈에
  const ICON = { Read: '📖', Edit: '✏️', MultiEdit: '✏️', NotebookEdit: '✏️', Write: '📝', Bash: '▶️', Grep: '🔍', Glob: '🔍', WebSearch: '🌐', WebFetch: '🌐',
    Skill: '📚', Agent: '📨', Task: '📨', AskUserQuestion: '🙋', TodoWrite: '🗒️', TaskCreate: '🗒️', TaskUpdate: '🗒️',
    think: '💭', handoff: '📄', ask: '🙋', wait_report: '⏳', done: '✅', idle: '☕', unfinished: '⚠️' };
  function bubbleOf(w) {
    const b = bubbleText(w);
    if (!b) return null;
    const ic = ICON[w.status === 'work' ? w.tool : w.status] || '💼';
    return { long: `${ic} ${b.long}`, short: `${ic} ${b.short}` };
  }
  function bubbleText(w) {
    if (!w || w.status === 'desk' || w.status === 'off') return null;
    if (w.status === 'ask' && snap && snap.office.waiting && snap.office.waiting.who === w.id) return { long: '확인해 주세요!', short: '확인!' };
    if (w.status !== 'work') return { long: BUBBLE[w.status], short: BUBBLE[w.status] };
    const t = w.target || '', v = VERB[w.tool] || '일하는 중';
    let long = v;
    if (/^(Read|Edit|MultiEdit|NotebookEdit|Write|WebFetch)$/.test(w.tool) && t) long = `${base(t)} ${v}`;
    else if (w.tool === 'Bash' && t) long = `${base(t.split(/\s+/)[0])} 실행 중`;
    else if ((w.tool === 'Grep' || w.tool === 'WebSearch') && t) long = `'${t}' ${v}`;
    else if (w.tool === 'Skill' && t) long = `스킬 「${t}」 읽는 중`;
    return { long, short: v };
  }

  // ---- 자리 접기 (패널 office.ts fold() 와 같은 규칙: 패널이 적어 준 접기 단계 중 들어가는 첫 단계, 그래도 넘치면 앞 max-1 자리 + 「+n명」) ----
  function foldPick(steps, max) {
    const m = Math.max(1, Math.floor(max));
    const fit = steps.find((st) => st.length <= m);
    if (fit) return fit;
    const last = steps[steps.length - 1] || [], keep = last.slice(0, m - 1), rest = last.slice(m - 1);
    const n = rest.reduce((a, x) => a + x.people, 0);
    return keep.concat([{ key: '__more', pick: '__more', kind: 'more', units: rest.flatMap((x) => x.units), label: `+${n}명`, family: '', people: n }]);
  }
  const ORDER = ['handoff', 'work', 'think', 'ask', 'wait_report', 'unfinished', 'done', 'idle', 'off', 'desk'];
  /** 접기 단계 (패널이 적어 준 것. 예전 패널이면 자리마다 한 자리) */
  function stepsOf() {
    const units = (snap && snap.units) || [];
    if (snap && snap.steps && snap.steps.main) return snap.steps;
    return { main: [units.map((u) => ({ key: u.key, pick: u.key, kind: 'unit', units: [u.key], label: u.key, family: u.family || u.job, people: u.count || 1 }))], part: [] };
  }
  /** 화면 한 자리 → 자리 정보 (대표 직원 · 팀원 점 · 이름표) */
  function spotSeat(sp, o) {
    const units = (snap && snap.units) || [];
    const us = sp.units.map((k) => units.find((u) => u.key === k)).filter(Boolean);
    const wOf = (id) => (o.workers || []).find((x) => x.id === id);
    const members = us.flatMap((u) => u.members);
    // leaving: 이 자리에서 나가는 중인 앞사람 (새 사람이 자리를 이어받아도 문까지 끝까지 걷는다 — 패널 office.ts unitsOf)
    const leaving = (sp.leaving || []).map(wOf).filter(Boolean);
    const base = { key: sp.key, pick: sp.pick, kind: sp.kind, units: sp.units, name: sp.label, members, team: false, count: 0, boss: us[0] && us[0].boss, leaving };
    if (sp.kind === 'twin') {
      const w = wOf(sp.who);
      const first = /#1$/.test(sp.key); // 파트장 표시 · ⟳n 은 묶음 첫 자리에만
      return Object.assign(base, { job: sp.family, worker: w, members: w ? [{ id: w.id, status: w.status }] : [], count: 1, loop: first && us[0] ? us[0].loop : 0, kids: first && us[0] ? us[0].kids : 0 });
    }
    if (sp.kind === 'unit' && us[0]) {
      const u = us[0];
      return Object.assign(base, { job: u.family || u.job, worker: wOf(u.worker), team: u.team, members: u.members, count: u.count, loop: u.loop, kids: u.kids });
    }
    // 접은 자리: 지금 일하는 사람을 대표로, 팀 자리처럼 칸막이 + 사람마다 점. 「+n명」 은 빈 책상
    const best = us.map((u) => wOf(u.worker)).filter(Boolean).sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status))[0];
    return Object.assign(base, { job: sp.family, worker: sp.kind === 'more' ? null : best, team: sp.kind === 'fold', more: sp.kind === 'more' });
  }

  // ---- 배치 ----
  // Hmax(월드 픽셀)를 주면 그 높이에 맞춰 접는다 (배율을 바닥까지 낮춰도 안 들어갈 때만). 없으면 다 펼친다
  function layout(W, Hmax) {
    const shelf = { x: W - RIGHT - SHELF_W, y: 14, w: SHELF_W, h: WALL_H + 70 };
    const leadCx = Math.round(Math.min(W / 2, shelf.x - SLOT_W / 2 - 70));
    const leadSy = WALL_H - 22;
    const hallTop = leadSy + ROW_H - 10, hallFoot = hallTop + 66, staffTop = hallTop + 74;
    const units = (snap && snap.units) || [];
    // 「사무실 소식」 게시판: 넓으면 책장 바로 밑(직원 책상은 그 왼쪽까지), 좁으면 직원 자리 맨 아래 오른쪽
    const NEWS_W = SHELF_W + 12;
    const besideShelf = W - SIDE - RIGHT - NEWS_W >= 3 * SLOT_W;
    const usable = W - SIDE - RIGHT - (besideShelf ? NEWS_W : 0);
    const perRow = Math.max(1, Math.floor(usable / SLOT_W));
    const left = SIDE + Math.floor((usable - perRow * SLOT_W) / 2);
    const seats = [];
    const o = snap && snap.office;
    // 심사대: 검사 직원이 있을 때만. 팀장 오른쪽 빈 바닥(팀장이 복도로 가는 길 · 책장 앞 화분 사이) → 안 되면 팀장 왼쪽
    // (문 쪽 길 · 화분과 떨어진 팀장 깔개 옆) → 둘 다 좁으면 직원 자리 맨 끝 한 칸을 쓴다. 문 · 복도 · 책장 · 화이트보드 · 게시판과 안 겹친다
    const NEED = 140;
    const deskOn = !!o && reviewersOf(o).length > 0;
    const rightX = [leadCx + 96, shelf.x - 34], leftX = [100, leadCx - 70];
    const hallX = !deskOn ? null : rightX[1] - rightX[0] >= NEED ? rightX[0] : leftX[1] - leftX[0] >= NEED ? leftX[1] - NEED : null;
    const deskSlot = deskOn && hallX == null ? 1 : 0;
    // 층: 파트장(에이전트가 부른 에이전트를 둔 직원)이 있을 때만 맨 아래 한 줄을 더해 그 아래 직원을 앉힌다
    const NEWS_H = 92;
    const st = stepsOf();
    let hasPart = !!(st.part && st.part.length && st.part[0].length);
    let maxMain = Infinity;
    if (Hmax) {
      const fitRows = (part) => Math.floor((Hmax - staffTop - 14 - (part ? PART_PAD : 0) - (besideShelf ? 0 : NEWS_H + 28)) / ROW_H) - (part ? 1 : 0);
      if (hasPart && fitRows(true) < 1) hasPart = false; // 파트 줄까지는 안 들어가면 터미널처럼 파트장 자리의 「파트장」 표시 · 카드로만
      maxMain = Math.max(1, fitRows(hasPart) * perRow - deskSlot);
    }
    const main = o ? foldPick(st.main, maxMain) : [], part = o && hasPart ? foldPick(st.part, perRow) : [];
    const slots = main.length + deskSlot;
    if (o) seats.push(mkSeat({ key: 'main', job: '팀장', name: '팀장', worker: o.lead, team: false, members: null, count: 0 }, leadCx - SLOT_W / 2, leadSy, -1, true));
    main.forEach((sp, i) => {
      const r = Math.floor(i / perRow), c = i % perRow;
      seats.push(mkSeat(spotSeat(sp, o), left + c * SLOT_W, staffTop + r * ROW_H, r, false));
    });
    const mainRows = Math.max(1, Math.ceil(slots / perRow));
    const partRow = part.length ? mainRows : -1;
    part.forEach((sp, i) => seats.push(mkSeat(spotSeat(sp, o), left + i * SLOT_W, staffTop + partRow * ROW_H + PART_PAD, partRow, false)));
    const rows = mainRows + (part.length ? 1 : 0), pad = part.length ? PART_PAD : 0;
    let desk = null;
    if (deskOn && hallX != null) {
      const top = leadSy + 78;
      desk = { mode: 'hall', x: hallX + 14, top, w: 84, h: 24, seatFoot: top + 19, sideX: hallX + 2, qy: hallTop + 46,
        sign: { x: hallX + 102, y: top - 34, w: 36, h: 16 } };
    } else if (deskOn) {
      const i = main.length, r = Math.floor(i / perRow), c = i % perRow, sx = left + c * SLOT_W, sy = staffTop + r * ROW_H;
      desk = { mode: 'grid', x: sx + 8, top: sy + 72, w: 84, h: 24, seatFoot: sy + 91, cx: sx + SLOT_W / 2, row: r, sx, sy,
        sign: { x: sx + 26, y: sy + 82, w: 48, h: 12 } }; // 좁은 칸: 번호판은 카운터 앞판에
    }
    const news = besideShelf ? { x: shelf.x, y: staffTop + 6, w: SHELF_W, h: NEWS_H }
      : { x: W - RIGHT - SHELF_W, y: staffTop + rows * ROW_H + pad + 4, w: SHELF_W, h: NEWS_H };
    const H = Math.max(staffTop + rows * ROW_H + pad + 14, news.y + news.h + 24);
    // 출입문은 뒷벽 왼쪽. 문 → 왼쪽 길 → 큰 복도로 드나든다
    const door = { x: 22, y: 8, w: 42, h: WALL_H + 4 };
    const lay = { W, H, seats, shelf, hallTop, hallFoot, staffTop, door, doorCx: door.x + door.w / 2, doorFoot: door.y + door.h, corridorX: door.x + door.w / 2,
      aisleFoot: (k) => staffTop + k * ROW_H + ROW_H - 6, lead: seats[0], books: null, partRow, perRow };
    // 벽: 문 · 시계 · 화이트보드(사장님 지시 · 할 일) · 팀장 뒤 회사 간판 · 남은 자리에 창문
    lay.plaque = { x: Math.max(104, leadCx - 56), y: 12, w: 112, h: 24 }; // 시계(왼쪽)를 피해서
    lay.news = news;
    lay.desk = desk;
    const boardW = Math.min(128, lay.plaque.x - 14 - 104); // 좁은 창: 간판과 안 겹치게 줄이고, 너무 좁으면 뺀다
    lay.board = boardW >= 70 ? { x: 104, y: 9, w: boardW, h: 48 } : null;
    lay.wins = [];
    for (let x = (lay.board ? lay.board.x + lay.board.w : 104) + 28; x + 64 < shelf.x - 24; x += 150) {
      if (x + 64 > lay.plaque.x - 14 && x < lay.plaque.x + lay.plaque.w + 14) { x = lay.plaque.x + lay.plaque.w + 14 - 150; continue; }
      lay.wins.push(x);
    }
    const keep = L; L = lay; lay.books = books(); L = keep;
    return lay;
  }
  function mkSeat(u, sx, sy, row, lead) {
    return Object.assign(u, { sx, sy, row, lead, cx: sx + SLOT_W / 2, seatTop: sy + 30, seatFoot: sy + 30 + FOOT, deskBottom: sy + 102 });
  }

  // ---- 배율: 창에 맞춰 (기기 픽셀 기준 정수 배율이라 픽셀이 번지지 않는다) ----
  // 카드가 열리면 넓은 창에선 사무실이 카드만큼 비켜서 다시 맞춘다 (덮어서 팀장이 가려지지 않게)
  function room() {
    const side = !$('card').hidden && window.innerWidth > 760 ? 384 : 0;
    if (stage.style.paddingRight !== side + 'px') stage.style.paddingRight = side + 'px';
    return side;
  }
  function fit() {
    dpr = window.devicePixelRatio || 1;
    const cw = Math.max(200, stage.clientWidth - room()) * dpr, ch = stage.clientHeight * dpr;
    // 「크게 → 작게(바닥 배율까지) → 접기 → +n」: 한 화면에 다 들어가는 가장 큰 배율. 바닥 배율(CSS 1배 — 캐릭터를 알아볼 수 있는
    // 가장 작은 크기)까지 낮춰도 안 들어가면 그 배율에서 높이에 맞춰 같은 직군 접기 → 「+n명」. 세로 스크롤은 기본으로 안 쓴다
    const floor = Math.max(1, Math.round(dpr));
    let pick = null;
    for (let s = 8; s >= floor; s--) {
      const W = Math.floor(cw / s);
      if (W < MIN_W && s > floor) continue;
      const lay = layout(W);
      if (lay.H * s <= ch) { pick = { s, lay }; break; }
    }
    if (!pick) { const W = Math.max(MIN_W, Math.floor(cw / floor)), Hmax = Math.floor(ch / floor); pick = { s: floor, lay: Object.assign(layout(W, Hmax), { Hmax }) }; }
    sd = pick.s; L = pick.lay;
    if (world.width !== L.W || world.height !== L.H) { world.width = L.W; world.height = L.H; }
    if (canvas.width !== L.W * sd) canvas.width = L.W * sd; // 크기가 같으면 건드리지 않는다 (바꾸면 그림판이 비워짐)
    if (canvas.height !== L.H * sd) canvas.height = L.H * sd;
    canvas.style.width = (L.W * sd) / dpr + 'px'; canvas.style.height = (L.H * sd) / dpr + 'px';
    if (stage.scrollLeft) stage.scrollLeft = 0;
    news(); // 게시판 쪽지 자리도 다시
    lastBgKey = '';
  }

  // ---- 그리는 도구 (월드) ----
  function R(c, x, y, w, h, col) { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
  function shade(hex, amt) { return S.shade(hex, amt); }

  // 배경: 바닥 판자 · 벽 · 걸레받이 · 깔개 · 화분 (배치가 바뀔 때만 다시 그림)
  function drawBg(now) {
    const hour = hourOf(now);
    const key = `${L.W}x${L.H}|${L.lead ? L.lead.cx : 0}|${hour < 6 || hour >= 19 ? 'n' : 'd'}`;
    if (key === lastBgKey) return;
    lastBgKey = key;
    bg.width = L.W; bg.height = L.H;
    const c = bctx;
    // 바닥: 따뜻한 나무 판자, 판자마다 살짝 다른 결
    for (let y = WALL_H; y < L.H; y += 10) {
      const row = (y - WALL_H) / 10;
      for (let x = -((row % 2) * 31); x < L.W; x += 62) {
        const t = hash(`${x},${y}`) % 18 - 9;
        R(c, x, y, 62, 10, shade('#c9a274', t));
        R(c, x, y + 9, 62, 1, shade('#a47c52', t / 2));
        R(c, x, y, 1, 10, '#a47c52');
        if (hash(`k${x},${y}`) % 5 === 0) R(c, x + 12 + (hash(`q${x}`) % 30), y + 3, 6, 1, shade('#b38b5d', t));
      }
    }
    // 큰 복도 · 문 앞 길: 초록 카펫 (사람이 다니는 곳)
    const run = (x, y, w, h) => { R(c, x, y, w, h, '#3f5a4c'); R(c, x + 2, y + 2, w - 4, h - 4, '#5c7a6b'); R(c, x + 4, y + 4, w - 8, h - 8, '#668a77'); };
    run(L.doorCx - 14, L.doorFoot + 10, 28, L.hallFoot - L.doorFoot - 2);
    run(L.doorCx - 14, L.hallFoot - 13, L.shelf.x + 60 - L.doorCx, 20);
    for (let x = L.doorCx; x < L.shelf.x + 40; x += 8) R(c, x, L.hallFoot - 4, 4, 1, '#86a894');
    // 벽: 위는 연한 색, 아래 징두리 판
    R(c, 0, 0, L.W, WALL_H, '#e6dccb');
    for (let x = 0; x < L.W; x += 4) R(c, x, 0, 1, WALL_H - 22, 'rgba(160,140,110,0.08)');
    R(c, 0, WALL_H - 22, L.W, 20, '#9a7653');
    for (let x = 6; x < L.W; x += 26) R(c, x, WALL_H - 19, 20, 14, '#8a6847');
    R(c, 0, WALL_H - 2, L.W, 2, '#5b4330');
    R(c, 0, WALL_H, L.W, 3, 'rgba(0,0,0,0.18)');
    // 창문 틀 (하늘은 매 장면 그림) + 낮엔 바닥에 햇빛
    const day = !(hour < 6 || hour >= 19);
    for (const wx of windows()) {
      R(c, wx - 3, 8, 70, 42, '#f7f1e6'); R(c, wx - 3, 48, 70, 3, '#cdbfa8');
      if (day) for (let y = 0; y < 64; y += 2) { c.fillStyle = `rgba(255,246,214,${(0.2 * (1 - y / 64)).toFixed(3)})`; c.fillRect(Math.round(wx - 2 - y / 3), WALL_H + y, Math.round(68 + (2 * y) / 3), 2); }
    }
    // 화이트보드 (글은 매 장면 위에 씀)
    const B = L.board || { x: -999, y: 0, w: 0, h: 0 };
    R(c, B.x - 3, B.y - 3, B.w + 6, B.h + 6, '#b9bec6'); R(c, B.x - 2, B.y - 2, B.w + 4, B.h + 4, '#dfe3e8');
    R(c, B.x, B.y, B.w, B.h, '#fbfcfd'); R(c, B.x, B.y + B.h + 3, B.w, 3, '#9aa1aa');
    R(c, B.x + 10, B.y + B.h + 1, 10, 2, '#e03131'); R(c, B.x + 24, B.y + B.h + 1, 10, 2, '#1971c2');
    // 회사 간판 (팀장 뒤 벽)
    const Pq = L.plaque;
    R(c, Pq.x, Pq.y, Pq.w, Pq.h, '#5b3a22'); R(c, Pq.x + 2, Pq.y + 2, Pq.w - 4, Pq.h - 4, '#7a5030');
    R(c, Pq.x + 2, Pq.y + 2, Pq.w - 4, 1, '#9a6a40'); R(c, Pq.x + 4, Pq.y + Pq.h, Pq.w - 8, 2, 'rgba(0,0,0,0.25)');
    // 팀장 깔개
    if (L.lead) {
      const rx = L.lead.cx - 62, ry = L.lead.sy + 84;
      R(c, rx, ry, 124, 30, '#8c3b3b'); R(c, rx + 3, ry + 3, 118, 24, '#a94442');
      for (let i = 0; i < 118; i += 6) R(c, rx + 3 + i, ry + 13, 3, 3, '#c9665f');
    }
    // 「사무실 소식」 게시판: 코르크판 + 다리 (글은 위에 겹친 쪽지가 보여 줌)
    const N = L.news;
    R(c, N.x + 10, N.y + N.h, 4, 14, '#6b4a2f'); R(c, N.x + N.w - 14, N.y + N.h, 4, 14, '#6b4a2f');
    R(c, N.x + 6, N.y + N.h + 14, 14, 3, 'rgba(0,0,0,0.2)'); R(c, N.x + N.w - 18, N.y + N.h + 14, 14, 3, 'rgba(0,0,0,0.2)');
    R(c, N.x - 3, N.y - 3, N.w + 6, N.h + 6, '#8a5d38'); R(c, N.x - 3, N.y - 3, N.w + 6, 2, '#a8784a');
    R(c, N.x, N.y, N.w, N.h, '#b98a57');
    for (let i = 0; i < 160; i++) R(c, N.x + (hash('k' + i) % N.w), N.y + (hash('j' + i) % N.h), 1, 1, i % 2 ? '#a77a4a' : '#c99a66');
    // 화분
    plant(c, L.W - RIGHT - SHELF_W - 30, WALL_H + 22);
    plant(c, SIDE + 6, WALL_H + 10);
    plant(c, L.news.y > L.staffTop + 20 ? 8 : L.W - 30, L.H - 40); // 게시판이 아래 오른쪽이면 화분은 왼쪽으로
  }
  const windows = () => L.wins;
  function plant(c, x, y) {
    R(c, x + 2, y + 18, 16, 14, '#b5643a'); R(c, x, y + 16, 20, 4, '#c87a4c'); R(c, x + 4, y + 30, 12, 2, 'rgba(0,0,0,0.2)');
    const leaf = ['#3f8f4a', '#2f7a3b', '#56a35d'];
    [[8, 0, 4, 18], [3, 4, 4, 13], [13, 3, 4, 14], [0, 9, 5, 8], [15, 8, 5, 9], [9, 6, 3, 12]].forEach((l, i) => R(c, x + l[0], y + l[1], l[2], l[3], leaf[i % 3]));
  }

  // 매 장면: 창밖 하늘 · 벽시계 · 문 · 책장
  function drawWall(c, now) {
    const hour = hourOf(now), night = hour < 6 || hour >= 19;
    for (const wx of windows()) {
      c.save(); c.beginPath(); c.rect(wx, 11, 64, 36); c.clip(); // 창 안에서만
      const g = c.createLinearGradient(0, 10, 0, 46);
      g.addColorStop(0, night ? '#0f1a3a' : '#8fc9f0'); g.addColorStop(1, night ? '#24355e' : '#cde9fb');
      c.fillStyle = g; c.fillRect(wx, 11, 64, 36);
      if (night) { for (let i = 0; i < 6; i++) if ((Math.floor(now / 700) + i) % 4) R(c, wx + 5 + ((i * 23) % 56), 14 + ((i * 11) % 26), 1, 1, '#fff6c8'); }
      else { const cx = wx + ((now / 400 + hash(String(wx)) % 64) % 84) - 14; R(c, cx, 19, 14, 4, '#ffffff'); R(c, cx + 3, 16, 8, 3, '#ffffff'); }
      c.restore();
      R(c, wx + 31, 11, 2, 36, '#f7f1e6'); R(c, wx, 28, 64, 2, '#f7f1e6');
    }
    // 벽시계 (진짜 시각)
    const kx = 86, ky = 30, d = new Date(now);
    c.fillStyle = '#5b4330'; c.beginPath(); c.arc(kx, ky, 12, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fffaf0'; c.beginPath(); c.arc(kx, ky, 10, 0, Math.PI * 2); c.fill();
    const hand = (ang, len, col, w) => { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(kx, ky); c.lineTo(kx + Math.sin(ang) * len, ky - Math.cos(ang) * len); c.stroke(); };
    hand(((d.getHours() % 12) + d.getMinutes() / 60) / 12 * Math.PI * 2, 5, '#2b2420', 2);
    hand(d.getMinutes() / 60 * Math.PI * 2, 8, '#2b2420', 1);
    hand(d.getSeconds() / 60 * Math.PI * 2, 8, '#c9423a', 1);
  }

  // 출입문: 뒤(문짝 · 열렸을 때 어두운 안쪽)와 앞(문틀)을 나눠 그려서, 드나드는 사람이 문틀 안으로 들어가 보이게
  function drawDoorBack(c, open) {
    const d = L.door;
    // 문 앞 발판
    R(c, d.x - 4, d.y + d.h + 2, d.w + 8, 9, '#7c2f2f'); R(c, d.x - 2, d.y + d.h + 4, d.w + 4, 5, '#9a3d3a');
    for (let i = 0; i < d.w + 2; i += 4) R(c, d.x - 1 + i, d.y + d.h + 6, 2, 1, '#b9605a');
    if (open) {
      // 열린 문: 어두운 복도 안쪽 + 안으로 젖혀진 문짝
      const g = c.createLinearGradient(0, d.y, 0, d.y + d.h);
      g.addColorStop(0, '#1a1410'); g.addColorStop(1, '#3a2c22');
      c.fillStyle = g; c.fillRect(d.x, d.y, d.w, d.h);
      R(c, d.x, d.y, 8, d.h, '#6b4a2f'); R(c, d.x + 1, d.y + 2, 6, d.h - 4, '#8a6040');
      R(c, d.x + 8, d.y + d.h - 6, d.w - 8, 6, 'rgba(255,214,150,0.10)');
      return;
    }
    // 닫힌 문: 판 두 개 · 작은 유리창 · 황동 손잡이
    R(c, d.x, d.y, d.w, d.h, '#8a5d38');
    for (let x = d.x + 2; x < d.x + d.w; x += 6) R(c, x, d.y, 1, d.h, 'rgba(60,36,18,0.18)');
    R(c, d.x + 6, d.y + 6, d.w - 12, 22, '#7a5130'); R(c, d.x + 8, d.y + 8, d.w - 16, 18, '#a9d6ee');
    R(c, d.x + 8, d.y + 8, d.w - 16, 3, '#d4ecf8'); R(c, d.x + d.w / 2, d.y + 8, 1, 18, '#7a5130');
    R(c, d.x + 6, d.y + 34, d.w - 12, d.h - 42, '#7a5130'); R(c, d.x + 8, d.y + 36, d.w - 16, d.h - 46, '#93653e');
    R(c, d.x + d.w - 10, d.y + 40, 5, 5, '#e0b84a'); R(c, d.x + d.w - 9, d.y + 41, 2, 2, '#fff1b0');
  }
  function drawDoorFront(c) {
    const d = L.door;
    R(c, d.x - 5, d.y - 5, d.w + 10, 5, '#d9b27c'); R(c, d.x - 5, d.y - 5, d.w + 10, 1, '#f0cf9c');
    R(c, d.x - 5, d.y, 5, d.h, '#d9b27c'); R(c, d.x + d.w, d.y, 5, d.h, '#c49a63');
    R(c, d.x - 5, d.y, 1, d.h, '#f0cf9c'); R(c, d.x + d.w + 4, d.y, 1, d.h, '#a47c4c');
    R(c, d.x - 5, d.y + d.h, d.w + 10, 2, '#a47c4c'); // 문턱
  }

  const SPINES = ['#c2410c', '#1971c2', '#2f9e44', '#e8590c', '#7048e8', '#d6336c', '#0c8599', '#f59f00', '#5c7cfa', '#868e96'];
  /** 책장의 책 자리들 (배치마다 한 번) */
  function books() {
    const s = L.shelf, levels = 4, lh = Math.floor((s.h - 8) / levels), out = [];
    for (let l = 0; l < levels; l++) {
      const y0 = s.y + 4 + l * lh;
      for (let x = s.x + 7; x < s.x + s.w - 10;) {
        const i = out.length, bw = 3 + (hash(`w${i}`) % 3), bh = lh - 9 - (hash(`h${i}`) % 6);
        out.push({ x, y: y0 + lh - 3 - bh, w: bw, h: bh, col: SPINES[hash(`c${i}`) % SPINES.length] });
        x += bw + 1;
      }
    }
    return { levels, lh, out };
  }
  function drawShelf(c, taken, now) {
    const s = L.shelf, B = L.books;
    R(c, s.x + 4, s.y + s.h, s.w - 4, 4, 'rgba(0,0,0,0.25)');
    R(c, s.x, s.y, s.w, s.h, '#6b4a2f'); R(c, s.x + 4, s.y + 4, s.w - 8, s.h - 8, '#4a3220');
    for (let l = 0; l < B.levels; l++) R(c, s.x + 4, s.y + 4 + l * B.lh + B.lh - 3, s.w - 8, 3, '#8a6040');
    B.out.forEach((b, i) => {
      if (taken.has(i)) { if (Math.floor(now / 300) % 2) R(c, b.x, b.y, b.w, b.h, 'rgba(255,224,120,0.35)'); return; } // 꺼내 간 책 자리
      R(c, b.x, b.y, b.w, b.h, b.col); R(c, b.x, b.y + 3, b.w, 1, shade(b.col, 60));
    });
  }
  const slotOf = (book) => hash(book) % Math.max(1, L.books.out.length);

  /** 나란히 앉은 같은 일 직원 묶음(이어진 twin 자리) · 파트장 아래 줄 묶음(같은 파트장) */
  function groupsOf(test) {
    const out = [];
    for (const s of L.seats) {
      const k = test(s);
      if (k == null) continue;
      const g = out[out.length - 1];
      if (g && g.k === k && g.sy === s.sy && g.x1 === s.sx) { g.x1 = s.sx + SLOT_W; g.seats.push(s); } else out.push({ k, sy: s.sy, x0: s.sx, x1: s.sx + SLOT_W, seats: [s] });
    }
    return out;
  }
  const twinGroups = () => groupsOf((s) => (s.kind === 'twin' ? s.pick : null)); // 줄이 바뀌면 묶음도 줄마다
  const partGroups = () => groupsOf((s) => (!s.lead && s.row === L.partRow ? s.boss || '?' : null));
  function drawGroups(c) {
    for (const g of twinGroups()) { // 같은 일 병렬: 청록 깔개 하나 위에 같은 책상이 나란히
      R(c, g.x0 + 4, g.sy + 32, g.x1 - g.x0 - 8, 78, '#2f8f83'); R(c, g.x0 + 6, g.sy + 34, g.x1 - g.x0 - 12, 74, '#5fb3a6');
      for (let x = g.x0 + 10; x < g.x1 - 10; x += 8) R(c, x, g.sy + 106, 4, 1, '#8fd3c7');
    }
    for (const g of partGroups()) { // 파트 줄: 파트마다 연보라 바닥 띠 (위 띠에 「▸ 개발자 파트」 글)
      R(c, g.x0 + 2, g.sy - PART_PAD + 2, g.x1 - g.x0 - 4, ROW_H + PART_PAD - 8, '#7b6fae'); R(c, g.x0 + 4, g.sy - PART_PAD + 4, g.x1 - g.x0 - 8, ROW_H + PART_PAD - 12, '#a99fd6');
    }
  }

  // 사무용 의자: 둥근 등받이 + 머리받이 (사람이 없으면 등받이가 보인다)
  function drawChair(c, s) {
    if (s.team) {
      // 팀 자리: 뒤에 낮은 유리 칸막이 + 팀 표지(진행 글은 위에 씀)
      R(c, s.cx - 46, s.sy + 38, 92, 32, 'rgba(176,214,236,0.38)'); R(c, s.cx - 46, s.sy + 37, 92, 2, '#8796a5');
      R(c, s.cx - 46, s.sy + 38, 2, 32, '#8796a5'); R(c, s.cx + 44, s.sy + 38, 2, 32, '#8796a5');
      R(c, s.cx - 20, s.sy + 39, 40, 9, '#2b2f36');
    }
    const x = s.cx - 13, y = s.sy + 50;
    R(c, x + 2, y - 1, 22, 1, '#2c3440');
    R(c, x + 1, y, 24, 20, '#2c3440'); R(c, x, y + 2, 26, 16, '#2c3440');
    R(c, x + 2, y + 1, 22, 18, '#3e4a5c'); R(c, x + 1, y + 3, 24, 14, '#3e4a5c');
    R(c, x + 4, y + 3, 18, 2, '#56657a'); R(c, x + 4, y + 5, 2, 10, '#4a586c');
    for (let i = 0; i < 4; i++) R(c, x + 7 + i * 4, y + 8, 1, 7, '#36414f'); // 등받이 바느질
    R(c, x + 11, y + 20, 4, 4, '#262c35');
  }

  let isNight = false;
  function drawDesk(c, s, frame, working) {
    const w = s.lead ? 96 : 80, x = s.cx - w / 2, y = s.sy + 72;
    R(c, x + 3, s.deskBottom, w - 2, 4, 'rgba(0,0,0,0.22)');
    R(c, x, y, w, 8, '#c08a55'); R(c, x, y, w, 2, '#d9a56e');
    R(c, x, y + 8, w, 22, '#9a6a3d'); R(c, x, y + 28, w, 2, '#7a5230');
    R(c, x + 6, y + 12, w - 12, 1, '#a87749');
    // 노트북 (뒷면) — 일하는 중이면 로고가 빛남
    R(c, s.cx + 10, y - 15, 24, 15, '#cfd4da'); R(c, s.cx + 8, y - 1, 28, 2, '#adb3ba');
    R(c, s.cx + 20, y - 9, 4, 4, working ? (frame % 2 ? '#74c0fc' : '#ffffff') : '#8e959c');
    if (s.lead) {
      // 받은 서류 더미 (보고를 받을수록 쌓인다)
      const n = Math.min(8, (snap.office.handoffs || []).length);
      for (let i = 0; i < n; i++) R(c, s.cx - 40, y - 2 - i * 2, 16, 2, i % 2 ? '#fffdf5' : '#eee6d6');
      R(c, s.cx - 18, y - 6, 6, 6, '#ffffff'); R(c, s.cx - 12, y - 4, 2, 3, '#ffffff');
    }
    // 스탠드 (밤이면 켜짐)
    const lx = x + 2, lit = isNight;
    R(c, lx, y - 2, 7, 2, '#495057'); R(c, lx + 3, y - 12, 1, 10, '#495057'); R(c, lx + 1, y - 15, 8, 3, lit ? '#ffe8a3' : '#868e96'); R(c, lx + 2, y - 16, 6, 1, '#343a40');
    // 역할마다 책상 소품
    const px = s.cx - 30;
    switch (s.job) {
      case '디자이너': R(c, px, y - 7, 17, 8, '#2b2f36'); R(c, px + 1, y - 6, 15, 6, '#8fd3ff'); R(c, px + 4, y - 4, 6, 2, '#f783ac'); R(c, px + 14, y - 11, 1, 6, '#e8590c');
        R(c, px + 20, y - 3, 3, 3, '#e64980'); R(c, px + 24, y - 3, 3, 3, '#fab005'); R(c, px + 28, y - 3, 3, 3, '#15aabf'); break;
      case 'QA': R(c, px, y - 13, 12, 14, '#8a6040'); R(c, px + 1, y - 11, 10, 11, '#fffdf5'); R(c, px + 4, y - 14, 4, 2, '#adb5bd');
        for (let i = 0; i < 3; i++) { R(c, px + 2, y - 9 + i * 3, 2, 1, '#2f9e44'); R(c, px + 5, y - 9 + i * 3, 5, 1, '#adb5bd'); } break;
      case '리서처': R(c, px, y - 3, 17, 3, '#1971c2'); R(c, px + 1, y - 6, 15, 3, '#c2410c'); R(c, px + 2, y - 9, 13, 3, '#2f9e44'); R(c, px + 1, y - 9, 1, 3, '#fff'); break;
      case '기획자': R(c, px, y - 2, 6, 2, '#ffe066'); R(c, px + 7, y - 2, 6, 2, '#ff8fab'); R(c, px + 14, y - 2, 6, 2, '#8ce99a');
        R(c, s.cx + 12, y - 14, 4, 4, '#ffe066'); R(c, s.cx + 27, y - 12, 4, 4, '#ff8fab'); break;
      case '개발자': R(c, px - 2, y - 19, 22, 14, '#3d434b'); R(c, px, y - 17, 18, 10, '#4d545d'); R(c, px + 8, y - 5, 3, 5, '#343a40'); R(c, px + 4, y - 1, 11, 1, '#343a40');
        R(c, px + 22, y - 5, 5, 5, '#c92a2a'); R(c, px + 23, y - 4, 3, 1, '#ffffff'); break;
    }
    if (s.team && s.members) {
      // 팀 깃발(오른쪽 끝) + 팀원 점 (끝 초록 · 일하는 중 노랑 · 못 끝냄 빨강)
      const fc = SPINES[hash(s.key) % SPINES.length];
      R(c, x + w - 4, y - 20, 2, 20, '#5b4330'); R(c, x + w - 2, y - 20, 12, 8, fc);
      s.members.slice(-6).forEach((m, i) => {
        const st = m.status;
        const col = st === 'done' || st === 'idle' ? '#3fa66b' : st === 'unfinished' ? '#c9423a' : st === 'off' || st === 'desk' ? '#868e96' : (frame % 2 ? '#fcc419' : '#b8901a');
        R(c, x + 8 + i * 7, y + 16, 4, 4, col);
      });
    }
  }

  // ---- 놓친 일 서류 (패널 office.ts onMissed: 흔적 있는 것만) ----
  // 그 일을 맡았던 자리 바로 위 통로 바닥에 떨어져 있다. 자리가 없으면 · 팀장 것이면 팀장 책상 왼쪽 큰 복도
  function paperSpots(o) {
    const n = new Map(), lead = L.lead;
    if (!lead) return [];
    return (o.papers || []).map((p) => {
      const s = p.who === 'main' ? null : L.seats.find((x) => !x.lead && ((x.worker && x.worker.id === p.who) || (x.members || []).some((m) => m.id === p.who)))
        || L.seats.find((x) => !x.lead && (x.pick || x.key) === p.unit) || null;
      const at = s || lead, i = n.get(at.key) || 0;
      n.set(at.key, i + 1);
      if (!s) return { p, x: Math.max(SIDE + 10, lead.cx - 84 - i * 16), y: L.hallFoot - 3, row: -1 };
      return { p, x: s.sx + SLOT_W - 24 - i * 16, y: (s.row === 0 ? L.hallFoot : L.aisleFoot(s.row - 1)) - 3, row: s.row };
    });
  }
  /** 바닥에 떨어진 종이 (조금 비뚤게 · 접힌 귀퉁이 · 빨간 줄) + 위에서 통통 튀는 「!」 */
  function drawLost(c, x, y, frame) {
    R(c, x + 1, y + 1, 14, 3, 'rgba(0,0,0,0.25)');
    R(c, x, y - 8, 13, 9, '#fffdf5'); R(c, x + 1, y - 9, 12, 1, '#fffdf5'); R(c, x + 10, y - 8, 3, 3, '#d9d2c3');
    R(c, x + 2, y - 6, 7, 1, '#e03131'); R(c, x + 2, y - 4, 8, 1, '#adb5bd'); R(c, x + 2, y - 2, 6, 1, '#adb5bd');
    const by = y - 20 - (frame % 2);
    R(c, x + 5, by, 3, 6, '#e03131'); R(c, x + 5, by + 8, 3, 3, '#e03131'); R(c, x + 6, by + 1, 1, 4, '#ff8787');
  }

  // ---- 움직임 (패널 scene.ts motionOf 와 같은 규칙) ----
  function toHall(s, x) {
    const start = { x: s.cx, y: s.seatFoot };
    if (s.lead) {
      const side = { x: s.cx + 74, y: start.y };
      return [start, side, { x: side.x, y: L.hallFoot }, { x, y: L.hallFoot }];
    }
    const up = { x: start.x, y: s.row === 0 ? L.hallFoot : L.aisleFoot(s.row - 1) };
    const pts = [start, up];
    if (s.row > 0) pts.push({ x: L.corridorX, y: up.y }, { x: L.corridorX, y: L.hallFoot });
    pts.push({ x, y: L.hallFoot });
    return pts;
  }
  /** 자리 → 큰 복도 → 왼쪽 길로 올라가 → 문 안으로 (안쪽으로 몇 걸음 더 가며 사라진다) */
  function toDoor(s) {
    return toHall(s, L.doorCx).concat([{ x: L.doorCx, y: L.doorFoot }, { x: L.doorCx, y: L.doorFoot - 20 }]);
  }
  /** 사장님: 문 → 왼쪽 길 → 큰 복도 → 팀장 책상 앞 */
  function bossPath() {
    return [{ x: L.doorCx, y: L.doorFoot - 20 }, { x: L.doorCx, y: L.doorFoot }, { x: L.doorCx, y: L.hallFoot }, { x: L.lead.cx - 34, y: L.hallFoot }];
  }
  const lenOf = (pts) => pts.reduce((n, p, i) => (i ? n + Math.abs(p.x - pts[i - 1].x) + Math.abs(p.y - pts[i - 1].y) : 0), 0);
  function at(pts, d) {
    let left = d;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], seg = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      if (left <= seg) { const q = seg ? left / seg : 0; return { x: a.x + (b.x - a.x) * q, y: a.y + (b.y - a.y) * q, dx: b.x - a.x, dy: b.y - a.y }; }
      left -= seg;
    }
    const z = pts[pts.length - 1], y = pts[pts.length - 2] || z;
    return { x: z.x, y: z.y, dx: z.x - y.x, dy: z.y - y.y };
  }
  function motionOf(o, s, now, who) {
    const w = who || s.worker; // who: 자리에서 나가는 앞사람 (보고 · 퇴근 걸음만)
    if (!w) return {};
    const id = s.lead ? 'main' : w.id;
    const h = s.lead ? null : [...(o.handoffs || [])].reverse().find((x) => x.from === w.id);
    const hAge = h ? now - h.at : -1;
    // 보고: 자리 → 팀장 앞 → 돌아옴 (거리 기반 시간)
    if (h && hAge >= 0) {
      const pts = toHall(s, L.lead.cx + 34), tripMs = lenOf(pts) / (WALK_SPEED * 0.4);
      if (hAge < tripMs) {
        const t = hAge / tripMs;
        if (t < 0.4) return { m: { pts, p: ease(t / 0.4), carry: 'doc' } };
        if (t < 0.6) return { m: { pts, p: 1, give: ease((t - 0.4) / 0.2) } };
        return { m: { pts, p: 1 - ease((t - 0.6) / 0.4) } };
      }
    }
    // 퇴근: 보고 끝난 뒤 문으로
    if (w.ended != null && !s.lead) {
      const leavePts = toDoor(s), leaveMs = lenOf(leavePts) / WALK_SPEED;
      const tripMs = h ? lenOf(toHall(s, L.lead.cx + 34)) / (WALK_SPEED * 0.4) : 0;
      const leaveAt = w.ended + (h && h.at >= w.ended - 1000 ? tripMs : 0) + 1500, lAge = now - leaveAt;
      if (lAge >= leaveMs) return { gone: true };
      if (lAge >= 0) return { m: { pts: leavePts, p: ease(lAge / leaveMs) } };
    }
    if (who) return {}; // 나가는 앞사람: 책장 · 출근 걸음은 자리 주인 몫
    // 놓친 일 서류: 팀장이 그 자리 근처로 걸어가 줍고 → 자리로 돌아온다 (그 뒤 자리에서 읽음)
    if (s.lead && !who) {
      const got = paperSpots(o).find((x) => x.p.picked != null && now - x.p.picked >= 0 && now - x.p.picked < PICK_WALK_MS);
      if (got) {
        const tx = got.x - 10;
        const pts = got.row <= 0 ? toHall(s, tx) : toHall(s, L.corridorX).concat([{ x: L.corridorX, y: L.aisleFoot(got.row - 1) }, { x: tx, y: L.aisleFoot(got.row - 1) }]);
        const t = (now - got.p.picked) / PICK_WALK_MS;
        if (t < 0.45) return { m: { pts, p: ease(t / 0.45) } };
        if (t < 0.55) return { m: { pts, p: 1, carry: t > 0.5 ? 'doc' : null, reach: true } };
        return { m: { pts, p: 1 - ease((t - 0.55) / 0.45), carry: 'doc' } };
      }
    }
    // 책장: 스킬을 쓰면 갔다 옴
    const sh = [...(o.shelf || [])].reverse().find((x) => x.who === id);
    const sAge = sh ? now - sh.at : -1;
    if (sh && sAge >= 0) {
      const pts = toHall(s, L.shelf.x + 40), shelfMs = lenOf(pts) / (WALK_SPEED * 0.4);
      if (sAge < shelfMs) {
        const t = sAge / shelfMs;
        if (t < 0.4) return { m: { pts, p: ease(t / 0.4) } };
        if (t < 0.55) return { m: { pts, p: 1, carry: t > 0.48 ? 'book' : null, reach: true } };
        return { m: { pts, p: 1 - ease((t - 0.55) / 0.45), carry: 'book' } };
      }
    }
    // 출근: 문에서 자리로
    if (!s.lead) {
      const aAge = now - w.started;
      if (aAge >= 0) {
        const arrivePts = toDoor(s), arriveMs = lenOf(arrivePts) / WALK_SPEED;
        if (aAge < arriveMs) return { m: { pts: arrivePts, p: 1 - ease(aAge / arriveMs) } };
      }
    }
    return {};
  }

  // ---- 심사대 (서로 검사하기) ----
  // 검사 직원(checker)이 출근하면 문 → 심사대로 가서 앉아 검토하고, 끝나면 도장(통과 · 반려) → 서류가 날아간 뒤 문으로 퇴근.
  // 검사 받는 직원(reviewOf)은 서류를 들고 심사대 앞에 줄을 섰다가, 반려면 서류를 돌려받아 자리로 · 통과면 서류는 팀장에게.
  // 이번 일(사장님 지시 뒤)의 검사 직원만. 하나도 없으면 심사대를 안 그린다.
  function reviewersOf(o) {
    const from = (o.promptAt || 0) - 1000;
    return (o.workers || []).filter((w) => w.checker && !w.teammate && (w.ended == null || w.started >= from));
  }
  const seatOfId = (id) => L.seats.find((x) => !x.lead && x.members && x.members.some((m) => m.id === id));
  const doorIn = () => [{ x: L.doorCx, y: L.doorFoot - 20 }, { x: L.doorCx, y: L.doorFoot }, { x: L.doorCx, y: L.hallFoot }];
  /** 큰 복도 → 심사대 뒤 자리 (심사대 왼쪽으로 돌아 들어가서 앉는다 — 앞에 선 줄과 안 부딪치게) */
  function hallToDesk(D, sitX) {
    if (D.mode === 'hall') return [{ x: D.sideX, y: L.hallFoot }, { x: D.sideX, y: D.seatFoot }, { x: sitX, y: D.seatFoot }];
    const pseudo = { cx: D.cx, seatFoot: D.seatFoot, row: D.row, lead: false };
    return toHall(pseudo, D.cx).reverse().concat([{ x: sitX, y: D.seatFoot }]);
  }
  const rev = (pts) => pts.slice().reverse();
  /** 지금 심사대 장면: 앉은 검사 직원 · 줄 선 직원 · 걷는 사람 · 날아가는 서류 · 번호판 글. hide = 자리에 안 그릴 직원, gone = 퇴근 */
  function reviewScene(o, now) {
    const D = L && L.desk, out = { sit: [], walk: [], papers: [], stamp: null, hide: new Set(), gone: new Set(), more: 0, wait: 0, sign: null, active: [] };
    if (!D) return out;
    const reviews = o.reviews || [];
    const lastOf = (id) => [...reviews].reverse().find((r) => r.by === id);
    const exitPts = (sitX) => rev(doorIn().concat(hallToDesk(D, sitX)));
    // 심사대에 있는 검사 직원 (출근해 오는 중 ~ 퇴근해 나가는 중). 3명 넘으면 2명만 앉히고 「+n」
    const all = reviewersOf(o).sort((a, b) => a.started - b.started);
    const sceneEnd = (w, sitX) => (w.ended == null ? Infinity : w.ended + STAMP_MS + lenOf(exitPts(sitX)) / WALK_SPEED);
    const on = all.filter((w) => now >= w.started && now < sceneEnd(w, D.x + 42));
    const cap = on.length > 3 ? 2 : on.length;
    out.more = on.length - cap;
    const sitXs = cap === 1 ? [D.x + 42] : cap === 2 ? [D.x + 28, D.x + 56] : [D.x + 14, D.x + 42, D.x + 70];
    out.active = on;
    on.slice(0, cap).forEach((w, i) => {
      const sitX = sitXs[i], inPts = doorIn().concat(hallToDesk(D, sitX)), inMs = lenOf(inPts) / WALK_SPEED;
      const r = w.ended != null ? lastOf(w.id) : null;
      out.hide.add(w.id);
      const age = now - w.started;
      if (age < inMs) { out.walk.push({ w, m: { pts: inPts, p: ease(age / inMs) } }); return; }
      if (w.ended == null || now < w.ended + STAMP_MS) {
        out.sit.push({ w, x: sitX, pose: w.ended == null ? 'read' : r && r.verdict === 'pass' ? 'thumb' : 'idle', expr: r && r.verdict === 'reject' ? 'normal' : 'happy' });
        if (w.ended != null) out.stamp = { r, q: (now - w.ended) / STAMP_MS, x: sitX };
        return;
      }
      const ex = exitPts(sitX), exMs = lenOf(ex) / WALK_SPEED;
      out.walk.push({ w, m: { pts: ex, p: ease(clamp((now - w.ended - STAMP_MS) / exMs, 0, 1)) } });
    });
    // 끝까지 나간 검사 직원은 퇴근
    for (const w of all) if (now >= sceneEnd(w, D.x + 42)) out.gone.add(w.id);
    // 줄: 검사 받는 직원 (검사 직원 출근 순). 앞 3명만 서고 나머지는 「대기 n」 숫자로
    const queue = [];
    for (const w of on) {
      const t = w.reviewOf && (o.workers || []).find((x) => x.id === w.reviewOf);
      if (t && t.ended != null && !queue.some((q) => q.t.id === t.id)) queue.push({ t, by: w });
    }
    out.wait = queue.filter((q) => q.by.ended == null).length;
    if (D.mode === 'hall') queue.slice(0, 3).forEach((q, i) => {
      const { t, by } = q, s = seatOfId(t.id);
      const qx = D.x + 22 + i * 30, qy = D.qy;
      // 자리에서 나오나, 이미 퇴근했으면 문에서 들어오나
      const h = [...(o.handoffs || [])].reverse().find((x) => x.from === t.id);
      const trip = s && h ? lenOf(toHall(s, L.lead.cx + 34)) / (WALK_SPEED * 0.4) : 0;
      const leaveAt = t.ended + trip + 1500;
      const fromSeat = !!s && s.worker === t && by.started + 600 < leaveAt;
      const qPts = fromSeat ? toHall(s, qx).concat([{ x: qx, y: qy }]) : doorIn().concat([{ x: qx, y: L.hallFoot }, { x: qx, y: qy }]);
      const qMs = lenOf(qPts) / WALK_SPEED;
      const qStart = fromSeat ? Math.max(by.started + 600, t.ended + trip + 300) : by.started + 600;
      if (now < qStart) return;
      const r = by.ended != null ? lastOf(by.id) : null, reject = !!r && r.verdict === 'reject';
      const backAt = by.ended == null ? Infinity : Math.max(by.ended + STAMP_MS, qStart + qMs);
      const look = lookOf(s ? s.job : '개발자'), expr = r ? (reject ? 'worried' : 'happy') : 'normal';
      out.hide.add(t.id);
      if (now < qStart + qMs) { out.walk.push({ w: t, look, m: { pts: qPts, p: ease((now - qStart) / qMs), carry: 'doc' } }); return; }
      if (now < backAt) { out.walk.push({ w: t, look, back: true, m: { pts: qPts, p: 1, carry: by.ended == null || (now < by.ended + STAMP_MS * 0.4) ? 'doc' : null }, expr }); return; }
      const bAge = now - backAt;
      if (bAge < qMs) { out.walk.push({ w: t, look, expr, m: { pts: rev(qPts), p: ease(bAge / qMs), carry: reject ? 'doc' : null } }); return; }
      if (fromSeat) {
        const lv = toDoor(s), lvMs = lenOf(lv) / WALK_SPEED;
        if (bAge < qMs + lvMs) { out.walk.push({ w: t, look, expr, m: { pts: lv, p: ease((bAge - qMs) / lvMs) } }); return; }
      }
      out.gone.add(t.id);
    });
    // 도장 찍은 서류: 반려면 만든 직원(줄 · 없으면 그 자리)에게, 통과면 팀장 책상으로
    if (out.stamp && out.stamp.r && out.stamp.q > 0.35) {
      const { r, x } = out.stamp, q = ease(clamp((out.stamp.q - 0.35) / 0.65, 0, 1));
      let to;
      if (r.verdict === 'reject' && r.of) {
        const qi = queue.findIndex((e) => e.t.id === r.of), s = seatOfId(r.of);
        to = D.mode === 'hall' && qi >= 0 && qi < 3 ? { x: D.x + 22 + qi * 30 + 8, y: D.qy - 30 } : s ? { x: s.cx - 4, y: s.sy + 66 } : null;
      } else if (r.verdict !== 'reject') to = { x: L.lead.cx - 6, y: L.lead.sy + 66 };
      if (to) out.papers.push({ x0: x, y0: D.top - 4, x1: to.x, y1: to.y, q, col: r.verdict === 'reject' ? '#ffc9c9' : r.verdict === 'pass' ? '#d3f9d8' : '#fffdf5' });
    }
    // 번호판: 검토 중 / 통과 / ① 반려 (이번 일의 마지막 결과)
    const from = (o.promptAt || 0) - 1000;
    const last = [...reviews].reverse().find((r) => r.at >= from);
    if (on.some((w) => w.ended == null)) out.sign = { text: '검토 중', bg: '#ffe066', fg: '#2b2420' };
    else if (last) out.sign = last.verdict === 'pass' ? { text: '통과 ✓', bg: '#2f9e44', fg: '#ffffff' }
      : last.verdict === 'reject' ? { text: `${circled(last.nth || 1)} 반려`, bg: '#c92a2a', fg: '#ffffff' } : { text: '검토 끝', bg: '#495057', fg: '#ffffff' };
    return out;
  }
  const circled = (n) => (n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : `${n}.`);
  function drawCounter(c, D, stamp) {
    const { x, top, w, h } = D;
    R(c, x + 3, top + h + 6, w - 2, 4, 'rgba(0,0,0,0.22)');
    R(c, x, top, w, 8, '#e9e2d4'); R(c, x, top, w, 2, '#ffffff'); // 밝은 상판
    R(c, x, top + 8, w, h - 2, '#4c6a8a'); R(c, x, top + 8, w, 2, '#3b5573'); R(c, x, top + h + 4, w, 2, '#2f4560');
    R(c, x + 6, top + 13, w - 12, 1, '#5d7fa3');
    if (D.mode === 'hall') { // 앞 명패 (좁은 칸에선 번호판 자리)
      R(c, x + w / 2 - 14, top + 14, 28, 9, '#f1e6c8'); R(c, x + w / 2 - 12, top + 17, 24, 1, '#8a6040'); R(c, x + w / 2 - 12, top + 20, 18, 1, '#8a6040');
    }
    R(c, x + 4, top - 3, 10, 4, '#fffdf5'); R(c, x + 5, top - 5, 10, 2, '#eee6d6'); // 서류 더미
    // 도장 (도장 찍는 순간 상판에 빨강 · 초록 자국)
    R(c, x + w - 14, top - 7, 4, 5, '#5b3a22'); R(c, x + w - 16, top - 2, 8, 2, '#c92a2a');
    if (stamp && stamp.r && stamp.q < 0.6) R(c, stamp.x - 5, top + 1, 10, 5, stamp.r.verdict === 'reject' ? '#e03131' : stamp.r.verdict === 'pass' ? '#2f9e44' : '#868e96');
    // 번호판 기둥 + 판 (글은 위에 겹쳐 씀)
    const S2 = D.sign;
    if (D.mode === 'hall') { R(c, S2.x + S2.w / 2 - 1, S2.y + S2.h, 2, top + h + 6 - S2.y - S2.h, '#5b4330'); R(c, S2.x + S2.w / 2 - 5, top + h + 4, 10, 3, '#5b4330'); }
    R(c, S2.x - 1, S2.y - 1, S2.w + 2, S2.h + 2, '#1a1512'); R(c, S2.x, S2.y, S2.w, S2.h, '#2b2420');
  }

  // 앉은 자세 · 표정
  function poseOf(w, reading) {
    if (reading) return 'read';
    switch (w.status) {
      case 'work':
        if (/^(Read|Skill|WebFetch)$/.test(w.tool)) return 'read';
        if (/^(Agent|Task)$/.test(w.tool)) return 'hand';
        if (w.tool === 'AskUserQuestion') return 'raise';
        return 'type';
      case 'handoff': return 'hand';
      case 'ask': return 'raise';
      case 'done': return 'thumb';
      case 'idle': return 'coffee';
      case 'unfinished': return 'sweat';
      default: return 'idle';
    }
  }
  function exprOf(pct, w, now) {
    if (w && w.status === 'done') return 'happy';
    if (w && w.status === 'unfinished') return 'worried';
    if (pct == null) return 'normal';
    if (pct >= 90) return 'exhausted';
    if (pct >= 70) return 'tired';
    if (pct >= 40) return Math.floor(now / 2600) % 5 === 0 ? 'yawn' : 'normal';
    return 'normal';
  }
  const fillOf = (s) => (s.lead ? snap.power && snap.power.lead : snap.power && snap.power.workers && s.worker && snap.power.workers[s.worker.id]);

  // 머리 위 표시: 새 일 ! · 막힘 ? · 생각 … · 끝 ✓ · 실패 빨간 ! · 녹초 zzz
  const GLYPH = { '!': ['..#..', '..#..', '..#..', '..#..', '.....', '..#..'], '?': ['.###.', '#...#', '...#.', '..#..', '.....', '..#..'],
    '…': ['.....', '.....', '.....', '.....', '.....', '#.#.#'], '✓': ['.....', '....#', '...#.', '#.#..', '.#...', '.....'] };
  function mark(c, x, y, ch, bgc, fg) {
    c.fillStyle = bgc; c.beginPath(); c.ellipse(x + 4.5, y + 4.5, 5.5, 5.5, 0, 0, Math.PI * 2); c.fill();
    (GLYPH[ch] || []).forEach((row, j) => { for (let i = 0; i < 5; i++) if (row[i] === '#') R(c, x + 2 + i, y + 2 + j, 1, 1, fg); });
  }
  function markOf(w, now) {
    if (!w) return null;
    const age = now - w.since;
    if (w.status === 'unfinished' || (w.error && w.status === 'think' && age < 5000)) return ['!', '#e03131', '#ffffff'];
    if (w.status === 'ask') return ['?', '#fd7e14', '#ffffff'];
    if (w.status === 'work' && age < 2500) return ['!', '#fcc419', '#2b2420'];
    if (w.status === 'think') return ['…', '#868e96', '#ffffff'];
    if (w.status === 'done' && now - (w.ended || w.since) < 9000) return ['✓', '#2f9e44', '#ffffff'];
    if ((w.status === 'work' || w.status === 'think') && age > 5 * 60000) return ['…', '#e07a3a', '#ffffff']; // 5분 넘게 같은 일
    return null;
  }
  function zzz(c, x, y, now) {
    for (let i = 0; i < 3; i++) {
      const t = ((now / 900 + i / 3) % 1), zx = x + i * 4 + Math.round(Math.sin(t * 6) * 1), zy = y - Math.round(t * 14);
      c.globalAlpha = 1 - t; R(c, zx, zy, 4, 1, '#cfe3ff'); R(c, zx + 2, zy + 1, 1, 1, '#cfe3ff'); R(c, zx + 1, zy + 2, 1, 1, '#cfe3ff'); R(c, zx, zy + 3, 4, 1, '#cfe3ff');
    }
    c.globalAlpha = 1;
  }

  function sprite(c, look, x, footY, opt) {
    const img = S.get(look, opt);
    c.drawImage(img, Math.round(x - SW / 2), Math.round(footY - FOOT));
  }
  function shadowAt(c, x, y, rx) { c.fillStyle = 'rgba(0,0,0,0.22)'; c.beginPath(); c.ellipse(Math.round(x), Math.round(y) + 1, rx, 4, 0, 0, Math.PI * 2); c.fill(); }
  function paper(c, x, y) { R(c, x, y, 10, 7, '#fffdf5'); R(c, x + 2, y + 2, 6, 1, '#adb5bd'); R(c, x + 2, y + 4, 5, 1, '#adb5bd'); R(c, x, y + 7, 10, 1, 'rgba(0,0,0,0.2)'); }

  // ---- 한 장면 ----
  function render(now) {
    if (!snap || !snap.office) return;
    drawBg(now);
    const c = wctx, o = snap.office, frame = Math.floor(now / 350);
    const hr = hourOf(now);
    isNight = hr < 6 || hr >= 19;
    c.imageSmoothingEnabled = false;
    c.drawImage(bg, 0, 0);
    drawWall(c, now);

    const moves = new Map(), gone = new Set();
    for (const s of L.seats) { const r = motionOf(o, s, now); if (r.m) moves.set(s.key, r.m); if (r.gone) gone.add(s.key); }
    // 심사대 장면: 심사대에 가 있는 직원은 자리에서 빼고(움직임도) 따로 그린다
    const RV = reviewScene(o, now);
    const away = (s) => !s.lead && !!s.worker && RV.hide.has(s.worker.id);
    for (const s of L.seats) {
      if (!s.worker || s.lead) continue;
      if (RV.hide.has(s.worker.id)) moves.delete(s.key);
      if (RV.gone.has(s.worker.id)) gone.add(s.key);
    }
    // 책장: 자리마다 거리가 달라 shelfMs 를 직접 계산한다
    const shelfMsFor = (who) => { const seat = L.seats.find((s) => !!s.worker && (s.lead ? 'main' : s.worker.id) === who); return seat ? lenOf(toHall(seat, L.shelf.x + 40)) / (WALK_SPEED * 0.4) : 15000; };
    const taken = new Set((o.shelf || []).filter((x) => { const sm = shelfMsFor(x.who); return now - x.at >= sm * 0.46 && now - x.at < sm + READ_MS; }).map((x) => slotOf(x.book)));
    const readers = new Set((o.shelf || []).filter((x) => { const sm = shelfMsFor(x.who); return now - x.at >= sm && now - x.at < sm + READ_MS; }).map((x) => x.who));
    if ((o.papers || []).some((p) => p.picked != null && now - p.picked >= PICK_WALK_MS && now - p.picked < PICK_MS + 1500)) readers.add('main'); // 주워 온 서류를 자리에서 펴 봄

    // 사장님 지시가 막 들어왔으면: 사장님이 문으로 들어와 팀장에게 지시서를 건네고 나간다
    let boss = null;
    const bAge = o.promptAt == null ? -1 : now - o.promptAt;
    if (bAge >= 0 && bAge < BOSS_MS) {
      const t = bAge / BOSS_MS, pts = bossPath();
      boss = t < 0.4 ? { pts, p: ease(t / 0.4), carry: 'doc' } : t < 0.58 ? { pts, p: 1, give: ease((t - 0.4) / 0.18) } : { pts, p: 1 - ease((t - 0.58) / 0.42) };
    }
    // 자리를 이어받힌 앞사람: 새 사람이 앉아도 보고 → 문으로 끝까지 걸어 나간다 (퇴근 전 잠깐은 자리 옆에 선 채로)
    const ghosts = [];
    for (const s of L.seats) for (const lw of s.leaving || []) {
      if (lw.ended == null) continue;
      const r = motionOf(o, s, now, lw);
      if (!r.gone) ghosts.push({ s, m: r.m || { pts: toDoor(s), p: 0 } });
    }
    // 문은 누가 드나들 때만 열린다
    let doorOpen = false;
    const nearDoor = (m) => { const p = at(m.pts, m.p * lenOf(m.pts)); return p.x < L.doorCx + 40 && p.y < L.doorFoot + 34; };
    for (const g of ghosts) if (nearDoor(g.m)) doorOpen = true;
    for (const m of moves.values()) if (nearDoor(m)) doorOpen = true;
    for (const x of RV.walk) if (nearDoor(x.m)) doorOpen = true;
    if (boss && nearDoor(boss)) doorOpen = true;
    drawDoorBack(c, doorOpen);
    bossAt = null;

    drawGroups(c);
    for (const s of L.seats) drawChair(c, s);
    const things = [{ foot: L.shelf.y + L.shelf.h, paint: () => drawShelf(c, taken, now) }, { foot: L.doorFoot + 1, paint: () => drawDoorFront(c) }];
    // 놓친 일 서류: 팀장이 주워 들기 전까지 바닥에 (지나가는 사람이 위에 그려지게 발 높이 = 종이)
    for (const x of paperSpots(o)) {
      if (x.p.picked != null && now - x.p.picked >= PICK_WALK_MS * 0.5) continue;
      things.push({ foot: x.y, paint: () => drawLost(c, x.x, x.y, frame) });
    }
    // 걷는 사람 하나 (직원 · 팀장 · 사장님 같이 씀). 문 안쪽으로 들어가면 서서히 사라진다
    const walker = (m, look, expr, onAt) => {
      const len = lenOf(m.pts), pt = at(m.pts, m.p * len), walking = m.p > 0.001 && m.p < 0.999;
      const step = Math.floor((m.p * len) / 6);
      const back = walking && pt.dy < 0 && Math.abs(pt.dy) > Math.abs(pt.dx);
      if (onAt) onAt(pt);
      things.push({ foot: pt.y, paint: () => {
        const fade = pt.y < L.doorFoot ? clamp((pt.y - (L.doorFoot - 20)) / 20, 0, 1) : 1;
        if (fade <= 0) return;
        c.globalAlpha = fade;
        if (fade === 1) shadowAt(c, pt.x, pt.y, 13);
        const holding = m.carry || m.give != null;
        const pose = m.give != null ? 'hand' : walking ? (holding ? 'carry' : 'walk') : holding ? 'carry' : 'idle';
        sprite(c, look, pt.x, pt.y - (walking && step % 2 ? 1 : 0), { pose, frame: walking ? step : frame, facing: m.face || (back ? 'back' : 'front'),
          carry: m.carry === 'book' ? 'book' : 'doc', expr });
        c.globalAlpha = 1;
        if (m.give != null) {
          const q = m.give, x0 = pt.x + 18, y0 = pt.y - 30, x1 = L.lead.cx - 6, y1 = L.lead.sy + 66;
          paper(c, x0 + (x1 - x0) * q, y0 + (y1 - y0) * q - Math.sin(q * Math.PI) * 10);
        }
      } });
    };
    if (boss) walker(boss, 'boss', 'normal', (pt) => { bossAt = { x: pt.x, y: pt.y, talk: bAge / BOSS_MS < 0.6 }; });
    for (const s of L.seats) {
      const w = s.worker;
      const present = !!w && !moves.has(s.key) && !gone.has(s.key) && !away(s) && w.status !== 'off' && !(s.lead && w.status === 'desk');
      const reading = !!w && readers.has(s.lead ? 'main' : w.id);
      things.push({ foot: s.deskBottom, paint: () => {
        if (present) {
          const pose = poseOf(w, reading), pct = pctOf(fillOf(s));
          sprite(c, lookOf(s.job), s.cx, s.seatFoot, { pose, frame, expr: exprOf(pct, w, now), sweat: pose === 'sweat' || (pct != null && pct >= 70) });
          const mk = markOf(w, now);
          if (mk) mark(c, s.cx + 15, s.seatTop + 2, mk[0], mk[1], mk[2]);
          else if (pct != null && pct >= 90) zzz(c, s.cx + 14, s.seatTop + 8, now);
        }
        drawDesk(c, s, frame, present && (w.status === 'work' || w.status === 'think'));
      } });
      const m = moves.get(s.key);
      if (m) walker(m, lookOf(s.job), exprOf(pctOf(fillOf(s)), null, now));
      for (const g of ghosts) if (g.s === s) walker(g.m, lookOf(s.job), 'happy');
    }
    // 심사대: 카운터 · 앉은 검사 직원 · 줄 선 직원 · 오가는 사람
    if (L.desk) {
      const D = L.desk;
      things.push({ foot: D.top + D.h + 6, paint: () => drawCounter(c, D, RV.stamp) });
      for (const st of RV.sit) {
        const ss = seatOfId(st.w.id);
        things.push({ foot: D.seatFoot, paint: () => sprite(c, lookOf(ss ? ss.job : 'QA'), st.x, D.seatFoot, { pose: st.pose, frame, expr: st.expr }) });
      }
      for (const x of RV.walk) {
        const ss = seatOfId(x.w.id);
        walker(x.back ? { ...x.m, face: 'back' } : x.m, x.look || lookOf(ss ? ss.job : 'QA'), x.expr || 'normal');
      }
    }
    things.sort((a, b) => a.foot - b.foot);
    for (const t of things) t.paint();

    // 밤: 방이 어두워지고 사람이 있는 책상 스탠드가 따뜻하게 비춘다
    if (isNight) {
      c.fillStyle = 'rgba(14,20,48,0.42)'; c.fillRect(0, 0, L.W, L.H);
      c.globalCompositeOperation = 'lighter';
      for (const s of L.seats) {
        if (!s.worker || moves.has(s.key) || gone.has(s.key) || away(s) || s.worker.status === 'off' || (s.lead && s.worker.status === 'desk')) continue;
        const lx = s.cx - (s.lead ? 48 : 40) + 6, ly = s.sy + 60;
        const g = c.createRadialGradient(lx, ly, 2, lx, ly, 52);
        g.addColorStop(0, 'rgba(255,200,120,0.42)'); g.addColorStop(1, 'rgba(255,200,120,0)');
        c.fillStyle = g; c.beginPath(); c.arc(lx, ly, 52, 0, Math.PI * 2); c.fill();
      }
      c.globalCompositeOperation = 'source-over';
    }

    // 일 맡기기: 팀장 책상 → 직원 책상으로 서류가 날아감
    for (const a of o.assigns || []) {
      const age = now - a.at;
      if (age < 0 || age >= ASSIGN_MS) continue;
      const s = L.seats.find((x) => x.worker && x.worker.id === a.to) || L.seats.find((x) => !x.lead && x.members && x.members.some((mm) => mm.id === a.to));
      if (!s) continue;
      const q = ease(age / ASSIGN_MS), x0 = L.lead.cx - 20, y0 = L.lead.sy + 64, x1 = s.cx - 4, y1 = s.sy + 66;
      paper(c, x0 + (x1 - x0) * q, y0 + (y1 - y0) * q - Math.sin(q * Math.PI) * 40);
    }

    // 심사대에서 도장 찍은 서류: 반려(빨강)는 만든 직원에게, 통과(초록)는 팀장에게
    for (const pp of RV.papers) {
      const x = pp.x0 + (pp.x1 - pp.x0) * pp.q, y = pp.y0 + (pp.y1 - pp.y0) * pp.q - Math.sin(pp.q * Math.PI) * 26;
      paper(c, x, y); R(c, x, y, 10, 2, pp.col === '#fffdf5' ? '#adb5bd' : pp.col === '#ffc9c9' ? '#e03131' : '#2f9e44');
    }

    // 확대해서 화면에 (픽셀 그대로)
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(world, 0, 0, L.W * sd, L.H * sd);
    overlay(now, moves, gone, RV);
  }

  // ---- 글자 (기기 해상도로 또렷하게): 말풍선 · 이름표 · 표지 ----
  function overlay(now, moves, gone, RV) {
    const fs = Math.round(dpr * clamp(9 + (sd / dpr) * 1.6, 11, 15));
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    hits = [];
    const X = (x) => x * sd, Y = (y) => y * sd;
    const label = (text, x, y, opt) => {
      ctx.font = `${opt.bold ? 700 : 500} ${opt.size || fs}px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
      const tw = ctx.measureText(text).width, pw = tw + fs * 0.9, ph = fs * 1.5;
      ctx.fillStyle = opt.bg; roundRect(ctx, x - pw / 2, y - ph / 2, pw, ph, ph / 2); ctx.fill();
      if (opt.border) { ctx.strokeStyle = opt.border; ctx.lineWidth = dpr; ctx.stroke(); }
      ctx.fillStyle = opt.fg; ctx.fillText(text, x, y + dpr * 0.5);
      return pw;
    };
    // 표지
    label('출입문', X(L.doorCx), Y(L.doorFoot + 20), { bg: 'rgba(43,36,32,.75)', fg: '#ffd89b', size: Math.round(fs * 0.8) });
    // 사장님 말풍선: 지시 내용 (걸어 들어오는 동안)
    if (bossAt && bossAt.talk && snap.office.prompt) {
      ctx.font = `600 ${fs}px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
      let text = `사장님: 「${snap.office.prompt}」`;
      while (text.length > 8 && ctx.measureText(text).width > X(200)) text = text.slice(0, -3) + '…」';
      const tw = ctx.measureText(text).width, pw = tw + fs * 1.1, ph = fs * 1.7;
      const bx = clamp(X(bossAt.x) - pw / 2, 4 * dpr, X(L.W) - pw - 4 * dpr), by = Y(bossAt.y - 74) - ph;
      ctx.fillStyle = '#fff4d6'; roundRect(ctx, bx, by, pw, ph, ph / 2.4); ctx.fill();
      ctx.strokeStyle = '#b52a2a'; ctx.lineWidth = 1.5 * dpr; ctx.stroke();
      ctx.fillStyle = '#2b2420'; ctx.textAlign = 'center'; ctx.fillText(text, bx + pw / 2, by + ph / 2 + dpr * 0.5);
    }
    label('책장 · 스킬', X(L.shelf.x + L.shelf.w / 2), Y(L.shelf.y + L.shelf.h + 10), { bg: 'rgba(43,36,32,.75)', fg: '#ffd89b', size: Math.round(fs * 0.8) });
    // 회사 간판: 프로젝트 = 회사
    const Pq = L.plaque, pfs = Math.round(Math.min(fs * 0.85, Y(Pq.h) * 0.5));
    ctx.font = `700 ${pfs}px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
    let title = `TermiMates · ${snap.project ? base(snap.project) : '사무실'}`;
    while (title.length > 6 && ctx.measureText(title).width > X(Pq.w - 8)) title = title.slice(0, -2) + '…';
    ctx.fillStyle = '#f2d49b'; ctx.fillText(title, X(Pq.x + Pq.w / 2), Y(Pq.y + Pq.h / 2) + dpr);
    // 화이트보드: 사장님 지시 + 팀장 할 일 (없으면 자리별 진행)
    if (L.board) {
    const B = L.board, bfs = Math.max(Math.round(9 * dpr), Math.round(Math.min(fs * 0.68, Y(B.h) / 5.2)));
    ctx.save(); ctx.beginPath(); ctx.rect(X(B.x), Y(B.y), X(B.w), Y(B.h)); ctx.clip();
    ctx.textAlign = 'left';
    const lines = [];
    const o = snap.office;
    lines.push(['#c92a2a', 700, o.prompt ? `📌 ${o.prompt}` : '📌 사장님 지시 기다리는 중']);
    const KB = snap.board; // 칸반: 단계(대기 · 진행 · 완료 · 반려)를 알 수 있을 때만 (패널 office.ts boardOf). 모르면 아래 할 일 목록
    if (KB && KB.length) {
      ctx.font = `700 ${bfs}px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
      ctx.fillStyle = '#c92a2a';
      let tx0 = lines[0][2]; while (tx0.length > 3 && ctx.measureText(tx0).width > X(B.w - 6)) tx0 = tx0.slice(0, -2) + '…';
      ctx.fillText(tx0, X(B.x + 3), Y(B.y) + bfs * 0.75);
      const cw = B.w / KB.length, top = Y(B.y) + bfs * 1.55 + Math.max(Math.round(8 * dpr), Math.round(bfs * 0.85)) * 0.55, sfs = Math.max(Math.round(8 * dpr), Math.round(bfs * 0.85)), lh2 = sfs * 1.2;
      const HEAD = { 대기: '#495057', 진행: '#1864ab', 완료: '#2b8a3e', 반려: '#c92a2a' };
      KB.forEach((col, i) => {
        const x = X(B.x + i * cw);
        if (i) R(ctx, x, top - sfs * 0.6, dpr, Y(B.y + B.h) - top + sfs * 0.6, '#ced4da'); // 칸 나눔 선
        ctx.font = `700 ${sfs}px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
        ctx.fillStyle = HEAD[col.name] || '#343a40';
        ctx.fillText(`${col.name} ${col.cards.length}`, x + 2 * dpr, top);
        const room2 = Math.max(0, Math.floor((Y(B.y + B.h) - top - lh2 * 0.6) / lh2));
        ctx.font = `500 ${sfs}px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
        col.cards.slice(0, room2).forEach((cd, j) => {
          let t = (cd.loop ? `⟳${cd.loop} ` : '') + cd.text;
          while (t.length > 2 && ctx.measureText(t).width > X(cw) - 4 * dpr) t = t.slice(0, -2) + '…';
          ctx.fillStyle = col.name === '반려' ? '#c92a2a' : col.name === '완료' ? '#868e96' : '#343a40';
          ctx.fillText(t, x + 2 * dpr, top + lh2 * (j + 1));
        });
      });
      lines.length = 0;
    } else if (o.todos && o.todos.length) for (const t of o.todos) lines.push([t.state === 'done' ? '#8a939c' : t.state === 'doing' ? '#1864ab' : '#343a40', t.state === 'doing' ? 700 : 500, `${t.state === 'done' ? '☑' : t.state === 'doing' ? '▶' : '☐'} ${t.text}`]);
    else for (const u of snap.units || []) { const ws = u.members.map((m) => m.status); const dn = ws.filter((x) => x === 'done').length;
      lines.push(['#343a40', 500, `• ${u.key} ${dn}/${ws.length} 끝`]); }
    const lh = bfs * 1.22, maxLines = Math.max(1, Math.floor((Y(B.h) - bfs * 0.6) / lh));
    const shown = lines.length > maxLines ? lines.filter((l, i) => i === 0 || l[0] !== '#8a939c').slice(0, maxLines) : lines;
    shown.forEach(([col, wt, text], i) => {
      ctx.font = `${wt} ${bfs}px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
      let tx = text; while (tx.length > 3 && ctx.measureText(tx).width > X(B.w - 6)) tx = tx.slice(0, -2) + '…';
      ctx.fillStyle = col; ctx.fillText(tx, X(B.x + 3), Y(B.y) + bfs * 0.75 + i * lh);
    });
    ctx.restore(); ctx.textAlign = 'center';
    }

    // 말풍선: 줄마다 옆자리와 겹치지 않게 (옆이 비면 넓게, 좁으면 짧은 말)
    // 페르소나(맡긴 일에서 입힌 성격)는 상태 말풍선 왼쪽에 작은 빨간 말풍선으로 나란히 — 위로 쌓으면 윗줄 이름표와 겹친다
    const rows = new Map();
    for (const s of L.seats) rows.set(s.sy, (rows.get(s.sy) || []).concat([s]));
    const qfs = Math.round(fs * 0.74);
    boxes.bubbles = []; boxes.tags = []; // 말풍선이 차지한 곳 (그림자 · 꼬리까지, 기기 픽셀): 묶음 글이 피해 간다
    for (const row of rows.values()) {
      row.sort((a, b) => a.cx - b.cx);
      const off = (s) => gone.has(s.key) || moves.has(s.key) || (!s.lead && !!s.worker && RV.hide.has(s.worker.id)); // 심사대에 가 있으면 자리 말풍선 없음
      const say = (s) => (s.worker && !off(s) ? bubbleOf(s.worker) : null);
      const persona = (s) => (!s.lead && s.worker && s.worker.persona && !off(s) ? s.worker.persona : null);
      const busy = (s) => !!(say(s) || persona(s));
      row.forEach((s, i) => {
        const b0 = say(s), b = b0 && b0.long ? b0 : null, pz = persona(s);
        if (!b && !pz) return;
        const prev = row[i - 1], next = row[i + 1];
        const lo = prev ? (busy(prev) ? prev.cx + SLOT_W / 2 : prev.cx) : 0;
        const hi = next ? (busy(next) ? next.cx - SLOT_W / 2 : next.cx) : L.W;
        let room = X(hi - lo) - fs;
        // 페르소나 몫 먼저 (상태 말풍선이 있으면 자리의 절반까지만)
        const gap = 3 * dpr, pph = qfs * 1.6;
        let ptext = null, ppw = 0;
        if (pz) {
          ctx.font = `700 ${qfs}px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
          const cap = b ? room * 0.5 : room;
          let inner = pz, cut = false;
          const pt = () => `"${inner}${cut ? '…' : ''}"`;
          while (inner.length > 2 && ctx.measureText(pt()).width + qfs > cap) { inner = inner.slice(0, -1); cut = true; }
          ptext = pt(); ppw = ctx.measureText(ptext).width + qfs;
          room -= ppw + gap;
        }
        let text = null, pw = 0;
        const ph = fs * 1.7;
        if (b) {
          ctx.font = `600 ${fs}px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
          text = ctx.measureText(b.long).width <= room ? b.long : b.short;
          while (text.length > 2 && ctx.measureText(text).width > room) text = text.slice(0, -2) + '…';
          pw = ctx.measureText(text).width + fs * 1.1;
        }
        const total = pw + (ptext ? ppw + (b ? gap : 0) : 0);
        const left = clamp(X(s.cx) - total / 2, X(lo), X(hi) - total);
        if (ptext) {
          const px = left, py = Y(s.sy + 12) - pph / 2, red = '#c92a2a';
          ctx.fillStyle = 'rgba(0,0,0,0.18)'; roundRect(ctx, px + dpr, py + 2 * dpr, ppw, pph, pph / 2.4); ctx.fill();
          ctx.fillStyle = red; roundRect(ctx, px, py, ppw, pph, pph / 2.4); ctx.fill();
          const tx = clamp(X(s.cx), px + pph / 2, px + ppw - pph / 2);
          ctx.beginPath(); ctx.moveTo(tx - 3 * dpr, py + pph - dpr); ctx.lineTo(tx, py + pph + 5 * dpr); ctx.lineTo(tx + 3 * dpr, py + pph - dpr); ctx.fill();
          boxes.bubbles.push({ x: px, y: py, w: ppw + dpr, h: pph + 2 * dpr }, { x: tx - 3 * dpr, y: py + pph, w: 6 * dpr, h: 5 * dpr });
          ctx.font = `700 ${qfs}px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
          ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(ptext, px + ppw / 2, py + pph / 2 + dpr * 0.5);
        }
        if (!b) return;
        ctx.font = `600 ${fs}px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
        const bx = left + (ptext ? ppw + gap : 0);
        const by = Y(s.sy + 12) - ph / 2;
        const st = s.worker.status;
        const accent = st === 'done' ? '#2f9e44' : st === 'unfinished' ? '#c9423a' : st === 'ask' ? '#e07a3a' : st === 'work' ? '#1971c2' : '#8a7f74';
        ctx.fillStyle = 'rgba(0,0,0,0.18)'; roundRect(ctx, bx + dpr, by + 2 * dpr, pw, ph, ph / 2.4); ctx.fill();
        ctx.fillStyle = '#fffdf8'; roundRect(ctx, bx, by, pw, ph, ph / 2.4); ctx.fill();
        ctx.strokeStyle = accent; ctx.lineWidth = 1.5 * dpr; ctx.stroke();
        const tx = clamp(X(s.cx), bx + ph / 2, bx + pw - ph / 2);
        ctx.fillStyle = '#fffdf8'; ctx.beginPath(); ctx.moveTo(tx - 4 * dpr, by + ph - dpr); ctx.lineTo(tx, by + ph + 6 * dpr); ctx.lineTo(tx + 4 * dpr, by + ph - dpr); ctx.fill();
        ctx.strokeStyle = accent; ctx.beginPath(); ctx.moveTo(tx - 4 * dpr, by + ph); ctx.lineTo(tx, by + ph + 6 * dpr); ctx.lineTo(tx + 4 * dpr, by + ph); ctx.stroke();
        // 테두리 굵기(1.5) 반 · 그림자(아래 2) · 꼬리(아래 6)까지 말풍선 몫
        boxes.bubbles.push({ x: bx - dpr, y: by - dpr, w: pw + 2 * dpr, h: ph + 3 * dpr }, { x: tx - 5 * dpr, y: by + ph, w: 10 * dpr, h: 7 * dpr });
        ctx.fillStyle = '#2b2420'; ctx.textAlign = 'center'; ctx.fillText(text, bx + pw / 2, by + ph / 2 + dpr * 0.5);
      });
    }
    // 이름표 (자리 가운데) + 누를 자리
    // 묶음 글: 나란히 앉은 같은 일 「같은 일 ×4」 · 파트 줄 「▸ 개발자 파트 · 3명」 (밝은 글 + 진한 바탕 — 바닥 위에서도 읽히게)
    const gfs = Math.round(fs * 0.72);
    ctx.textAlign = 'left';
    const tag = (text, x, y, bgc, fg, dodge) => {
      ctx.font = `700 ${gfs}px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
      const w = ctx.measureText(text).width + gfs * 0.8, h = gfs * 1.45;
      // 말풍선(모서리 · 그림자 · 꼬리)과 겹치면 그 아래로 비켜 쓴다 (테두리 반 + 1픽셀 띄움)
      const hit = (b, yy) => x - dpr < b.x + b.w && b.x < x + w + dpr && yy - h / 2 - dpr < b.y + b.h && b.y < yy + h / 2 + dpr;
      for (let k = 0; dodge && k < 4; k++) { const b = boxes.bubbles.find((bb) => hit(bb, y)); if (!b) break; y = b.y + b.h + h / 2 + 2 * dpr; }
      boxes.tags.push({ x: x - dpr / 2, y: y - h / 2 - dpr / 2, w: w + dpr, h: h + dpr, text });
      ctx.fillStyle = bgc; roundRect(ctx, x, y - h / 2, w, h, h / 2); ctx.fill();
      ctx.strokeStyle = fg; ctx.lineWidth = dpr; ctx.stroke();
      ctx.fillStyle = fg; ctx.fillText(text, x + gfs * 0.4, y + dpr * 0.5);
    };
    const tagged = new Set();
    for (const g of twinGroups()) {
      if (tagged.has(g.k)) continue; // 줄이 바뀐 묶음은 첫 줄에만
      tagged.add(g.k);
      tag(`같은 일 ×${L.seats.filter((x) => x.kind === 'twin' && x.pick === g.k).length}`, X(g.x0 + 4), Y(g.sy + 28), '#0b5c52', '#ffffff', true);
    }
    for (const g of partGroups()) {
      const n = g.seats.reduce((a, x) => a + (x.members ? x.members.length : 1), 0);
      tag(`▸ ${g.k} 파트 · ${n}명`, X(g.x0 + 6), Y(g.sy - PART_PAD / 2 + 1), '#2b1f4f', '#ffe9a8');
    }
    ctx.textAlign = 'center';
    for (const s of L.seats) {
      // 심사대에 가 있는 동안(검사 · 줄 서기)은 원래 자리 이름표를 흐리게, 배지 · 피로도 · ⟳ 는 안 그린다 (심사대 쪽에 보인다)
      const atDesk = !s.lead && !!s.worker && RV.hide.has(s.worker.id), walking = moves.has(s.key);
      const isSel = (s.pick || s.key) === sel, away = gone.has(s.key) || atDesk;
      const name = (s.count > 1 && !s.team && s.kind !== 'fold' ? `${s.name} ×${s.count}` : s.name) + (atDesk ? ' · 심사대' : gone.has(s.key) ? ' 퇴근' : ''); // 심사대 앞에 가 있으면 (반려 뒤 줄 서기 포함) 늘 「· 심사대」
      // 직급 배지: 이름표 오른쪽 같은 줄에 (밑에 두면 아랫줄 말풍선과 겹친다). 1배에서도 읽히는 크기, 자리 폭에 안 들어가면 별만,
      // 그래도 안 들어가면 안 그린다 (이름표 밑은 아랫줄 말풍선 자리, 책상 위는 그림을 가림). 페르소나가 있으면 빨간 테두리
      const tier = !s.lead && !away && s.worker ? TIER[s.worker.tier] : null;
      const nfont = `${isSel || s.lead ? 700 : 500} ${fs}px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
      ctx.font = nfont;
      const pw0 = ctx.measureText(name).width + fs * 0.9, room = X(SLOT_W) - 6 * dpr, gap = 3 * dpr;
      const bfs = Math.max(Math.round(10 * dpr), Math.round(fs * 0.68));
      let badge = null;
      if (tier) {
        ctx.font = `700 ${bfs}px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
        const wOf = (t) => ctx.measureText(t).width + bfs;
        const full = `${tier.stars} ${tier.name}`;
        const text = pw0 + gap + wOf(full) <= room ? full : tier.stars;
        badge = pw0 + gap + wOf(text) <= room ? { text, w: wOf(text), inline: true } : null; // 별도 안 들어가면 안 그림 (카드에서 봄)
      }
      const shift = badge && badge.inline ? (badge.w + gap) / 2 : 0, ny = Y(s.sy + 115);
      const pw = label(name, X(s.cx) - shift, ny, isSel
        ? { bg: '#ffd89b', fg: '#2a1d05', bold: true, border: '#fff3d6' }
        : { bg: away ? 'rgba(43,36,32,.45)' : 'rgba(43,36,32,.82)', fg: away ? '#a99f95' : '#f3ead9', bold: s.lead });
      let below = ny + fs * 0.75; // 이름표 아래 끝
      if (badge) {
        const bh = bfs * 1.45, bx = X(s.cx) - shift + pw / 2 + gap, by = ny - bh / 2;
        ctx.font = `700 ${bfs}px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
        ctx.fillStyle = tier.bg; roundRect(ctx, bx, by, badge.w, bh, bh / 2); ctx.fill();
        if (s.worker.persona) { ctx.strokeStyle = '#ff4d4f'; ctx.lineWidth = 1.5 * dpr; ctx.stroke(); }
        ctx.fillStyle = tier.fg; ctx.fillText(badge.text, bx + badge.w / 2, by + bh / 2 + dpr * 0.5);
      }
      // 그 밑 작은 피로도 캡슐 (직원마다 따로)
      const fp = !away ? pctOf(fillOf(s)) : null;
      if (fp != null && s.worker && s.worker.status !== 'desk' && s.worker.status !== 'off') {
        const bw = 30 * dpr, bh = 4 * dpr, bx = X(s.cx) - bw / 2, by = below + fs * 0.2;
        ctx.fillStyle = 'rgba(26,21,18,.85)'; roundRect(ctx, bx - dpr, by - dpr, bw + 2 * dpr, bh + 2 * dpr, bh); ctx.fill();
        ctx.fillStyle = stageOf(fp)[2]; roundRect(ctx, bx, by, Math.max(bh, (bw * Math.min(100, fp)) / 100), bh, bh / 2); ctx.fill();
      }
      // 다시 하는 횟수 ⟳n (반려 · 같은 일 다시 맡김) · 파트장 표시 (그 아래 사람 수)
      if (s.loop && !away && !walking) label(`⟳${s.loop}`, X(s.cx + 34), Y(s.sy + 36), { bg: '#c92a2a', fg: '#ffffff', bold: true, size: gfs });
      if (s.kids && !away) label('파트장', X(s.cx + 28), Y(s.sy + 52), { bg: '#2b1f4f', fg: '#ffe9a8', bold: true, size: gfs, border: '#ffe9a8' }); // 몇 명인지는 아래 파트 띠에
      if (s.team && s.members) {
        const dn = s.members.filter((m) => m.status === 'done').length;
        ctx.font = `700 ${Math.round(fs * 0.62)}px -apple-system, "Apple SD Gothic Neo", sans-serif`; ctx.fillStyle = '#ffd89b';
        ctx.fillText(`${dn}/${s.members.length} 끝`, X(s.cx), Y(s.sy + 43.5));
      }
      hits.push({ key: s.pick || s.key, x: s.sx, y: s.sy + 4, w: SLOT_W, h: ROW_H - 4 });
    }
    hits.push({ key: '__shelf', x: L.shelf.x, y: L.shelf.y, w: L.shelf.w, h: L.shelf.h + 20 }); // 책장 누르면 스킬 목록
    // 심사대: 번호판 글 · 「+n」(못 앉은 검사 직원) · 「대기 n」 · 표지. 누르면 심사대 카드
    if (L.desk) {
      const D = L.desk, S2 = D.sign, sfs = Math.round(fs * 0.72);
      if (RV.sign) {
        ctx.font = `700 ${sfs}px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
        const tw = ctx.measureText(RV.sign.text).width + sfs * 0.8, bw = Math.max(X(S2.w), tw), bh = Math.max(Y(S2.h), sfs * 1.4);
        const bx = X(S2.x + S2.w / 2) - bw / 2, by = Y(S2.y + S2.h / 2) - bh / 2;
        ctx.fillStyle = RV.sign.bg; roundRect(ctx, bx, by, bw, bh, 3 * dpr); ctx.fill();
        ctx.fillStyle = RV.sign.fg; ctx.fillText(RV.sign.text, bx + bw / 2, by + bh / 2 + dpr * 0.5);
      }
      if (RV.more > 0) label(`+${RV.more}`, X(D.x + D.w - 6), Y(D.seatFoot - 58), { bg: '#1971c2', fg: '#ffffff', bold: true, size: sfs });
      if (RV.wait > 3 || (D.mode === 'grid' && RV.wait > 0)) label(`대기 ${RV.wait}`, X(D.mode === 'hall' ? D.x + 52 : D.x + 18), Y(D.mode === 'hall' ? D.qy - 70 : D.top + 14), { bg: '#e8590c', fg: '#ffffff', bold: true, size: sfs });
      const sel2 = sel === '__review';
      // 이름표는 카운터 왼쪽 아래 끝 (앞에 줄 선 사람 몸과 안 겹치게)
      if (D.mode === 'hall') label('심사대', X(D.x - 8), Y(D.top + D.h + 4), sel2 ? { bg: '#ffd89b', fg: '#2a1d05', bold: true, size: sfs } : { bg: 'rgba(43,36,32,.75)', fg: '#ffd89b', size: sfs });
      else label('심사대', X(D.cx), Y(D.sy + 115), sel2 ? { bg: '#ffd89b', fg: '#2a1d05', bold: true } : { bg: 'rgba(43,36,32,.82)', fg: '#f3ead9' });
      // 심사대에 앉은 검사 직원: 직급 배지 · 페르소나를 머리 위에 (원래 자리 대신 여기서 보인다)
      for (const st of RV.sit) {
        const t = TIER[st.w.tier], bfs2 = Math.max(Math.round(10 * dpr), Math.round(fs * 0.68));
        let y = Y(D.seatFoot - 70);
        if (t) { label(t.stars, X(st.x), y, { bg: t.bg, fg: t.fg, bold: true, size: bfs2, border: st.w.persona ? '#ff4d4f' : null }); y -= bfs2 * 1.7; }
        if (st.w.persona) label(`"${st.w.persona.length > 10 ? st.w.persona.slice(0, 9) + '…' : st.w.persona}"`, X(st.x), y, { bg: '#c92a2a', fg: '#ffffff', bold: true, size: Math.round(fs * 0.74) });
      }
      hits.push(D.mode === 'hall' ? { key: '__review', x: D.x - 10, y: S2.y - 4, w: D.w + 56, h: D.qy - S2.y + 6 } : { key: '__review', x: D.sx, y: D.sy + 4, w: SLOT_W, h: ROW_H - 4 });
    }
    hits.push({ key: '__news', x: L.news.x, y: L.news.y, w: L.news.w, h: L.news.h + 14 }); // 게시판 누르면 옆에 소식 전체 목록 (책장처럼)
    // 바닥 서류는 자리보다 먼저 (자리 칸 위에 떨어져 있어도 서류가 눌린다)
    for (const x of paperSpots(snap.office)) if (x.p.picked == null) hits.unshift({ key: '__paper:' + x.p.id, x: x.x - 4, y: x.y - 24, w: 22, h: 30 });
  }
  function roundRect(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  // ---- 위 계기판 ----
  function hud() {
    if (!snap || !snap.office) return;
    const o = snap.office, pw = snap.power || {};
    $('project').textContent = snap.project ? '· ' + base(snap.project) : '';
    const dm = $('demo');
    dm.hidden = !snap.demo;
    if (snap.demo) dm.textContent = snap.demo.label ? `▶ ${snap.demo.label} 중 ${snap.demo.step}/${snap.demo.total} · 방금 일을 빠르게 (토큰 0)` : `▶ 시연 중 ${snap.demo.step}/${snap.demo.total} · 가짜 장면 (토큰 0)`;
    // 🔔 사장님 확인 기다림
    const wt = $('wait');
    wt.hidden = !o.waiting;
    if (o.waiting) wt.textContent = `🔔 사장님 확인 필요 — ${o.waiting.what} · ${ago(Date.now() - o.waiting.at)}째`;
    $('report').hidden = !snap.report;
    $('order').textContent = o.prompt ? `사장님 지시 「${o.prompt}」` : '아직 사장님 지시 없음';
    const run = (o.workers || []).filter((w) => w.ended == null && !w.teammate);
    const done = (o.workers || []).filter((w) => w.status === 'done').length;
    const unitsBusy = (snap.units || []).filter((u) => u.members.some((m) => run.some((w) => w.id === m.id))).map((u) => u.key);
    $('situation').textContent = [`팀장: ${o.lead.action}`, unitsBusy.length ? `일하는 자리 ${unitsBusy.join(', ')}` : '', done ? `보고 완료 ${done}건` : '']
      .filter(Boolean).join(' · ');
    // 피로도
    const p = pctOf(pw.lead), st = p != null ? stageOf(p) : null, fat = $('fatigue');
    fat.className = 'capsule' + (p != null && p >= 90 ? ' lv3' : '');
    fat.querySelector('.pill i').style.width = (p != null ? clamp(p, 0, 100) : 0) + '%';
    fat.querySelector('.pill i').style.backgroundColor = st ? st[2] : '#3FA66B';
    // 직원 중 가장 피곤한 사람 (직원마다 따로 잼)
    let worst = null;
    for (const u of snap.units || []) { const w = (o.workers || []).find((x) => x.id === u.worker); if (!w || w.ended != null) continue;
      const wp = pctOf(pw.workers && pw.workers[w.id]); if (wp != null && (!worst || wp > worst[0])) worst = [wp, u.key]; }
    fat.querySelector('.val').textContent = (p != null ? `${p}% ${st[1]} · ${man(pw.lead.tokens)}/${man(pw.lead.window)}` : '아직 안 잼') +
      (worst ? ` · 직원 최고 ${worst[0]}% ${worst[1]}` : '');
    const face = $('face'), fc = face.getContext('2d');
    fc.imageSmoothingEnabled = false; fc.clearRect(0, 0, 48, 40);
    fc.drawImage(S.get('lead', { pose: 'idle', expr: exprOf(p, null, Date.now()) }), 0, 2, 48, 40, 0, 0, 48, 40);
    // 전기세
    const usual = pw.usual, frac = usual ? pw.today / usual : null, over = frac != null && frac > 1;
    const meter = $('meter');
    meter.classList.toggle('warn', over);
    const leds = meter.querySelector('.leds');
    if (leds.children.length !== 10) leds.innerHTML = '<i></i>'.repeat(10);
    const on = frac != null ? Math.round(clamp(frac, 0, 1) * 10) : 0;
    [...leds.children].forEach((el, i) => el.classList.toggle('on', i < on));
    meter.querySelector('.val').textContent = `오늘 ${man(pw.today)}`;
    // 작은 그래프: 이 창을 연 뒤 오늘 전기세가 늘어난 모양
    if (!spark.length || spark[spark.length - 1] !== pw.today) { spark.push(pw.today || 0); if (spark.length > 40) spark.shift(); }
    const sc = $('spark'), sx = sc && sc.getContext('2d');
    if (sx) {
      sx.clearRect(0, 0, 72, 18);
      const lo = Math.min(...spark), hi = Math.max(...spark), n = spark.length;
      sx.strokeStyle = over ? '#e07a3a' : '#5ce1e6'; sx.lineWidth = 1.5; sx.beginPath();
      spark.forEach((v, i) => { const x = n > 1 ? (i / (n - 1)) * 70 + 1 : 36, y = hi > lo ? 16 - ((v - lo) / (hi - lo)) * 14 : 9; if (i) sx.lineTo(x, y); else sx.moveTo(x, y); });
      sx.stroke();
    }
    timeline();
    const job = pw.job ? sumT(pw.job) : 0;
    meter.querySelector('.sub').textContent = (frac != null ? `평소의 ${Math.round(frac * 100)}%${over ? ' · 많이 쓰는 중' : ''}` : '평소 기록 쌓는 중') +
      ` · 이번 일 ${man(job)}${job ? ` (${parts(pw.job)})` : ''}`;
  }

  const spark = [];
  // ---- 책장 밑 「사무실 소식」 게시판: 모두의 '한 일' 을 시간순으로 (게시판엔 3줄, 누르면 옆 카드에 전체) ----
  let allEv = [], lastNews = '', seenNews = new Set(), newsDrop = false;
  function timeline() {
    const o = snap.office, ev = [];
    for (const [at2, x] of o.lead.recent || []) ev.push([at2, '팀장', x]);
    for (const w of o.workers || []) for (const [at2, x] of w.recent || []) ev.push([at2, unitName(w) + (w.member ? ' ' + w.member : ''), x]);
    ev.sort((a, b) => b[0] - a[0]);
    allEv = ev;
    news();
    if (sel === '__news') card();
  }
  function news() {
    const box = $('news');
    if (!box || !L || !L.news) return;
    const N = L.news, k = sd / dpr, x = (canvas.offsetLeft || 0) + N.x * k, y = (canvas.offsetTop || 0) + N.y * k;
    const top = allEv.slice(0, 3);
    const on = sel === '__news';
    const key = on + '|' + top.map((e) => e[0] + e[2]).join('|');
    box.className = on ? 'on' : '';
    box.style.width = N.w * k + 'px';
    box.style.left = x + 'px';
    box.style.top = y + 'px';
    box.style.height = N.h * k + 'px';
    // 게시판이 좁으면 머리 글을 줄인다 (오른쪽 밖으로 잘리지 않게)
    const tight = N.w * k < 160;
    $('newsTog').textContent = on ? (tight ? '◂' : '◂ 보는 중') : allEv.length > 3 ? (tight ? `▸ ${allEv.length}` : `▸ 전체 ${allEv.length}`) : '▸ 보기';
    if (key === lastNews) return;
    lastNews = key;
    $('newsList').innerHTML = top.length ? top.map((e) => {
      const id = e[0] + e[2], fresh = seenNews.size && !seenNews.has(id);
      return `<div class="${fresh ? 'new' : ''}"><time>${hhmm(e[0])}</time><i>${esc(e[1])}</i>${esc(e[2])}</div>`;
    }).join('') : '<div>아직 소식이 없어요</div>';
    for (const e of allEv.slice(0, 30)) seenNews.add(e[0] + e[2]);
  }
  // 소식 카드: 모두의 '한 일' 전체를 최신 순으로 (열 때만 주르륵, 새 소식은 맨 위에 하나씩)
  function newsCard() {
    const list = allEv.slice(0, 60), now = Date.now(), wasDrop = newsDrop;
    const rows = list.map((e, n) => {
      const id = e[0] + e[2];
      const first = seenCard.get(id);
      const cls = newsDrop ? 'srow' : 'srow still' + (first === undefined || now - first < 4000 ? ' fresh' : '');
      return `<div class="${cls}" style="--i:${Math.min(n, 20)}"><div class="sname"><b>${esc(e[1])}</b><span class="role">${hhmm(e[0])}</span></div><div class="snote">${esc(e[2])}</div></div>`;
    });
    for (const e of list) if (!seenCard.has(e[0] + e[2])) seenCard.set(e[0] + e[2], wasDrop ? 0 : now); // 새 소식은 4초 동안 노랗게
    newsDrop = false;
    return `<div class="who"><canvas id="cardFace" width="48" height="64"></canvas><div><h2>📋 사무실 소식</h2><div class="kind">팀장과 직원들이 한 일을 최신 순으로 모아 봐요</div></div></div>` +
      `<h3>소식 ${allEv.length}개${allEv.length > list.length ? ` <span style="font-weight:400">— 최근 ${list.length}개만</span>` : ''}</h3>` +
      (rows.length ? rows.join('') : '<div class="row">아직 소식이 없어요 — 일을 시키면 여기에 쌓여요</div>');
  }
  const seenCard = new Map();
  const openNews = () => { const was = !!sel; sel = sel === '__news' ? null : '__news'; if (sel) newsDrop = true; card(); news(); if (was !== !!sel) refit(); };
  $('news').addEventListener('click', () => openNews());

  // ---- 카드 (누른 직원 · 팀) ----
  // 책장 카드: 스킬 목록이 주르륵 (방금 쓴 책 → 내 스킬 → 플러그인은 더 보기)
  let shelfMore = false, lastCardHtml = '';
  // 내 스킬 / 플러그인 스킬(플러그인별)을 확실히 나누고, 이름 + 한 줄 설명만 (담당은 안 보임)
  function shelfCard() {
    const items = snap.skills || [];
    const mine = items.filter((i) => i.source === 'user'), plug = items.filter((i) => i.source !== 'user');
    const groups = [...new Set(plug.map((i) => i.plugin || '기타'))].map((g) => [g, plug.filter((i) => (i.plugin || '기타') === g)]);
    let n = 0;
    const row = (i) => `<div class="srow" style="--i:${n++};cursor:pointer" data-copy="/${esc(i.name)} " title="누르면 /${esc(i.name)} 복사"><div class="sname"><b>${esc(i.name)}</b>${i.count ? `<span class="star">★ 이번 세션 ${i.count}번</span>` : ''}</div><div class="snote">${esc(i.note)}</div></div>`;
    return `<div class="who"><canvas id="cardFace" width="48" height="64"></canvas><div><h2>📚 책장</h2><div class="kind">스킬을 쓰면 직원이 책장에 와서 책을 꺼내 가요</div></div></div>` +
      (items.length ? '' : '<div class="row">아직 스킬 목록을 못 받았어요 (패널을 새로 켜면 와요)</div>') +
      '<div class="note" style="margin-top:0">줄을 누르면 <code>/스킬이름</code> 이 복사돼요 — Claude Code 입력창에 붙여 넣으세요.</div>' +
      `<h3>내 스킬 ${mine.length}개 <span style="font-weight:400">— 내가 만들어 둔 것 (~/.claude/skills · commands, 이 프로젝트 .claude)</span></h3>` +
      (mine.length ? mine.map(row).join('') : '<div class="row">아직 없어요</div>') +
      `<h3>플러그인 스킬 ${plug.length}개 <span style="font-weight:400">— 설치한 플러그인에 딸려 온 것</span></h3>` +
      (shelfMore ? groups.map(([g, list]) => `<h3 style="margin-top:8px">${esc(g)} 플러그인 · ${list.length}개</h3>${list.map(row).join('')}`).join('')
        : groups.length ? `<button class="more" data-more="1">${groups.map(([g, list]) => `${esc(g)} ${list.length}`).join(' · ')} ▾ 펼치기</button>` : '');
  }
  // 📋 이번 일 보고서 (다시 보기는 패널에서 누르면 여기에도 같이 보여요)
  function reportCard() {
    const r = snap.report;
    if (!r) return '<div class="row">아직 보고서가 없어요. 일이 끝나면 생겨요.</div>';
    const people = r.units.reduce((n, u) => n + u.people, 0);
    return `<div class="who"><canvas id="cardFace" width="48" height="64"></canvas><div><h2>📋 이번 일 보고서</h2><div class="kind">「${esc(r.prompt)}」</div></div></div>
      <div class="row"><b>걸린 시간</b>${r.mins}분 · 자리 ${r.units.length}개 (직원 ${people}명) · 서류 ${r.papers}장 · 실패 ${r.fails}번</div>
      <div class="row"><b>전기세</b>${man(r.tokens)}${r.top ? ` · 제일 많이 쓴 자리: ${esc(r.top)}` : ''}</div>
      <ul>${r.units.map((u) => `<li><b>${esc(u.key)}</b>${u.people > 1 ? ` (${u.people}명)` : ''} — ${u.mins}분 · 서류 ${u.papers}장${u.fails ? ` · 실패 ${u.fails}번` : ''}${u.tokens ? ` · ${man(u.tokens)}` : ''}</li>`).join('')}</ul>
      ${(r.reviews || []).length ? `<h3>검사 결과</h3><ul>${r.reviews.map((x) => `<li><b>${esc(x.by)}</b> → ${reviewText(x)}</li>`).join('')}</ul>` : ''}
      <div class="note">▶ 다시 보기: Claude Code 옆 패널에서 「📋 보고서 · ▶ 다시 보기」 를 누르면 방금 일이 4배 빠르게 다시 돌아요 — 이 화면에도 같이 보여요 (토큰 0).</div>`;
  }
  // 🔍 심사대: 지금 검토 중 · 대기 줄 · 최근 결과와 반려 이유 (이유는 검사 직원이 남긴 글에서 뽑을 수 있을 때만)
  const reviewText = (r) => {
    const what = r.unit ? `${r.unit} 서류` : '서류';
    if (r.verdict === 'pass') return `<span style="color:#2f9e44;font-weight:700">통과 ✓</span> ${esc(what)}`;
    if (r.verdict === 'reject') return `<span style="color:#c92a2a;font-weight:700">${r.nth > 1 ? `${r.nth}번째 반려` : '반려'} ✗</span> ${esc(what)}${r.reason ? `<br><span style="color:#8a7f74">이유: ${esc(r.reason)}</span>` : ''}`;
    return `<span style="font-weight:700">검토 끝</span> ${esc(what)} <span style="color:#8a7f74">(통과 · 반려를 글에서 못 찾음)</span>`;
  };
  function reviewCard() {
    const o = snap.office, now = Date.now(), ws = o.workers || [];
    const RV = reviewScene(o, now), from = (o.promptAt || 0) - 1000;
    const name = (id) => { const w = ws.find((x) => x.id === id); return w ? unitName(w) + (w.member ? ' ' + w.member : '') : '?'; };
    const busy = reviewersOf(o).filter((w) => w.ended == null);
    const nowRows = busy.map((w) => `<li><b>${esc(name(w.id))}</b> — ${w.reviewOf ? `${esc(name(w.reviewOf))} 서류` : '서류'} 검토 중 · ${ago(now - w.started)}째<br><span style="color:#8a7f74">${esc(w.task || '')}</span></li>`);
    const line = busy.filter((w) => w.reviewOf).map((w, i) => `<li><b>${i + 1}</b> ${esc(name(w.reviewOf))} — ${esc((ws.find((x) => x.id === w.reviewOf) || {}).task || '')}</li>`);
    const done = (o.reviews || []).filter((r) => r.at >= from).slice(-8).reverse();
    return `<div class="who"><canvas id="cardFace" width="48" height="64"></canvas><div><h2>🔍 심사대</h2><div class="kind">검사 직원이 남이 한 일을 보고 통과 · 반려를 정해요</div></div></div>` +
      `<h3>지금 검토 중 ${busy.length}명${RV.more ? ` <span style="font-weight:400">— 심사대엔 2명만 앉고 +${RV.more}</span>` : ''}</h3>` +
      (nowRows.length ? `<ul>${nowRows.join('')}</ul>` : '<div class="row">지금은 없어요</div>') +
      `<h3>대기 줄 ${line.length}명</h3>` + (line.length ? `<ul>${line.join('')}</ul>` : '<div class="row">줄 선 사람 없어요</div>') +
      `<h3>최근 결과</h3>` + (done.length ? `<ul>${done.map((r) => `<li><time>${hhmm(r.at)}</time><b>${esc(name(r.by))}</b> → ${reviewText(r)}</li>`).join('')}</ul>` : '<div class="row">아직 없어요</div>') +
      '<div class="note">검사 직원: 에이전트 종류 이름에 review · critic · verifier · judge 가 있거나, 맡긴 일이 검토 · 리뷰 · 심사 · 검증인 직원. QA 는 테스트를 돌리는 게 기본이라, 맡긴 일에 검토 · 리뷰 · 승인이 있을 때만 검사 직원으로 봐요.<br>' +
      '검사 받는 직원은 검사 직원이 출근하기 직전에 일을 끝낸 직원으로 짐작해요. 통과 · 반려는 검사 직원이 남긴 마지막 글에서 뽑고, 애매하면 「검토 끝」 으로만 보여요.</div>';
  }

  // 📄 놓친 일 서류: 누르면 패널에 「주워 와」 를 전한다 (serve.py /api/pick → 패널이 팀장을 걸려 보내고 입력창에 문장).
  // 패널에 못 전하면(서버가 예전 것 · 패널이 꺼짐) 문장을 카드에 보여 주고 복사 단추로
  const picks = new Map(); // 서류 id → 'sending' · 'sent' · 'fail'
  function pick(id) {
    if (picks.get(id) === 'sending' || picks.get(id) === 'sent') return;
    picks.set(id, 'sending');
    fetch('/api/pick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: (snap && snap.session) || 'session', id }) })
      .then((r) => r.json()).then((d) => picks.set(id, d && d.ok ? 'sent' : 'fail'), () => picks.set(id, 'fail')).then(() => { if (sel === '__paper:' + id) card(); });
  }
  const WHY = { todo: '할 일 목록에 안 끝난 줄이 남았어요', said: '「했어?」 물음의 답에 놓쳤다는 말이 있었어요', abort: '맡은 직원이 중단됐어요' };
  function paperCard(id) {
    const p = ((snap.office && snap.office.papers) || []).find((x) => x.id === id);
    const head = `<div class="who"><canvas id="cardFace" width="48" height="64"></canvas><div><h2>📄 놓친 일 서류</h2><div class="kind">${p ? `${esc(p.who === 'main' ? '팀장' : p.unit)} 자리 · ${hhmm(p.at)}` : ''}</div></div></div>`;
    if (!p) return head + '<div class="row">이 서류는 이미 넘겼어요 (또는 그 일이 끝나서 치웠어요).</div>';
    const line = `놓친 일 다시 확인: ${p.text}`, st = picks.get(id);
    const now = st === 'fail' ? '<div class="paper err">패널에 못 전했어요 — 아래 문장을 복사해 Claude Code 입력창에 붙여 넣으세요.</div>'
      : p.picked != null ? `<div class="row"><b>팀장</b>${Date.now() - p.picked < PICK_MS ? '서류를 주워 와 확인하는 중 → 곧 Claude Code 입력창에 문장이 들어가요' : '입력창에 넣었어요. 확인하고 Enter 는 직접'}</div>`
        : st ? '<div class="row"><b>팀장</b>주우러 가는 중…</div>' : '<div class="row"><b>팀장</b>바닥의 서류를 누르면 주우러 가요</div>';
    return head + `<div class="row"><b>왜</b>${esc(WHY[p.why] || '')}</div>` + `<div class="paper">${esc(line)}</div>` + now +
      `<button class="more" data-copy="${esc(line)}">📋 문장 복사</button>` +
      '<div class="note">흔적 있는 것만 서류가 돼요: 할 일 목록(TodoWrite · TaskCreate)에 안 끝난 줄 · 「했어?」 물음의 답에 「깜빡 · 놓쳤 · 못 했」 · 직원 중단. 그 일이 나중에 끝나면 서류도 사라져요. 보내기는 직접 (보내기 전엔 토큰 0).</div>';
  }

  // 👥 명부: 내가 만든 에이전트 (.claude/agents)
  function rosterCard() {
    const list = snap.roster || [];
    const rows = list.map((a, i) => `<div class="srow" style="--i:${i}"><div class="sname"><b>${esc(a.name)}</b><span class="star" style="color:#8a7f74">${esc(a.where)}</span></div><div class="snote">${esc(a.description)}</div>
      <button class="more" style="margin-top:6px" data-copy="${esc(a.name)} 에이전트에게 맡겨 줘: ">📋 맡기기 문장 복사</button></div>`).join('');
    return `<div class="who"><canvas id="cardFace" width="48" height="64"></canvas><div><h2>👥 명부</h2><div class="kind">내가 만든 에이전트 ${list.length}명 (.claude/agents)</div></div></div>
      ${rows || '<div class="row">아직 없어요. 프로젝트의 .claude/agents 나 ~/.claude/agents 에 에이전트를 만들면 여기 보여요.</div>'}
      <div class="note">복사한 문장을 Claude Code 입력창에 붙여 넣고 이어서 쓰면 돼요. 패널의 「명부」 탭에선 누르면 바로 입력창에 들어가요. 이름은 패널에서 직원을 눌러 바꿀 수 있어요.</div>`;
  }

  // 피로도 안내: 단계별로 지금 할 일 (/compact, 또는 기록하고 /clear)
  const NOTE_TEXT = '지금까지 한 일 · 정한 것 · 남은 일을 HANDOFF.md 에 정리해 줘. 다음 대화에서 이 파일부터 읽고 이어 갈 거야.';
  function tiredCard() {
    const p = pctOf(snap.power && snap.power.lead), st = p != null ? stageOf(p) : null;
    const copy = (t, label) => `<button class="more" data-copy="${esc(t)}">📋 ${esc(label)}</button>`;
    let body = '';
    if (p == null) body = '<div class="row">Claude 가 한 번 대답하면 대화가 얼마나 찼는지 재요.</div>';
    else if (p < 40) body = '<div class="row">괜찮아요. 그대로 일하면 돼요.</div>';
    else if (p < 70) body = '<div class="row">하던 일을 이어 가는 거면 그대로 두세요.</div><div class="row">Claude 는 대답할 때마다 지금까지 대화를 처음부터 다시 읽어요. 상관없는 새 일을 여기서 시키면 앞 이야기까지 매번 다시 읽느라 전기세가 더 나와요.</div><div class="row"><b>→ 새 일이면</b> <code>/clear</code> 로 새 대화를 열고 시키세요.</div>';
    else body = `<div class="row"><b>${p < 90 ? '정리할 때예요.' : '곧 Claude 가 알아서 정리(자동 compact)해요.'}</b> 하던 일을 마무리하고 둘 중 하나:</div>
      <div class="paper">① 같은 일을 이어 갈 거면 → <code>/compact</code><br><span style="color:#8a7f74">지금까지를 요약해서 대화를 가볍게. 흐름은 남아요.</span></div>
      <div class="paper">② 다른 일로 넘어갈 거면 → 지금까지 한 일 · 정한 것 · 남은 일을 파일(예: HANDOFF.md)에 적게 한 뒤 → <code>/clear</code><br>
      <span style="color:#8a7f74">새 대화에서 「HANDOFF.md 읽고 이어서 하자」 하면 돼요. /clear 는 대화를 비워서 되돌릴 수 없으니 적는 것부터.</span></div>`;
    const acts = p != null && p >= 40 ? copy(NOTE_TEXT, '정리 부탁 문장 복사') + copy('/compact', '/compact 복사') + copy('/clear', '/clear 복사 (정리 먼저!)') : '';
    return `<div class="who"><canvas id="cardFace" width="48" height="64"></canvas><div><h2>팀장 피로도 ${p != null ? `${p}% ${st[1]}` : ''}</h2><div class="kind">팀장이 지금 들고 있는 대화량 ÷ 최대치</div></div></div>${body}${acts}
      <div class="note">직원은 각자 따로 대화를 들고 일해요 (이름표 밑 작은 막대). 일이 끝나면 그 대화는 버려지고 다음 직원은 0% 부터.<br>복사한 걸 Claude Code 입력창에 붙여 넣고 Enter — 보내기 전엔 토큰 0.</div>`;
  }
  const HELP = `<div class="who"><canvas id="cardFace" width="48" height="64"></canvas><div><h2>👋 사무실 사용법</h2><div class="kind">처음 오셨나요?</div></div></div>
    <div class="row">여기는 지금 이 프로젝트(= 회사)의 사무실이에요. Claude 에게 일을 시키면 직원들이 출근해서 일하는 모습이 보여요.</div>
    <div class="row"><b>팀장</b>지금 대화하는 Claude. 일을 나누면 직원이 문으로 출근해요 — 기본은 기획자 · 디자이너 · 개발자 · QA · 리서처, 내가 만든 에이전트는 그 이름 그대로. 팀이면 「QA 1팀」 처럼 한 자리.</div>
    <div class="row"><b>청록 깔개 · 같은 일 ×n</b>같은 일을 나눠서 동시에 하는 직원들. 누르면 그 직원들 목록과 각자 상태.</div>
    <div class="row"><b>직원을 누르면</b>오른쪽에 「지금 화면」 — 실행 중인 명령 · 고치는 파일 · 방금 한 일.</div>
    <div class="row"><b>📚 책장</b>내 스킬 목록과 한 줄 설명. 스킬을 쓰면 담당 직원이 책을 꺼내 와 읽어요.</div>
    <div class="row"><b>🔍 심사대</b>검토 · 리뷰를 맡은 직원이 오면 복도 옆에 생겨요. 검사 받는 직원이 서류를 들고 줄 서고, 번호판에 검토 중 · 통과 · 반려. 누르면 반려 이유까지.</div>
    <div class="row"><b>📋 게시판</b>사무실 소식 최근 3줄. 누르면 오른쪽에 소식 전체 목록.</div>
    <div class="row"><b>📄 놓친 일 서류</b>할 일 목록에 안 끝난 줄 · 「했어?」 물음에 「깜빡했어요」 · 직원 중단처럼 흔적이 있으면 그 자리 바닥에 떨어져요. 누르면 팀장이 주워 와 Claude Code 입력창에 「놓친 일 다시 확인: …」 을 넣어 줘요 (보내기는 직접).</div>
    <div class="row"><b>🔔 확인 필요</b>Claude 가 허락 · 질문의 답을 기다리면 맨 위에 노란 줄이 떠요. Claude Code 창으로 가서 답해 주세요.</div>
    <div class="row"><b>📋 보고서</b>일이 끝나면 맨 위 「이번 일 보고서」. 다시 보기는 패널에서 누르면 여기에도 같이 보여요.</div>
    <div class="row"><b>👥 명부</b>내가 만든 에이전트 목록. 「맡기기 문장 복사」 → 입력창에 붙여 넣기.</div>
    <div class="row"><b>피로도</b>대화가 얼마나 찼는지. 팀장은 맨 위, 직원은 이름표 밑 작은 막대(직원마다 따로).</div>
    <div class="row"><b>전기세</b>쓴 토큰. 평소보다 많이 쓰면 주황색.</div>
    <div class="note">명령 (Claude Code 에서): <code>/termimates</code> 패널 켜고 끄기 · <code>/termimates 시연</code> 가짜 장면 (토큰 0) · <code>/termimates 웹</code> 이 화면 · <code>/termimates 도움말</code><br>이 화면은 AI 를 부르지 않아요 (토큰 0). 기록은 이 컴퓨터에만.</div>`;
  function card() {
    const el = $('card');
    if (!snap || !snap.office || !sel) { el.hidden = true; lastCardHtml = ''; return; }
    if (sel === '__report' || sel === '__roster') {
      const html = sel === '__report' ? reportCard() : rosterCard();
      if (html !== lastCardHtml) { lastCardHtml = html; $('cardBody').innerHTML = html;
        const f = $('cardFace'), fc = f && f.getContext('2d');
        if (fc) { fc.imageSmoothingEnabled = false; fc.clearRect(0, 0, 48, 64); fc.drawImage(S.get(sel === '__report' ? 'lead' : 'planner', { pose: sel === '__report' ? 'thumb' : 'idle', expr: 'happy' }), 0, 0); } }
      el.hidden = false; return;
    }
    if (sel === '__tired') {
      const html = tiredCard();
      if (html !== lastCardHtml) { lastCardHtml = html; $('cardBody').innerHTML = html;
        const f = $('cardFace'), fc = f && f.getContext('2d'); const p = pctOf(snap.power && snap.power.lead);
        if (fc) { fc.imageSmoothingEnabled = false; fc.clearRect(0, 0, 48, 64); fc.drawImage(S.get('lead', { pose: 'idle', expr: exprOf(p, null, Date.now()) }), 0, 0); } }
      el.hidden = false; return;
    }
    if (sel === '__help') {
      if (lastCardHtml !== HELP) { lastCardHtml = HELP; $('cardBody').innerHTML = HELP;
        const f = $('cardFace'), fc = f && f.getContext('2d'); if (fc) { fc.imageSmoothingEnabled = false; fc.drawImage(S.get('lead', { pose: 'thumb', expr: 'happy' }), 0, 0); } }
      el.hidden = false; return;
    }
    if (String(sel).startsWith('__paper:')) {
      const html = paperCard(sel.slice(8));
      if (html !== lastCardHtml) { lastCardHtml = html; $('cardBody').innerHTML = html;
        const f = $('cardFace'), fc = f && f.getContext('2d'); if (fc) { fc.imageSmoothingEnabled = false; fc.clearRect(0, 0, 48, 64); fc.drawImage(S.get('lead', { pose: 'read' }), 0, 0); } }
      el.hidden = false; return;
    }
    if (sel === '__news') {
      const html = newsCard();
      if (html !== lastCardHtml) {
        lastCardHtml = html;
        $('cardBody').innerHTML = html;
        const f = $('cardFace'), fc = f && f.getContext('2d');
        if (fc) { fc.imageSmoothingEnabled = false; fc.clearRect(0, 0, 48, 64); fc.drawImage(S.get('lead', { pose: 'idle', expr: 'happy' }), 0, 0); }
      }
      el.hidden = false;
      return;
    }
    if (sel === '__review') {
      const html = reviewCard();
      if (html !== lastCardHtml) {
        lastCardHtml = html;
        $('cardBody').innerHTML = html;
        const f = $('cardFace'), fc = f && f.getContext('2d');
        if (fc) { fc.imageSmoothingEnabled = false; fc.clearRect(0, 0, 48, 64); fc.drawImage(S.get('qa', { pose: 'read' }), 0, 0); }
      }
      el.hidden = false;
      return;
    }
    if (sel === '__shelf') {
      const html = shelfCard();
      if (html !== lastCardHtml) {
        lastCardHtml = html;
        $('cardBody').innerHTML = html;
        const f = $('cardFace'), fc = f && f.getContext('2d');
        if (fc) { fc.imageSmoothingEnabled = false; fc.clearRect(0, 0, 48, 64); fc.drawImage(S.get('researcher', { pose: 'read' }), 0, 0); }
      }
      el.hidden = false;
      return;
    }
    lastCardHtml = '';
    const o = snap.office, pw = snap.power || {}, now = Date.now();
    const rows = [];
    const row = (k, v) => rows.push(`<div class="row"><b>${esc(k)}</b>${v}</div>`);
    const gauge = (f) => {
      const p = pctOf(f);
      if (p == null) return '아직 안 잼';
      const st = stageOf(p);
      return `${p}% ${st[1]} · 들고 있는 대화 ${man(f.tokens)} / ${man(f.window)} 토큰<div class="gauge"><i style="width:${clamp(p, 0, 100)}%;background:${st[2]}"></i></div>`;
    };
    const list = (items) => `<ul>${items.join('')}</ul>`;
    let head = '', kind = '', look = 'lead', who = null;
    if (sel === 'main') {
      const L0 = o.lead;
      head = '팀장'; kind = '메인 Claude · 일을 나누고 보고를 받아요'; who = L0;
      // 지금 화면: 사장님 지시서 + 하는 일 + 맡긴 직원들 실시간
      const busy = (o.workers || []).filter((w) => w.ended == null);
      rows.push(screen(L0, [
        o.prompt ? `<div class="sub">📌 사장님 지시 「${esc(o.prompt)}」</div>` : '',
        ...busy.slice(-6).map((w) => `<div class="sub">${ICON[w.status === 'work' ? w.tool : w.status] || '💼'} ${esc(unitName(w))}${w.member ? ' ' + esc(w.member) : ''} · ${esc(w.action)}</div>`),
      ].join('')));
      row('지금', `${esc(L0.action)} · ${ago(now - L0.since)}째`);
      row('피로도', gauge(pw.lead));
      const t = pw.byWorker && pw.byWorker.main;
      if (sumT(t)) row('전기세 몫', `이번 세션 ${man(sumT(t))} · ${parts(t)}`);
      if (o.prompt) row('사장님 지시', `「${esc(o.prompt)}」`);
      if (o.said) rows.push(`<div class="paper">마지막으로 한 말: ${esc(o.said)}</div>`);
      const ws = [...(o.workers || [])].reverse().slice(0, 8);
      if (ws.length) row('맡긴 일', list(ws.map((w) => `<li class="${w.ended != null ? 'dim' : ''}">${esc(unitName(w))}${w.member ? ' ' + esc(w.member) : ''} — ${esc(w.task || '(설명 없음)')} · ${esc(w.status === 'done' ? '보고 완료' : w.action)}</li>`)));
      if (L0.recent.length) row('한 일', list(L0.recent.slice(0, 10).map(([t2, x]) => `<li><time>${hhmm(t2)}</time>${esc(x)}</li>`)));
    } else if (sel === '__more' || String(sel).startsWith('fold:')) {
      // 접은 자리 · 「+n명」: 그 안의 자리마다 사람과 각자 상태
      const seat = L.seats.find((x) => x.pick === sel);
      if (!seat) { el.hidden = true; return; }
      const inside = (snap.units || []).filter((u) => seat.units.includes(u.key));
      head = seat.name; kind = sel === '__more' ? '자리가 모자라 접은 직원들' : '같은 직군이라 한 자리로 접었어요'; look = lookOf(seat.job || 'guest'); who = seat.worker;
      rows.push('<div class="note">창을 넓히거나 키우면 펼쳐져요.</div>');
      for (const u of inside) {
        const ms = u.members.map((m) => (o.workers || []).find((w) => w.id === m.id)).filter(Boolean).reverse();
        row(`${u.key}${u.loop ? ` ⟳${u.loop}` : ''}`, list(ms.slice(0, 6).map((x) => `<li class="${x.ended != null ? 'dim' : ''}">${x.member ? `<b>${esc(x.member)}</b> ` : ''}${esc(x.status === 'done' ? '보고 완료 ✓' : x.ended != null ? '퇴근' : x.action)} — ${esc(x.task || '')}</li>`)));
      }
    } else {
      const u = (snap.units || []).find((x) => x.key === sel);
      if (!u) { el.hidden = true; return; }
      const members = u.members.map((m) => (o.workers || []).find((w) => w.id === m.id)).filter(Boolean);
      const w = members.slice().reverse().find((x) => x.ended == null) || members[members.length - 1];
      head = u.key; kind = `에이전트 종류: ${[...new Set(members.map((x) => x.role))].join(', ')}`; look = lookOf(u.job); who = w;
      // 청록 깔개(나란히 자리)로 앉은 자리면 맨 위에 그 뜻을 쉬운 말로 (아래 「같은 일 직원」 에 목록 · 상태)
      const twinsHere = L.seats.filter((x) => x.kind === 'twin' && x.pick === u.key).length;
      if (twinsHere) rows.push(`<div class="note" style="margin-top:0">같은 일을 나눠서 동시에 하는 직원들이에요 (${twinsHere}명)</div>`);
      if (w) {
        rows.push(screen(w, ''));
        row('지금', w.status === 'done' ? `보고 완료 · ${ago(now - (w.ended || now))} 전` : `${esc(w.action)} · ${ago(now - w.since)}째`);
        if (w.task) row('맡은 일', `${esc(w.task)} <span style="color:#8a7f74">(팀장이 맡김)</span>`);
        { const t = TIER[w.tier];
          if (t) row('모델 직급', `<span style="background:${t.bg};color:${t.fg};padding:1px 8px;border-radius:9px;font-weight:700">${t.stars} ${t.name}</span>${w.model ? ` <span style="color:#8a7f74">${esc(w.model)}</span>` : ''}`); }
        if (w.persona) row('페르소나', `<span style="color:#ff6b6b;font-weight:700">「${esc(w.persona)}」</span> <span style="color:#8a7f74">(맡긴 일에서 입힌 성격)</span>`);
        row('피로도', gauge(pw.workers && pw.workers[w.id]));
        { const wp = pctOf(pw.workers && pw.workers[w.id]);
          if (wp != null && wp >= 70) rows.push('<div class="note">대화가 많이 찼어요. 남은 일은 새 직원에게 나눠 맡기면 덜 피곤해요. 이 직원은 팀장과 따로 자기 대화를 들고 일해서, 일이 끝나면 이 대화는 버려지고 다음 직원은 0% 부터 시작해요.</div>'); }
        let tot = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
        for (const x of members) { const t = pw.byWorker && pw.byWorker[x.id]; if (t) tot = { input: tot.input + t.input, cacheRead: tot.cacheRead + t.cacheRead, cacheWrite: tot.cacheWrite + t.cacheWrite, output: tot.output + t.output }; }
        if (sumT(tot)) row('전기세 몫', `${man(sumT(tot))} · ${parts(tot)}<br><span style="color:#8a7f74">실제 AI 직원이라 따로 대화를 들고 일해요. 직원이 많을수록 전기세가 더 나와요.</span>`);
        if (w.handback) rows.push(`<div class="paper">넘긴 서류: 「${esc(w.handback)}」</div>`);
        if (w.error) rows.push(`<div class="paper err">⚠ 실패: ${esc(w.error)}</div>`);
        if (u.boss) row('파트', `${esc(u.boss)} 파트장이 맡긴 일`);
        if (u.loop) row('반복', `<b style="color:#ff6b6b">⟳ ${u.loop}번째</b> 다시 하는 중 <span style="color:#8a7f74">(반려 · 같은 일 다시 맡김)</span>`);
        if (u.kids) {
          const kids = (snap.units || []).filter((x) => x.boss === u.key).flatMap((x) => x.members.map((m) => [x.key, (o.workers || []).find((w) => w.id === m.id)])).filter((p2) => p2[1]);
          row(`파트원 ${u.kids}명`, list(kids.reverse().slice(0, 8).map(([k2, x]) => `<li class="${x.ended != null ? 'dim' : ''}"><b>${esc(k2)}</b> ${esc(x.status === 'done' ? '보고 완료 ✓' : x.ended != null ? '퇴근' : x.action)} — ${esc(x.task || '')}</li>`)));
        }
        if (u.team || u.count >= 2) {
          const state = (x) => (x.status === 'done' ? '보고 완료 ✓' : x.status === 'unfinished' ? '못 끝냄' : x.ended != null ? '퇴근' : x.action);
          row(`${u.team ? '팀원' : '같은 일 직원'} ${members.length}명`, list(members.slice().reverse().map((x, i) => `<li class="${x.ended != null ? 'dim' : ''}"><b>${esc(x.member || members.length - i)}</b> ${esc(state(x))} — ${esc(x.task || '')}${x.handback ? `<br>　서류 「${esc(x.handback.slice(0, 60))}」` : ''}</li>`)));
        }
        if (w.recent.length) row('한 일', list(w.recent.slice(0, 10).map(([t2, x]) => `<li><time>${hhmm(t2)}</time>${esc(x)}</li>`)));
      }
    }
    rows.push('<div class="note">말 걸기는 Claude Code 옆 패널에서 이 직원을 눌러서 해요 (보낼 때만 토큰이 들어요).</div>');
    $('cardBody').innerHTML = `<div class="who"><canvas id="cardFace" width="48" height="64"></canvas><div><h2>${esc(head)}</h2><div class="kind">${esc(kind)}</div></div></div>${rows.join('')}`;
    const f = $('cardFace'), fc = f && f.getContext('2d');
    if (fc) { fc.imageSmoothingEnabled = false; fc.clearRect(0, 0, 48, 64); const cardPct = sel === 'main' ? pctOf(pw.lead) : (who ? pctOf(pw.workers && pw.workers[who.id]) : null); const cardPose = who ? poseOf(who, false) : 'idle'; fc.drawImage(S.get(look, { pose: cardPose, frame: Math.floor(now / 350), expr: exprOf(cardPct, who, now), sweat: cardPose === 'sweat' || (cardPct != null && cardPct >= 70) }), 0, 0); }
    el.hidden = false;
  }

  /** 「지금 화면」: 그 사람 모니터에 떠 있을 것 — 고치는 파일 · 실행 중인 명령 · 찾는 말 · 읽는 책 + 방금 한 일 */
  function screen(w, extra) {
    const t = w.target || '', now = Date.now();
    let cur = '';
    if (w.status === 'work') {
      switch (w.tool) {
        case 'Bash': cur = `<span class="ps">$</span>${esc(t)} <span class="cur"></span>`; break;
        case 'Edit': case 'MultiEdit': case 'NotebookEdit': cur = `✏️ ${esc(t)}<br><span class="dim">고치는 중</span><span class="dots"></span>`; break;
        case 'Write': cur = `📝 ${esc(t)}<br><span class="dim">새로 쓰는 중</span><span class="dots"></span>`; break;
        case 'Read': cur = `📖 ${esc(t)}<br><span class="dim">읽는 중</span><span class="dots"></span>`; break;
        case 'Grep': case 'Glob': cur = `🔍 ${esc(t)}<br><span class="dim">찾는 중</span><span class="dots"></span>`; break;
        case 'WebSearch': case 'WebFetch': cur = `🌐 ${esc(t)}<br><span class="dim">웹에서 보는 중</span><span class="dots"></span>`; break;
        case 'Skill': cur = `📚 스킬 책 「${esc(t)}」<br><span class="dim">읽는 중</span><span class="dots"></span>`; break;
        case 'Agent': case 'Task': cur = `📨 ${esc(t)}<br><span class="dim">직원에게 맡기는 중</span>`; break;
        default: cur = `${esc(w.tool || '')} ${esc(t)}<br><span class="dim">${esc(w.action)}</span>`;
      }
    } else if (w.status === 'think') cur = `💭 <span class="dim">생각 중</span><span class="dots"></span>`;
    else if (w.status === 'done') cur = `✅ 보고 완료${w.handback ? `<br><span class="dim">「${esc(w.handback)}」</span>` : ''}`;
    else if (w.status === 'unfinished') cur = `⚠️ 못 끝냈어요${w.error ? `<br><span class="dim">${esc(w.error)}</span>` : ''}`;
    else cur = `${ICON[w.status] || '💼'} ${esc(w.action)}`;
    if (w.error && w.status !== 'unfinished') cur += `<br><span style="color:#ff8787">⚠ ${esc(w.error)}</span>`;
    const log = (w.recent || []).slice(0, 5).map(([at2, x]) => `<div class="log"><time>${hhmm(at2)}</time>${esc(x)}</div>`).join('');
    return `<div class="screen"><div class="bar"><i></i><i></i><i></i><span>지금 화면 · ${ago(now - w.since)}째</span></div><div class="now">${cur}</div>${extra}${log}</div>`;
  }
  function unitName(w) {
    const u = (snap.units || []).find((x) => x.members.some((m) => m.id === w.id));
    return u ? u.key : w.role;
  }

  // ---- 누르기 ----
  function hitAt(ev) {
    const r = canvas.getBoundingClientRect();
    const wx = ((ev.clientX - r.left) * dpr) / sd, wy = ((ev.clientY - r.top) * dpr) / sd;
    return hits.find((h) => wx >= h.x && wx < h.x + h.w && wy >= h.y && wy < h.y + h.h);
  }
  // 카드를 열고 닫으면 사무실 폭이 바뀐다: 창 크기 바꿀 때처럼 맞추자마자 바로 다시 그린다 (안 그리면 한 프레임 비어 깜빡임)
  const refit = () => refitNow();
  canvas.addEventListener('click', (ev) => {
    const h = hitAt(ev);
    if (h && h.key === '__news') { openNews(); return; }
    if (h && h.key.startsWith('__paper:')) pick(h.key.slice(8));
    const was = !!sel; sel = h ? h.key : null; card(); news(); if (was !== !!sel) refit();
  });
  canvas.addEventListener('mousemove', (ev) => { const h = hitAt(ev); if ((h && h.key) !== hover) { hover = h && h.key; canvas.classList.toggle('hand', !!h); } });
  $('close').addEventListener('click', () => { sel = null; card(); news(); refit(); });
  const open = (k) => () => { const was = !!sel; sel = sel === k ? null : k; card(); if (was !== !!sel) refit(); };
  $('report').addEventListener('click', open('__report'));
  $('roster').addEventListener('click', open('__roster'));
  $('help').addEventListener('click', () => { const was = !!sel; sel = sel === '__help' ? null : '__help'; card(); if (was !== !!sel) refit(); });
  $('cardBody').addEventListener('click', (ev) => {
    const d = ev.target && ev.target.dataset;
    if (d && d.more) { shelfMore = true; card(); }
    const c = ev.target && ev.target.closest && ev.target.closest('[data-copy]');
    if (c && navigator.clipboard) navigator.clipboard.writeText(c.dataset.copy).then(() => {
      if (c.tagName === 'BUTTON') c.textContent = '✓ 복사했어요 — Claude Code 입력창에 붙여 넣으세요';
      else { c.style.outline = '2px solid #2f9e44'; setTimeout(() => { c.style.outline = ''; }, 900); }
    });
  });
  $('fatigue').addEventListener('click', () => { const was = !!sel; sel = sel === '__tired' ? null : '__tired'; card(); if (was !== !!sel) refit(); });
  window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && sel) { sel = null; card(); refit(); } });

  // ---- 받기 ----
  let sig = '', firstTake = true;
  function take(data) {
    snap = data;
    if (firstTake && snap && snap.office) {
      firstTake = false;
      if (qs.get('sel')) sel = qs.get('sel');
      if (qs.get('news') === 'open') { sel = '__news'; newsDrop = true; }
    }
    $('empty').hidden = !!(snap && snap.office);
    if (snap && snap.office) {
      // 자리 수가 바뀌면 배율부터 다시, 아니면 같은 폭으로 자리만 새로 (깜빡이지 않게)
      // 자리 수 = 접기 단계들의 자리 수 + 심사대 유무 (심사대가 grid 칸을 하나 더 쓸 수 있다). 일하는 수(count)는 안 본다:
      // 나란히 앉은 직원 하나가 끝나도 퇴근 걸음이 끝날 때까지 자리는 그대로라 배율이 들썩이지 않게
      const st0 = stepsOf();
      const now = JSON.stringify([(snap.units || []).map((u) => u.key), st0.main.map((x) => x.length), (st0.part || []).map((x) => x.length), reviewersOf(snap.office).length > 0]);
      if (!L || now !== sig) { sig = now; fit(); try { render(Date.now()); } catch (e) { /* 다음 장면에 */ } } else L = Object.assign(layout(L.W, L.Hmax), { Hmax: L.Hmax });
    }
    hud();
    if (sel && sel !== 'main' && !sel.startsWith('__') && !sel.startsWith('fold:') && !(snap.units || []).some((u) => u.key === sel)) sel = null; // __ 로 시작 = 책장 · 보고서 · 명부 · 도움말 카드
    if (sel === '__report' && !snap.report) sel = null;
    if (sel === '__review' && !(L && L.desk)) sel = null; // 검사 직원이 없어져 심사대가 사라짐
    if (sel) card();
  }
  function connect() {
    const conn = $('conn');
    const es = new EventSource('/api/stream?session=' + encodeURIComponent(session));
    es.onopen = () => { conn.textContent = '연결됨'; conn.className = 'conn ok'; };
    es.onmessage = (ev) => { try { take(JSON.parse(ev.data)); } catch (e) { /* 다음 소식을 기다림 */ } };
    es.onerror = () => { conn.textContent = '연결 끊김 — Claude Code 세션이 끝났거나 웹을 껐어요 (다시 시도 중)'; conn.className = 'conn bad'; };
  }
  fetch('/api/state?session=' + encodeURIComponent(session)).then((r) => r.json()).then((d) => { if (d) take(d); else $('empty').hidden = false; }).catch(() => { $('empty').hidden = false; });
  if (!qs.has('once')) connect(); // ?once=1: 한 번만 받기 (소개 사진 찍을 때)
  else $('conn').hidden = true;

  // ---- 창 크기 ----
  // 사무실 칸 크기가 바뀔 때마다 (창 크기 · 위 계기판 줄 수 · 카드) 다시 맞춘다
  // 깜빡임 없이: 드래그 중엔 0.12초에 한 번만 다시 맞추고, 손을 멈추면 한 번 더. 크기를 바꾼 그 자리에서 바로 다시 그린다
  let rz = 0, settle = 0, lastFit = 0;
  const refitNow = () => { if (!snap || !snap.office) return; fit(); lastFit = Date.now(); try { render(Date.now()); } catch (e) { /* 다음 장면에 */ } };
  const onResize = () => {
    clearTimeout(settle);
    settle = setTimeout(refitNow, 140);
    if (Date.now() - lastFit > 120) { cancelAnimationFrame(rz); rz = requestAnimationFrame(refitNow); }
  };
  window.addEventListener('resize', onResize);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(onResize).observe(stage);

  // ---- 돌리기 (움직일 땐 매끄럽게, 가만히 있을 땐 덜 자주) ----
  let lastDraw = 0, lastHud = 0;
  function loop(t) {
    requestAnimationFrame(loop);
    if (!snap || !snap.office || !L) return;
    const now = Date.now();
    if (now - lastDraw < 33) return;
    lastDraw = now;
    try { render(now); } catch (e) { if (!loop.err) { loop.err = true; console.error(e); } }
    if (now - lastHud > 1000) { lastHud = now; hud(); if (sel) card(); } // 카드의 「몇 분째」 · 지금 화면도 1초마다
  }
  requestAnimationFrame(loop);

  // 시험용: 화면 없이 배치만 확인
  window.__termimates = { layout: (W, Hmax) => layout(W, Hmax), take, motionOf: (s, now, who) => motionOf(snap.office, s, now, who), boxes: () => boxes, papers: () => paperSpots(snap.office), hits: () => hits, click: (k) => { if (k.startsWith('__paper:')) pick(k.slice(8)); sel = k; card(); return $('cardBody').innerHTML; }, world: () => world, select: (k) => { sel = k; card(); return $('cardBody').innerHTML; }, news: (open) => { sel = open ? '__news' : null; newsDrop = open; lastNews = ''; card(); news(); return open ? $('cardBody').innerHTML : $('newsList').innerHTML; } };
})();
