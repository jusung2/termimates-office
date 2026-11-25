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

  // ---- 시간 규칙 (패널 scene.ts 와 같게) ----
  const TRIP_MS = 4400, ASSIGN_MS = 1300, SHELF_MS = 5200, READ_MS = 4000, ARRIVE_MS = 3200, LEAVE_MS = 3200, BOSS_MS = 7000;

  // ---- 배치 치수 (월드 픽셀 = 캐릭터 픽셀) ----
  const SLOT_W = 100, ROW_H = 128, WALL_H = 72, SIDE = 64, RIGHT = 16, SHELF_W = 112, MIN_W = 380;
  const FOOT = S.FOOT, SW = S.W;

  // ---- 상태 ----
  let bossAt = null; // 사장님이 지금 어디 있는지 (말풍선용)
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

  // ---- 배치 ----
  function layout(W) {
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
    if (o) seats.push(mkSeat({ key: 'main', job: '팀장', name: '팀장', worker: o.lead, team: false, members: null, count: 0 }, leadCx - SLOT_W / 2, leadSy, -1, true));
    units.forEach((u, i) => {
      const r = Math.floor(i / perRow), c = i % perRow;
      const w = o.workers.find((x) => x.id === u.worker);
      seats.push(mkSeat({ key: u.key, job: u.family || u.job, name: u.key, worker: w, team: u.team, members: u.members, count: u.count }, left + c * SLOT_W, staffTop + r * ROW_H, r, false));
    });
    const rows = Math.max(1, Math.ceil(units.length / perRow));
    const NEWS_H = 92;
    const news = besideShelf ? { x: shelf.x, y: staffTop + 6, w: SHELF_W, h: NEWS_H }
      : { x: W - RIGHT - SHELF_W, y: staffTop + rows * ROW_H + 4, w: SHELF_W, h: NEWS_H };
    const H = Math.max(staffTop + rows * ROW_H + 14, news.y + news.h + 24);
    // 출입문은 뒷벽 왼쪽. 문 → 왼쪽 길 → 큰 복도로 드나든다
    const door = { x: 22, y: 8, w: 42, h: WALL_H + 4 };
    const lay = { W, H, seats, shelf, hallTop, hallFoot, staffTop, door, doorCx: door.x + door.w / 2, doorFoot: door.y + door.h, corridorX: door.x + door.w / 2,
      aisleFoot: (k) => staffTop + k * ROW_H + ROW_H - 6, lead: seats[0], books: null };
    // 벽: 문 · 시계 · 화이트보드(사장님 지시 · 할 일) · 팀장 뒤 회사 간판 · 남은 자리에 창문
    lay.plaque = { x: Math.max(104, leadCx - 56), y: 12, w: 112, h: 24 }; // 시계(왼쪽)를 피해서
    lay.news = news;
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
    let pick = null;
    for (let s = 8; s >= 1; s--) {
      const W = Math.floor(cw / s);
      if (W < MIN_W && s > 1) continue;
      const lay = layout(W);
      if (lay.H * s <= ch) { pick = { s, lay }; break; }
      if (!pick || (W >= MIN_W && s < pick.s)) pick = { s, lay }; // 안 맞으면 가장 작은 배율(세로 스크롤)
    }
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
  function motionOf(o, s, now) {
    const w = s.worker;
    if (!w) return {};
    const id = s.lead ? 'main' : w.id;
    const h = s.lead ? null : [...(o.handoffs || [])].reverse().find((x) => x.from === w.id);
    const hAge = h ? now - h.at : -1;
    if (h && hAge >= 0 && hAge < TRIP_MS) {
      const pts = toHall(s, L.lead.cx + 34), t = hAge / TRIP_MS;
      if (t < 0.4) return { m: { pts, p: ease(t / 0.4), carry: 'doc' } };
      if (t < 0.6) return { m: { pts, p: 1, give: ease((t - 0.4) / 0.2) } };
      return { m: { pts, p: 1 - ease((t - 0.6) / 0.4) } };
    }
    if (w.ended != null && !s.lead) {
      const leaveAt = w.ended + (h && h.at >= w.ended - 1000 ? TRIP_MS : 0) + 1500, lAge = now - leaveAt;
      if (lAge >= LEAVE_MS) return { gone: true };
      if (lAge >= 0) return { m: { pts: toDoor(s), p: ease(lAge / LEAVE_MS) } };
    }
    const sh = [...(o.shelf || [])].reverse().find((x) => x.who === id);
    const sAge = sh ? now - sh.at : -1;
    if (sh && sAge >= 0 && sAge < SHELF_MS) {
      const pts = toHall(s, L.shelf.x + 40), t = sAge / SHELF_MS;
      if (t < 0.4) return { m: { pts, p: ease(t / 0.4) } };
      if (t < 0.55) return { m: { pts, p: 1, carry: t > 0.48 ? 'book' : null, reach: true } };
      return { m: { pts, p: 1 - ease((t - 0.55) / 0.45), carry: 'book' } };
    }
    if (!s.lead) {
      const aAge = now - w.started;
      if (aAge >= 0 && aAge < ARRIVE_MS) return { m: { pts: toDoor(s), p: 1 - ease(aAge / ARRIVE_MS) } };
    }
    return {};
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
    const taken = new Set((o.shelf || []).filter((x) => now - x.at >= SHELF_MS * 0.46 && now - x.at < SHELF_MS + READ_MS).map((x) => slotOf(x.book)));
    const readers = new Set((o.shelf || []).filter((x) => now - x.at >= SHELF_MS && now - x.at < SHELF_MS + READ_MS).map((x) => x.who));

    // 사장님 지시가 막 들어왔으면: 사장님이 문으로 들어와 팀장에게 지시서를 건네고 나간다
    let boss = null;
    const bAge = o.promptAt == null ? -1 : now - o.promptAt;
    if (bAge >= 0 && bAge < BOSS_MS) {
      const t = bAge / BOSS_MS, pts = bossPath();
      boss = t < 0.4 ? { pts, p: ease(t / 0.4), carry: 'doc' } : t < 0.58 ? { pts, p: 1, give: ease((t - 0.4) / 0.18) } : { pts, p: 1 - ease((t - 0.58) / 0.42) };
    }
    // 문은 누가 드나들 때만 열린다
    let doorOpen = false;
    const nearDoor = (m) => { const p = at(m.pts, m.p * lenOf(m.pts)); return p.x < L.doorCx + 40 && p.y < L.doorFoot + 34; };
    for (const m of moves.values()) if (nearDoor(m)) doorOpen = true;
    if (boss && nearDoor(boss)) doorOpen = true;
    drawDoorBack(c, doorOpen);
    bossAt = null;

    for (const s of L.seats) drawChair(c, s);
    const things = [{ foot: L.shelf.y + L.shelf.h, paint: () => drawShelf(c, taken, now) }, { foot: L.doorFoot + 1, paint: () => drawDoorFront(c) }];
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
        sprite(c, look, pt.x, pt.y - (walking && step % 2 ? 1 : 0), { pose, frame: walking ? step : frame, facing: back ? 'back' : 'front',
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
      const present = !!w && !moves.has(s.key) && !gone.has(s.key) && w.status !== 'off' && !(s.lead && w.status === 'desk');
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
    }
    things.sort((a, b) => a.foot - b.foot);
    for (const t of things) t.paint();

    // 밤: 방이 어두워지고 사람이 있는 책상 스탠드가 따뜻하게 비춘다
    if (isNight) {
      c.fillStyle = 'rgba(14,20,48,0.42)'; c.fillRect(0, 0, L.W, L.H);
      c.globalCompositeOperation = 'lighter';
      for (const s of L.seats) {
        if (!s.worker || moves.has(s.key) || gone.has(s.key) || s.worker.status === 'off' || (s.lead && s.worker.status === 'desk')) continue;
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
      const s = L.seats.find((x) => x.worker && x.worker.id === a.to) || L.seats.find((x) => x.members && x.members.some((mm) => mm.id === a.to));
      if (!s) continue;
      const q = ease(age / ASSIGN_MS), x0 = L.lead.cx - 20, y0 = L.lead.sy + 64, x1 = s.cx - 4, y1 = s.sy + 66;
      paper(c, x0 + (x1 - x0) * q, y0 + (y1 - y0) * q - Math.sin(q * Math.PI) * 40);
    }

    // 확대해서 화면에 (픽셀 그대로)
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(world, 0, 0, L.W * sd, L.H * sd);
    overlay(now, moves, gone);
  }

  // ---- 글자 (기기 해상도로 또렷하게): 말풍선 · 이름표 · 표지 ----
  function overlay(now, moves, gone) {
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
    if (o.todos && o.todos.length) for (const t of o.todos) lines.push([t.state === 'done' ? '#8a939c' : t.state === 'doing' ? '#1864ab' : '#343a40', t.state === 'doing' ? 700 : 500, `${t.state === 'done' ? '☑' : t.state === 'doing' ? '▶' : '☐'} ${t.text}`]);
    else for (const u of snap.units || []) { const ws = u.members.map((m) => m.status); const dn = ws.filter((x) => x === 'done').length;
      lines.push(['#343a40', 500, `• ${u.key} ${dn}/${ws.length} 끝`]); }
    const lh = bfs * 1.22, maxLines = Math.max(1, Math.floor((Y(B.h) - bfs * 0.6) / lh));
    let shown = lines.length > maxLines ? lines.filter((l, i) => i === 0 || l[0] !== '#8a939c').slice(0, maxLines) : lines;
    shown.forEach(([col, wt, text], i) => {
      ctx.font = `${wt} ${bfs}px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
      let tx = text; while (tx.length > 3 && ctx.measureText(tx).width > X(B.w - 6)) tx = tx.slice(0, -2) + '…';
      ctx.fillStyle = col; ctx.fillText(tx, X(B.x + 3), Y(B.y) + bfs * 0.75 + i * lh);
    });
    ctx.restore(); ctx.textAlign = 'center';
    }

    // 말풍선: 줄마다 옆자리와 겹치지 않게 (옆이 비면 넓게, 좁으면 짧은 말)
    const rows = new Map();
    for (const s of L.seats) rows.set(s.sy, (rows.get(s.sy) || []).concat([s]));
    for (const row of rows.values()) {
      row.sort((a, b) => a.cx - b.cx);
      const say = (s) => (s.worker && !gone.has(s.key) && !moves.has(s.key) ? bubbleOf(s.worker) : null);
      row.forEach((s, i) => {
        const b = say(s);
        if (!b || !b.long) return;
        const prev = row[i - 1], next = row[i + 1];
        const lo = prev ? (say(prev) ? prev.cx + SLOT_W / 2 : prev.cx) : 0;
        const hi = next ? (say(next) ? next.cx - SLOT_W / 2 : next.cx) : L.W;
        ctx.font = `600 ${fs}px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
        const room = X(hi - lo) - fs;
        let text = ctx.measureText(b.long).width <= room ? b.long : b.short;
        while (text.length > 2 && ctx.measureText(text).width > room) text = text.slice(0, -2) + '…';
        const tw = ctx.measureText(text).width, pw = tw + fs * 1.1, ph = fs * 1.7;
        let bx = X(s.cx) - pw / 2;
        bx = clamp(bx, X(lo), X(hi) - pw);
        const by = Y(s.sy + 12) - ph / 2;
        const st = s.worker.status;
        const accent = st === 'done' ? '#2f9e44' : st === 'unfinished' ? '#c9423a' : st === 'ask' ? '#e07a3a' : st === 'work' ? '#1971c2' : '#8a7f74';
        ctx.fillStyle = 'rgba(0,0,0,0.18)'; roundRect(ctx, bx + dpr, by + 2 * dpr, pw, ph, ph / 2.4); ctx.fill();
        ctx.fillStyle = '#fffdf8'; roundRect(ctx, bx, by, pw, ph, ph / 2.4); ctx.fill();
        ctx.strokeStyle = accent; ctx.lineWidth = 1.5 * dpr; ctx.stroke();
        const tx = clamp(X(s.cx), bx + ph / 2, bx + pw - ph / 2);
        ctx.fillStyle = '#fffdf8'; ctx.beginPath(); ctx.moveTo(tx - 4 * dpr, by + ph - dpr); ctx.lineTo(tx, by + ph + 6 * dpr); ctx.lineTo(tx + 4 * dpr, by + ph - dpr); ctx.fill();
        ctx.strokeStyle = accent; ctx.beginPath(); ctx.moveTo(tx - 4 * dpr, by + ph); ctx.lineTo(tx, by + ph + 6 * dpr); ctx.lineTo(tx + 4 * dpr, by + ph); ctx.stroke();
        ctx.fillStyle = '#2b2420'; ctx.textAlign = 'center'; ctx.fillText(text, bx + pw / 2, by + ph / 2 + dpr * 0.5);
      });
    }
    // 이름표 (자리 가운데) + 누를 자리
    for (const s of L.seats) {
      const isSel = s.key === sel, away = gone.has(s.key);
      const name = (s.count > 1 && !s.team ? `${s.name} ×${s.count}` : s.name) + (away ? ' 퇴근' : '');
      // 이름표 밑 작은 피로도 캡슐 (직원마다 따로)
      const fp = !away ? pctOf(fillOf(s)) : null;
      if (fp != null && s.worker && s.worker.status !== 'desk' && s.worker.status !== 'off') {
        const bw = 30 * dpr, bh = 4 * dpr, bx = X(s.cx) - bw / 2, by = Y(s.sy + 115) + fs * 0.95;
        ctx.fillStyle = 'rgba(26,21,18,.85)'; roundRect(ctx, bx - dpr, by - dpr, bw + 2 * dpr, bh + 2 * dpr, bh); ctx.fill();
        ctx.fillStyle = stageOf(fp)[2]; roundRect(ctx, bx, by, Math.max(bh, (bw * Math.min(100, fp)) / 100), bh, bh / 2); ctx.fill();
      }
      label(name, X(s.cx), Y(s.sy + 115), isSel
        ? { bg: '#ffd89b', fg: '#2a1d05', bold: true, border: '#fff3d6' }
        : { bg: away ? 'rgba(43,36,32,.45)' : 'rgba(43,36,32,.82)', fg: away ? '#a99f95' : '#f3ead9', bold: s.lead });
      if (s.team && s.members) {
        const dn = s.members.filter((m) => m.status === 'done').length;
        ctx.font = `700 ${Math.round(fs * 0.62)}px -apple-system, "Apple SD Gothic Neo", sans-serif`; ctx.fillStyle = '#ffd89b';
        ctx.fillText(`${dn}/${s.members.length} 끝`, X(s.cx), Y(s.sy + 43.5));
      }
      hits.push({ key: s.key, x: s.sx, y: s.sy + 4, w: SLOT_W, h: ROW_H - 4 });
    }
    hits.push({ key: '__shelf', x: L.shelf.x, y: L.shelf.y, w: L.shelf.w, h: L.shelf.h + 20 }); // 책장 누르면 스킬 목록
    hits.push({ key: '__news', x: L.news.x, y: L.news.y, w: L.news.w, h: L.news.h + 14 }); // 게시판 누르면 펼치기 · 접기
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
  // ---- 책장 밑 「사무실 소식」 게시판: 모두의 '한 일' 을 시간순으로 (접으면 3줄, 누르면 10줄) ----
  let allEv = [], newsOpen = false, lastNews = '', seenNews = new Set();
  function timeline() {
    const o = snap.office, ev = [];
    for (const [at2, x] of o.lead.recent || []) ev.push([at2, '팀장', x]);
    for (const w of o.workers || []) for (const [at2, x] of w.recent || []) ev.push([at2, unitName(w) + (w.member ? ' ' + w.member : ''), x]);
    ev.sort((a, b) => b[0] - a[0]);
    allEv = ev;
    news();
  }
  function news() {
    const box = $('news');
    if (!box || !L || !L.news) return;
    const N = L.news, k = sd / dpr, x = (canvas.offsetLeft || 0) + N.x * k, y = (canvas.offsetTop || 0) + N.y * k;
    const n = newsOpen ? 10 : 3;
    const top = allEv.slice(0, n);
    const key = newsOpen + '|' + top.map((e) => e[0] + e[2]).join('|');
    box.className = newsOpen ? 'open' : '';
    // 접으면 게시판 코르크판 안에, 펼치면 게시판 오른쪽 위에 맞춰 넓은 종이로
    const w = newsOpen ? Math.max(320, N.w * k) : N.w * k;
    box.style.width = w + 'px';
    box.style.left = (newsOpen ? x + N.w * k - w : x) + 'px';
    box.style.top = y + 'px';
    box.style.height = newsOpen ? 'auto' : N.h * k + 'px';
    $('newsTog').textContent = newsOpen ? '▴ 접기' : '▾ 10줄';
    if (key === lastNews) return;
    lastNews = key;
    $('newsList').innerHTML = top.length ? top.map((e) => {
      const id = e[0] + e[2], fresh = seenNews.size && !seenNews.has(id);
      return `<div class="${fresh ? 'new' : ''}"><time>${hhmm(e[0])}</time><i>${esc(e[1])}</i>${esc(e[2])}</div>`;
    }).join('') : '<div>아직 소식이 없어요</div>';
    for (const e of allEv.slice(0, 30)) seenNews.add(e[0] + e[2]);
  }
  $('news').addEventListener('click', () => { newsOpen = !newsOpen; news(); });

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
      <div class="note">▶ 다시 보기: Claude Code 옆 패널에서 「📋 보고서 · ▶ 다시 보기」 를 누르면 방금 일이 4배 빠르게 다시 돌아요 — 이 화면에도 같이 보여요 (토큰 0).</div>`;
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
    <div class="row"><b>직원을 누르면</b>오른쪽에 「지금 화면」 — 실행 중인 명령 · 고치는 파일 · 방금 한 일.</div>
    <div class="row"><b>📚 책장</b>내 스킬 목록과 한 줄 설명. 스킬을 쓰면 담당 직원이 책을 꺼내 와 읽어요.</div>
    <div class="row"><b>📋 게시판</b>사무실 소식 최근 3줄, 누르면 10줄.</div>
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
    } else {
      const u = (snap.units || []).find((x) => x.key === sel);
      if (!u) { el.hidden = true; return; }
      const members = u.members.map((m) => (o.workers || []).find((w) => w.id === m.id)).filter(Boolean);
      const w = members.slice().reverse().find((x) => x.ended == null) || members[members.length - 1];
      head = u.key; kind = `에이전트 종류: ${[...new Set(members.map((x) => x.role))].join(', ')}`; look = lookOf(u.job); who = w;
      if (w) {
        rows.push(screen(w, ''));
        row('지금', w.status === 'done' ? `보고 완료 · ${ago(now - (w.ended || now))} 전` : `${esc(w.action)} · ${ago(now - w.since)}째`);
        if (w.task) row('맡은 일', `${esc(w.task)} <span style="color:#8a7f74">(팀장이 맡김)</span>`);
        row('피로도', gauge(pw.workers && pw.workers[w.id]));
        { const wp = pctOf(pw.workers && pw.workers[w.id]);
          if (wp != null && wp >= 70) rows.push('<div class="note">대화가 많이 찼어요. 남은 일은 새 직원에게 나눠 맡기면 덜 피곤해요. 이 직원은 팀장과 따로 자기 대화를 들고 일해서, 일이 끝나면 이 대화는 버려지고 다음 직원은 0% 부터 시작해요.</div>'); }
        let tot = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
        for (const x of members) { const t = pw.byWorker && pw.byWorker[x.id]; if (t) tot = { input: tot.input + t.input, cacheRead: tot.cacheRead + t.cacheRead, cacheWrite: tot.cacheWrite + t.cacheWrite, output: tot.output + t.output }; }
        if (sumT(tot)) row('전기세 몫', `${man(sumT(tot))} · ${parts(tot)}<br><span style="color:#8a7f74">실제 AI 직원이라 따로 대화를 들고 일해요. 직원이 많을수록 전기세가 더 나와요.</span>`);
        if (w.handback) rows.push(`<div class="paper">넘긴 서류: 「${esc(w.handback)}」</div>`);
        if (w.error) rows.push(`<div class="paper err">⚠ 실패: ${esc(w.error)}</div>`);
        if (u.team) {
          const state = (x) => (x.status === 'done' ? '보고 완료 ✓' : x.status === 'unfinished' ? '못 끝냄' : x.ended != null ? '퇴근' : x.action);
          row(`팀원 ${members.length}명`, list(members.slice().reverse().map((x, i) => `<li class="${x.ended != null ? 'dim' : ''}"><b>${esc(x.member || members.length - i)}</b> ${esc(state(x))} — ${esc(x.task || '')}${x.handback ? `<br>　서류 「${esc(x.handback.slice(0, 60))}」` : ''}</li>`)));
        }
        if (w.recent.length) row('한 일', list(w.recent.slice(0, 10).map(([t2, x]) => `<li><time>${hhmm(t2)}</time>${esc(x)}</li>`)));
      }
    }
    rows.push('<div class="note">말 걸기는 Claude Code 옆 패널에서 이 직원을 눌러서 해요 (보낼 때만 토큰이 들어요).</div>');
    $('cardBody').innerHTML = `<div class="who"><canvas id="cardFace" width="48" height="64"></canvas><div><h2>${esc(head)}</h2><div class="kind">${esc(kind)}</div></div></div>${rows.join('')}`;
    const f = $('cardFace'), fc = f && f.getContext('2d');
    if (fc) { fc.imageSmoothingEnabled = false; fc.clearRect(0, 0, 48, 64); fc.drawImage(S.get(look, { pose: who ? poseOf(who, false) : 'idle', frame: Math.floor(now / 350), expr: 'normal' }), 0, 0); }
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
  const refit = () => { if (snap && snap.office) fit(); };
  canvas.addEventListener('click', (ev) => {
    const h = hitAt(ev);
    if (h && h.key === '__news') { newsOpen = !newsOpen; news(); return; }
    const was = !!sel; sel = h ? h.key : null; card(); if (was !== !!sel) refit();
  });
  canvas.addEventListener('mousemove', (ev) => { const h = hitAt(ev); if ((h && h.key) !== hover) { hover = h && h.key; canvas.classList.toggle('hand', !!h); } });
  $('close').addEventListener('click', () => { sel = null; card(); refit(); });
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
      if (qs.get('news') === 'open') newsOpen = true;
    }
    $('empty').hidden = !!(snap && snap.office);
    if (snap && snap.office) {
      // 자리 수가 바뀌면 배율부터 다시, 아니면 같은 폭으로 자리만 새로 (깜빡이지 않게)
      const now = (snap.units || []).map((u) => u.key).join('|');
      if (!L || now !== sig) { sig = now; fit(); try { render(Date.now()); } catch (e) { /* 다음 장면에 */ } } else L = layout(L.W);
    }
    hud();
    if (sel && sel !== 'main' && !sel.startsWith('__') && !(snap.units || []).some((u) => u.key === sel)) sel = null; // __ 로 시작 = 책장 · 보고서 · 명부 · 도움말 카드
    if (sel === '__report' && !snap.report) sel = null;
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
  window.__termimates = { layout: (W) => layout(W), take, motionOf: (s, now) => motionOf(snap.office, s, now), world: () => world, select: (k) => { sel = k; card(); return $('cardBody').innerHTML; }, news: (open) => { newsOpen = open; lastNews = ''; news(); return $('newsList').innerHTML; } };
})();
