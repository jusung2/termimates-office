/* termimates 캐릭터: 48×64 픽셀, 부품 조합식.
 * 얼굴·머리·옷·팔·소품을 한 번씩 그려 두고 섞는다. 픽셀 데이터는 전부 이 파일 안에 있다(외부 그림 없음).
 * 직군을 늘릴 땐 LOOKS 에 한 줄 추가(머리 모양·옷·소품 부품 이름 + 색).
 * 마지막에 자동 외곽선(빈 칸 중 그림에 붙은 칸 = 진한 선)을 둘러 픽셀아트 느낌을 낸다.
 */
(function (root) {
  'use strict';
  const W = 48, H = 64, FOOT = 61;
  const OUT = '#2a2230';
  const SKIN = '#f6d2b4', SKIN_D = '#e2ad8c', BLUSH = '#f19c9c', EYE = '#2b2233', MOUTH = '#8e3b3b';
  const WHITE = '#ffffff', PAPER = '#fbfaf4', LINE = '#a7afb9', SHIRT = '#ecebe6';

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, v + amt));
    return '#' + ((1 << 24) | (f(n >> 16) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255)).toString(16).slice(1);
  }

  // 직군별 생김새 (samples/characters-v1.png 분위기 기준)
  const LOOKS = {
    lead:       { hair: 'spiky',  hc: ['#6b4430', '#93633f', '#4a2d1f'], top: 'shirt',    topc: SHIRT,     tie: '#8b2a2a', lanyard: '#2f4a6b', belt: true,
                  bottom: 'pants', bc: '#30344a', shoe: '#4a3226', prop: 'mug' },
    planner:    { hair: 'bun',    hc: ['#8a5532', '#b07445', '#663c20'], clip: '#f2c94c', top: 'cardigan', topc: '#d9bc8c',
                  bottom: 'skirt', bc: '#5a4033', socks: '#ece6da', shoe: '#4a3226', prop: 'clipboard' },
    designer:   { hair: 'bob',    hc: ['#a8605a', '#c88078', '#80443f'], beret: '#8a2f35', earring: '#e0b030', top: 'sweater', topc: '#efe3cc',
                  apron: '#5c3b30', bottom: 'skirt', bc: '#5c3b30', socks: '#ece6da', shoe: '#4a3226', prop: 'tablet' },
    developer:  { hair: 'messy',  hc: ['#262a3a', '#414867', '#14161f'], top: 'hoodie',   topc: '#34466e', phones: '#34343b',
                  bottom: 'cargo', bc: '#6b6b45', shoe: '#e6e6e6', prop: 'laptop' },
    qa:         { hair: 'long',   hc: ['#3e4a2e', '#5b6b44', '#29311e'], top: 'vest',     topc: SHIRT,     vest: '#5f7a3a', lanyard: '#3a5a2a',
                  bottom: 'pants', bc: '#6a4630', shoe: '#4a3226', prop: 'magnifier' },
    researcher: { hair: 'fluffy', hc: ['#b09a78', '#d2c09e', '#8a7656'], glasses: true, top: 'vest', topc: SHIRT, vest: '#6e4b33',
                  bottom: 'pants', bc: '#2e3140', shoe: '#3a2a20', prop: 'books' },
    // 사장님 (사장님 지시를 들고 오는 사람): 짙은 정장 · 흰 셔츠 · 빨간 넥타이 · 회색 머리
    boss:       { hair: 'short',  hc: ['#7d828c', '#a5aab3', '#5a5e66'], top: 'suit', topc: '#2a3142', tie: '#b52a2a',
                  bottom: 'pants', bc: '#2a3142', shoe: '#18181b', prop: null },
    guest:      { hair: 'short',  hc: ['#55504a', '#77716a', '#3b3733'], top: 'coat',     topc: '#7d8fa6', scarf: '#c0504d',
                  bottom: 'pants', bc: '#3a3f4a', shoe: '#2e2e33', prop: null },
  };

  // ---------- 픽셀 도구 ----------
  const newBuf = () => new Array(W * H).fill(null);
  function P(b, x, y, c) { if (c && x >= 0 && x < W && y >= 0 && y < H) b[y * W + x] = c; }
  function R(b, x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) P(b, x + i, y + j, c); }
  function PTS(b, pts, c) { for (const p of pts) P(b, p[0], p[1], c); }
  function disc(b, cx, cy, r, c) {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.6) P(b, cx + x, cy + y, c);
  }

  // ---------- 얼굴 ----------
  const FACE_INSET = { 11: 4, 12: 3, 13: 2, 29: 2, 30: 3, 31: 5 };
  function faceShape(b, c) {
    for (let y = 11; y <= 31; y++) {
      const k = FACE_INSET[y] !== undefined ? FACE_INSET[y] : 1;
      R(b, 12 + k, y, 24 - 2 * k, 1, c);
    }
  }
  function face(b, L, expr) {
    faceShape(b, SKIN);
    R(b, 12, 19, 1, 5, SKIN); R(b, 35, 19, 1, 5, SKIN);           // 귀
    P(b, 12, 21, SKIN_D); P(b, 35, 21, SKIN_D);
    R(b, 21, 32, 6, 2, SKIN_D);                                    // 목
    const ring = '#b78fa6';
    switch (expr) {
      case 'happy':
        PTS(b, [[16, 21], [17, 20], [18, 20], [19, 21], [28, 21], [29, 20], [30, 20], [31, 21]], EYE); break;
      case 'sleep':
        R(b, 16, 21, 4, 1, EYE); R(b, 28, 21, 4, 1, EYE); break;
      case 'yawn':
        R(b, 16, 21, 4, 1, EYE); R(b, 28, 21, 4, 1, EYE); R(b, 17, 23, 2, 1, ring); R(b, 29, 23, 2, 1, ring); break;
      case 'tired':
        R(b, 16, 20, 4, 1, EYE); R(b, 28, 20, 4, 1, EYE); R(b, 17, 21, 2, 2, EYE); R(b, 29, 21, 2, 2, EYE);
        R(b, 16, 23, 4, 1, ring); R(b, 28, 23, 4, 1, ring); break;
      case 'exhausted':
        PTS(b, [[17, 20], [18, 21], [17, 22], [30, 20], [29, 21], [30, 22]], EYE);
        R(b, 16, 23, 4, 1, ring); R(b, 28, 23, 4, 1, ring); break;
      default:
        R(b, 17, 20, 2, 3, EYE); R(b, 29, 20, 2, 3, EYE); P(b, 18, 20, WHITE); P(b, 30, 20, WHITE);
    }
    if (expr !== 'exhausted' && expr !== 'tired') { R(b, 15, 24, 2, 1, BLUSH); R(b, 31, 24, 2, 1, BLUSH); }
    switch (expr) {
      case 'happy': R(b, 22, 26, 4, 1, MOUTH); R(b, 23, 27, 2, 1, MOUTH); break;
      case 'flat': R(b, 22, 27, 4, 1, MOUTH); break;
      case 'yawn': R(b, 23, 25, 2, 1, '#6e2630'); R(b, 22, 26, 4, 2, '#6e2630'); R(b, 23, 28, 2, 1, '#6e2630'); break;
      case 'worried': case 'exhausted': case 'tired': PTS(b, [[22, 27], [23, 26], [24, 26], [25, 27]], MOUTH); break;
      case 'sleep': R(b, 23, 27, 2, 1, MOUTH); break;
      default: PTS(b, [[22, 26], [23, 27], [24, 27], [25, 26]], MOUTH);
    }
    if (L.glasses) {
      const g = '#3b3340';
      R(b, 16, 18, 4, 1, g); R(b, 16, 23, 4, 1, g); R(b, 15, 19, 1, 4, g); R(b, 20, 19, 1, 4, g);
      R(b, 28, 18, 4, 1, g); R(b, 28, 23, 4, 1, g); R(b, 27, 19, 1, 4, g); R(b, 32, 19, 1, 4, g);
      R(b, 21, 20, 6, 1, g); P(b, 13, 20, g); P(b, 14, 20, g); P(b, 33, 20, g); P(b, 34, 20, g);
    }
    if (L.earring) { R(b, 12, 24, 1, 2, L.earring); R(b, 35, 24, 1, 2, L.earring); }
  }

  // ---------- 머리카락 ----------
  // bang: x=13..34 각 칸의 앞머리 끝 y. side: 옆머리 끝 y.
  const HAIR = {
    spiky:  { top: 4, side: 18, bang: [19, 18, 16, 17, 15, 16, 14, 16, 15, 13, 15, 16, 14, 15, 16, 14, 15, 16, 15, 17, 18, 19],
              extra: [[14, 3], [15, 3], [15, 2], [19, 3], [20, 2], [20, 3], [26, 3], [27, 2], [27, 3], [31, 3], [32, 3], [33, 4], [34, 5],
                      [10, 9], [10, 10], [37, 9], [37, 10]] },
    messy:  { top: 4, side: 20, bang: [19, 18, 17, 16, 17, 15, 17, 16, 14, 17, 16, 15, 17, 16, 14, 16, 17, 15, 16, 17, 18, 19],
              extra: [[13, 3], [14, 2], [15, 3], [18, 2], [19, 1], [20, 2], [23, 2], [24, 1], [25, 2], [28, 2], [29, 1], [30, 3],
                      [33, 3], [34, 4], [35, 5], [10, 8], [10, 9], [10, 10], [10, 11], [37, 8], [37, 9], [37, 10], [37, 11]] },
    bun:    { top: 5, side: 27, bang: [18, 17, 16, 16, 15, 15, 14, 14, 14, 13, 13, 13, 13, 14, 14, 15, 15, 16, 16, 17, 19, 22],
              extra: [[10, 22], [10, 23], [10, 24], [10, 25], [37, 22], [37, 23], [37, 24], [37, 25], [37, 26]] },
    bob:    { top: 6, side: 28, bang: [20, 19, 17, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 17, 19, 20],
              extra: [[10, 26], [10, 27], [37, 26], [37, 27]] },
    long:   { top: 5, side: 28, bang: [21, 19, 17, 16, 16, 17, 16, 16, 17, 16, 16, 16, 16, 17, 16, 16, 17, 16, 16, 17, 19, 21], extra: [] },
    fluffy: { top: 4, side: 20, bang: [18, 17, 16, 15, 16, 15, 14, 15, 16, 15, 14, 15, 16, 15, 14, 15, 16, 15, 16, 17, 17, 18],
              extra: [[13, 4], [12, 5], [11, 6], [16, 3], [17, 3], [22, 3], [23, 3], [24, 3], [29, 3], [30, 3], [34, 4], [35, 5], [36, 6],
                      [10, 12], [10, 13], [37, 12], [37, 13]] },
    short:  { top: 5, side: 17, bang: [17, 16, 15, 14, 14, 14, 14, 13, 13, 13, 13, 13, 13, 13, 13, 14, 14, 14, 15, 15, 16, 17], extra: [] },
  };
  const CAP_HW = [8, 10, 11, 12];

  function hair(b, L, back) {
    const s = HAIR[L.hair] || HAIR.short, c = L.hc;
    for (let y = s.top; y <= 11; y++) {
      const k = y - s.top, hw = k < CAP_HW.length ? CAP_HW[k] : 12.5;
      const x0 = Math.ceil(23.5 - hw), x1 = Math.floor(23.5 + hw);
      R(b, x0, y, x1 - x0 + 1, 1, c[0]);
    }
    if (back) {
      faceShape(b, c[0]);
      R(b, 15, 29, 18, 2, c[2]);
    } else {
      s.bang.forEach((by, i) => { for (let y = 12; y <= by; y++) P(b, 13 + i, y, c[0]); P(b, 13 + i, by, c[2]); });
    }
    R(b, 11, 12, 2, s.side - 11, c[0]); R(b, 35, 12, 2, s.side - 11, c[0]);
    P(b, 11, s.side, c[2]); P(b, 12, s.side, c[2]); P(b, 35, s.side, c[2]); P(b, 36, s.side, c[2]);
    PTS(b, s.extra, c[0]);
    R(b, 16, s.top + 2, 5, 1, c[1]); R(b, 15, s.top + 3, 2, 1, c[1]); P(b, 22, s.top + 2, c[1]); R(b, 27, s.top + 3, 3, 1, c[1]);
    if (L.hair === 'bun') {
      disc(b, 30, 4, 4, c[0]); R(b, 28, 2, 3, 1, c[1]); P(b, 33, 6, c[2]);
      if (!back) PTS(b, [[15, 13], [17, 13], [16, 14], [15, 15], [17, 15]], L.clip);
    }
    if (L.hair === 'long') {               // 오른쪽으로 땋은 머리 + 흰 끈
      R(b, 37, 18, 3, 12, c[0]); R(b, 38, 30, 2, 3, c[0]); P(b, 38, 33, c[2]);
      for (let y = 20; y < 30; y += 3) P(b, 38, y, c[2]);
      R(b, 36, 16, 2, 3, '#f0ede4');
    }
    if (L.beret) {
      const bc = L.beret, rows = [[15, 30], [13, 33], [12, 35], [11, 36], [11, 36], [12, 35]];
      rows.forEach((r, i) => R(b, r[0], 2 + i, r[1] - r[0] + 1, 1, i === 5 ? shade(bc, -25) : bc));
      P(b, 23, 1, bc); P(b, 24, 1, bc); R(b, 15, 3, 4, 1, shade(bc, 30));
    }
  }

  // ---------- 몸·옷 ----------
  function torso(b, L, back) {
    const t = L.topc, dk = shade(t, -26);
    R(b, 15, 33, 18, 1, t); R(b, 14, 34, 20, 13, t);
    if (back) {
      if (L.top === 'hoodie') R(b, 17, 33, 14, 5, dk);
      if (L.vest) R(b, 15, 35, 18, 12, L.vest);
      if (L.apron) { R(b, 17, 33, 2, 14, L.apron); R(b, 29, 33, 2, 14, L.apron); }
      if (L.scarf) R(b, 16, 33, 16, 3, L.scarf);
      return;
    }
    switch (L.top) {
      case 'shirt':
        R(b, 14, 34, 1, 13, '#d8d6cf');
        R(b, 23, 34, 2, 10, L.tie); R(b, 23, 33, 2, 1, shade(L.tie, -30)); P(b, 23, 44, shade(L.tie, -20)); P(b, 24, 44, shade(L.tie, -20));
        PTS(b, [[20, 33], [21, 34], [27, 33], [26, 34]], WHITE);
        break;
      case 'cardigan':
        R(b, 21, 33, 6, 14, '#f3efe6'); R(b, 20, 34, 1, 13, dk); R(b, 27, 34, 1, 13, dk);
        PTS(b, [[20, 38], [20, 42]], '#7a5a3a'); R(b, 15, 43, 4, 2, dk); R(b, 29, 43, 4, 2, dk);
        PTS(b, [[21, 33], [26, 33]], WHITE); R(b, 22, 44, 4, 3, '#dfe6ee');
        break;
      case 'sweater':
        for (let y = 34; y < 47; y += 2) for (let x = 14 + (y % 4 ? 1 : 0); x < 34; x += 3) P(b, x, y, shade(t, -12));
        R(b, 17, 33, 2, 6, L.apron); R(b, 29, 33, 2, 6, L.apron); R(b, 17, 39, 14, 8, L.apron);
        break;
      case 'hoodie':
        R(b, 15, 33, 18, 2, dk); R(b, 21, 35, 1, 5, '#e8e8e8'); R(b, 26, 35, 1, 5, '#e8e8e8'); R(b, 18, 42, 12, 4, dk);
        break;
      case 'vest':
        R(b, 14, 34, 1, 13, '#d8d6cf');
        R(b, 15, 35, 18, 12, L.vest);
        for (let d = 0; d <= 4; d++) { const g = 4 - d; R(b, 23 - g, 35 + d, 2 + 2 * g, 1, t); }
        if (L.hair === 'long') for (let y = 41; y < 47; y += 2) for (let x = 16; x < 32; x += 3) P(b, x, y, shade(L.vest, -14));
        else PTS(b, [[23, 41], [23, 44]], '#2b2233');
        PTS(b, [[20, 33], [21, 34], [27, 33], [26, 34]], WHITE);
        break;
      case 'suit': {
        R(b, 21, 33, 6, 9, '#f5f3ee');                                          // 흰 셔츠
        R(b, 23, 34, 2, 9, L.tie); R(b, 23, 33, 2, 1, shade(L.tie, -30)); P(b, 23, 43, shade(L.tie, -20)); P(b, 24, 43, shade(L.tie, -20));
        PTS(b, [[20, 33], [20, 34], [21, 35], [21, 36], [22, 37], [22, 38], [22, 39],
          [27, 33], [27, 34], [26, 35], [26, 36], [25, 37], [25, 38], [25, 39]], dk);  // 깃
        R(b, 23, 44, 1, 1, '#c9a14a'); R(b, 23, 46, 1, 1, '#c9a14a');             // 단추
        R(b, 28, 37, 3, 1, '#f5f3ee'); P(b, 29, 36, '#f5f3ee');                    // 손수건
        R(b, 14, 34, 1, 13, dk);
        break;
      }
      case 'coat':
        R(b, 14, 47, 20, 3, t); R(b, 16, 33, 16, 3, L.scarf); R(b, 26, 36, 3, 6, L.scarf);
        PTS(b, [[21, 40], [21, 44]], '#2b2233'); R(b, 23, 36, 1, 14, dk);
        break;
    }
    if (L.lanyard) {
      PTS(b, [[19, 34], [19, 35], [20, 36], [20, 37], [21, 38], [21, 39], [28, 34], [28, 35], [27, 36], [27, 37], [26, 38], [26, 39]], L.lanyard);
      R(b, 21, 40, 6, 4, '#dfe6ee'); R(b, 22, 41, 4, 1, '#4a7ab5');
    }
    if (L.belt) { R(b, 14, 46, 20, 1, '#3a2c25'); R(b, 23, 46, 2, 1, '#c9a14a'); }
    if (L.phones) {
      R(b, 14, 32, 4, 4, L.phones); R(b, 30, 32, 4, 4, L.phones);
      R(b, 15, 33, 2, 2, '#5a5a62'); R(b, 31, 33, 2, 2, '#5a5a62');
    }
  }

  function legs(b, L, lf, rf) {
    const bc = L.bottom === 'skirt' ? L.bc : L.bc, sh = L.shoe, sole = shade(sh, -40);
    if (L.bottom === 'skirt') {
      R(b, 14, 47, 20, 2, bc); R(b, 13, 49, 22, 3, bc); R(b, 13, 52, 22, 1, shade(bc, -22));
      R(b, 17, 53, 5, 4 - lf, SKIN); R(b, 26, 53, 5, 4 - rf, SKIN);
      R(b, 17, 56 - lf, 5, 2, L.socks); R(b, 26, 56 - rf, 5, 2, L.socks);
      R(b, 16, 58 - lf, 7, 2, sh); R(b, 16, 60 - lf, 7, 1, sole);
      R(b, 25, 58 - rf, 7, 2, sh); R(b, 25, 60 - rf, 7, 1, sole);
    } else {
      R(b, 16, 47, 16, 3, bc);
      R(b, 16, 50, 7, 8 - lf, bc); R(b, 25, 50, 7, 8 - rf, bc);
      R(b, 23, 47, 2, 3, shade(bc, -20));
      if (L.bottom === 'cargo') { R(b, 16, 51, 2, 4, shade(bc, -22)); R(b, 30, 51, 2, 4, shade(bc, -22)); }
      R(b, 15, 58 - lf, 8, 2, sh); R(b, 15, 60 - lf, 8, 1, sole);
      R(b, 25, 58 - rf, 8, 2, sh); R(b, 25, 60 - rf, 8, 1, sole);
      if (sh === '#e6e6e6') { R(b, 16, 58 - lf, 5, 1, '#9aa0a6'); R(b, 26, 58 - rf, 5, 1, '#9aa0a6'); }
    }
  }

  // ---------- 팔 ----------
  function arms(b, L, mode, frame) {
    const sl = L.top === 'vest' || L.top === 'shirt' ? SHIRT : L.topc, dk = shade(sl, -28);
    const left = () => { R(b, 10, 34, 4, 11, sl); R(b, 13, 35, 1, 9, dk); R(b, 10, 45, 4, 2, SKIN); };
    const rightDown = () => { R(b, 34, 34, 4, 11, sl); R(b, 34, 35, 1, 9, dk); R(b, 34, 45, 4, 2, SKIN); };
    switch (mode) {
      case 'hold': case 'type': {
        const y = mode === 'type' ? 41 : 40, hh = mode === 'type' ? 2 : 3;
        R(b, 11, 34, 3, 7, sl); R(b, 12, y, 5, hh, sl);
        R(b, 34, 34, 3, 7, sl); R(b, 31, y, 5, hh, sl);
        return;
      }
      case 'hand': left(); R(b, 34, 34, 3, 3, sl); R(b, 36, 35, 7, 3, sl); R(b, 36, 37, 7, 1, dk); return;
      case 'raise': case 'mug': case 'thumb': left(); R(b, 34, 34, 3, mode === 'mug' ? 5 : 4, sl); return;
      default: left(); rightDown();
    }
  }
  // 손은 소품 위에 그린다(소품을 잡은 모습)
  function hands(b, mode, frame) {
    if (mode === 'hold') { R(b, 16, 40, 3, 3, SKIN); R(b, 29, 40, 3, 3, SKIN); }
    if (mode === 'type') {
      const o = frame % 2;
      R(b, 16, 41 - o, 3, 2, SKIN); R(b, 29, 40 + o, 3, 2, SKIN);
    }
    if (mode === 'hand') R(b, 43, 35, 3, 3, SKIN);
  }
  // 얼굴·머리 위로 올라오는 팔(손 들기, 커피, 엄지척)
  function upperArm(b, L, mode, frame) {
    const sl = L.top === 'vest' || L.top === 'shirt' ? SHIRT : L.topc;
    if (mode === 'raise') { R(b, 35, 22, 3, 12, sl); R(b, 35, 18, 3, 4, SKIN); P(b, 34, 19, SKIN); }
    if (mode === 'thumb') { R(b, 35, 29, 3, 6, sl); R(b, 35, 26, 4, 3, SKIN); R(b, 36, 23, 2, 3, SKIN); }
    if (mode === 'mug') {
      R(b, 32, 30, 4, 5, sl);
      R(b, 27, 25, 5, 5, '#f4f1ea'); R(b, 27, 25, 5, 1, '#d9d3c4'); PTS(b, [[32, 26], [32, 27], [32, 28]], '#f4f1ea');
      R(b, 31, 28, 3, 3, SKIN);
      steam(b, 28, 21, frame);
    }
  }
  function steam(b, x, y, frame) {
    const s = '!#d9dee8';
    if (frame % 2) PTS(b, [[x, y + 2], [x + 1, y + 1], [x, y], [x + 2, y + 2]], s);
    else PTS(b, [[x + 1, y + 2], [x, y + 1], [x + 1, y], [x + 3, y + 1]], s);
  }

  // ---------- 소품 ----------
  function prop(b, name, frame) {
    switch (name) {
      case 'mug':
        R(b, 35, 41, 6, 6, '#f4f1ea'); R(b, 35, 41, 6, 1, '#d9d3c4'); PTS(b, [[41, 42], [41, 43], [41, 44]], '#f4f1ea');
        R(b, 34, 44, 3, 3, SKIN); steam(b, 36, 37, frame); return;
      case 'clipboard':
        R(b, 15, 34, 18, 13, '#8a5a3a'); R(b, 17, 36, 14, 10, PAPER); R(b, 21, 33, 6, 2, '#b9bec6');
        R(b, 19, 38, 9, 1, LINE); R(b, 19, 40, 10, 1, LINE); R(b, 19, 42, 7, 1, LINE); return;
      case 'tablet':
        R(b, 15, 36, 18, 11, '#2d2f38'); R(b, 16, 37, 16, 8, '#59657a'); R(b, 17, 38, 4, 1, '#7b89a1');
        PTS(b, [[12, 32], [13, 33], [14, 34], [15, 35]], '#262626'); P(b, 11, 31, '#e86a8a');
        R(b, 13, 45, 2, 3, '#7a5040'); return;
      case 'laptop':
        R(b, 14, 35, 20, 11, '#8d939d'); R(b, 14, 35, 20, 1, '#a9afb8');
        PTS(b, [[22, 38], [26, 38]], '#d7dbe1'); R(b, 22, 39, 5, 3, '#d7dbe1'); PTS(b, [[23, 40], [25, 40]], '#8d939d');
        R(b, 13, 46, 22, 2, '#6b717b'); return;
      case 'magnifier':
        R(b, 24, 34, 10, 13, PAPER); R(b, 27, 33, 4, 2, '#b9bec6');
        for (let k = 0; k < 3; k++) {
          const y = 37 + 3 * k;
          PTS(b, [[25, y + 1], [26, y + 2], [27, y + 1], [28, y]], '#3f8f4a'); R(b, 29, y + 1, 3, 1, LINE);
        }
        R(b, 11, 30, 5, 1, '#8a9bb0'); R(b, 11, 36, 5, 1, '#8a9bb0'); R(b, 10, 31, 1, 5, '#8a9bb0'); R(b, 16, 31, 1, 5, '#8a9bb0');
        R(b, 11, 31, 5, 5, '#cfe9f7'); P(b, 12, 32, WHITE); PTS(b, [[16, 37], [17, 38], [17, 39]], '#7a5236'); return;
      case 'books':
        R(b, 15, 35, 18, 4, '#3d5a99'); R(b, 16, 39, 17, 4, '#9c3b34'); R(b, 15, 43, 18, 4, '#3f6b45');
        R(b, 31, 36, 1, 2, '#ece6d6'); R(b, 31, 40, 1, 2, '#ece6d6'); R(b, 31, 44, 1, 2, '#ece6d6');
        R(b, 18, 35, 1, 4, '#2d4477'); R(b, 19, 39, 1, 4, '#7a2c27'); R(b, 18, 43, 1, 4, '#2f5134'); return;
      case 'openbook':
        R(b, 14, 38, 20, 8, '#7a4b2e'); R(b, 15, 38, 8, 7, PAPER); R(b, 25, 38, 8, 7, PAPER); R(b, 23, 38, 2, 7, '#d9d2c0');
        R(b, 16, 40, 6, 1, LINE); R(b, 26, 40, 6, 1, LINE); R(b, 16, 42, 5, 1, LINE); R(b, 26, 42, 5, 1, LINE); return;
      case 'book1':
        R(b, 18, 36, 12, 10, '#5b4a9a'); R(b, 28, 37, 1, 8, '#ece6d6'); R(b, 20, 39, 6, 2, '#f2c94c'); return;
      case 'card':
        R(b, 18, 36, 12, 9, '#f7e08a'); R(b, 20, 38, 8, 1, '#b39a3a'); R(b, 20, 40, 6, 1, '#b39a3a'); return;
      case 'red': case 'doc':
        R(b, 18, 34, 12, 13, PAPER); R(b, 20, 37, 8, 1, LINE); R(b, 20, 39, 8, 1, LINE); R(b, 20, 41, 6, 1, LINE);
        if (name === 'red') { R(b, 23, 42, 6, 4, '#d04848'); R(b, 24, 43, 4, 2, '#f3c1c1'); }
        return;
    }
  }
  function handDoc(b, carry) {               // 옆으로 내민 서류
    const c = carry === 'card' ? '#f7e08a' : PAPER;
    R(b, 41, 28, 7, 10, c); R(b, 42, 30, 5, 1, LINE); R(b, 42, 32, 5, 1, LINE);
    if (carry === 'red') { R(b, 42, 33, 5, 3, '#d04848'); }
  }

  // ---------- 조합 ----------
  function plan(L, pose, carry) {
    switch (pose) {
      case 'carry': return { arms: 'hold', prop: carry === 'book' ? 'book1' : (carry || 'doc') };
      case 'hand': return { arms: 'hand', handDoc: carry || 'doc' };
      case 'type': return { arms: 'type' };
      case 'typeStand': return { arms: 'hold', prop: 'laptop' };
      case 'read': return { arms: 'hold', prop: 'openbook' };
      case 'coffee': return { arms: 'mug' };
      case 'raise': return { arms: 'raise' };
      case 'thumb': return { arms: 'thumb' };
      case 'sleep': return { arms: 'down' };
      default:
        if (L.prop === 'mug') return { arms: 'down', prop: 'mug' };
        return L.prop ? { arms: 'hold', prop: L.prop } : { arms: 'down' };
    }
  }

  function compose(lookName, o) {
    o = o || {};
    const L = LOOKS[lookName] || LOOKS.guest;
    const pose = o.pose || 'idle', frame = o.frame || 0, back = o.facing === 'back';
    const p = plan(L, pose, o.carry);
    const walking = pose === 'walk' || pose === 'carry';
    const lf = walking && frame % 4 === 1 ? 1 : 0, rf = walking && frame % 4 === 3 ? 1 : 0;
    const b = newBuf();
    legs(b, L, lf, rf);
    torso(b, L, back);
    arms(b, L, back ? 'down' : p.arms, frame);
    if (!back) {
      if (p.prop) prop(b, p.prop, frame);
      if (p.handDoc) handDoc(b, p.handDoc);
      hands(b, p.arms, frame);
      face(b, L, o.expr || 'normal');
    }
    hair(b, L, back);
    if (!back) upperArm(b, L, p.arms, frame);
    if (pose === 'sweat' || o.sweat) { P(b, 38, 12, '#8fd3ff'); R(b, 37, 13, 3, 2, '#8fd3ff'); P(b, 38, 15, '#8fd3ff'); P(b, 37, 13, WHITE); }
    return outline(b);
  }

  function outline(b) {
    const out = b.slice();
    const solid = (x, y) => x >= 0 && x < W && y >= 0 && y < H && b[y * W + x] && b[y * W + x][0] !== '!';
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (b[y * W + x]) continue;
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) out[y * W + x] = OUT;
    }
    for (let i = 0; i < out.length; i++) if (out[i] && out[i][0] === '!') out[i] = out[i].slice(1);
    return out;
  }

  function frameKey(pose, frame) {
    if (pose === 'walk' || pose === 'carry') return frame % 4;
    if (pose === 'type' || pose === 'coffee' || pose === 'idle' || pose === 'sweat') return frame % 2;
    return 0;
  }

  const cache = new Map();
  function get(look, o) {
    o = o || {};
    const fk = frameKey(o.pose || 'idle', o.frame || 0);
    const key = [look, o.pose, fk, o.expr, o.facing === 'back' ? 'b' : 'f', o.carry, o.sweat ? 1 : 0].join('|');
    let c = cache.get(key);
    if (c) return c;
    if (cache.size > 1500) cache.clear();
    const px = compose(look, Object.assign({}, o, { frame: fk }));
    c = document.createElement('canvas');
    c.width = W; c.height = H;
    const cx = c.getContext('2d');
    const img = cx.createImageData(W, H);
    for (let i = 0; i < px.length; i++) {
      if (!px[i]) continue;
      const n = parseInt(px[i].slice(1), 16);
      img.data[i * 4] = n >> 16; img.data[i * 4 + 1] = (n >> 8) & 255; img.data[i * 4 + 2] = n & 255; img.data[i * 4 + 3] = 255;
    }
    cx.putImageData(img, 0, 0);
    cache.set(key, c);
    return c;
  }

  const api = { W, H, FOOT, LOOKS, compose, get, shade };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sprites = api;
})(typeof window !== 'undefined' ? window : globalThis);
