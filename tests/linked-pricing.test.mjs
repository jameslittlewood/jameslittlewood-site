import test from 'node:test'
import assert from 'node:assert/strict'
import { effectiveRates, effectiveTokenState, withExactTotalInput } from '../src/lib/linked-pricing.ts'
import { calculateCost, comparePeriods, deriveSimplified, toSimplified, validateUsage } from '../src/lib/token-cost.ts'

const exact = { uncachedInput: 1_000_000, cachedInput: 2_000_000, output: 500_000 }
const simplified = toSimplified(exact)
const rates = { input: 2, cachedInput: 0.5, output: 10 }
const workload = (linked) => effectiveTokenState(exact, simplified, linked)

test('linked caching charges all input at uncached rates without dropping total input', () => {
 const tokens = workload(true)
 assert.deepEqual(tokens.exact, { uncachedInput: 3_000_000, cachedInput: 0, output: 500_000 })
 assert.equal(tokens.simplified.totalInput, 3_000_000)
 assert.equal(tokens.simplified.cacheHitPercent, 0)
 const cost = calculateCost(tokens.exact, effectiveRates(rates, true))
 assert.equal(cost.totalCost, 11)
 assert.equal(cost.uncachedInputCost, 6)
 assert.equal(cost.cachedInputCost, 0)
 assert.equal(cost.cacheHitRate, 0)
 assert.equal(cost.cacheSavings, 0)
})

test('unlinking restores independent cached price and usage without mutating saved values', () => {
 workload(true)
 effectiveRates(rates, true)
 assert.deepEqual(workload(false).exact, exact)
 assert.deepEqual(workload(false).simplified, simplified)
 assert.equal(effectiveRates(rates, false).cachedInput, 0.5)
 assert.equal(calculateCost(workload(false).exact, effectiveRates(rates, false)).totalCost, 8)
})

test('one model-level link applies to standard and peak pricing', () => {
 const peak = { input: 4, cachedInput: 1, output: 20 }
 const cost = comparePeriods(workload(true).exact, effectiveRates(rates, true), effectiveRates(peak, true))
 assert.equal(cost.standard.totalCost, 11)
 assert.equal(cost.peak.totalCost, 22)
 assert.equal(cost.standard.cachedInputCost, 0)
 assert.equal(cost.peak.cachedInputCost, 0)
 const restored = comparePeriods(workload(false).exact, effectiveRates(rates, false), effectiveRates(peak, false))
 assert.equal(restored.standard.totalCost, 8)
 assert.equal(restored.peak.totalCost, 16)
})

test('switching Exact to Simplified and back retains zero effective caching and restores saved caching', () => {
 const converted = toSimplified(exact)
 const linked = effectiveTokenState(exact, converted, true)
 const active = deriveSimplified(linked.simplified.totalInput, linked.simplified.cacheHitPercent, linked.simplified.output)
 assert.deepEqual(active, linked.exact)
 assert.equal(calculateCost(active, effectiveRates(rates, true)).totalCost, 11)
 const restoredExact = deriveSimplified(converted.totalInput, converted.cacheHitPercent, converted.output)
 assert.deepEqual(restoredExact, exact)
 assert.deepEqual(effectiveTokenState(restoredExact, converted, true).exact, linked.exact)
 assert.deepEqual(effectiveTokenState(restoredExact, converted, false).exact, exact)
})

test('editing no-cache Exact input edits the total and retains independent cached tokens where possible', () => {
 const updated = withExactTotalInput(exact, 4_000_000)
 const active = effectiveTokenState(updated, toSimplified(updated), true).exact
 assert.equal(active.uncachedInput, 4_000_000)
 assert.equal(active.cachedInput, 0)
 assert.equal(calculateCost(active, effectiveRates(rates, true)).totalCost, 13)
 assert.equal(effectiveTokenState(updated, toSimplified(updated), false).exact.cachedInput, 2_000_000)
 const reduced = withExactTotalInput(exact, 500_000)
 assert.equal(reduced.cachedInput, 500_000)
 assert.equal(reduced.uncachedInput, 0)
})

test('editing no-cache Simplified total preserves total across mode conversion and restores hit rate', () => {
 const edited = { ...simplified, totalInput: 6_000_000 }
 const active = effectiveTokenState(exact, edited, true).simplified
 const usage = deriveSimplified(active.totalInput, active.cacheHitPercent, active.output)
 assert.equal(usage.uncachedInput, 6_000_000)
 assert.equal(usage.cachedInput, 0)
 const converted = deriveSimplified(edited.totalInput, edited.cacheHitPercent, edited.output)
 assert.equal(converted.cachedInput, 4_000_000)
 assert.equal(effectiveTokenState(converted, edited, true).exact.uncachedInput, 6_000_000)
 assert.equal(effectiveTokenState(converted, edited, false).simplified.cacheHitPercent, simplified.cacheHitPercent)
})

test('missing cached prices do not imply caching unavailable', () => {
 const missing = { ...rates, cachedInput: null }
 assert.equal(effectiveRates(missing, false).cachedInput, null)
 assert.equal(workload(false).exact.cachedInput, 2_000_000)
 assert.equal(calculateCost(workload(false).exact, missing).totalCost, null)
 assert.equal(calculateCost(workload(true).exact, effectiveRates(missing, true)).totalCost, 11)
})

test('disabled stale hit rates are ignored while invalid totals and prices remain invalid', () => {
 const active = effectiveTokenState(exact, { ...simplified, cacheHitPercent: NaN }, true).simplified
 assert.ok(deriveSimplified(active.totalInput, active.cacheHitPercent, active.output))
 for (const input of [null, NaN, -1, Infinity]) {
  assert.equal(calculateCost(workload(true).exact, effectiveRates({ ...rates, input }, true)).totalCost, null)
 }
 for (const total of [NaN, -1, Infinity, 1.5]) {
  const edited = withExactTotalInput(exact, total)
  assert.ok(Object.keys(validateUsage(effectiveTokenState(edited, simplified, true).exact)).length)
  assert.equal(deriveSimplified(total, 0, exact.output), null)
 }
})
