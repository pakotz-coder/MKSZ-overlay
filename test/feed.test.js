// Run: node --test test/
const test = require('node:test');
const assert = require('node:assert');
const F = require('../feed.js');
const {makeDemoMatch} = require('../demo.js');

const NOW = Date.now();
const load = (events, live) => { const st = F.createStore(); events.forEach(e => F.ingest(st, e, NOW, live)); return st; };
const init = {UUID: 'i', action: 'init', period: '1', params: {
  period_length: 30, team_a_name: 'Alpha', team_b_name: 'Beta',
  periods: [{value: '1', text: 'I. félidő', type: 'normal'}, {value: '2', text: 'Félidő', type: 'zero'},
            {value: '3', text: 'II. félidő', type: 'normal'}, {value: '13', text: 'Vége', type: 'zero'}],
  team_a_players: [{id: 1, name: 'A One', jersey: 7}, {id: 2, name: 'A Keeper', jersey: 1, goalkeeper: true}],
  team_b_players: [{id: 11, name: 'B One', jersey: 9}, {id: 12, name: 'B Keeper', jersey: 12, goalkeeper: true}]}};
let n = 0;
const ev = (action, team, tg, extra, period) => ({UUID: 'e' + (++n), action, period: String(period || (tg >= 1800 ? 3 : 1)), totalGameTime: tg,
  params: Object.assign({selectedTeamId: 'team' + team, selectedPlayer: team === 'A' ? 1 : 11, selectedAction: {actionName: action}}, extra || {})});

test('demo match: totals are consistent', () => {
  const S = F.build(load(makeDemoMatch(7)), 'demo');
  for (const T of ['A', 'B']) {
    const st = S.stats[T], O = T === 'A' ? 'B' : 'A';
    assert.strictEqual(st.shots, st.goals + st.saved + st.post + st.miss + st.block, 'shots = sum of outcomes');
    assert.strictEqual(st.saved, S.stats[O].saves, 'saved shots = opponent saves');
    assert.strictEqual(S.stats[O].faced, st.goals + st.saved, 'faced = goals + saves');
    const pg = Object.values(S.players).filter(p => p.team === T).reduce((s, p) => s + p.goals, 0);
    assert.strictEqual(pg, st.goals, 'player goals add up');
    assert.strictEqual(S.gate[T].reduce((a, b) => a + b, 0), st.goals, 'every goal has a gate cell');
    assert.strictEqual(S.zones[T].s.reduce((a, b) => a + b, 0), st.shots, 'every shot has a zone');
    assert.strictEqual(S.zones[T].s[17], st.a7, 'zone 17 = penalties');
    assert.ok(S.timeouts[T] <= 3);
  }
  assert.strictEqual(S.score.a, S.stats.A.goals);
  assert.strictEqual(S.score.b, S.stats.B.goals);
  assert.ok(S.score.a + S.score.b > 30, 'a realistic number of goals');
  assert.strictEqual(S.lead.length, S.score.a + S.score.b);
  assert.strictEqual(S.finished, true);
  assert.ok(S.ht && S.ht.a <= S.score.a && S.ht.b <= S.score.b);
  assert.strictEqual(S.clock.running, false);
  assert.strictEqual(S.clock.sec, 3600);
  JSON.parse(JSON.stringify(S));                       // must survive the trip to Firebase
});

test('an edited event replaces the old one, a deleted event disappears', () => {
  const g1 = ev('gol', 'A', 60), g2 = ev('gol', 'B', 120), g3 = ev('gol', 'A', 180);
  const st = load([init, g1, g2, g3]);
  assert.deepStrictEqual(F.build(st).score, {a: 2, b: 1});
  F.ingest(st, Object.assign({}, g3, {params: Object.assign({}, g3.params, {selectedTeamId: 'teamB', selectedPlayer: 11})}), NOW, true);
  let S = F.build(st);
  assert.deepStrictEqual(S.score, {a: 1, b: 2});
  assert.strictEqual(S.players[1].goals, 1);
  F.ingest(st, {UUID: g2.UUID, deleted: true}, NOW, true);
  S = F.build(st);
  assert.deepStrictEqual(S.score, {a: 1, b: 1});
  assert.strictEqual(S.lead.length, 2);
});

test('events are counted in match order even when they arrive out of order', () => {
  const a = ev('gol', 'A', 100), b = ev('gol', 'A', 200), c = ev('gol', 'B', 150);
  const S = F.build(load([init, a, b, c]));
  assert.deepStrictEqual(S.lead.map(x => x.d), [1, 0, 1]);
  assert.strictEqual(S.run.team, 'A'); assert.strictEqual(S.run.n, 1);
  assert.strictEqual(S.lastGoal.uuid, b.UUID);
});

test('penalties, saves and keepers', () => {
  const S = F.build(load([init,
    ev('gol7m', 'A', 10, {otherTeamGoalKeeper: {id: 12}, selectedGateArea: 3}),
    ev('vedett7m', 'A', 20, {otherTeamGoalKeeper: {id: 12}}),
    ev('rontott7m', 'A', 30), ev('kapufa7m', 'A', 40),
    ev('vedett', 'A', 50, {otherTeamGoalKeeper: {id: 12}, selectedArea: 0}),
    ev('gol', 'A', 60, {selectedArea: 6})]));                    // no keeper = empty net
  assert.strictEqual(S.stats.A.a7, 4); assert.strictEqual(S.stats.A.g7, 1);
  assert.strictEqual(S.stats.A.shots, 6); assert.strictEqual(S.stats.A.goals, 2);
  assert.deepStrictEqual(S.gks.list[12], {saves: 2, faced: 3, s7: 1, f7: 2});
  assert.strictEqual(S.stats.B.saves, 2); assert.strictEqual(S.stats.B.faced, 4);
  assert.strictEqual(S.zones.A.s[0], 1, 'zone 0 (right wing) counts');
  assert.strictEqual(S.zones.A.g[6], 1);
  assert.strictEqual(S.players[1].a7, 4);
});

test('cards, suspensions and time-outs', () => {
  const S = F.build(load([init, ev('sargalap', 'A', 10), ev('2perc', 'A', 20), ev('4perc', 'A', 30), ev('kiallitas', 'B', 40),
    ev('piroslap', 'B', 50), ev('keklap', 'B', 60),
    ev('timeOut', 'A', 70, {usedTimeOuts: 1}), ev('timeOut', 'B', 80, {type: 'lost'})]));
  assert.deepStrictEqual(S.pens.A, {y: 1, s2: 3, r: 0, b: 0});
  assert.deepStrictEqual(S.pens.B, {y: 0, s2: 1, r: 1, b: 1});
  assert.strictEqual(S.players[1].s2, 3);
  assert.deepStrictEqual(S.timeouts, {A: 1, B: 0});
});

test('drafts, rejected and helper-scorer events are ignored', () => {
  const sub = ev('gol', 'A', 40); sub.usertype = 'sub';
  const S = F.build(load([init, ev('gol', 'A', 10, {isDraft: true}), ev('gol', 'A', 20, {approved: false}),
    ev('gol', 'A', 30, {rejectReason: 'x'}), sub, ev('gol', 'B', 50)]));
  assert.deepStrictEqual(S.score, {a: 0, b: 1});
});

test('clock: runs after a goal, holds on a time-out and at half-time', () => {
  let st = load([init, {UUID: 'p1', action: 'periodchange', period: '1', params: {period: '1'}}, ev('gol', 'A', 600)], true);
  let S = F.build(st);
  assert.deepStrictEqual([S.clock.sec, S.clock.running, S.clock.cap], [600, true, 1800]);
  F.ingest(st, ev('timeOut', 'B', 640), NOW, true);
  S = F.build(st);
  assert.deepStrictEqual([S.clock.sec, S.clock.running], [640, false]);
  F.ingest(st, {UUID: 'p2', action: 'periodchange', period: '2', params: {period: '2'}}, NOW, true);
  S = F.build(st);
  assert.deepStrictEqual([S.period, S.periodText, S.clock.sec, S.clock.running], ['2', 'Félidő', 1800, false]);
  assert.deepStrictEqual(S.ht, {a: 1, b: 0});
  F.ingest(st, {UUID: 'p3', action: 'periodchange', period: '3', params: {period: '3'}}, NOW, true);
  S = F.build(st);
  assert.deepStrictEqual([S.clock.sec, S.clock.running, S.clock.cap], [1800, true, 3600]);
});

test('beach handball: two-point goals, score restarts each set', () => {
  const b = JSON.parse(JSON.stringify(init)); b.params.rule = 'STRAND';
  const S = F.build(load([b, ev('gol2p', 'A', 10, {}, 1), ev('gol', 'B', 20, {}, 1), ev('gol6m', 'B', 30, {}, 3)]));
  assert.strictEqual(S.type, 'STRAND');
  assert.deepStrictEqual(S.score, {a: 0, b: 2});
});

test('replayed history uses the scorer timestamp for the clock', () => {
  const g = ev('gol', 'A', 600); g.clientTime = NOW - 30000;
  const st = load([init, {UUID: 'p1', action: 'periodchange', period: '1', params: {period: '1'}}, g], false);
  assert.strictEqual(F.build(st).clock.at, NOW - 30000);
});

test('team names are trimmed and the end of the first half is exposed', () => {
  const i2 = JSON.parse(JSON.stringify(init)); i2.params.team_b_name = 'Beta '; i2.params.team_b_shortname = ' ';
  const S = F.build(load([i2]));
  assert.strictEqual(S.teams.B.name, 'Beta'); assert.strictEqual(S.teams.B.short, 'Beta');
  assert.strictEqual(S.halfEnd, 1800);
});

test('second half starts from a period change that carries no match time', () => {
  const S = F.build(load([init, ev('gol', 'A', 1700), {UUID: 'p3', action: 'periodchange', period: '3', params: {period: '3'}}], true));
  assert.deepStrictEqual([S.period, S.clock.sec, S.clock.running, S.clock.cap], ['3', 1800, true, 3600]);
  assert.deepStrictEqual(S.ht, {a: 1, b: 0});
});
