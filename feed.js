/* MKSZ livescore feed → overlay state.
   Pure logic, no DOM and no network: control.html feeds it socket events, Node can require it for tests.

   The feed is an event log, not a snapshot: events can be re-sent (same UUID = edited) or arrive with
   `deleted: true`. So we keep every event and rebuild the whole state from the log each time, the same
   way the federation's own client does. Counting incrementally would drift after the first correction. */
(function (root) {
  'use strict';

  // Chronological order of period codes (from the livescore client).
  const CHRONO = {0:0,1:1,2:3,3:4,14:5,4:6,5:7,15:8,6:9,7:10,16:11,8:12,9:13,17:14,10:15,11:16,12:98,18:17,13:99};
  const chrono = p => p == null ? 0 : (CHRONO[String(p)] !== undefined ? CHRONO[String(p)] : (parseInt(p, 10) || 0));

  const GOAL_PTS = {gol: 1, gol7m: 1, gol2p: 2, gol6m: 2};      // 2p / 6m exist only in beach handball
  const SAVED = ['vedett', 'vedett7m', 'vedett6m'];
  const POST  = ['kapufa', 'kapufa7m', 'kapufa6m'];
  const MISS  = ['rontott', 'rontott7m', 'rontott6m'];
  const isPenalty = a => /[67]m$/.test(a);
  const ZONES = 18;                                             // court zones 0..16, 17 = penalty
  const FINAL_PERIOD = '13';

  function createStore() { return {items: new Map(), seq: 0}; }

  // Returns true when the log changed. `live` = arrived as it happened (not part of the history replay).
  function ingest(store, e, now, live) {
    if (!e || !e.UUID) return false;
    if (e.deleted) return store.items.delete(e.UUID);
    store.items.set(e.UUID, {e, at: arrivalTime(e, now, live), seq: store.seq++, live: !!live});
    return true;
  }
  // For replayed history the scorer's own timestamp says when the event really happened;
  // use it when it is believable, so the running clock is right after a mid-match reconnect.
  function arrivalTime(e, now, live) {
    if (live) return now;
    let ct = e.clientTime;
    if (typeof ct === 'string') ct = /^\d+$/.test(ct) ? Number(ct) : Date.parse(ct);
    if (typeof ct === 'number' && ct > 0 && ct < 1e11) ct *= 1000;          // seconds → ms
    return (typeof ct === 'number' && isFinite(ct) && ct <= now + 5000 && now - ct < 3 * 3600e3) ? Math.min(ct, now) : now;
  }

  const zStats = () => ({goals: 0, shots: 0, g7: 0, a7: 0, post: 0, miss: 0, block: 0, saved: 0, to: 0, saves: 0, faced: 0});
  const zPens = () => ({y: 0, s2: 0, r: 0, b: 0});
  const zeros = n => Array(n).fill(0);
  const teamOf = v => { const s = String(v || ''); const c = s.slice(-1); return (s.indexOf('team') === 0 && (c === 'A' || c === 'B')) ? c : null; };

  function blank() {
    return {
      matchId: null, type: 'TEREM', meta: {venue: '', competition: '', age: '', date: '', ts: 0},
      teams: {A: {name: '', short: '', logo: ''}, B: {name: '', short: '', logo: ''}},
      score: {a: 0, b: 0}, ht: null, period: '1', periodText: '', periodType: 'normal', periodLength: 30, finished: false,
      clock: {sec: 0, running: false, at: 0, cap: 0},
      stats: {A: zStats(), B: zStats()},
      gate: {A: zeros(9), B: zeros(9)}, gateShots: {A: zeros(9), B: zeros(9)},
      zones: {A: {g: zeros(ZONES), s: zeros(ZONES)}, B: {g: zeros(ZONES), s: zeros(ZONES)}},
      players: {}, officials: {A: [], B: []},
      gks: {A: null, B: null, list: {}}, emptyNet: {A: false, B: false}, timeouts: {A: 0, B: 0},
      pens: {A: zPens(), B: zPens()},
      timeline: [], lead: [], run: {team: null, n: 0}, bestRun: {A: {n: 0, from: 0, to: 0}, B: {n: 0, from: 0, to: 0}},
      lastGoal: null, events: 0, halfEnd: 0
    };
  }

  function build(store, matchId) {
    const S = blank(); S.matchId = matchId || null;
    const all = [...store.items.values()].sort((x, y) => x.seq - y.seq);

    /* ---- match set-up ---- */
    let periods = [];
    const initRec = all.filter(r => r.e.action === 'init').pop();
    if (initRec) {
      const q = initRec.e.params || {};
      S.type = q.rule === 'STRAND' ? 'STRAND' : 'TEREM';
      const tm = k => { const nm = String(q['team_' + k + '_name'] || '').trim(), sh = String(q['team_' + k + '_shortname'] || '').trim();
        return {name: nm, short: sh || nm, logo: q['team_' + k + '_logo'] || ''}; };
      S.teams.A = tm('a'); S.teams.B = tm('b');
      S.meta = {venue: q.letesitmeny_nev || '', competition: q.alverseny || '', age: q.korosztaly || '',
                date: (q.datum_teny || '') + (q.ido ? ' ' + q.ido : ''),
                ts: Number(initRec.e.date) || Number(initRec.e.clientTime) || 0};   // when the scorer opened the match
      S.periodLength = Number(q.period_length) || 30;
      let cum = 0;
      periods = (q.periods || []).slice().sort((x, y) => chrono(x.value) - chrono(y.value)).map(p => {
        const brk = p.type === 'zero' || p.type === 'extendedzero';
        const dur = brk ? 0 : (p.type === 'extended' ? 300 : S.periodLength * 60);
        if (String(p.value) === '1') cum = 0;
        cum += dur;
        return {value: String(p.value), text: p.text || '', type: p.type || 'normal', start: cum - dur, end: cum};
      });
      const put = (arr, team, entry) => (arr || []).forEach(pl => { if (pl && pl.id != null) S.players[pl.id] = newPlayer(pl, team, entry); });
      put(q.team_a_players, 'A', false); put(q.team_a_players_entry, 'A', true);
      put(q.team_b_players, 'B', false); put(q.team_b_players_entry, 'B', true);
      const offs = arr => (arr || []).map(o => ({name: o.name || '', jersey: o.jersey == null ? '' : o.jersey}));
      S.officials = {A: offs(q.team_a_officials), B: offs(q.team_b_officials)};
    }
    const pdef = v => periods.find(p => p.value === String(v)) || null;

    /* ---- running facts, in arrival order ---- */
    let periodAt = 0;
    all.forEach(r => {
      const e = r.e, p = e.params || {};
      if (e.action === 'player_entry' && p.player && p.player.id != null) {
        const t = teamOf(p.player.team); if (!t) return;
        const old = S.players[p.player.id];
        S.players[p.player.id] = Object.assign(old || newPlayer(p.player, t, false),
          {gk: !!p.player.goalkeeper, entry: false, team: t});
      } else if (e.action === 'periodchange') {
        const v = p.period != null ? p.period : e.period;
        if (v != null && chrono(v) >= chrono(S.period)) { S.period = String(v); periodAt = r.at; }
      } else if (e.action === 'gamedatachange') {
        const n = p.name || '';
        if (n === 'team_a_actual_goalkeeper' || n === 'team_b_actual_goalkeeper') {
          const t = n.indexOf('_a_') > 0 ? 'A' : 'B', id = p.value && p.value.id;
          S.emptyNet[t] = (id === 0);
          if (id) S.gks[t] = id;
        }
      }
    });

    /* ---- match events, in match order ---- */
    const ev = [];
    all.forEach(r => {
      const e = r.e, p = e.params || {};
      const T = teamOf(p.selectedTeamId);
      if (!T || e.usertype === 'sub') return;
      if (p.isDraft === true || p.approved === false || p.rejectReason) return;
      const d = pdef(e.period);
      const tg = e.totalGameTime != null ? Number(e.totalGameTime) : (d ? d.start : 0) + (Number(e.gametime) || 0);
      ev.push({r, e, p, T, O: T === 'A' ? 'B' : 'A', tg: tg || 0, ch: chrono(e.period)});
    });
    ev.sort((x, y) => x.ch - y.ch || x.tg - y.tg || x.r.seq - y.r.seq);
    S.events = ev.length;

    const firstHalf = periods.find(p => p.type === 'normal') || {value: '1'};
    const firstHalfCh = chrono(firstHalf.value);
    S.halfEnd = firstHalf.end || S.periodLength * 60;
    let htScore = {a: 0, b: 0}, lastPeriod = null, toCount = {A: 0, B: 0}, toUsed = {A: 0, B: 0};
    const gk = id => (S.gks.list[id] = S.gks.list[id] || {saves: 0, faced: 0, s7: 0, f7: 0});

    ev.forEach(x => {
      const {e, p, T, O, tg} = x, a = e.action, st = S.stats[T];
      if (chrono(e.period) > chrono(S.period)) S.period = String(e.period);       // period inferred from events
      if (S.type === 'STRAND' && lastPeriod !== null && lastPeriod !== String(e.period)) S.score = {a: 0, b: 0};
      lastPeriod = String(e.period);
      const pl = p.selectedPlayer != null ? S.players[p.selectedPlayer] : null;
      const pen = isPenalty(a);
      const gate = Number(p.selectedGateArea);
      const zone = pen ? 17 : (p.selectedArea == null || p.selectedArea === '' ? -1 : Number(p.selectedArea));
      const shot = made => {
        st.shots++; if (pen) st.a7++;
        if (pl) { pl.shots++; if (pen) pl.a7++; }
        if (zone >= 0 && zone < ZONES) { S.zones[T].s[zone]++; if (made) S.zones[T].g[zone]++; }
        if (gate >= 1 && gate <= 9) { S.gateShots[T][gate - 1]++; if (made) S.gate[T][gate - 1]++; }
      };
      const keeper = saved => {
        const id = p.otherTeamGoalKeeper && p.otherTeamGoalKeeper.id;
        S.stats[O].faced++; if (saved) S.stats[O].saves++;
        if (id) { const g = gk(id); g.faced++; if (pen) g.f7++; if (saved) { g.saves++; if (pen) g.s7++; } }
      };

      if (GOAL_PTS[a]) {
        S.score[T === 'A' ? 'a' : 'b'] += GOAL_PTS[a];
        st.goals++; if (pen) st.g7++;
        if (pl) { pl.goals++; if (pen) pl.g7++; }
        shot(true); keeper(false);
        if (S.run.team === T) { S.run.n++; S.run.to = tg; } else S.run = {team: T, n: 1, from: tg, to: tg};
        if (S.run.n > S.bestRun[T].n) S.bestRun[T] = {n: S.run.n, from: S.run.from, to: S.run.to};
        S.lead.push({t: tg, d: S.score.a - S.score.b});
        S.lastGoal = {uuid: e.UUID, team: T, player: pl ? pl.name : '', jersey: pl ? pl.jersey : '',
                      score: {a: S.score.a, b: S.score.b}, sev: pen, live: x.r.live};
        if (x.ch <= firstHalfCh) htScore = {a: S.score.a, b: S.score.b};
      } else if (SAVED.includes(a)) { st.saved++; shot(false); keeper(true); }
      else if (POST.includes(a)) { st.post++; shot(false); }
      else if (MISS.includes(a)) { st.miss++; shot(false); }
      else if (a === 'blokkolt') { st.block++; shot(false); }
      else if (a === 'eladott' || a === 'technikai') { st.to++; if (pl) pl.to++; }
      else if (a === 'timeOut') {
        if (p.type === 'lost') return;
        toCount[T]++; if (p.usedTimeOuts != null) toUsed[T] = Math.max(toUsed[T], Number(p.usedTimeOuts) || 0);
      }
      else if (a === 'sargalap') { S.pens[T].y++; if (pl) pl.y++; }
      else if (a === 'piroslap') { S.pens[T].r++; if (pl) pl.r++; }
      else if (a === 'keklap') { S.pens[T].b++; if (pl) pl.b++; }
      else if (a === 'kiallitas' || a === '2perc') { S.pens[T].s2++; if (pl) pl.s2++; }
      else if (a === '4perc') { S.pens[T].s2 += 2; if (pl) pl.s2 += 2; }

      S.timeline.unshift({t: mmss(tg), team: T, act: a,
        name: (p.selectedAction && p.selectedAction.actionName) || a,
        player: pl ? pl.name : '', jersey: pl ? pl.jersey : '', score: S.score.a + ':' + S.score.b});
      if (S.timeline.length > 10) S.timeline.pop();
    });
    S.timeouts = {A: Math.max(toCount.A, toUsed.A), B: Math.max(toCount.B, toUsed.B)};

    /* ---- period, half-time, clock ---- */
    const cur = pdef(S.period);
    S.periodText = cur ? cur.text : '';
    S.periodType = cur ? cur.type : 'normal';
    S.finished = S.period === FINAL_PERIOD;
    if (chrono(S.period) > firstHalfCh) S.ht = htScore;
    const last = ev[ev.length - 1];
    const playing = !S.finished && (S.periodType === 'normal' || S.periodType === 'extended');
    if (last && last.ch >= chrono(S.period)) {
      // the feed has no start/stop signal: run on from the last event, but hold during a team time-out
      S.clock = {sec: last.tg, at: last.r.at, running: playing && last.e.action !== 'timeOut', cap: cur ? cur.end : 0};
    } else {
      S.clock = {sec: cur ? cur.start : (last ? last.tg : 0), at: periodAt || (last ? last.r.at : 0), running: playing && !!periodAt, cap: cur ? cur.end : 0};
    }
    if (!playing && cur) S.clock.sec = Math.max(S.clock.sec, cur.end);
    return S;
  }

  function newPlayer(pl, team, entry) {
    return {name: pl.name || '', jersey: pl.jersey == null ? '' : pl.jersey, team, gk: !!pl.goalkeeper, entry: !!entry,
            goals: 0, g7: 0, a7: 0, shots: 0, to: 0, y: 0, s2: 0, r: 0, b: 0};
  }
  function mmss(s) { s = Math.max(0, Math.floor(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }

  const api = {createStore, ingest, build, chrono, mmss, ZONES};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MKSZFeed = api;
})(typeof self !== 'undefined' ? self : this);
