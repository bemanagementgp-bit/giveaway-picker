/* Giveaway Picker – Instagram comment picker. Vanilla JS, everything runs in the browser. */
(function () {
  'use strict';
  const C = window.APP_CONFIG || {};
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const FONT = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const STATE_KEY = 'giveaway_state_v1', HIST_KEY = 'giveaway_history_v1', TOKEN_KEY = 'giveaway_ig_token';
  const FREE_MAX_USERS = 500, FREE_MAX_WINNERS = 3, PRO_MAX_WINNERS = 20, MAX_ALTERNATES = 5;
  const GRAPH = 'https://graph.facebook.com/v21.0/';

  // ---------- state ----------
  const DEF = {
    mode: 'paste', pasteText: '', uploaded: [], uploadName: '', manual: [], imported: [], importName: '',
    rules: { dedupe: true, mentions: 0, keyword: '', minLen: 0, exclude: [], owner: '', bots: true, bonus: '' },
    draw: { winners: 1, alternates: 1, anim: 'roulette', sound: false },
    postUrl: '', stageView: 'draw',
    cert: { format: 'square', bg1: '#f97316', bg2: '#7c3aed', accent: '#ffffff', logo: '' },
    excludePrev: false, result: null, sampleLoaded: false
  };
  const S = Studio.restore(STATE_KEY, DEF);
  // ---- restored state / history are untrusted (localStorage): enforce types, enums, lengths ----
  const MAX_ENTRIES = 200000;
  const str = (v, max) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').slice(0, max || 2000);
  const isHex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
  const cleanEntries = a => (Array.isArray(a) ? a : []).filter(e => e && typeof e === 'object').slice(0, MAX_ENTRIES).map(e => ({ user: str(e.user, 60), text: str(e.text, 2200) }));
  const cleanUsers = a => (Array.isArray(a) ? a : []).filter(u => typeof u === 'string').slice(0, 20000).map(u => u.slice(0, 60));
  function cleanResult(r) {
    if (!r || typeof r !== 'object' || !Array.isArray(r.winners)) return null;
    return {
      seed: /^[0-9a-f]{8,64}$/i.test(r.seed) ? r.seed : '', hash: /^[0-9a-f]{64}$/i.test(r.hash) ? r.hash : '',
      winners: cleanEntries(r.winners).slice(0, PRO_MAX_WINNERS), alternates: cleanEntries(r.alternates).slice(0, MAX_ALTERNATES),
      count: Math.max(0, Number(r.count) || 0), entries: Math.max(0, Number(r.entries) || 0), date: str(r.date, 40), postUrl: str(r.postUrl, 500)
    };
  }
  ['rules', 'draw', 'cert'].forEach(k => { S[k] = Studio.safeAssign({}, DEF[k], S[k] && typeof S[k] === 'object' ? S[k] : {}); });
  S.uploaded = cleanEntries(S.uploaded); S.imported = cleanEntries(S.imported); S.manual = cleanUsers(S.manual);
  S.rules.exclude = cleanUsers(S.rules.exclude);
  ['keyword', 'owner', 'bonus'].forEach(k => { S.rules[k] = str(S.rules[k], 200); });
  S.rules.dedupe = !!S.rules.dedupe; S.rules.bots = !!S.rules.bots;
  S.rules.mentions = clamp(parseInt(S.rules.mentions, 10) || 0, 0, 10); S.rules.minLen = clamp(parseInt(S.rules.minLen, 10) || 0, 0, 500);
  S.draw.winners = clamp(parseInt(S.draw.winners, 10) || 1, 1, PRO_MAX_WINNERS); S.draw.alternates = clamp(parseInt(S.draw.alternates, 10) || 0, 0, MAX_ALTERNATES);
  if (!['roulette', 'countdown', 'instant'].includes(S.draw.anim)) S.draw.anim = DEF.draw.anim;
  S.draw.sound = !!S.draw.sound;
  if (!['square', 'story'].includes(S.cert.format)) S.cert.format = DEF.cert.format;
  ['bg1', 'bg2', 'accent'].forEach(k => { if (!isHex(S.cert[k])) S.cert[k] = DEF.cert[k]; });
  if (!/^data:image\/png;base64,[a-z0-9+/=]+$/i.test(S.cert.logo || '')) S.cert.logo = '';
  ['pasteText'].forEach(k => { S[k] = str(S[k], 5 * 1024 * 1024); });
  ['uploadName', 'importName', 'postUrl'].forEach(k => { S[k] = str(S[k], 500); });
  if (!['draw', 'cert'].includes(S.stageView)) S.stageView = 'draw';
  S.result = cleanResult(S.result);
  if (!['paste', 'upload', 'manual', 'instagram'].includes(S.mode)) S.mode = 'paste';
  if (S.mode === 'instagram' && !isPro()) S.mode = 'paste';
  let history = Studio.safeParse(localStorage.getItem(HIST_KEY) || '[]', []);
  history = (Array.isArray(history) ? history : []).filter(h => h && typeof h === 'object').slice(0, 20).map(h => ({
    date: str(h.date, 40), hash: /^[0-9a-f]{64}$/i.test(h.hash) ? h.hash : '', seed: /^[0-9a-f]{8,64}$/i.test(h.seed) ? h.seed : '',
    winners: cleanUsers(h.winners).slice(0, PRO_MAX_WINNERS), alternates: cleanUsers(h.alternates).slice(0, MAX_ALTERNATES), count: Math.max(0, Number(h.count) || 0)
  }));
  let igToken = '';          // memory only unless "remember" is ticked
  let logoImg = null;        // decoded certificate logo (Pro)
  let drawing = false;
  let eligible = { users: [], entries: [], removed: {}, total: 0, truncated: 0 };
  let wasOverLimit = false;

  function save() { Studio.persist(STATE_KEY, S); }

  // ---------- sample data ----------
  const SAMPLE = `@maria.lopez Done!! @carla_g @juli.ferreyra 🙌 #giveaway
juan_perez: I want this so bad @pedro.ok @lucas_mdq
sofi.rt tagging my besties @ana.b @lu.ciana #giveaway #sorteo
@camila_vega participating! @nico.vega @fer_vega @abu.vega
pablo.dm: let's go 🙏 @marti.dm
@agus_torres Love your content ❤️ @vale_torres @tomi.torres
lau.gimenez: @cande.g @ro.gimenez fingers crossed 🤞
@mateo_ruiz done, following and shared to my story! @caro_r @ivan.ruiz #giveaway
nati_ba: @flor.ba @mica.ba @pau.ba 🍀
@seba.quiroga @ramiro.q @dani_quiroga I need this
flor.castro: Participo!! @belen.castro @eze_castro
@maria.lopez again because I want it SO much @carla_g @juli.ferreyra
@tomas.acosta @agus.acosta @lucho_acosta 🔥🔥
vicky.ramos: @ceci.ramos @gon.ramos love it #giveaway
@luz.benitez Love this!! 😍 I never win anything
@diego.ferro done ✅
@facu_nieto @mili.nieto @bruno.nieto done ✅
cande.ibarra: Me me me 🙋‍♀️ @sol.ibarra @clara_ibarra
@gaston.pintos @leo.pintos @meli_pintos participando #sorteo
luna_v: @estrella_v @cielo_v 🌙
@rocio.molina crossing fingers @jime.molina @male.molina
emi.sosa: this would be perfect for my mom @ana.sosa @cris.sosa
@nico.alvarez @juan.alvarez @marcos_alvarez #giveaway done
8392017364: WIN FREE IPHONE CLICK LINK IN BIO
free_giveaway_bot: Congratulations!! You won. Send DM to claim 🎁
@carla_g @maria.lopez @juli.ferreyra my turn 😂
marti.dm: @pablo.dm you tagged me so I tag you back 😜 @sofi.dm
@abril.paz @pili.paz @nati.paz 💛 #giveaway
ivan.ruiz: @mateo_ruiz @caro_r let's gooo
@pedro.ok counting on you @juan_perez @lucas_mdq
lucas_mdq: @pedro.ok @juan_perez haha ok @meli.mdq
@valen.cabrera @tati.cabrera @fran.cabrera #giveaway #sorteo
dani_quiroga: @seba.quiroga @ramiro.q done & shared to story
@mica.ba @nati_ba @flor.ba @pau.ba 🍀🍀
jime.molina: @rocio.molina @male.molina participando!
@ceci.ramos @vicky.ramos @gon.ramos 💜
cris.sosa: @emi.sosa @ana.sosa 🙏 #giveaway
@bruno.nieto @facu_nieto @mili.nieto yes please
sol.ibarra: @cande.ibarra @clara_ibarra 🤍
@leo.pintos @gaston.pintos @meli_pintos participo
estrella_v: @luna_v @cielo_v 🌟 #sorteo
@diego.ferro oops forgot to tag @ceci.ferro @mar.ferro
@male.molina @rocio.molina @jime.molina need it
ana.sosa: @emi.sosa @cris.sosa
@juan.alvarez @nico.alvarez @marcos_alvarez
marcos_alvarez: ok ok @nico.alvarez @juan.alvarez
@caro_r @mateo_ruiz @ivan.ruiz #giveaway
pili.paz: @abril.paz @nati.paz 💛💛
@tati.cabrera @valen.cabrera @fran.cabrera
fran.cabrera: @valen.cabrera @tati.cabrera participando
@gon.ramos @ceci.ramos @vicky.ramos
clara_ibarra: @sol.ibarra @cande.ibarra ✨ #giveaway
@meli_pintos @leo.pintos @gaston.pintos
cielo_v: @luna_v @estrella_v 🌙🌙
@belen.castro @flor.castro @eze_castro done
eze_castro: @flor.castro @belen.castro
@vale_torres @agus_torres @tomi.torres #giveaway
tomi.torres: @agus_torres @vale_torres 🔥
@ro.gimenez @lau.gimenez @cande.g
cande.g: @lau.gimenez @ro.gimenez 🤞
@lucho_acosta @tomas.acosta @agus.acosta participando
agus.acosta: @tomas.acosta @lucho_acosta
@sofi.dm nice giveaway! @marti.dm @pablo.dm #giveaway`;

  // ---------- parsing ----------
  const USER_RE = /^[a-z0-9._]{1,30}$/i;
  const NOISE_RE = /^(reply|responder|see translation|ver traducción|verified|verificado|hide replies|ocultar respuestas|view (all )?\d* ?repl(y|ies)|ver (las )?\d* ?respuestas?|\d+\s*(likes?|me gusta)|\d+\s*[smhdw]|\d+\s*(sec|min|h|d|w|y)|\d+\s*(seconds?|minutes?|hours?|days?|weeks?|years?)( ago)?|liked by .*|edited|editado|·)$/i;
  function cleanUser(u) { return String(u || '').trim().replace(/^@+/, '').replace(/[:,;!?.]+$/, '').toLowerCase(); }
  function parseOneLine(line) {
    line = line.trim(); if (!line) return null;
    let m = line.match(/^@?([A-Za-z0-9._]{1,30})\s*[:\-–—|]\s*(.*)$/);
    if (m) return { user: m[1].toLowerCase(), text: m[2].trim() };
    const sp = line.search(/\s/);
    const first = sp < 0 ? line : line.slice(0, sp), rest = sp < 0 ? '' : line.slice(sp + 1).trim();
    const u = cleanUser(first);
    if (!u) return null;
    if (!USER_RE.test(u)) return { user: u.replace(/[^a-z0-9._]/g, ''), text: rest, weak: true };
    return { user: u, text: rest };
  }
  function parseText(text) {
    const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(l => l && !NOISE_RE.test(l));
    if (!lines.length) return [];
    // Detect the instagram.com desktop layout: username on its own line, comment on the next line(s)
    const single = lines.filter(l => !/\s/.test(l) && USER_RE.test(cleanUser(l)) && !/^#/.test(l));
    const multi = lines.length - single.length;
    const blockMode = multi > 0 && single.length >= lines.length * 0.3 && single.length <= multi * 1.5 && single.length >= 2;
    const out = [];
    if (blockMode) {
      let cur = null;
      lines.forEach(l => {
        if (!/\s/.test(l) && USER_RE.test(cleanUser(l)) && !/^#/.test(l)) { cur = { user: cleanUser(l), text: '' }; out.push(cur); }
        else if (cur) cur.text = (cur.text ? cur.text + ' ' : '') + l;
        else { const e = parseOneLine(l); if (e && e.user) out.push(e); }
      });
    } else lines.forEach(l => { const e = parseOneLine(l); if (e && e.user) out.push(e); });
    return out.filter(e => e.user);
  }
  function parseCSV(text) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',' || ch === ';' || ch === '\t') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim()));
  }
  const USER_KEYS = ['username', 'user_name', 'user', 'author', 'handle', 'owner', 'account', 'commenter', 'name', 'from', 'screen_name', 'usuario', 'autor', 'nombre'];
  const TEXT_KEYS = ['text', 'comment', 'comment_text', 'message', 'body', 'content', 'comentario', 'mensaje', 'texto'];
  function findKey(keys, cands) { const low = keys.map(k => String(k).toLowerCase().trim()); for (const c of cands) { const i = low.indexOf(c); if (i >= 0) return keys[i]; } return null; }
  function fromObjects(arr) {
    if (!arr.length) return [];
    const sample = arr.find(o => o && typeof o === 'object') || {};
    const keys = Object.keys(sample);
    const uk = findKey(keys, USER_KEYS), tk = findKey(keys, TEXT_KEYS);
    return arr.map(o => {
      if (typeof o === 'string') return parseOneLine(o);
      if (!o || typeof o !== 'object') return null;
      let user = uk ? o[uk] : null;
      if (user && typeof user === 'object') user = user.username || user.name || user.id;
      if (!user) { const nested = o.user || o.owner || o.from || o.author || o.username || o.name; user = nested && typeof nested === 'object' ? (nested.username || nested.name) : nested; }
      const text = tk && o[tk] != null ? o[tk] : (o.text || o.comment || o.message || o.body || '');
      user = cleanUser(user); if (!user) return null;
      return { user, text: String(text == null ? '' : text).trim() };
    }).filter(Boolean);
  }
  function parseFile(name, text) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    text = text.replace(/^﻿/, '');
    if (ext === 'json' || /^\s*[\[{]/.test(text)) {
      try {
        let j = Studio.safeParse(text, null);
        if (j && !Array.isArray(j)) j = j.data || j.comments || j.items || j.results || j.rows || Object.values(j).find(v => Array.isArray(v)) || [];
        if (Array.isArray(j)) return { entries: fromObjects(j), kind: 'JSON' };
      } catch (e) { /* fall through to text */ }
    }
    if (ext === 'csv' || ext === 'tsv' || /[,;\t]/.test(text.split('\n')[0] || '')) {
      const rows = parseCSV(text);
      if (rows.length) {
        const head = rows[0].map(c => c.toLowerCase().trim());
        const ui = head.findIndex(h => USER_KEYS.includes(h)), ti = head.findIndex(h => TEXT_KEYS.includes(h));
        if (ui >= 0) {
          return { entries: rows.slice(1).map(r => ({ user: cleanUser(r[ui]), text: (ti >= 0 ? r[ti] : '').trim() })).filter(e => e.user), kind: 'CSV' };
        }
        if (rows[0].length >= 2) return { entries: rows.map(r => ({ user: cleanUser(r[0]), text: (r[1] || '').trim() })).filter(e => e.user && USER_RE.test(e.user)), kind: 'CSV' };
      }
    }
    return { entries: parseText(text), kind: 'text' };
  }

  // ---------- data access ----------
  function allEntries() {
    if (S.mode === 'paste') return parseText(S.pasteText);
    if (S.mode === 'upload') return S.uploaded;
    if (S.mode === 'manual') return S.manual.map(u => ({ user: u, text: '' }));
    if (S.mode === 'instagram') return S.imported;
    return [];
  }
  const BOT_RE = /^\d+$|bot|giveaway|free/i;
  function prevWinnerSet() {
    const set = new Set();
    if (isPro() && S.excludePrev) history.forEach(h => (h.winners || []).forEach(u => set.add(u)));
    return set;
  }
  function computeEligible() {
    const entries = allEntries();
    const r = S.rules;
    const removed = { duplicates: 0, mentions: 0, keyword: 0, length: 0, excluded: 0, owner: 0, bots: 0, previous: 0 };
    const excl = new Set(r.exclude.map(cleanUser)), owner = cleanUser(r.owner), prev = prevWinnerSet();
    const kw = r.keyword.trim().toLowerCase(), bonus = r.bonus.trim().toLowerCase();
    const seen = new Set(), bonusSeen = new Set();
    let out = [], bonusCount = 0;
    entries.forEach(e => {
      const user = cleanUser(e.user), text = String(e.text || '');
      if (!user) return;
      if (owner && user === owner) { removed.owner++; return; }
      if (excl.has(user)) { removed.excluded++; return; }
      if (r.bots && BOT_RE.test(user)) { removed.bots++; return; }
      if (prev.has(user)) { removed.previous++; return; }
      const mentions = (text.match(/@[a-z0-9._]+/gi) || []).length;
      if (r.mentions > 0 && mentions < r.mentions) { removed.mentions++; return; }
      if (kw && !text.toLowerCase().includes(kw)) { removed.keyword++; return; }
      if (r.minLen > 0 && text.trim().length < r.minLen) { removed.length++; return; }
      if (r.dedupe && seen.has(user)) { removed.duplicates++; return; }
      seen.add(user);
      let w = 1;
      if (bonus && text.toLowerCase().includes(bonus) && (!r.dedupe || !bonusSeen.has(user))) { w = 2; bonusCount++; bonusSeen.add(user); }
      out.push({ user, text, w });
    });
    let users = [...new Set(out.map(e => e.user))];
    let truncated = 0;
    if (!isPro() && users.length > FREE_MAX_USERS) {
      const keep = new Set(users.slice(0, FREE_MAX_USERS));
      truncated = users.length - FREE_MAX_USERS;
      out = out.filter(e => keep.has(e.user)); users = users.slice(0, FREE_MAX_USERS);
    }
    const entryCount = out.reduce((a, e) => a + e.w, 0);
    eligible = { users, entries: out, removed, total: entries.length, truncated, entryCount, bonusCount };
    return eligible;
  }

  // ---------- crypto / draw ----------
  function randomSeed() { const b = new Uint8Array(16); crypto.getRandomValues(b); return [...b].map(x => x.toString(16).padStart(2, '0')).join(''); }
  function sfc32(a, b, c, d) {
    return function () {
      a |= 0; b |= 0; c |= 0; d |= 0;
      const t = (a + b | 0) + d | 0; d = d + 1 | 0; a = b ^ b >>> 9; b = c + (c << 3) | 0; c = (c << 21 | c >>> 11); c = c + t | 0;
      return (t >>> 0) / 4294967296;
    };
  }
  function rngFromSeed(seed) {
    const h = seed.padEnd(32, '0');
    const u = i => parseInt(h.slice(i * 8, i * 8 + 8), 16) >>> 0;
    const rnd = sfc32(u(0), u(1), u(2), u(3));
    for (let i = 0; i < 16; i++) rnd();
    return rnd;
  }
  // compact SHA-256 fallback for non-secure contexts (crypto.subtle is used when available)
  function sha256Sync(str) {
    const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    const bytes = new TextEncoder().encode(str);
    const l = bytes.length, padLen = ((l + 9 + 63) >> 6) << 6;
    const m = new Uint8Array(padLen); m.set(bytes); m[l] = 0x80;
    const dv = new DataView(m.buffer); dv.setUint32(padLen - 4, (l * 8) >>> 0); dv.setUint32(padLen - 8, Math.floor(l * 8 / 4294967296));
    let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const w = new Uint32Array(64), rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < padLen; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) { const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0; }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25), ch = (e & f) ^ (~e & g), t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22), mj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + mj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H = H.map((x, i) => (x + [a, b, c, d, e, f, g, h][i]) >>> 0);
    }
    return H.map(x => x.toString(16).padStart(8, '0')).join('');
  }
  async function sha256(str) {
    if (crypto.subtle) {
      try { const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)); return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join(''); } catch (e) { /* fallback */ }
    }
    return sha256Sync(str);
  }
  function pickWinners(el, seed, nW, nA) {
    const entries = el.entries.slice().sort((a, b) => a.user < b.user ? -1 : a.user > b.user ? 1 : a.text < b.text ? -1 : a.text > b.text ? 1 : 0);
    let pool = []; entries.forEach((e, i) => { for (let k = 0; k < e.w; k++) pool.push(i); });
    const rnd = rngFromSeed(seed), winners = [], alternates = [];
    const take = () => { if (!pool.length) return null; const e = entries[pool[Math.floor(rnd() * pool.length)]]; pool = pool.filter(i => entries[i].user !== e.user); return { user: e.user, text: e.text }; };
    for (let i = 0; i < nW; i++) { const w = take(); if (!w) break; winners.push(w); }
    for (let i = 0; i < nA; i++) { const w = take(); if (!w) break; alternates.push(w); }
    return { winners, alternates };
  }

  // ---------- sound ----------
  let actx = null;
  function beep(freq, dur, type, gain) {
    if (!S.draw.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'square'; o.frequency.value = freq; g.gain.value = gain || 0.035;
      o.connect(g); g.connect(actx.destination);
      const t = actx.currentTime; o.start(t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.stop(t + dur + 0.02);
    } catch (e) { /* no audio */ }
  }
  function fanfare() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.35, 'triangle', 0.06), i * 110)); }

  // ---------- confetti ----------
  const confettiEl = $('confetti'); let particles = [], confettiRaf = 0;
  function confetti(n) {
    const rect = $('stage').getBoundingClientRect();
    confettiEl.width = rect.width; confettiEl.height = rect.height;
    const colors = ['#f97316', '#fb923c', '#7c3aed', '#34c759', '#0a84ff', '#ff453a', '#ffd60a', '#ffffff'];
    for (let i = 0; i < (n || 120); i++) particles.push({ x: rect.width / 2 + (Math.random() - 0.5) * 80, y: rect.height * 0.45, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 12 - 4, g: 0.35, r: Math.random() * 6 + 3, c: colors[i % colors.length], a: Math.random() * Math.PI, va: (Math.random() - 0.5) * 0.3, life: 90 + Math.random() * 40 });
    if (!confettiRaf) tickConfetti();
  }
  function tickConfetti() {
    const ctx = confettiEl.getContext('2d'); ctx.clearRect(0, 0, confettiEl.width, confettiEl.height);
    particles = particles.filter(p => p.life > 0);
    particles.forEach(p => { p.vy += p.g; p.x += p.vx; p.y += p.vy; p.vx *= 0.99; p.a += p.va; p.life--; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.globalAlpha = Math.min(1, p.life / 30); ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6); ctx.restore(); });
    confettiRaf = particles.length ? requestAnimationFrame(tickConfetti) : 0;
  }

  // ---------- draw flow ----------
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function setReveal(tag, name, sub) { $('revealTag').textContent = tag; $('revealName').textContent = name; $('revealSub').textContent = sub; }
  function winnerCard(w, i, alt) {
    const d = document.createElement('div'); d.className = 'winner-card' + (alt ? ' alt' : '');
    d.innerHTML = `<span class="rank">${alt ? 'Alt ' + (i + 1) : '#' + (i + 1)}</span><b>@${esc(w.user)}</b>${w.text ? `<small>${esc(w.text)}</small>` : ''}`;
    return d;
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
  async function animateReveal(res, el) {
    const grid = $('winnersGrid'); grid.innerHTML = '';
    const names = el.users;
    const anim = S.draw.anim;
    if (anim === 'instant') {
      setReveal('Winner' + (res.winners.length > 1 ? 's' : ''), res.winners.map(w => '@' + w.user).join('  ·  '), res.alternates.length ? 'Alternates: ' + res.alternates.map(a => '@' + a.user).join(', ') : 'Picked from ' + names.length + ' participants');
      res.winners.forEach((w, i) => grid.appendChild(winnerCard(w, i)));
      fanfare(); confetti(140); return;
    }
    if (anim === 'countdown') {
      for (const n of [3, 2, 1]) { setReveal('Drawing', String(n), 'Picking from ' + names.length + ' participants…'); $('revealName').classList.add('pop'); beep(660, 0.12); await sleep(650); $('revealName').classList.remove('pop'); await sleep(50); }
      setReveal('Winner' + (res.winners.length > 1 ? 's' : ''), res.winners.map(w => '@' + w.user).join('  ·  '), res.alternates.length ? 'Alternates: ' + res.alternates.map(a => '@' + a.user).join(', ') : 'Picked from ' + names.length + ' participants');
      $('revealName').classList.add('pop'); setTimeout(() => $('revealName').classList.remove('pop'), 500);
      res.winners.forEach((w, i) => grid.appendChild(winnerCard(w, i)));
      fanfare(); confetti(160); return;
    }
    // roulette: spin through names, slowing down, one winner at a time
    for (let i = 0; i < res.winners.length; i++) {
      const w = res.winners[i], dur = 1700 + Math.min(600, names.length * 4), start = performance.now();
      let last = 0, idx = Math.floor(Math.random() * names.length);
      await new Promise(resolve => {
        const step = now => {
          const t = Math.min(1, (now - start) / dur), eased = 1 - Math.pow(1 - t, 3);
          const interval = 40 + eased * 260;
          if (now - last >= interval) { last = now; idx = (idx + 1 + Math.floor(Math.random() * 3)) % names.length; setReveal('Winner ' + (i + 1) + ' of ' + res.winners.length, '@' + names[idx], 'Spinning through ' + names.length + ' participants…'); beep(880 - eased * 300, 0.04, 'square', 0.02); }
          if (t < 1) requestAnimationFrame(step); else resolve();
        };
        requestAnimationFrame(step);
      });
      setReveal('Winner ' + (i + 1) + ' of ' + res.winners.length, '@' + w.user, w.text ? '"' + w.text.slice(0, 120) + '"' : 'Congratulations!');
      $('revealName').classList.add('pop'); setTimeout(() => $('revealName').classList.remove('pop'), 500);
      grid.appendChild(winnerCard(w, i)); fanfare(); confetti(110);
      if (i < res.winners.length - 1) await sleep(900);
    }
    if (res.alternates.length) await sleep(400);
    setReveal(res.winners.length > 1 ? 'Winners' : 'Winner', res.winners.map(w => '@' + w.user).join('  ·  '), res.alternates.length ? 'Alternates: ' + res.alternates.map(a => '@' + a.user).join(', ') : 'Picked from ' + names.length + ' participants');
  }
  async function runDraw(seed) {
    if (drawing) return;
    const el = computeEligible();
    if (!el.users.length) { toast('Add participants first'); return; }
    let nW = clamp(parseInt($('winnersN').value, 10) || 1, 1, PRO_MAX_WINNERS);
    if (nW > FREE_MAX_WINNERS && !Studio.gate('winners')) { return; }
    const nA = clamp(parseInt($('alternatesN').value, 10) || 0, 0, MAX_ALTERNATES);
    if (nW > el.users.length) { toast('Only ' + el.users.length + ' eligible participants for ' + nW + ' winners'); nW = el.users.length; }
    if (!seed) seed = randomSeed();
    drawing = true; $('drawBtn').disabled = true; $('drawBtn2').disabled = true;
    setStageView('draw');
    try {
      const users = el.users.slice().sort();
      const hash = await sha256(users.join('\n') + '\n' + seed);
      const res = pickWinners(el, seed, nW, nA);
      await animateReveal(res, el);
      S.result = { seed, hash, winners: res.winners, alternates: res.alternates, count: users.length, entries: el.entryCount, date: new Date().toISOString(), postUrl: S.postUrl };
      if (isPro()) { history.unshift({ date: S.result.date, hash, seed, winners: res.winners.map(w => w.user), alternates: res.alternates.map(a => a.user), count: users.length }); history = history.slice(0, 20); try { localStorage.setItem(HIST_KEY, JSON.stringify(history)); } catch (e) {} renderHistory(); }
      $('caption').value = buildCaption(S.result);
      save(); renderResult(); renderCert();
      track('draw', { winners: nW, alternates: nA, participants: users.length, anim: S.draw.anim });
    } finally { drawing = false; $('drawBtn').disabled = false; $('drawBtn2').disabled = false; }
  }
  function buildCaption(r) {
    const names = r.winners.map(w => '@' + w.user);
    const list = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0];
    return `🎉 Congrats ${list}! You won our giveaway 🎁\n\nPicked at random from ${r.count} participants with Giveaway Picker. Verification hash: ${r.hash.slice(0, 10)}\n\nSend us a DM to claim your prize. We will never contact you from another account or ask for payment details.${r.alternates.length ? '\n\nAlternates: ' + r.alternates.map(a => '@' + a.user).join(', ') : ''}`;
  }

  // ---------- certificate ----------
  const cert = $('certCanvas'), cctx = cert.getContext('2d');
  function certSize() { return S.cert.format === 'story' ? { w: 1080, h: 1920 } : { w: 1080, h: 1080 }; }
  function drawCert(ctx, w, h) {
    const pro = isPro();
    const bg1 = pro ? S.cert.bg1 : '#f97316', bg2 = pro ? S.cert.bg2 : '#7c3aed', fg = pro ? S.cert.accent : '#ffffff';
    const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, bg1); g.addColorStop(1, bg2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // soft blobs
    ctx.save(); ctx.globalAlpha = 0.18; ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(w * 0.85, h * 0.12, w * 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(w * 0.1, h * 0.9, w * 0.35, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    // card
    const pad = 70, cx = pad, cy = h * (S.cert.format === 'story' ? 0.14 : 0.08), cw = w - pad * 2, ch = h - cy * 2;
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.28)'; Studio.roundRect(ctx, cx, cy, cw, ch, 48); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
    ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    let y = cy + 110;
    if (logoImg && pro) { const f = Studio.fit(logoImg.width, logoImg.height, 260, 120); ctx.drawImage(logoImg, w / 2 - f.w / 2, y - 60, f.w, f.h); y += f.h + 20; }
    ctx.font = `600 30px ${FONT}`; ctx.globalAlpha = 0.85; ctx.fillText('GIVEAWAY WINNER' + (S.result && S.result.winners.length > 1 ? 'S' : ''), w / 2, y); ctx.globalAlpha = 1;
    y += 50; ctx.font = `800 96px ${FONT}`; ctx.fillText('🎉', w / 2, y + 80); y += 150;
    const winners = S.result ? S.result.winners : [{ user: 'your.winner', text: '' }];
    const n = winners.length, size = n <= 1 ? 86 : n <= 3 ? 66 : n <= 6 ? 50 : n <= 12 ? 38 : 30, lh = size * 1.3;
    ctx.font = `800 ${size}px ${FONT}`;
    winners.forEach(wn => { let t = '@' + wn.user; while (ctx.measureText(t).width > cw - 80 && t.length > 6) t = t.slice(0, -2) + '…'; ctx.fillText(t, w / 2, y + size); y += lh; });
    if (S.result && S.result.alternates.length && n <= 6) { y += 10; ctx.font = `500 28px ${FONT}`; ctx.globalAlpha = 0.8; Studio.wrapText(ctx, 'Alternates: ' + S.result.alternates.map(a => '@' + a.user).join(', '), cw - 120).forEach(l => { ctx.fillText(l, w / 2, y + 28); y += 38; }); ctx.globalAlpha = 1; }
    if (n === 1 && winners[0].text) { y += 20; ctx.font = `italic 500 30px ${FONT}`; ctx.globalAlpha = 0.85; Studio.wrapText(ctx, '"' + winners[0].text.slice(0, 160) + '"', cw - 140).slice(0, 3).forEach(l => { ctx.fillText(l, w / 2, y + 30); y += 42; }); ctx.globalAlpha = 1; }
    // footer block
    const fy = cy + ch - 150;
    ctx.font = `500 26px ${FONT}`; ctx.globalAlpha = 0.85;
    const date = S.result ? new Date(S.result.date) : new Date();
    const meta = [date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }), (S.result ? S.result.count : eligible.users.length) + ' participants', 'Hash ' + (S.result ? S.result.hash.slice(0, 10) : '—')];
    ctx.fillText(meta.join('   ·   '), w / 2, fy);
    const url = (S.postUrl || '').trim();
    if (url) { ctx.font = `500 24px ${FONT}`; let t = url.replace(/^https?:\/\/(www\.)?/, ''); while (ctx.measureText(t).width > cw - 80 && t.length > 10) t = t.slice(0, -2) + '…'; ctx.fillText(t, w / 2, fy + 40); }
    ctx.globalAlpha = 0.65; ctx.font = `600 22px ${FONT}`; ctx.fillText('Drawn with ' + (C.APP_NAME || 'Giveaway Picker') + ' · provably fair', w / 2, cy + ch - 50); ctx.globalAlpha = 1;
  }
  function renderCertNow() {
    const { w, h } = certSize();
    if (cert.width !== w || cert.height !== h) { cert.width = w; cert.height = h; }
    drawCert(cctx, w, h);
    if (!isPro()) { cctx.save(); cctx.globalAlpha = 0.7; Studio.watermark(cctx, w, h); cctx.restore(); }
  }
  const renderCert = Studio.raf(renderCertNow);
  function certName() { const { w, h } = certSize(); return 'giveaway-winner-' + (S.result ? S.result.winners.map(x => x.user).join('-').slice(0, 40) : 'preview') + '-' + w + 'x' + h; }
  async function downloadCert() {
    if (!S.result) { toast('Draw winners first'); return; }
    const { w, h } = certSize();
    await Studio.exportPNG((ctx, cw, ch) => drawCert(ctx, cw, ch), w, h, { name: Studio.safeName(certName()) });
    toast('Certificate downloaded');
  }

  // ---------- rendering ----------
  function fmt(n) { return n.toLocaleString(); }
  function renderEligible() {
    const el = computeEligible();
    $('eligibleLine').innerHTML = `Eligible: <b>${fmt(el.users.length)}</b> users / <b>${fmt(el.entryCount)}</b> entries`;
    $('stageUsers').textContent = fmt(el.users.length);
    $('stageEntries').textContent = fmt(el.entryCount) + (el.entryCount === 1 ? ' entry' : ' entries') + (el.bonusCount ? ' · ' + el.bonusCount + ' bonus' : '');
    $('stageInfo').innerHTML = `Eligible: <b>${fmt(el.users.length)}</b> users · <b>${fmt(el.total)}</b> comments`;
    const labels = { duplicates: 'Duplicate comments (same user)', mentions: 'Not enough mentions', keyword: 'Missing hashtag / keyword', length: 'Comment too short', excluded: 'Excluded usernames', owner: 'Account owner', bots: 'Blocked as bot', previous: 'Previous winners' };
    const items = Object.keys(el.removed).filter(k => el.removed[k] > 0).map(k => `<li><span>${labels[k]}</span><b>−${fmt(el.removed[k])}</b></li>`);
    if (el.bonusCount) items.push(`<li><span>Bonus entries</span><b>+${fmt(el.bonusCount)}</b></li>`);
    $('breakdown').innerHTML = items.length ? `<li class="head"><span>${fmt(el.total)} comments parsed</span></li>` + items.join('') : (el.total ? `<li class="head"><span>${fmt(el.total)} comments parsed · nothing removed</span></li>` : '');
    const notice = $('limitNotice');
    if (el.truncated > 0) {
      notice.textContent = `Free plan: using the first ${FREE_MAX_USERS} of ${fmt(el.users.length + el.truncated)} eligible participants. Upgrade to Pro for unlimited participants.`;
      notice.classList.remove('hidden');
      if (!wasOverLimit) { wasOverLimit = true; Studio.gate('participants'); }
    } else { notice.classList.add('hidden'); wasOverLimit = false; }
    // participants summary + preview table
    const entries = allEntries();
    const uniq = new Set(entries.map(e => cleanUser(e.user))).size;
    $('partSummary').textContent = entries.length ? `${fmt(entries.length)} comment${entries.length === 1 ? '' : 's'} · ${fmt(uniq)} unique user${uniq === 1 ? '' : 's'}` + (S.mode === 'upload' && S.uploadName ? ' · ' + S.uploadName : S.mode === 'instagram' && S.importName ? ' · ' + S.importName : '') : 'No participants yet.';
    $('entryList').innerHTML = entries.slice(0, 60).map(e => `<tr><td>@${esc(cleanUser(e.user))}</td><td>${esc(e.text || '')}</td></tr>`).join('') + (entries.length > 60 ? `<tr><td colspan="2" class="hint">… and ${fmt(entries.length - 60)} more</td></tr>` : '');
    if (!S.result) renderCert();
  }
  function renderResult() {
    const r = S.result;
    $('resultEmpty').classList.toggle('hidden', !!r); $('resultBox').classList.toggle('hidden', !r);
    if (!r) return;
    $('winnerList').innerHTML = r.winners.map(w => `<li><b>@${esc(w.user)}</b>${w.text ? `<small>${esc(w.text)}</small>` : ''}</li>`).join('');
    $('altList').innerHTML = r.alternates.length ? r.alternates.map(a => `<li><b>@${esc(a.user)}</b>${a.text ? `<small>${esc(a.text)}</small>` : ''}</li>`).join('') : '<li class="hint">None</li>';
    $('hashShort').textContent = r.hash.slice(0, 16) + '…'; $('hashShort').title = r.hash;
    $('seedShow').textContent = r.seed;
    $('resultMeta').textContent = new Date(r.date).toLocaleString() + ' · ' + fmt(r.count) + ' participants / ' + fmt(r.entries) + ' entries';
  }
  function restoreStageResult() {
    const r = S.result; if (!r) return;
    setReveal(r.winners.length > 1 ? 'Winners' : 'Winner', r.winners.map(w => '@' + w.user).join('  ·  '), r.alternates.length ? 'Alternates: ' + r.alternates.map(a => '@' + a.user).join(', ') : 'Picked from ' + r.count + ' participants');
    const grid = $('winnersGrid'); grid.innerHTML = ''; r.winners.forEach((w, i) => grid.appendChild(winnerCard(w, i)));
  }
  function renderHistory() {
    const pro = isPro();
    $('historyLocked').classList.toggle('hidden', pro); $('historyBody').classList.toggle('hidden', !pro);
    if (!pro) return;
    $('historyList').innerHTML = history.length ? history.map(h => `<li><span class="d">${esc(new Date(h.date).toLocaleString())}</span><b>${h.winners.map(u => '@' + esc(u)).join(', ')}</b><small>${esc(h.count)} participants · hash ${esc(h.hash.slice(0, 10))} · seed <code>${esc(h.seed)}</code></small></li>`).join('') : '<li class="hint">No draws yet.</li>';
  }
  function setStageView(v) {
    S.stageView = v; stageSeg.set(v);
    $('drawView').classList.toggle('hidden', v !== 'draw'); cert.classList.toggle('hidden', v !== 'cert');
    if (v === 'cert') renderCert();
    save();
  }
  function renderChips(el, list, onRemove) {
    el.innerHTML = '';
    list.forEach((u, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.innerHTML = '@' + esc(u) + ' <span aria-hidden="true">✕</span>'; b.setAttribute('aria-label', 'Remove ' + u); b.addEventListener('click', () => onRemove(i)); el.appendChild(b); });
  }
  function renderManual() { renderChips($('chipList'), S.manual, i => { S.manual.splice(i, 1); save(); renderManual(); renderEligible(); }); }
  function renderExclude() { renderChips($('excludeChips'), S.rules.exclude, i => { S.rules.exclude.splice(i, 1); save(); renderExclude(); renderEligible(); }); }
  function setMode(m) {
    if (m === 'instagram' && !isPro()) { openPro('instagram'); modeSeg.set(S.mode); return; }
    S.mode = m; modeSeg.set(m); save();
    ['paste', 'upload', 'manual', 'instagram'].forEach(k => $('pane' + k[0].toUpperCase() + k.slice(1)).classList.toggle('hidden', k !== m));
    renderEligible();
  }
  function refreshUI() {
    const pro = isPro();
    $('winnersN').max = pro ? PRO_MAX_WINNERS : FREE_MAX_WINNERS;
    $('winnersHint').textContent = pro ? 'Up to 20 winners' : 'Free: up to 3 · Pro: up to 20';
    document.querySelectorAll('#modeInstagram .pro-badge, #historyPanel summary .pro-badge, #brandBox .sub-label .pro-badge').forEach(b => b.classList.toggle('hidden', pro));
    $('igLocked').classList.toggle('hidden', pro); $('igForm').classList.toggle('hidden', !pro);
    $('brandBox').classList.toggle('locked', !pro);
    renderHistory();
    if (!pro && S.mode === 'instagram') setMode('paste');
    renderEligible(); renderCert();
  }

  // ---------- instagram import (Pro) ----------
  async function graph(path, params) {
    const u = new URL(GRAPH + path); Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
    const r = await fetch(u.toString()); let j = {}; try { j = await r.json(); } catch (e) {}
    if (j.error) throw new Error(j.error.message || ('Graph API error ' + (j.error.code || '')));
    if (!r.ok) throw new Error('Graph API request failed (' + r.status + ')');
    return j;
  }
  async function graphAll(path, params, max, onPage) {
    let j = await graph(path, params), out = (j.data || []).slice();
    while (j.paging && j.paging.next && out.length < max) {
      if (onPage) onPage(out.length);
      // Only follow pagination links that point back to the Graph API host.
      if (typeof j.paging.next !== 'string' || !j.paging.next.startsWith(GRAPH.replace(/v[\d.]+\/$/, ''))) break;
      const r = await fetch(j.paging.next); j = await r.json();
      if (j.error) throw new Error(j.error.message || 'Graph API error');
      out = out.concat(j.data || []);
    }
    return out;
  }
  function parsePostRef(v) {
    v = (v || '').trim();
    if (/^\d{8,}$/.test(v)) return { id: v };
    const m = v.match(/instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/) || v.match(/^([A-Za-z0-9_-]{8,14})$/);
    if (m) return { shortcode: m[1] };
    return null;
  }
  async function importInstagram() {
    if (!Studio.gate('instagram')) return;
    const ref = parsePostRef($('igUrl').value), token = ($('igToken').value || '').trim(), st = $('igStatus');
    if (!ref) { toast('Enter a valid Instagram post URL or media ID'); return; }
    if (!token || token.length < 20 || /\s/.test(token)) { toast('That does not look like a valid access token'); st.textContent = 'Error: paste a User access token (long string starting with EAA…).'; return; }
    igToken = token;
    if ($('igRemember').checked) { try { localStorage.setItem(TOKEN_KEY, token); } catch (e) {} }
    const btn = $('igImport'); btn.disabled = true;
    try {
      let mediaId = ref.id;
      if (!mediaId) {
        st.textContent = 'Looking up your Instagram account…';
        const pages = await graphAll('me/accounts', { fields: 'name,instagram_business_account', access_token: token }, 200);
        const igIds = pages.map(p => p.instagram_business_account && p.instagram_business_account.id).filter(Boolean);
        if (!igIds.length) throw new Error('No Instagram Business/Creator account is linked to the Pages this token can see. Link your Instagram account to a Facebook Page and grant pages_show_list.');
        for (const igId of igIds) {
          st.textContent = 'Searching the post in account ' + igId + '…';
          const media = await graphAll(igId + '/media', { fields: 'id,shortcode,permalink', limit: 100, access_token: token }, 2000, n => { st.textContent = 'Scanned ' + n + ' posts…'; });
          const hit = media.find(m => m.shortcode === ref.shortcode || (m.permalink && m.permalink.includes('/' + ref.shortcode + '/')));
          if (hit) { mediaId = hit.id; break; }
        }
        if (!mediaId) throw new Error('Post not found in the connected Instagram account(s). Make sure the URL belongs to the account that owns the token.');
      }
      st.textContent = 'Reading comments…';
      const comments = await graphAll(mediaId + '/comments', { fields: 'username,text,timestamp,like_count', limit: 50, access_token: token }, 100000, n => { st.textContent = 'Read ' + n + ' comments…'; });
      S.imported = comments.filter(c => c && typeof c === 'object').map(c => ({ user: cleanUser(c.username).slice(0, 60), text: String(c.text || '').trim().slice(0, 2200) })).filter(e => e.user);
      S.importName = 'Instagram ' + (ref.shortcode ? '/p/' + ref.shortcode : 'media ' + mediaId);
      st.textContent = 'Imported ' + S.imported.length + ' comments from ' + S.importName + '.';
      toast('Imported ' + S.imported.length + ' comments'); track('instagram_import', { count: S.imported.length });
      save(); renderEligible();
    } catch (e) {
      st.textContent = 'Error: ' + e.message;
      toast('Instagram import failed: ' + e.message.slice(0, 80));
    } finally { btn.disabled = false; }
  }

  // ---------- wiring ----------
  const modeSeg = Studio.seg($('modeSeg'), setMode);
  const stageSeg = Studio.seg($('stageSeg'), setStageView);
  const animSeg = Studio.seg($('animSeg'), v => { S.draw.anim = v; save(); });
  const certSegC = Studio.seg($('certSeg'), v => { S.cert.format = v; save(); renderCert(); if (S.stageView !== 'cert') setStageView('cert'); });

  const pasteEl = $('pasteText');
  pasteEl.value = S.pasteText;
  const onPaste = Studio.debounce(() => { S.pasteText = pasteEl.value; save(); const n = parseText(S.pasteText).length; $('pasteCount').textContent = fmt(n) + (n === 1 ? ' comment detected' : ' comments detected'); renderEligible(); }, 150);
  pasteEl.addEventListener('input', onPaste);
  $('loadSample').addEventListener('click', () => { pasteEl.value = SAMPLE; S.sampleLoaded = true; S.pasteText = SAMPLE; save(); setMode('paste'); onPaste(); toast('Sample comments loaded'); track('sample', {}); });
  $('clearPaste').addEventListener('click', () => { pasteEl.value = ''; S.pasteText = ''; save(); onPaste(); });

  Studio.dropzone($('uploadDrop'), async files => {
    const f = files[0]; if (!f) return;
    if (f.size > 20 * 1024 * 1024) { toast('Could not read the file'); return; } // import size cap (20 MB)
    try {
      const text = await f.text();
      const res = parseFile(f.name, text);
      if (!res.entries.length) { toast('No participants found in ' + f.name); return; }
      S.uploaded = cleanEntries(res.entries); S.uploadName = String(f.name).slice(0, 200); save();
      $('uploadInfo').textContent = `${f.name} (${res.kind}) · ${fmt(res.entries.length)} comments`;
      setMode('upload'); toast('Loaded ' + fmt(res.entries.length) + ' comments'); track('upload', { kind: res.kind, count: res.entries.length });
    } catch (e) { toast('Could not read the file'); }
  }, { accept: '.csv,.txt,.json,.tsv,text/plain,text/csv,application/json', paste: false });
  $('clearUpload').addEventListener('click', () => { S.uploaded = []; S.uploadName = ''; save(); $('uploadInfo').textContent = 'No file loaded.'; renderEligible(); });
  if (S.uploadName) $('uploadInfo').textContent = `${S.uploadName} · ${fmt(S.uploaded.length)} comments`;

  function addChip(inputId, list, after) {
    const inp = $(inputId); const vals = inp.value.split(/[\s,]+/).map(cleanUser).filter(u => u && USER_RE.test(u));
    if (!vals.length) { toast('Enter a username'); return; }
    vals.forEach(u => { if (!list.includes(u)) list.push(u); });
    inp.value = ''; save(); after();
  }
  $('chipAdd').addEventListener('click', () => addChip('chipInput', S.manual, () => { renderManual(); renderEligible(); }));
  $('chipInput').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addChip('chipInput', S.manual, () => { renderManual(); renderEligible(); }); } });
  $('clearManual').addEventListener('click', () => { S.manual = []; save(); renderManual(); renderEligible(); });
  $('excludeAdd').addEventListener('click', () => addChip('excludeInput', S.rules.exclude, () => { renderExclude(); renderEligible(); }));
  $('excludeInput').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addChip('excludeInput', S.rules.exclude, () => { renderExclude(); renderEligible(); }); } });

  // rules
  $('dedupe').checked = S.rules.dedupe; $('dedupe').addEventListener('change', () => { S.rules.dedupe = $('dedupe').checked; save(); renderEligible(); });
  $('bots').checked = S.rules.bots; $('bots').addEventListener('change', () => { S.rules.bots = $('bots').checked; save(); renderEligible(); });
  $('mentions').value = S.rules.mentions; $('mentions').addEventListener('input', () => { S.rules.mentions = clamp(parseInt($('mentions').value, 10) || 0, 0, 10); save(); renderEligible(); });
  $('minLen').value = S.rules.minLen; $('minLen').addEventListener('input', () => { S.rules.minLen = clamp(parseInt($('minLen').value, 10) || 0, 0, 500); save(); renderEligible(); });
  const bindText = (id, get, set) => { $(id).value = get(); $(id).addEventListener('input', Studio.debounce(() => { set($(id).value); save(); renderEligible(); }, 120)); };
  bindText('keyword', () => S.rules.keyword, v => { S.rules.keyword = v; });
  bindText('owner', () => S.rules.owner, v => { S.rules.owner = v; });
  bindText('bonusKeyword', () => S.rules.bonus, v => { S.rules.bonus = v; });
  $('postUrl').value = S.postUrl; $('postUrl').addEventListener('input', Studio.debounce(() => { S.postUrl = $('postUrl').value.trim(); save(); renderCert(); }, 150));

  // draw settings
  $('winnersN').value = S.draw.winners; $('alternatesN').value = S.draw.alternates; $('sound').checked = S.draw.sound;
  $('winnersN').addEventListener('change', () => { let v = clamp(parseInt($('winnersN').value, 10) || 1, 1, PRO_MAX_WINNERS); if (v > FREE_MAX_WINNERS && !isPro()) { openPro('winners'); v = FREE_MAX_WINNERS; } $('winnersN').value = v; S.draw.winners = v; save(); });
  $('alternatesN').addEventListener('change', () => { const v = clamp(parseInt($('alternatesN').value, 10) || 0, 0, MAX_ALTERNATES); $('alternatesN').value = v; S.draw.alternates = v; save(); });
  $('sound').addEventListener('change', () => { S.draw.sound = $('sound').checked; save(); if (S.draw.sound) beep(660, 0.1, 'triangle', 0.05); });
  $('drawBtn').addEventListener('click', () => runDraw());
  $('drawBtn2').addEventListener('click', () => { runDraw(); $('stage').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  $('repeatBtn').addEventListener('click', () => runDraw());
  $('excludeRedrawBtn').addEventListener('click', () => {
    if (!S.result) return;
    S.result.winners.forEach(w => { if (!S.rules.exclude.includes(w.user)) S.rules.exclude.push(w.user); });
    save(); renderExclude(); renderEligible(); toast('Previous winners excluded'); runDraw();
  });
  $('replayBtn').addEventListener('click', () => { const s = ($('seedInput').value || '').trim().toLowerCase(); if (!/^[0-9a-f]{8,64}$/.test(s)) { toast('Seed must be a hex string (copy it from a previous result)'); return; } runDraw(s); });
  $('seedInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('replayBtn').click(); });
  $('copyHash').addEventListener('click', async () => { if (!S.result) return; try { await navigator.clipboard.writeText('Giveaway verification · hash ' + S.result.hash + ' · seed ' + S.result.seed + ' · ' + S.result.count + ' participants'); toast('Hash copied'); track('copy', { what: 'hash' }); } catch (e) { toast('Clipboard not available'); } });

  // result actions
  $('dlCert').addEventListener('click', downloadCert);
  $('copyCert').addEventListener('click', async () => { if (!S.result) { toast('Draw winners first'); return; } renderCertNow(); await Studio.copyCanvas(cert); });
  $('copyCaption').addEventListener('click', async () => { const t = $('caption').value.trim(); if (!t) { toast('Draw winners first'); return; } try { await navigator.clipboard.writeText(t); toast('Caption copied'); track('copy', { what: 'caption' }); } catch (e) { toast('Clipboard not available'); } });
  $('shareBtn').addEventListener('click', async () => {
    const t = $('caption').value.trim(); if (!t) { toast('Draw winners first'); return; }
    if (navigator.share) { try { await navigator.share({ title: 'Giveaway winners', text: t }); track('share', {}); return; } catch (e) { /* cancelled */ } }
    try { await navigator.clipboard.writeText(t); toast('Caption copied – paste it in your post'); } catch (e) { toast('Sharing not available here'); }
  });
  $('caption').addEventListener('input', () => { /* editable, not persisted beyond session */ });

  // certificate branding (Pro)
  $('certBg1').value = S.cert.bg1; $('certBg2').value = S.cert.bg2; $('certAccent').value = S.cert.accent;
  [['certBg1', 'bg1'], ['certBg2', 'bg2'], ['certAccent', 'accent']].forEach(([id, k]) => $(id).addEventListener('input', () => { if (!Studio.gate('branding')) { $(id).value = S.cert[k]; return; } S.cert[k] = $(id).value; save(); renderCert(); if (S.stageView !== 'cert') setStageView('cert'); }));
  $('logoBtn').addEventListener('click', () => { if (!Studio.gate('branding')) return; $('logoFile').click(); });
  $('logoFile').addEventListener('change', async () => {
    const f = $('logoFile').files[0]; $('logoFile').value = ''; if (!f) return;
    try {
      const img = await Studio.readImage(f);
      const fit = Studio.fit(img.width, img.height, 520, 240); const c = document.createElement('canvas'); c.width = fit.w; c.height = fit.h; c.getContext('2d').drawImage(img, 0, 0, fit.w, fit.h);
      S.cert.logo = c.toDataURL('image/png'); await loadLogo(); save(); renderCert(); setStageView('cert'); toast('Logo added');
    } catch (e) { toast('Could not read the logo'); }
  });
  $('logoClear').addEventListener('click', () => { S.cert.logo = ''; logoImg = null; save(); renderCert(); });
  async function loadLogo() { if (!S.cert.logo) { logoImg = null; return; } try { logoImg = await Studio.readImageFromURL(S.cert.logo); } catch (e) { logoImg = null; } }

  // history (Pro)
  $('excludePrev').checked = !!S.excludePrev;
  $('excludePrev').addEventListener('change', () => { S.excludePrev = $('excludePrev').checked; save(); renderEligible(); });
  $('clearHistory').addEventListener('click', () => { history = []; try { localStorage.removeItem(HIST_KEY); } catch (e) {} renderHistory(); renderEligible(); toast('History cleared'); });

  // instagram
  $('igImport').addEventListener('click', importInstagram);
  $('clearImport').addEventListener('click', () => { S.imported = []; S.importName = ''; save(); $('igStatus').textContent = ''; renderEligible(); });
  $('igRemember').addEventListener('change', () => { if (!$('igRemember').checked) { try { localStorage.removeItem(TOKEN_KEY); } catch (e) {} toast('Token forgotten on this device'); } else if ($('igToken').value.trim()) { try { localStorage.setItem(TOKEN_KEY, $('igToken').value.trim()); } catch (e) {} } });
  $('igToken').addEventListener('input', () => { igToken = $('igToken').value; if ($('igRemember').checked) { try { localStorage.setItem(TOKEN_KEY, igToken.trim()); } catch (e) {} } });
  try { const t = localStorage.getItem(TOKEN_KEY); if (t) { igToken = t; $('igToken').value = t; $('igRemember').checked = true; } } catch (e) {}

  // keyboard: Ctrl/Cmd+Enter draws
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runDraw(); } });
  window.addEventListener('resize', Studio.debounce(() => { if (particles.length) { const r = $('stage').getBoundingClientRect(); confettiEl.width = r.width; confettiEl.height = r.height; } }, 200));

  // ---------- init ----------
  document.querySelectorAll('#proPrice,[data-pro-price]').forEach(el => el.textContent = C.PRO_PRICE || '$9');
  document.addEventListener('pro:changed', refreshUI);
  if (!S.sampleLoaded && !S.pasteText && !S.uploaded.length && !S.manual.length) { S.pasteText = SAMPLE; S.sampleLoaded = true; pasteEl.value = SAMPLE; S.mode = 'paste'; save(); }
  { const n = parseText(S.pasteText).length; $('pasteCount').textContent = fmt(n) + (n === 1 ? ' comment detected' : ' comments detected'); }
  animSeg.set(S.draw.anim); certSegC.set(S.cert.format);
  renderManual(); renderExclude();
  setMode(S.mode);
  refreshUI();
  renderResult(); restoreStageResult();
  if (S.result) $('caption').value = buildCaption(S.result);
  loadLogo().then(() => renderCert());
  setStageView(S.stageView === 'cert' && S.result ? 'cert' : 'draw');
})();
