/* Draft Clash room server.
 * One room = two seats (0 Radiant, 1 Dire). The server owns the draft: it checks turn order,
 * seat and hero availability, then broadcasts the whole room. After the draft each captain sets
 * positions 1-5 for their heroes; an order stays hidden from the opponent until both lock in.
 * Then the server picks one match seed; both browsers run the same deterministic simulation
 * from it. Check-ins (match start, 15:00, 30:00) wait until both players are ready.
 */
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 10000;
const HEROES = 127;
const CM = [ // [kind, 0 = first-pick team, 1 = other team]
  ['ban',0],['ban',0],['ban',1],['ban',1],['ban',0],['ban',1],['ban',1],
  ['pick',0],['pick',1],
  ['ban',0],['ban',0],['ban',1],
  ['pick',1],['pick',0],['pick',0],['pick',1],['pick',1],['pick',0],
  ['ban',0],['ban',1],['ban',0],['ban',1],
  ['pick',0],['pick',1]
];
const CHECKPOINTS = ['start', '15', '30'];
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ROOM_IDLE_MS = 3 * 60 * 60 * 1000;      // drop rooms untouched for 3 hours
const ROOM_EMPTY_MS = 30 * 60 * 1000;         // or with nobody connected for 30 minutes

const rooms = new Map();

function newCode(){
  let c;
  do { c = Array.from({ length: 5 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join(''); } while (rooms.has(c));
  return c;
}
function cleanName(n, fallback){ const s = String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 18); return s || fallback; }
function freshDraft(){ return { step: 0, picks: [[], []], bans: [[], []], used: {} }; }
function turnTeam(room, step){ const t = CM[step][1]; return t === 0 ? room.first : 1 - room.first; }

function view(room, seat){
  return {
    t: 'room', code: room.code, seat, hostSeat: room.hostSeat, first: room.first, phase: room.phase,
    locked: room.orders.map(o => !!o), myOrder: room.orders[seat] || null,
    names: room.seats.map((s, i) => s ? s.name : (i ? 'Dire' : 'Radiant')),
    present: room.seats.map(s => !!s), online: room.seats.map(s => !!(s && s.ws)),
    draft: room.draft, seed: room.seed, round: room.round,
    ready: room.ready, passed: room.passed
  };
}
function send(ws, msg){ if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(room){ room.touched = Date.now(); room.seats.forEach((s, i) => { if (s && s.ws) send(s.ws, view(room, i)); }); }
function fail(ws, msg, code){ send(ws, { t: 'err', msg, code: code || 'bad' }); }

function attach(ws, room, seat){
  // a seat holds one socket; a newer tab replaces an older one
  const s = room.seats[seat];
  if (s.ws && s.ws !== ws){ send(s.ws, { t: 'err', code: 'replaced', msg: 'This room was opened in another tab.' }); try { s.ws.close(); } catch (_) {} }
  s.ws = ws; ws.room = room; ws.seat = seat;
  send(ws, { t: 'seat', code: room.code, seat, token: s.token });
}

function resetRound(room){ room.ready = {}; room.passed = []; }

const handlers = {
  host(ws, m){
    const code = newCode();
    const seat = m.side === 0 || m.side === 1 ? m.side : crypto.randomInt(2);
    const first = m.fp === 0 || m.fp === 1 ? m.fp : crypto.randomInt(2);
    const room = { code, first, hostSeat: seat, phase: 'lobby', seats: [null, null], draft: freshDraft(), orders: [null, null], seed: 0, round: 0, ready: {}, passed: [], touched: Date.now(), emptySince: null };
    room.seats[seat] = { name: cleanName(m.name, seat ? 'Dire' : 'Radiant'), token: crypto.randomBytes(16).toString('hex'), ws: null };
    rooms.set(code, room);
    attach(ws, room, seat); broadcast(room);
  },
  join(ws, m){
    const room = rooms.get(String(m.code || '').toUpperCase().trim());
    if (!room) return fail(ws, 'No room with that code. Check the letters, or ask the host for a new code.', 'noroom');
    const seat = room.seats[0] ? (room.seats[1] ? -1 : 1) : 0;
    if (seat < 0) return fail(ws, 'That room already has two players.', 'full');
    room.seats[seat] = { name: cleanName(m.name, seat ? 'Dire' : 'Radiant'), token: crypto.randomBytes(16).toString('hex'), ws: null };
    if (room.phase === 'lobby') room.phase = 'draft';
    attach(ws, room, seat); broadcast(room);
  },
  resume(ws, m){
    const room = rooms.get(String(m.code || '').toUpperCase());
    if (!room) return fail(ws, 'That room has closed.', 'gone');
    const seat = room.seats.findIndex(s => s && s.token === m.token);
    if (seat < 0) return fail(ws, 'Your seat in that room is no longer held.', 'gone');
    attach(ws, room, seat); broadcast(room);
  },
  act(ws, m){
    const room = ws.room; if (!room) return;
    if (room.phase !== 'draft') return fail(ws, 'The draft is over.');
    const d = room.draft;
    if (m.step !== d.step) return send(ws, view(room, ws.seat)); // stale click: resync
    if (turnTeam(room, d.step) !== ws.seat) return fail(ws, 'Not your turn yet.');
    const h = m.h;
    if (!Number.isInteger(h) || h < 0 || h >= HEROES || d.used[h]) return fail(ws, 'That hero is not available.');
    d.used[h] = 1;
    (CM[d.step][0] === 'pick' ? d.picks : d.bans)[ws.seat].push(h);
    d.step++;
    if (d.step >= CM.length){ room.phase = 'positions'; room.orders = [null, null]; room.round++; resetRound(room); }
    broadcast(room);
  },
  positions(ws, m){ // order = this seat's five picks, index 0 = position 1. null unlocks.
    const room = ws.room; if (!room) return;
    if (room.phase !== 'positions' || m.round !== room.round) return send(ws, view(room, ws.seat));
    if (m.order === null){ room.orders[ws.seat] = null; return broadcast(room); }
    const mine = room.draft.picks[ws.seat];
    const o = m.order;
    if (!Array.isArray(o) || o.length !== 5 || new Set(o).size !== 5 || !o.every(h => mine.includes(h))) return fail(ws, 'Those positions do not match your five heroes.');
    room.orders[ws.seat] = o.slice();
    if (room.orders[0] && room.orders[1]){
      room.draft.picks = [room.orders[0].slice(), room.orders[1].slice()];
      room.phase = 'preview'; room.seed = crypto.randomInt(1, 4294967295); resetRound(room);
    }
    broadcast(room);
  },
  ready(ws, m){
    const room = ws.room; if (!room) return;
    const cp = String(m.cp);
    if (!CHECKPOINTS.includes(cp) || m.round !== room.round) return send(ws, view(room, ws.seat));
    if (cp === 'start' ? room.phase !== 'preview' : room.phase !== 'match') return send(ws, view(room, ws.seat));
    const r = room.ready[cp] || (room.ready[cp] = [false, false]);
    r[ws.seat] = true;
    if (r[0] && r[1] && !room.passed.includes(cp)){ room.passed.push(cp); if (cp === 'start') room.phase = 'match'; }
    broadcast(room);
  },
  rematch(ws){ // same draft, new match seed
    const room = ws.room; if (!room || (room.phase !== 'match' && room.phase !== 'preview')) return;
    room.phase = 'preview'; room.seed = crypto.randomInt(1, 4294967295); room.round++; resetRound(room);
    broadcast(room);
  },
  redraft(ws){ // fresh draft, first pick passes to the other team
    const room = ws.room; if (!room || room.phase === 'lobby' || room.phase === 'draft') return;
    room.phase = 'draft'; room.draft = freshDraft(); room.orders = [null, null]; room.first = 1 - room.first; room.seed = 0; room.round++; resetRound(room);
    broadcast(room);
  },
  leave(ws){
    const room = ws.room; if (!room) return;
    room.seats[ws.seat] = null; ws.room = null;
    if (!room.seats[0] && !room.seats[1]) { rooms.delete(room.code); return; }
    // the remaining player keeps the room; if a draft or match was underway it waits for a new opponent
    room.phase = 'lobby'; room.draft = freshDraft(); room.orders = [null, null]; room.seed = 0; room.round++; resetRound(room);
    room.hostSeat = room.seats[0] ? 0 : 1;
    broadcast(room);
  },
  ping(ws){ send(ws, { t: 'pong' }); }
};

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/'){
    res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
    res.end(`draft-clash room server: ${rooms.size} room(s)\n`);
    return;
  }
  res.writeHead(404); res.end();
});
const wss = new WebSocketServer({ server, maxPayload: 4096 });

wss.on('connection', ws => {
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (_) { return; }
    const h = m && handlers[m.t];
    if (h) { try { h(ws, m); } catch (e) { console.error(e); fail(ws, 'Server error.'); } }
  });
  ws.on('close', () => {
    const room = ws.room;
    if (room && room.seats[ws.seat] && room.seats[ws.seat].ws === ws){ room.seats[ws.seat].ws = null; broadcast(room); }
  });
});

setInterval(() => { // heartbeat + cleanup
  wss.clients.forEach(ws => { if (!ws.alive) return ws.terminate(); ws.alive = false; try { ws.ping(); } catch (_) {} });
  const now = Date.now();
  for (const [code, room] of rooms){
    const anyone = room.seats.some(s => s && s.ws);
    if (anyone) room.emptySince = null; else if (!room.emptySince) room.emptySince = now;
    if (now - room.touched > ROOM_IDLE_MS || (room.emptySince && now - room.emptySince > ROOM_EMPTY_MS)) rooms.delete(code);
  }
}, 30000);

server.listen(PORT, () => console.log('draft-clash room server on :' + PORT));
