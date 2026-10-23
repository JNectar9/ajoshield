'use strict';
// AjoShield rules and Plan calculator. SIMULATION ONLY: no real money, no network, no secrets.
// All money is whole kobo (1 naira = 100 kobo). Never use decimals for money.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_RULES_DIR = path.join(__dirname, 'rules');
const BPS_TOTAL = 10000; // 100% in basis points

const clone = (o) => JSON.parse(JSON.stringify(o));
const isInt = (n) => Number.isSafeInteger(n);
const isKobo = (n) => Number.isSafeInteger(n) && n > 0;

function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}
function hashRules(rules) {
  return crypto.createHash('sha256').update(canonicalJson(rules)).digest('hex');
}
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o).forEach(deepFreeze);
  }
  return o;
}

function validateRules(rules) {
  const bad = (m) => { throw new Error('Invalid rules: ' + m); };
  if (!rules || typeof rules !== 'object') bad('rules must be an object');
  if (typeof rules.rulesVersion !== 'string' || !rules.rulesVersion) bad('rulesVersion is required');
  if (rules.currency !== 'NGN') bad('currency must be NGN');
  if (!isInt(rules.members) || rules.members < 2) bad('members must be a whole number of at least 2');
  if (!isInt(rules.cycles) || rules.cycles < 1) bad('cycles must be a whole number of at least 1');
  const b = rules.installmentsBps;
  if (!b || !isKobo(b.drop1) || !isKobo(b.drop2) || !isKobo(b.final)) bad('installmentsBps needs positive whole numbers for drop1, drop2 and final');
  if (b.drop1 + b.drop2 + b.final !== BPS_TOTAL) bad('installments must add up to exactly 10000 basis points (100%)');
  if (!isInt(rules.collateralMultiple) || rules.collateralMultiple < 0) bad('collateralMultiple must be a whole number');
  if (!isInt(rules.graceDays) || rules.graceDays < 0) bad('graceDays must be a whole number');
  if (!isInt(rules.disputeWindowHours) || rules.disputeWindowHours < 0) bad('disputeWindowHours must be a whole number');
  if (!rules.plans || typeof rules.plans !== 'object' || Object.keys(rules.plans).length === 0) bad('plans are required');
  for (const [id, p] of Object.entries(rules.plans)) {
    if (!isKobo(p.weeklyContributionKobo)) bad('plan ' + id + ' weeklyContributionKobo must be a positive whole number of kobo');
    if (typeof p.enabled !== 'boolean') bad('plan ' + id + ' enabled must be true or false');
  }
  return true;
}

// Splits a pot into three drops. Drop 1 and Drop 2 are rounded down; the final drop takes the remainder,
// so the three always add up to exactly the pot.
function splitPot(potKobo, bps) {
  if (!isKobo(potKobo)) throw new Error('pot must be a positive whole number of kobo');
  const drop1Kobo = Math.floor((potKobo * bps.drop1) / BPS_TOTAL);
  const drop2Kobo = Math.floor((potKobo * bps.drop2) / BPS_TOTAL);
  const finalKobo = potKobo - drop1Kobo - drop2Kobo;
  return { drop1Kobo, drop2Kobo, finalKobo };
}

function calculatePlan(rules, planId) {
  validateRules(rules);
  const id = String(planId);
  const plan = rules.plans[id];
  if (!plan) throw new Error('Unknown plan: ' + id);
  if (!plan.enabled) throw new Error('Plan ' + id + ' is not enabled');
  const weekly = plan.weeklyContributionKobo;
  const potKobo = weekly * rules.members;
  const drops = splitPot(potKobo, rules.installmentsBps);
  return {
    planId: id,
    weeklyContributionKobo: weekly,
    members: rules.members,
    cycles: rules.cycles,
    potKobo,
    ...drops,
    scheduledPayoutKobo: potKobo,
    collateralKobo: weekly * rules.collateralMultiple,
    totalContributedPerMemberKobo: weekly * rules.cycles,
  };
}

function formatNaira(kobo) {
  if (!isInt(kobo) || kobo < 0) throw new Error('kobo must be a non-negative whole number');
  const whole = String(Math.floor(kobo / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const rem = kobo % 100;
  return '\u20a6' + whole + (rem ? '.' + String(rem).padStart(2, '0') : '');
}

// Creates a circle that carries a frozen copy of the rules it was agreed under.
function createCircle({ rules, planId, circleId, createdAt, mode = 'simulated' }) {
  if (mode !== 'simulated') throw new Error('Live funds are not enabled. AjoShield is running in simulation only.');
  if (typeof circleId !== 'string' || !circleId.trim()) throw new Error('circleId is required');
  const terms = calculatePlan(rules, planId);
  const snapshot = clone(rules);
  return deepFreeze({
    circleId: circleId.trim(),
    funds: 'simulated',
    planId: String(planId),
    rulesVersion: snapshot.rulesVersion,
    rulesHash: hashRules(snapshot),
    rulesSnapshot: snapshot,
    terms,
    createdAt: createdAt || new Date().toISOString(),
  });
}

// Throws if a circle's rules or terms were changed after creation.
function verifyCircle(circle) {
  const fail = (m) => { throw new Error('Circle failed verification: ' + m); };
  if (!circle || circle.funds !== 'simulated') fail('circle must be simulated');
  if (hashRules(circle.rulesSnapshot) !== circle.rulesHash) fail('rules snapshot does not match its hash');
  if (circle.rulesSnapshot.rulesVersion !== circle.rulesVersion) fail('rules version does not match the snapshot');
  const expected = calculatePlan(circle.rulesSnapshot, circle.planId);
  if (canonicalJson(expected) !== canonicalJson(circle.terms)) fail('terms do not match the rules snapshot');
  return true;
}

// Loads a published rules file and refuses it if it was edited after publishing.
function loadRules(version, dir = DEFAULT_RULES_DIR) {
  if (!/^\d+\.\d+\.\d+$/.test(String(version))) throw new Error('Invalid rules version: ' + version);
  const published = JSON.parse(fs.readFileSync(path.join(dir, 'published-hashes.json'), 'utf8'));
  const expected = published[version];
  if (!expected) throw new Error('Rules version ' + version + ' is not published');
  const rules = JSON.parse(fs.readFileSync(path.join(dir, 'rules-v' + version + '.json'), 'utf8'));
  if (hashRules(rules) !== expected) throw new Error('Rules version ' + version + ' was modified after publishing. Create a new version instead.');
  validateRules(rules);
  if (rules.rulesVersion !== version) throw new Error('File name and rulesVersion do not match');
  return rules;
}

function createCircleFromVersion({ version, planId, circleId, createdAt, dir }) {
  return createCircle({ rules: loadRules(version, dir), planId, circleId, createdAt });
}

module.exports = {
  canonicalJson, hashRules, validateRules, splitPot, calculatePlan, formatNaira,
  createCircle, verifyCircle, loadRules, createCircleFromVersion,
};
