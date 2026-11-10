/* Demo match: invented teams and players, in the same event shape as the MKSZ livescore feed.
   Used by control.html?demo=1 (try the overlay without a live match) and by the Node tests.
   Nothing here is real data. */
(function (root) {
  'use strict';

  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

  const FIRST = ['Ádám', 'Bence', 'Csaba', 'Dávid', 'Erik', 'Ferenc', 'Gergő', 'Hunor', 'Imre', 'János', 'Kristóf', 'Levente', 'Márk', 'Norbert', 'Olivér', 'Péter'];
  const LAST = ['Minta', 'Próba', 'Teszt', 'Példa', 'Demó', 'Vázlat', 'Kísérlet', 'Gyakorló'];

  function squad(team, base, r) {
    const out = [];
    for (let i = 0; i < 16; i++) {
      const gk = i === 0 || i === 1;
      out.push({id: base + i, name: LAST[(i + (team === 'A' ? 0 : 3)) % LAST.length] + ' ' + FIRST[(i * 3 + (team === 'A' ? 0 : 5)) % FIRST.length],
                jersey: gk ? (i === 0 ? 1 : 16) : 2 + i + Math.floor(r() * 2) * 20, goalkeeper: gk});
    }
    return out;
  }

  // Returns every event of a full 60-minute match, in order. Each has `_t` = match second (for pacing).
  function makeDemoMatch(seed) {
    const r = rng(seed || 7), ev = [];
    let n = 0, clock = Date.now() - 3600e3;
    const push = (action, period, tg, params) => {
      ev.push({UUID: 'demo-' + (++n), action, period: String(period), totalGameTime: tg, gametime: tg, clientTime: (clock += 1000),
               params: params || {}, _t: tg});
    };
    const A = squad('A', 1000, r), B = squad('B', 2000, r);
    push('init', 1, 0, {
      rule: 'TEREM', period_length: 30,
      team_a_id: 1, team_a_name: 'Demó Kék Sportegyesület', team_a_shortname: 'Demó Kék', team_a_logo: '',
      team_b_id: 2, team_b_name: 'Minta Piros Kézilabda Club', team_b_shortname: 'Minta Piros', team_b_logo: '',
      letesitmeny_nev: 'Demó Sportcsarnok', alverseny: 'Demó bajnokság', korosztaly: 'Felnőtt', datum_teny: '2026-01-01', ido: '18:00',
      periods: [{value: '1', text: 'I. félidő', type: 'normal'}, {value: '2', text: 'Félidő', type: 'zero'},
                {value: '3', text: 'II. félidő', type: 'normal'}, {value: '13', text: 'Mérkőzés vége', type: 'zero'}],
      team_a_players: A, team_b_players: B,
      team_a_officials: [{name: 'Minta Edző', jersey: 'A'}, {name: 'Próba Másodedző', jersey: 'B'}],
      team_b_officials: [{name: 'Teszt Edző', jersey: 'A'}, {name: 'Példa Gyúró', jersey: 'C'}]
    });
    push('gamedatachange', 1, 0, {name: 'team_a_actual_goalkeeper', value: {id: A[0].id}});
    push('gamedatachange', 1, 0, {name: 'team_b_actual_goalkeeper', value: {id: B[0].id}});
    push('periodchange', 1, 0, {period: '1'});

    const name = {gol: 'Gól', gol7m: '7m gól', vedett: 'Védett lövés', vedett7m: 'Védett 7m', kapufa: 'Kapufa', rontott: 'Rontott lövés',
                  rontott7m: 'Rontott 7m', blokkolt: 'Blokkolt lövés', eladott: 'Eladott labda', technikai: 'Technikai hiba',
                  sargalap: 'Sárga lap', '2perc': '2 perc', piroslap: 'Piros lap', timeOut: 'Időkérés'};
    const used = {A: 0, B: 0}, yellow = {A: 0, B: 0};
    const half = (period, from, to) => {
      let t = from + 20 + Math.floor(r() * 40), side = r() < 0.5 ? 'A' : 'B';
      while (t < to) {
        const mine = side === 'A' ? A : B, other = side === 'A' ? B : A;
        const pl = mine[2 + Math.floor(r() * 14)], gk = other[t > from + 1200 && r() < 0.3 ? 1 : 0];
        const base = {selectedTeamId: 'team' + side, selectedPlayer: pl.id};
        const k = r();
        let a;
        if (k < 0.07) a = r() < 0.6 ? 'eladott' : 'technikai';
        else if (k < 0.10 && yellow[side] < 3) { a = 'sargalap'; yellow[side]++; }
        else if (k < 0.14) a = '2perc';
        else if (k < 0.145 && period === 3) a = 'piroslap';
        else if (k < 0.17 && used[side] < 3 && t > from + 300) { a = 'timeOut'; used[side]++; }
        else if (k < 0.27) a = r() < 0.72 ? 'gol7m' : (r() < 0.7 ? 'vedett7m' : 'rontott7m');
        else { const q = r(); a = q < 0.56 ? 'gol' : q < 0.80 ? 'vedett' : q < 0.87 ? 'kapufa' : q < 0.95 ? 'rontott' : 'blokkolt'; }
        const p = Object.assign({selectedAction: {actionName: name[a]}}, base);
        const isShot = /^(gol|vedett|kapufa|rontott|blokkolt)/.test(a);
        if (isShot) {
          const pen = /7m$/.test(a);
          if (!pen) p.selectedArea = Math.floor(r() * 16);
          if (/^(gol|vedett)/.test(a)) { p.selectedGateArea = 1 + Math.floor(r() * 9); p.otherTeamGoalKeeper = {id: gk.id}; }
          p.selectedActionType = 'normalShot';
        }
        if (a === 'timeOut') { delete p.selectedPlayer; p.usedTimeOuts = used[side]; }
        push(a, period, t, p);
        if (isShot || a === 'eladott' || a === 'technikai') side = side === 'A' ? 'B' : 'A';
        t += 25 + Math.floor(r() * 55);
      }
    };
    half(1, 0, 1800);
    push('periodchange', 2, 1800, {period: '2'});
    push('periodchange', 3, 1800, {period: '3'});
    half(3, 1800, 3600);
    push('periodchange', 13, 3600, {period: '13'});
    return ev;
  }

  const api = {makeDemoMatch};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MKSZDemo = api;
})(typeof self !== 'undefined' ? self : this);
