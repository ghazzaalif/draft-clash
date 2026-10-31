/* ===== Draft Clash engine: data model, draft scoring, match simulation ===== */
var DRAFTW = 0.42, FORMW = 0.4; // calibrated so draft win% matches simulated outcomes
var DC = (function(){
const ALPH='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const META = { matches: 20330, from: 'Oct 2025', to: 'Oct 2026', avgMin: 34.9, avgKills: 58.8, radiantWin: 0.521 };
let H = [], N = 0, VS = '', SY = '';

function load(csv, vs, sy, pos){
  VS = vs.replace(/\s+/g,''); SY = sy.replace(/\s+/g,'');
  const P = {};
  (pos || '').trim().split('\n').forEach(function(line){
    if (!line) return;
    const c = line.indexOf(','); P[+line.slice(0, c)] = line.slice(c + 1).split(';').map(function(x){ return x.split(':').map(Number); });
  });
  H = csv.trim().split('\n').map(function(line, i){
    const p = line.split(',');
    const d = p[8].split(';').map(function(x){ return x.split(':').map(Number); });
    const g = +p[5], w = +p[6];
    const wr = (w + 15) / (g + 30);
    const pp = P[+p[0]] || [[0,0],[0,0],[0,0],[0,0],[0,0]];
    const pt = pp.reduce(function(a, x){ return a + x[0]; }, 0);
    return {
      i: i, id: +p[0], name: p[1], attr: p[2], atk: p[3], roles: p[4].split('|'),
      g: g, w: w, bans: +p[7], slug: p[9],
      wr: wr,
      rawWr: g ? w / g : 0.5,
      stageG: d.map(function(x){ return x[0]; }),
      stageWr: d.map(function(x){ return (x[1] + 20) / (x[0] + 40); }),
      // pro games at positions 1-5 (lane role + farm order within each lane)
      posG: pp.map(function(x){ return x[0]; }),
      posShare: pp.map(function(x){ return (x[0] + 0.5) / (pt + 2.5); }),
      // win-rate difference at each position, only where the hero is really played there (15%+ of its games), shrunk hard
      posAdj: pp.map(function(x){ if ((x[0] + 0.5) / (pt + 2.5) < 0.15) return 0; const v = (x[1] + 200 * wr) / (x[0] + 200) - wr; return Math.max(-0.02, Math.min(0.02, v)); })
    };
  });
  N = H.length;
  return H;
}
function pk(i, j){ return i * N - (i * (i + 1)) / 2 + (j - i - 1); }
function dec(c){ return (ALPH.indexOf(c) - 31) / 100; }
function vs(a, b){ if (a === b) return 0; return a < b ? dec(VS[pk(a, b)]) : -dec(VS[pk(b, a)]); }
function syn(a, b){ if (a === b) return 0; return a < b ? dec(SY[pk(a, b)]) : dec(SY[pk(b, a)]); }
function has(h, r){ return H[h].roles.indexOf(r) >= 0; }

/* hero strength by stage: 0 early, 1 mid, 2 late (pro win rate in <30, 30-42, >42 min games) */
function stageWr(h, s){
  const w = H[h].stageWr;
  if (s === 0) return w[0];
  if (s === 1) return 0.5 * w[0] + 0.5 * w[1];
  return 0.3 * w[1] + 0.7 * w[2];
}
function logit(p){ return Math.log(p / (1 - p)); }
function sig(x){ return 1 / (1 + Math.exp(-x)); }

function comp(team, s){
  if (team.length < 5) return 0;
  let sup = 0, car = 0, ini = 0, dis = 0, dur = 0;
  team.forEach(function(h){
    if (has(h,'Support')) sup++;
    if (has(h,'Carry')) car++;
    if (has(h,'Initiator')) ini++;
    if (has(h,'Disabler')) dis++;
    if (has(h,'Durable')) dur++;
  });
  let c = 0;
  if (sup === 0) c -= 0.035; else if (sup >= 4) c -= 0.02;
  if (car === 0) c -= (s === 2 ? 0.05 : 0.02);
  if (ini === 0) c -= 0.02;
  if (dis <= 1) c -= 0.02;
  if (dur === 0) c -= 0.015;
  return c;
}

/* ---------- positions ----------
   A positioned team is an array of 5 heroes where index 0..4 = position 1..5.
   Radiant's safe lane is bottom, Dire's safe lane is top. */
const POS = [
  { n: 1, name: 'Carry', lane: 'safe' }, { n: 2, name: 'Mid', lane: 'mid' }, { n: 3, name: 'Offlane', lane: 'off' },
  { n: 4, name: 'Soft support', lane: 'off' }, { n: 5, name: 'Hard support', lane: 'safe' }
];
// how much a position's fit matters in each stage (each row averages 1): supports early, carries late
const POSW = [[0.85, 1.2, 1.1, 1.0, 0.85], [1.0, 1.15, 1.0, 0.95, 0.9], [1.35, 1.1, 0.95, 0.85, 0.75]];
const LANEW = [0.8, 0.3, 0];
const FITK = 0.06;
function share(h, p){ return H[h].posShare[p]; }
// win-rate points lost for playing a hero where pros rarely play it (none above 15% of its games)
function fitPen(h, p){ const s = H[h].posShare[p]; return s >= 0.15 ? 0 : -FITK * Math.pow(1 - s / 0.15, 1.3); }
const PERMS = (function(){ const out = []; (function rec(a, rest){ if (!rest.length) return out.push(a); rest.forEach(function(x, i){ rec(a.concat([x]), rest.slice(0, i).concat(rest.slice(i + 1))); }); })([], [0, 1, 2, 3, 4]); return out; })();
function teamPosValue(T){ // a positioned team's own strength, stage-weighted like the overall win chance
  let v = 0;
  for (let s = 0; s < 3; s++){ let x = 0; for (let p = 0; p < 5; p++){ const h = T[p]; x += stageWr(h, s) - 0.5 + POSW[s][p] * (H[h].posAdj[p] + fitPen(h, p)); } v += [0.3, 0.4, 0.3][s] * x; }
  return v;
}
// "Pro positions": the most likely assignment given how often pros play each hero at each position
// (product of shares). Win-rate value only breaks near-ties.
function bestOrder(T){
  if (T.length !== 5) return T.slice();
  let best = null, bv = -1e9;
  PERMS.forEach(function(perm){
    const o = perm.map(function(i){ return T[i]; });
    let v = 0; for (let p = 0; p < 5; p++) v += Math.log(share(o[p], p));
    v += 2 * teamPosValue(o);
    if (v > bv){ bv = v; best = o; }
  });
  return best;
}
// how well a partial team can still cover distinct positions (sum of best shares)
function coverage(T){
  if (!T.length) return 0;
  let best = 0;
  PERMS.forEach(function(perm){ let v = 0; for (let i = 0; i < T.length; i++){ const sh = share(T[i], perm[i]); v += sh < 0.15 ? 0 : Math.min(1, sh / 0.35); } if (v > best) best = v; });
  return best;
}
// lane matchups from Radiant's side. Each side lane: Radiant pair vs Dire pair.
function lanes(R, D){
  function edge(rs, ds){
    let m = 0; rs.forEach(function(a){ ds.forEach(function(b){ m += vs(a, b); }); }); m /= rs.length * ds.length;
    let e = 0; rs.forEach(function(a){ e += stageWr(a, 0) - 0.5; }); ds.forEach(function(b){ e -= stageWr(b, 0) - 0.5; });
    let f = 0; rs.forEach(function(a){ f += fitPen(a, R.indexOf(a)); }); ds.forEach(function(b){ f -= fitPen(b, D.indexOf(b)); });
    return { matchup: m, edge: m + 0.5 * e / rs.length + f / rs.length };
  }
  return [
    Object.assign({ lane: 'top', rad: [R[2], R[3]], dire: [D[0], D[4]], radRole: 'offlane', direRole: 'safe lane' }, edge([R[2], R[3]], [D[0], D[4]])),
    Object.assign({ lane: 'mid', rad: [R[1]], dire: [D[1]], radRole: 'mid', direRole: 'mid' }, edge([R[1]], [D[1]])),
    Object.assign({ lane: 'bot', rad: [R[0], R[4]], dire: [D[2], D[3]], radRole: 'safe lane', direRole: 'offlane' }, edge([R[0], R[4]], [D[2], D[3]]))
  ];
}

/* Evaluate two lineups. Partial lineups (during the draft) skip position terms. Full lineups are
   read as position-ordered when `positioned`; otherwise each team gets its best position order. */
function evaluate(R, D, positioned){
  const full = R.length === 5 && D.length === 5;
  if (full && !positioned){ R = bestOrder(R); D = bestOrder(D); }
  const out = { stages: [], R: R, D: D, positioned: full };
  let vsSum = 0; const pairs = [];
  R.forEach(function(a){ D.forEach(function(b){ const v = vs(a, b); vsSum += v; pairs.push({ a: a, b: b, v: v }); }); });
  function synTeam(T){ let s = 0; const l = [];
    for (let x = 0; x < T.length; x++) for (let y = x + 1; y < T.length; y++){ const v = syn(T[x], T[y]); s += v; l.push({ a: T[x], b: T[y], v: v }); }
    return { s: s, l: l }; }
  const sR = synTeam(R), sD = synTeam(D);
  const ln = full ? lanes(R, D) : null;
  out.lanes = ln;
  for (let s = 0; s < 3; s++){
    let hr = 0, hd = 0, fr = 0, fd = 0;
    // hero strength is the hero's own; position fit (and how well it does at that position) counts more where the position matters
    R.forEach(function(h, p){ hr += stageWr(h, s) - 0.5; if (full) fr += POSW[s][p] * (fitPen(h, p) + H[h].posAdj[p]); });
    D.forEach(function(h, p){ hd += stageWr(h, s) - 0.5; if (full) fd += POSW[s][p] * (fitPen(h, p) + H[h].posAdj[p]); });
    const parts = { hero: hr - hd, matchup: vsSum / 5, synergy: (sR.s - sD.s) / 2, comp: comp(R, s) - comp(D, s),
      lanes: full ? LANEW[s] * (ln[0].matchup + ln[1].matchup + ln[2].matchup) : 0, fit: fr - fd };
    const diff = parts.hero + parts.matchup + parts.synergy + parts.comp + parts.lanes + parts.fit;
    const p = sig(4 * 0.9 * diff + logit(META.radiantWin));
    out.stages.push({ p: p, parts: parts, heroR: hr, heroD: hd });
  }
  pairs.sort(function(x, y){ return Math.abs(y.v) - Math.abs(x.v); });
  out.pairs = pairs; out.synR = sR.l.sort(function(x,y){return y.v-x.v;}); out.synD = sD.l.sort(function(x,y){return y.v-x.v;});
  out.overall = 0.3 * out.stages[0].p + 0.4 * out.stages[1].p + 0.3 * out.stages[2].p;
  return out;
}

function contest(h){ return (H[h].g + H[h].bans) / META.matches; }

/* Marginal value of adding hero h to team A facing E */
function pickValue(h, A, E){
  let v = H[h].wr - 0.5;
  E.forEach(function(e){ v += vs(h, e) / 5; });
  A.forEach(function(a){ v += syn(h, a) / 2; });
  const need = roleNeed(A);
  if (need.ini && (has(h,'Initiator'))) v += 0.012;
  // fill open positions: a hero pros only play at a position the team already covers is worth less
  if (A.length && A.length < 5) v += 0.045 * A.length * (coverage(A.concat([h])) - coverage(A) - 0.75);
  v += 0.03 * Math.min(1, contest(h) * 2);
  return v;
}
function countRole(T, r){ return T.filter(function(h){ return has(h, r); }).length; }
function roleNeed(A){
  const left = 5 - A.length;
  return {
    sup: countRole(A,'Support') < 2 && left <= 4 - countRole(A,'Support') + 1,
    car: countRole(A,'Carry') < 1 && left <= 3,
    ini: countRole(A,'Initiator') < 1 && left <= 2
  };
}

/* ---------- seeded RNG ---------- */
function rng(seed){ let s = seed >>> 0 || 1; return function(){ s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

/* Bot draft action. level: 0 easy,1 normal,2 hard */
function botChoose(kind, mine, theirs, unavailable, level, rand){
  const pool = [];
  for (let h = 0; h < N; h++) if (!unavailable[h]) pool.push(h);
  let scored;
  if (kind === 'pick') scored = pool.map(function(h){ return { h: h, v: pickValue(h, mine, theirs) }; });
  else scored = pool.map(function(h){ return { h: h, v: pickValue(h, theirs, mine) + 0.04 * contest(h) }; });
  scored.sort(function(a, b){ return b.v - a.v; });
  const top = [3, 2, 1][level] * ({0:6,1:2,2:1}[level]);
  const k = Math.min(scored.length, [14, 5, 2][level]);
  const r = rand();
  return scored[Math.floor(r * r * k)].h;
  void top;
}

/* ---------- map structures ---------- */
const LANES = ['top', 'mid', 'bot'];
function freshSide(){
  return { tw: { top: [1,1,1], mid: [1,1,1], bot: [1,1,1] }, t4: [1,1], rax: { top: [1,1], mid: [1,1], bot: [1,1] }, anc: 1 };
}
function clone(o){ return JSON.parse(JSON.stringify(o)); }
function towersUp(sd){ let n = sd.t4[0] + sd.t4[1]; LANES.forEach(function(l){ n += sd.tw[l][0] + sd.tw[l][1] + sd.tw[l][2]; }); return n; }
function raxUp(sd){ let n = 0; LANES.forEach(function(l){ n += sd.rax[l][0] + sd.rax[l][1]; }); return n; }

/* ---------- match simulation ---------- */
const KILLW = { Carry: 1.35, Nuker: 1.3, Escape: 1.05, Initiator: 1.0, Disabler: 0.95, Durable: 0.9, Pusher: 1.0, Support: 0.6 };
const DEATHW = { Support: 1.4, Carry: 0.85, Durable: 0.75, Escape: 0.85 };
// kill and death share by position and stage
const KILLP = [[0.8, 1.4, 1.1, 1.0, 0.6], [1.1, 1.3, 1.0, 0.85, 0.6], [1.5, 1.2, 0.95, 0.75, 0.55]];
const DEATHP = [[0.9, 0.9, 1.2, 1.1, 1.0], [0.8, 0.9, 1.0, 1.15, 1.3], [0.8, 0.9, 1.0, 1.15, 1.3]];
const LANEK = 9; // logit per win-rate point of lane edge

/* R and D are position-ordered (index 0 = position 1). */
function simulate(R, D, seed){
  const rand = rng(seed);
  const ev = evaluate(R, D, true);
  const LN3 = ev.lanes.map(function(l){ return { lane: l.lane, rad: l.rad, dire: l.dire, radRole: l.radRole, direRole: l.direRole, edge: l.edge, kills: [0, 0], winner: null }; });
  const teams = [R, D];
  const side = [freshSide(), freshSide()];
  const kda = {}; R.concat(D).forEach(function(h){ kda[h] = [0,0,0]; });
  const st = {
    kills: [0, 0], lead: 0, aegis: null, rosh: { alive: true, kills: [0, 0], respawn: null },
    torm: [{ alive: false, spawn: 20, kills: 0 }, { alive: false, spawn: 20, kills: 0 }], shards: [0, 0], fb: false,
    roshTotal: 0
  };
  const frames = []; const events = [];
  let winner = null, endT = null;
  function gauss(){ return Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(6.2832 * rand()); }
  const f0 = gauss() * FORMW; const form = [f0 + gauss() * 0.25, f0 + gauss() * 0.25, f0 + gauss() * 0.3]; // match-day form: execution the draft can't see

  function poisson(l){ let L = Math.exp(-l), k = 0, p = 1; do { k++; p *= rand(); } while (p > L); return k - 1; }
  function pickW(arr, wf){ let tot = 0; const ws = arr.map(function(x){ const w = wf(x); tot += w; return w; }); let r = rand() * tot; for (let i = 0; i < arr.length; i++){ r -= ws[i]; if (r <= 0) return arr[i]; } return arr[arr.length - 1]; }
  function roleW(h, table){ let w = 1; H[h].roles.forEach(function(r){ if (table[r]) w *= Math.pow(table[r], 0.6); }); return w; }
  function stageOf(t){ return t <= 15 ? 0 : t <= 30 ? 1 : 2; }
  function leadLogit(t, team){ const l = team === 0 ? st.lead : -st.lead; return 0.42 * l / (3500 + 260 * t); }
  function structEdge(team){ const o = 1 - team; return (towersUp(side[team]) - towersUp(side[o])) * 0.025 + (raxUp(side[team]) - raxUp(side[o])) * 0.05; }
  function fightP(t, extra){ // radiant win prob for a fight
    const s = stageOf(t);
    let x = DRAFTW * logit(ev.stages[s].p) + form[s] + leadLogit(t, 0) + (extra || 0);
    if (st.aegis) x += st.aegis.team === 0 ? 0.42 : -0.42;
    x += (st.shards[0] - st.shards[1]) * 0.07;
    return sig(x);
  }
  function livePr(t){ const s = stageOf(t); return sig(logit(ev.stages[s].p) + 1.3 * leadLogit(t, 0) + structEdge(0) * 1.2); }
  function log(t, sec, type, team, text, extra){ const e = { t: t, sec: sec, type: type, team: team, text: text }; if (extra) for (const k in extra) e[k] = extra[k]; events.push(e); return e; }

  function nextTarget(att){ // returns description of next structure attacker can hit, per lane
    const def = side[1 - att]; const opts = [];
    LANES.forEach(function(l){
      const tw = def.tw[l];
      if (tw[0]) opts.push({ lane: l, kind: 'tower', tier: 1 });
      else if (tw[1]) opts.push({ lane: l, kind: 'tower', tier: 2 });
      else if (tw[2]) opts.push({ lane: l, kind: 'tower', tier: 3 });
      else if (def.rax[l][0] || def.rax[l][1]) opts.push({ lane: l, kind: 'rax' });
    });
    const anyT3 = LANES.some(function(l){ return !def.tw[l][2]; });
    if (anyT3 && (def.t4[0] || def.t4[1])) opts.push({ lane: 'base', kind: 't4' });
    if (!def.t4[0] && !def.t4[1]) opts.push({ lane: 'base', kind: 'ancient' });
    return opts;
  }
  const TEAM = ['Radiant', 'Dire'];
  const LN = { top: 'top', mid: 'middle', bot: 'bottom', base: 'base' };
  function takeStructure(t, att, o, sec){
    const def = side[1 - att];
    if (o.kind === 'tower'){
      def.tw[o.lane][o.tier - 1] = 0; st.lead += (att === 0 ? 1 : -1) * (o.tier === 1 ? 650 : o.tier === 2 ? 800 : 950);
      log(t, sec, 'tower', att, TEAM[att] + ' destroyed ' + TEAM[1 - att] + ' ' + LN[o.lane] + ' tier ' + o.tier + ' tower', { lane: o.lane, tier: o.tier, victim: 1 - att });
    } else if (o.kind === 'rax'){
      const r = def.rax[o.lane]; const both = rand() < 0.75;
      if (r[0]) r[0] = 0; if (both || !r[0]) r[1] = 0;
      st.lead += (att === 0 ? 1 : -1) * 900;
      const all = raxUp(def) === 0;
      log(t, sec, 'rax', att, TEAM[att] + ' broke ' + TEAM[1 - att] + ' ' + LN[o.lane] + ' barracks' + (all ? ', mega creeps unleashed' : ''), { lane: o.lane, victim: 1 - att });
    } else if (o.kind === 't4'){
      if (def.t4[0]) def.t4[0] = 0; else def.t4[1] = 0;
      log(t, sec, 'tower', att, TEAM[att] + ' destroyed a ' + TEAM[1 - att] + ' tier 4 tower', { lane: 'base', tier: 4, victim: 1 - att });
    } else if (o.kind === 'ancient'){
      def.anc = 0; winner = att; endT = t;
      log(t, sec, 'ancient', att, TEAM[att] + ' destroyed the ' + TEAM[1 - att] + ' Ancient', { victim: 1 - att });
    }
  }
  function attemptPush(t, att, power, sec){ // power: number of structures it may take
    for (let n = 0; n < power && winner === null; n++){
      const opts = nextTarget(att); if (!opts.length) return;
      // prefer outer towers; high-ground needs time
      const o = pickW(opts, function(x){
        if (x.kind === 'tower') return x.tier === 1 ? 6 : x.tier === 2 ? (t >= 14 ? 3 : 0.4) : (t >= 24 ? 1.6 : 0.15);
        if (x.kind === 'rax') return 2.5; if (x.kind === 't4') return 2; return 3;
      });
      if (o.kind === 'tower' && o.tier === 3 && t < 22 && rand() < 0.7) return;
      if (o.kind === 'ancient' && rand() < 0.2) return;
      takeStructure(t, att, o, sec);
    }
  }
  function fight(t, size, place, sec, extra, lane){
    const q = lane ? sig(0.5 * DRAFTW * logit(ev.stages[0].p) + LANEK * lane.edge + form[0] + leadLogit(t, 0)) : fightP(t, extra);
    let w = rand() < q ? 0 : 1; const l = 1 - w;
    let wk = Math.max(1, Math.round(size * (0.62 + rand() * 0.38)));
    let lk = size - wk; if (lk > wk){ const z = wk; wk = lk; lk = z; }
    if (size <= 2 && rand() < 0.75) lk = 0, wk = size;
    const s = stageOf(t);
    function credit(team, n){
      const killers = lane ? (team === 0 ? lane.rad : lane.dire) : teams[team];
      const victims = lane ? (team === 0 ? lane.dire : lane.rad) : teams[1 - team];
      if (lane) lane.kills[team] += n;
      const dead = {};
      for (let i = 0; i < n; i++){
        const k = pickW(killers, function(h){ return KILLP[s][teams[team].indexOf(h)] * Math.sqrt(roleW(h, KILLW)) * (0.6 + stageWr(h, s)); });
        const alive = victims.filter(function(h){ return !dead[h]; });
        const v = pickW(alive.length ? alive : victims, function(h){ return DEATHP[s][teams[1 - team].indexOf(h)] * Math.sqrt(roleW(h, DEATHW)); });
        dead[v] = 1;
        kda[k][0]++; kda[v][1]++;
        killers.forEach(function(a){ if (a !== k && rand() < (size >= 3 ? 0.55 : 0.4)) kda[a][2]++; });
        st.kills[team]++;
        st.lead += (team === 0 ? 1 : -1) * (180 + 11 * t);
        if (!st.fb){ st.fb = true; log(t, sec, 'fb', team, 'First Blood: ' + H[k].name + ' killed ' + H[v].name, { killer: k, victim: v }); }
        else if (size <= 2) log(t, sec, 'kill', team, H[k].name + ' killed ' + H[v].name, { killer: k, victim: v, place: place });
      }
    }
    credit(w, wk); credit(l, lk);
    if (st.aegis && st.aegis.team === l && wk > 0){ st.aegis = null; }
    if (size >= 3) log(t, sec, 'fight', w, 'Teamfight at ' + place + ': ' + TEAM[w] + ' won ' + wk + '–' + lk, { wk: wk, lk: lk, place: place });
    return { w: w, margin: wk - lk };
  }

  for (let t = 1; t <= 90 && winner === null; t++){
    const s = stageOf(t);
    // timers
    if (st.aegis && t >= st.aegis.until){ log(t, 0, 'aegis', st.aegis.team, 'Aegis expired for ' + TEAM[st.aegis.team]); st.aegis = null; }
    if (!st.rosh.alive && st.rosh.respawn && t >= st.rosh.respawn[0] && (t >= st.rosh.respawn[1] || rand() < 0.4)){ st.rosh.alive = true; st.rosh.respawn = null; log(t, 0, 'roshup', -1, 'Roshan has respawned'); }
    st.torm.forEach(function(tm, i){ if (!tm.alive && t >= tm.spawn){ tm.alive = true; if (t === 20 && i === 0) log(t, 0, 'tormup', -1, 'Tormentors have spawned on both sides of the map'); else if (t > 20) log(t, 0, 'tormup', -1, (i === 0 ? 'Radiant' : 'Dire') + '-side Tormentor is back'); } });

    // fights
    const lam = [1.05, 1.62, 1.9][s];
    const avgSize = [1.35, 2.5, 3.6][s];
    const nf = poisson(lam / avgSize);
    for (let f = 0; f < nf && winner === null; f++){
      const sec = Math.floor(rand() * 60);
      let size;
      if (s === 0) size = rand() < 0.72 ? 1 : 2 + (rand() < 0.25 ? 1 : 0);
      else if (s === 1) size = rand() < 0.45 ? 1 + (rand() < 0.4 ? 1 : 0) : 3 + Math.floor(rand() * 4);
      else size = rand() < 0.3 ? 1 + (rand() < 0.4 ? 1 : 0) : 3 + Math.floor(rand() * 6);
      if (t <= 10){ // laning phase: kills happen in lanes between the heroes laning against each other
        const place = pickW(['top lane', 'mid lane', 'bot lane', 'the jungle'], function(x){ return x === 'the jungle' ? 0.3 : x === 'mid lane' ? 0.85 : 1; });
        const lane = place === 'the jungle' ? null : LN3[['top lane', 'mid lane', 'bot lane'].indexOf(place)];
        fight(t, lane && lane.lane === 'mid' ? 1 : Math.min(size, 2), place, sec, 0, lane);
        continue;
      }
      const place = pickW(['top lane', 'mid lane', 'bot lane', 'the jungle', 'the river'], function(x){ return x === 'the river' && st.rosh.alive && t > 14 ? 2 : 1; });
      const r = fight(t, size, place, sec);
      if (size >= 3 && r.margin >= 2){
        // convert the fight
        const roll = rand();
        if (st.rosh.alive && t >= 14 && roll < 0.38){ killRosh(t, r.w, sec + 1); }
        else if (st.torm.some(function(x){ return x.alive; }) && roll < 0.5){ const i = st.torm[r.w].alive ? r.w : 1 - r.w; takeTorm(t, r.w, i, sec + 1); }
        else attemptPush(t, r.w, r.margin >= 4 ? 2 + (t > 30 ? 1 : 0) : 1, Math.min(59, sec + 2));
      } else if (r.margin >= 1 && s >= 1 && rand() < (size >= 3 ? 0.6 : 0.2)){
        attemptPush(t, r.w, 1, Math.min(59, sec + 2));
      }
    }
    if (winner !== null) break;

    // end of the laning phase: each lane is won, lost or even
    if (t === 10) LN3.forEach(function(L){
      const x = LANEK * L.edge + (L.kills[0] - L.kills[1]) * 0.35 + gauss() * 0.45 + 0.5 * form[0];
      L.winner = x > 0.4 ? 0 : x < -0.4 ? 1 : -1;
      if (L.winner >= 0) st.lead += (L.winner === 0 ? 1 : -1) * 550;
      const nm = function(a){ return a.map(function(h){ return H[h].name; }).join(' and '); };
      const where = L.lane === 'mid' ? 'mid' : L.lane === 'top' ? 'the top lane' : 'the bottom lane';
      const w = L.winner, txt = w < 0
        ? 'Laning: ' + where + ' went even (' + nm(L.rad) + ' vs ' + nm(L.dire) + ')'
        : 'Laning: ' + TEAM[w] + ' won ' + where + ' (' + nm(w ? L.dire : L.rad) + ' over ' + nm(w ? L.rad : L.dire) + ')';
      log(t, 59, 'lane', w, txt, { lane: L.lane });
    });

    // laning / split-push pressure (early towers fall in the lanes a team won)
    for (let team = 0; team < 2 && winner === null; team++){
      const adv = team === 0 ? fightP(t) : 1 - fightP(t);
      let base = t < 7 ? 0 : t < 12 ? 0.11 : t < 20 ? 0.2 : t < 30 ? 0.18 : 0.14;
      if (rand() < base * (0.4 + 1.2 * adv)) {
        const opts = nextTarget(team).filter(function(o){ return o.kind === 'tower' && (o.tier === 1 || (o.tier === 2 && t >= 16)); });
        if (opts.length){
          const o = t < 16 ? pickW(opts, function(x){ const L = LN3.find(function(y){ return y.lane === x.lane; }); return !L || L.winner === null || L.winner === -1 ? 1 : L.winner === team ? 3 : 0.4; })
            : opts[Math.floor(rand() * opts.length)];
          takeStructure(t, team, o, 20 + Math.floor(rand() * 39));
        }
      }
    }

    // sieges by the stronger side
    if (t >= 14 && winner === null){
      const pr = fightP(t, structEdge(0)), team = pr >= 0.5 ? 0 : 1, edge = Math.abs(pr - 0.5) * 2;
      if (rand() < 0.09 + 0.4 * edge + (t > 30 ? 0.1 : 0)) attemptPush(t, team, 1 + (edge > 0.5 && t > 25 ? 1 : 0), 10 + Math.floor(rand() * 40));
    }
    if (winner !== null) break;
    // roshan attempts without a big fight
    if (st.rosh.alive && t >= 17){
      const pr = fightP(t);
      if (rand() < 0.11 + 0.22 * Math.abs(pr - 0.5) + (t > 35 ? 0.06 : 0)){
        const team = rand() < pr ? 0 : 1;
        if (rand() < 0.35){ const r = fight(t, 2 + Math.floor(rand() * 4), 'Roshan’s lair', 40); if (r.w === team || rand() < 0.5) killRosh(t, r.w, 50); }
        else killRosh(t, team, 45);
      }
    }
    // tormentors
    st.torm.forEach(function(tm, i){
      if (tm.alive && rand() < 0.07){ const pr = fightP(t); let team = rand() < (i === 0 ? 0.65 : 0.35) ? 0 : 1; if (rand() < Math.abs(pr - 0.5)) team = pr > 0.5 ? 0 : 1; takeTorm(t, team, i, 30); }
    });

    frames.push(snapshot(t));
  }
  if (winner === null){ // safety: decide by live probability
    const t = frames.length; winner = livePr(t) >= 0.5 ? 0 : 1; endT = t; side[1 - winner].anc = 0;
    log(t, 59, 'ancient', winner, TEAM[winner] + ' destroyed the ' + TEAM[1 - winner] + ' Ancient', { victim: 1 - winner });
    frames.push(snapshot(t));
  } else frames.push(snapshot(endT));

  function killRosh(t, team, sec){
    st.rosh.alive = false; st.rosh.kills[team]++; st.roshTotal++;
    st.rosh.respawn = [t + 8, t + 11];
    st.aegis = { team: team, until: t + 5 };
    st.lead += (team === 0 ? 1 : -1) * 600;
    const n = st.roshTotal;
    const loot = n === 1 ? 'Aegis' : n === 2 ? 'Aegis + Cheese' : 'Aegis, Cheese + Refresher Shard';
    log(t, sec, 'rosh', team, TEAM[team] + ' slew Roshan (' + ordinal(n) + '): ' + loot, { n: n });
  }
  function takeTorm(t, team, i, sec){
    const tm = st.torm[i]; tm.alive = false; tm.spawn = t + 10; tm.kills++;
    st.shards[team]++;
    log(t, sec, 'torm', team, TEAM[team] + ' defeated the ' + (i === 0 ? 'Radiant' : 'Dire') + '-side Tormentor for an Aghanim’s Shard', { which: i });
  }
  function snapshot(t){
    return { t: t, kills: st.kills.slice(), lead: Math.round(st.lead), side: clone(side), aegis: st.aegis ? clone(st.aegis) : null,
      rosh: clone(st.rosh), torm: clone(st.torm), shards: st.shards.slice(), p: livePr(t), kda: clone(kda), day: Math.floor(t / 5) % 2 === 0 };
  }
  events.sort(function(a, b){ return a.t - b.t || a.sec - b.sec; });
  return { ev: ev, frames: frames, events: events, winner: winner, endT: endT, seed: seed, lanes: LN3 };
}
function ordinal(n){ return n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'); }

/* Captains Mode order (team 0 = first pick). type: 'ban' | 'pick' */
const CM = [
  ['ban',0],['ban',0],['ban',1],['ban',1],['ban',0],['ban',1],['ban',1],
  ['pick',0],['pick',1],
  ['ban',0],['ban',0],['ban',1],
  ['pick',1],['pick',0],['pick',0],['pick',1],['pick',1],['pick',0],
  ['ban',0],['ban',1],['ban',0],['ban',1],
  ['pick',0],['pick',1]
];
const PHASES = [[0,6,'Ban phase 1'],[7,8,'Pick phase 1'],[9,11,'Ban phase 2'],[12,17,'Pick phase 2'],[18,21,'Ban phase 3'],[22,23,'Pick phase 3']];

return { load: load, heroes: function(){ return H; }, vs: vs, syn: syn, evaluate: evaluate, pickValue: pickValue,
  botChoose: botChoose, simulate: simulate, rng: rng, CM: CM, PHASES: PHASES, META: META, stageWr: stageWr,
  towersUp: towersUp, raxUp: raxUp, contest: contest, LANES: LANES, has: has,
  POS: POS, share: share, fitPen: fitPen, bestOrder: bestOrder, lanes: lanes, teamPosValue: teamPosValue };
})();
if (typeof module !== 'undefined') module.exports = DC;
