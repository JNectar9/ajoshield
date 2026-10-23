'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const P = require('./plans');

const RULES_DIR = path.join(__dirname, 'rules');
const rules = () => JSON.parse(fs.readFileSync(path.join(RULES_DIR, 'rules-v1.0.0.json'), 'utf8'));
const allEnabled = () => { const r = rules(); for (const p of Object.values(r.plans)) p.enabled = true; return r; };
const plain = (o) => JSON.parse(JSON.stringify(o));

test('Plan 1: 10 members x 2,000 weekly gives a 20,000 pot split 8,000 / 10,000 / 2,000', () => {
  const t = P.calculatePlan(rules(), 1);
  assert.equal(t.weeklyContributionKobo, 200000);
  assert.equal(t.members, 10);
  assert.equal(t.cycles, 10);
  assert.equal(t.potKobo, 2000000);
  assert.equal(t.drop1Kobo, 800000);
  assert.equal(t.drop2Kobo, 1000000);
  assert.equal(t.finalKobo, 200000);
  assert.equal(t.collateralKobo, 400000);
  assert.equal(P.formatNaira(t.potKobo), '\u20a620,000');
  assert.equal(P.formatNaira(t.drop1Kobo), '\u20a68,000');
  assert.equal(P.formatNaira(t.drop2Kobo), '\u20a610,000');
  assert.equal(P.formatNaira(t.finalKobo), '\u20a62,000');
  assert.equal(P.formatNaira(t.collateralKobo), '\u20a64,000');
});

test('every plan matches the agreed table and its three drops add up exactly', () => {
  const expected = {
    1: [20000, 8000, 10000, 2000], 2: [50000, 20000, 25000, 5000], 3: [100000, 40000, 50000, 10000],
    4: [200000, 80000, 100000, 20000], 5: [500000, 200000, 250000, 50000], 6: [1000000, 400000, 500000, 100000],
  };
  const r = allEnabled();
  for (const [id, [pot, d1, d2, fin]] of Object.entries(expected)) {
    const t = P.calculatePlan(r, id);
    assert.equal(t.potKobo, pot * 100, 'pot of plan ' + id);
    assert.equal(t.drop1Kobo, d1 * 100, 'drop 1 of plan ' + id);
    assert.equal(t.drop2Kobo, d2 * 100, 'drop 2 of plan ' + id);
    assert.equal(t.finalKobo, fin * 100, 'final of plan ' + id);
    assert.equal(t.drop1Kobo + t.drop2Kobo + t.finalKobo, t.potKobo);
  }
});

test('splitPot always adds up exactly, even when amounts do not divide evenly', () => {
  const bps = { drop1: 4000, drop2: 5000, final: 1000 };
  for (let pot = 1; pot <= 5000; pot++) {
    const s = P.splitPot(pot, bps);
    assert.equal(s.drop1Kobo + s.drop2Kobo + s.finalKobo, pot, 'pot ' + pot);
    assert.ok(s.drop1Kobo >= 0 && s.drop2Kobo >= 0 && s.finalKobo >= 0);
  }
  assert.deepEqual(P.splitPot(1003, bps), { drop1Kobo: 401, drop2Kobo: 501, finalKobo: 101 });
});

test('only Plan 1 is enabled; Plans 2 to 6 and unknown plans are refused', () => {
  const r = rules();
  assert.deepEqual(Object.keys(r.plans).filter((id) => r.plans[id].enabled), ['1']);
  for (const id of [2, 3, 4, 5, 6]) assert.throws(() => P.calculatePlan(r, id), /not enabled/);
  assert.throws(() => P.calculatePlan(r, 7), /Unknown plan/);
});

test('invalid rules are rejected', () => {
  const badSplit = rules(); badSplit.installmentsBps.final = 999;
  assert.throws(() => P.validateRules(badSplit), /10000 basis points/);
  const decimal = rules(); decimal.plans['1'].weeklyContributionKobo = 2000.5;
  assert.throws(() => P.validateRules(decimal), /whole number of kobo/);
  const negative = rules(); negative.plans['1'].weeklyContributionKobo = -1;
  assert.throws(() => P.validateRules(negative), /whole number of kobo/);
  const noEnabledFlag = rules(); delete noEnabledFlag.plans['1'].enabled;
  assert.throws(() => P.validateRules(noEnabledFlag), /true or false/);
  const oneMember = rules(); oneMember.members = 1;
  assert.throws(() => P.validateRules(oneMember), /at least 2/);
  assert.throws(() => P.splitPot(1.5, { drop1: 4000, drop2: 5000, final: 1000 }), /whole number of kobo/);
});

test('a new circle records its rules version, a hash and a frozen snapshot', () => {
  const c = P.createCircle({ rules: rules(), planId: 1, circleId: 'test-circle-1', createdAt: '2026-10-22T00:00:00.000Z' });
  assert.equal(c.funds, 'simulated');
  assert.equal(c.rulesVersion, '1.0.0');
  assert.equal(c.rulesHash, P.hashRules(rules()));
  assert.equal(c.terms.potKobo, 2000000);
  assert.ok(P.verifyCircle(c));
  assert.throws(() => { c.terms.potKobo = 1; }, TypeError);
  assert.throws(() => { c.rulesSnapshot.plans['1'].weeklyContributionKobo = 1; }, TypeError);
});

test('editing the rules later does not change an existing circle', () => {
  const original = rules();
  const old = P.createCircle({ rules: original, planId: 1, circleId: 'old-circle' });
  const oldTerms = plain(old.terms);
  const oldHash = old.rulesHash;
  const edited = rules();
  edited.rulesVersion = '1.1.0';
  edited.plans['1'].weeklyContributionKobo = 300000;
  edited.collateralMultiple = 3;
  const fresh = P.createCircle({ rules: edited, planId: 1, circleId: 'new-circle' });
  assert.deepEqual(plain(old.terms), oldTerms);
  assert.equal(old.rulesHash, oldHash);
  assert.equal(old.rulesVersion, '1.0.0');
  assert.ok(P.verifyCircle(old));
  assert.notEqual(fresh.rulesHash, old.rulesHash);
  assert.equal(fresh.terms.weeklyContributionKobo, 300000);
  assert.equal(fresh.terms.collateralKobo, 900000);
  assert.ok(P.verifyCircle(fresh));
  // mutating the object that was passed in must not reach the circle either
  original.plans['1'].weeklyContributionKobo = 999;
  assert.equal(old.rulesSnapshot.plans['1'].weeklyContributionKobo, 200000);
});

test('a tampered circle is rejected', () => {
  const c = plain(P.createCircle({ rules: rules(), planId: 1, circleId: 'tamper-test' }));
  assert.ok(P.verifyCircle(c));
  const a = plain(c); a.rulesSnapshot.plans['1'].weeklyContributionKobo = 100;
  assert.throws(() => P.verifyCircle(a), /does not match its hash/);
  const b = plain(c); b.terms.potKobo = 1;
  assert.throws(() => P.verifyCircle(b), /terms do not match/);
  const d = plain(c); d.rulesHash = 'abc';
  assert.throws(() => P.verifyCircle(d), /does not match its hash/);
  const e = plain(c); e.funds = 'live';
  assert.throws(() => P.verifyCircle(e), /must be simulated/);
});

test('live funds are refused', () => {
  for (const mode of ['live', 'real', 'LIVE', '']) {
    assert.throws(() => P.createCircle({ rules: rules(), planId: 1, circleId: 'x', mode }), /Live funds are not enabled/);
  }
  assert.equal(P.createCircle({ rules: rules(), planId: 1, circleId: 'x' }).funds, 'simulated');
  assert.throws(() => P.createCircle({ rules: rules(), planId: 1, circleId: '  ' }), /circleId is required/);
});

test('the published rules file loads, and editing it after publishing is detected', () => {
  const loaded = P.loadRules('1.0.0');
  assert.equal(loaded.rulesVersion, '1.0.0');
  const c = P.createCircleFromVersion({ version: '1.0.0', planId: 1, circleId: 'from-file' });
  assert.equal(c.terms.potKobo, 2000000);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ajo-rules-'));
  fs.copyFileSync(path.join(RULES_DIR, 'published-hashes.json'), path.join(tmp, 'published-hashes.json'));
  const edited = rules(); edited.plans['1'].weeklyContributionKobo = 250000;
  fs.writeFileSync(path.join(tmp, 'rules-v1.0.0.json'), JSON.stringify(edited));
  assert.throws(() => P.loadRules('1.0.0', tmp), /modified after publishing/);

  const unpublished = rules(); unpublished.rulesVersion = '9.9.9';
  fs.writeFileSync(path.join(tmp, 'rules-v9.9.9.json'), JSON.stringify(unpublished));
  assert.throws(() => P.loadRules('9.9.9', tmp), /not published/);
  assert.throws(() => P.loadRules('../evil'), /Invalid rules version/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('the hash does not depend on key order or spacing', () => {
  const a = { b: 1, a: { d: 2, c: [3, 4] } };
  const b = { a: { c: [3, 4], d: 2 }, b: 1 };
  assert.equal(P.canonicalJson(a), P.canonicalJson(b));
  assert.equal(P.hashRules(a), P.hashRules(b));
  assert.notEqual(P.hashRules(a), P.hashRules({ b: 2, a: { d: 2, c: [3, 4] } }));
});

test('money formatting uses whole naira and kobo', () => {
  assert.equal(P.formatNaira(0), '\u20a60');
  assert.equal(P.formatNaira(100), '\u20a61');
  assert.equal(P.formatNaira(123456789), '\u20a61,234,567.89');
  assert.equal(P.formatNaira(50), '\u20a60.50');
  assert.throws(() => P.formatNaira(1.5), /whole number/);
  assert.throws(() => P.formatNaira(-1), /non-negative/);
});
