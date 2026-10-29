import test from 'node:test'
import assert from 'node:assert/strict'
import {
	MAX_TOKEN_COUNT,
	calculateCost,
	comparePeriods,
	deriveSimplified,
	toSimplified,
	tokenCountError,
	usdPerTokenToPerMillion,
	validateSimplified,
	validateUsage,
} from '../src/lib/token-cost.ts'
import {
	createCustomModelPricing,
	normaliseModelPricing,
} from '../src/lib/pricing.ts'

const rates = { input: 2, cachedInput: 0.5, output: 10 }
const usage = {
	uncachedInput: 1_000_000,
	cachedInput: 2_000_000,
	output: 500_000,
}

test('converts OpenRouter USD-per-token strings to USD per million', () => {
	assert.equal(usdPerTokenToPerMillion('0.00000015'), 0.15)
	assert.equal(usdPerTokenToPerMillion('0.000003'), 3)
	assert.equal(usdPerTokenToPerMillion(0.0000006), 0.6)
	assert.equal(usdPerTokenToPerMillion('0'), 0)
})

test('rejects missing, invalid and negative prices', () => {
	assert.equal(usdPerTokenToPerMillion(undefined), null)
	assert.equal(usdPerTokenToPerMillion(null), null)
	assert.equal(usdPerTokenToPerMillion(''), null)
	assert.equal(usdPerTokenToPerMillion('   '), null)
	assert.equal(usdPerTokenToPerMillion('not-a-price'), null)
	assert.equal(usdPerTokenToPerMillion('-0.000001'), null)
})

test('calculates each token category and the total separately', () => {
	const result = calculateCost(usage, rates)
	assert.equal(result.uncachedInputCost, 2)
	assert.equal(result.cachedInputCost, 1)
	assert.equal(result.outputCost, 5)
	assert.equal(result.totalCost, 8)
	assert.equal(result.totalInputTokens, 3_000_000)
})

test('calculates cache hit rate, uncached equivalent and savings', () => {
	const result = calculateCost(usage, rates)
	assert.ok(Math.abs(result.cacheHitRate - 66.66666666666666) < 1e-9)
	assert.equal(result.costWithoutCaching, 11)
	assert.equal(result.cacheSavings, 3)
	assert.deepEqual(result.unavailable, [])
})

test('handles very small costs without rounding them to zero', () => {
	const result = calculateCost(
		{ uncachedInput: 1_200, cachedInput: 3_800, output: 800 },
		{ input: 0.15, cachedInput: 0.003, output: 0.6 }
	)
	assert.ok(Math.abs(result.totalCost - 0.0006714) < 1e-12)
})

test('marks cached cost unavailable when the rate is missing and tokens exist', () => {
	const result = calculateCost(
		{ uncachedInput: 1_000, cachedInput: 500, output: 100 },
		{ input: 1, cachedInput: null, output: 2 }
	)
	assert.equal(result.uncachedInputCost, 0.001)
	assert.equal(result.cachedInputCost, null)
	assert.equal(result.outputCost, 0.0002)
	assert.equal(result.totalCost, null)
	assert.equal(result.cacheSavings, null)
	assert.ok(
		result.unavailable.some((message) => message.includes('Cached-input'))
	)
})

test('does not treat a missing cached rate as zero when cached tokens are zero', () => {
	const result = calculateCost(
		{ uncachedInput: 1_000, cachedInput: 0, output: 100 },
		{ input: 1, cachedInput: null, output: 2 }
	)
	assert.equal(result.cachedInputCost, 0)
	assert.ok(Math.abs(result.totalCost - 0.0012) < 1e-12)
	assert.equal(result.cacheSavings, 0)
})

test('calculates zero usage as zero cost', () => {
	const result = calculateCost(
		{ uncachedInput: 0, cachedInput: 0, output: 0 },
		{ input: null, cachedInput: null, output: null }
	)
	assert.equal(result.totalCost, 0)
	assert.equal(result.cacheHitRate, 0)
	assert.equal(result.cacheSavings, 0)
})

test('reports a caching premium when cached pricing is higher than input pricing', () => {
	const result = calculateCost(
		{ uncachedInput: 1_000_000, cachedInput: 1_000_000, output: 0 },
		{ input: 1, cachedInput: 2, output: 0 }
	)
	assert.equal(result.totalCost, 3)
	assert.equal(result.cacheSavings, -1)
})

test('validates token counts including negative, fractional and large values', () => {
	assert.equal(tokenCountError(0), null)
	assert.equal(tokenCountError(MAX_TOKEN_COUNT), null)
	assert.match(tokenCountError(-1), /negative/)
	assert.match(tokenCountError(1.5), /whole number/)
	assert.match(tokenCountError(Number.NaN), /number/)
	assert.match(tokenCountError(MAX_TOKEN_COUNT + 1), /too large/)

	const errors = validateUsage({
		uncachedInput: -1,
		cachedInput: 1.5,
		output: Number.POSITIVE_INFINITY,
	})
	assert.ok(errors.uncachedInput)
	assert.ok(errors.cachedInput)
	assert.ok(errors.output)
})

test('derives cached and uncached quantities from a percentage', () => {
	assert.deepEqual(deriveSimplified(1_000_000, 75, 50_000), {
		uncachedInput: 250_000,
		cachedInput: 750_000,
		output: 50_000,
	})
	assert.deepEqual(deriveSimplified(3, 50, 0), {
		uncachedInput: 1,
		cachedInput: 2,
		output: 0,
	})
	assert.deepEqual(deriveSimplified(1_000, 0, 0), {
		uncachedInput: 1_000,
		cachedInput: 0,
		output: 0,
	})
	assert.deepEqual(deriveSimplified(1_000, 100, 0), {
		uncachedInput: 0,
		cachedInput: 1_000,
		output: 0,
	})
})

test('rejects cache-hit percentages outside 0–100', () => {
	assert.ok(validateSimplified(1_000, -0.1, 0).cacheHitPercent)
	assert.ok(validateSimplified(1_000, 100.1, 0).cacheHitPercent)
	assert.equal(deriveSimplified(1_000, 101, 0), null)
	assert.equal(validateSimplified(1_000, 100, 0).cacheHitPercent, undefined)
})

test('preserves equivalent usage when switching entry modes', () => {
	const original = { uncachedInput: 1_200, cachedInput: 3_800, output: 800 }
	const simplified = toSimplified(original)
	assert.equal(simplified.totalInput, 5_000)
	assert.equal(simplified.cacheHitPercent, 76)
	const restored = deriveSimplified(
		simplified.totalInput,
		simplified.cacheHitPercent,
		simplified.output
	)
	assert.deepEqual(restored, original)
})

test('compares standard and peak periods', () => {
	const comparison = comparePeriods(
		{ uncachedInput: 1_000_000, cachedInput: 0, output: 1_000_000 },
		{ input: 1, cachedInput: 0.1, output: 2 },
		{ input: 2, cachedInput: 0.2, output: 4 }
	)
	assert.equal(comparison.standard.totalCost, 3)
	assert.equal(comparison.peak.totalCost, 6)
	assert.equal(comparison.difference, 3)
	assert.equal(comparison.differencePercent, 100)
})

const deepseekPricing = {
	prompt: '0.00000015',
	completion: '0.0000006',
	input_cache_read: '0.000000003',
	overrides: [
		{
			utc_days: ['saturday', 'sunday'],
			prompt: '0.00000015',
			completion: '0.0000006',
			input_cache_read: '0.000000003',
		},
		{
			utc_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
			utc_start: 0,
			utc_end: 100,
			prompt: '0.00000015',
			completion: '0.0000006',
			input_cache_read: '0.000000003',
		},
		{
			utc_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
			utc_start: 100,
			utc_end: 400,
			prompt: '0.0000003',
			completion: '0.0000012',
			input_cache_read: '0.000000006',
		},
		{
			utc_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
			utc_start: 400,
			utc_end: 600,
			prompt: '0.00000015',
			completion: '0.0000006',
			input_cache_read: '0.000000003',
		},
		{
			utc_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
			utc_start: 600,
			utc_end: 1000,
			prompt: '0.0000003',
			completion: '0.0000012',
			input_cache_read: '0.000000006',
		},
	],
}

test('detects verified time-based peak pricing without confusing weekends', () => {
	const model = normaliseModelPricing({
		id: 'deepseek/example',
		name: 'DeepSeek Example',
		provider: 'DeepSeek',
		pricing: deepseekPricing,
		source: 'fallback',
		fromFallback: true,
	})
	assert.equal(model.hasTimeBasedPricing, true)
	assert.equal(model.periods.length, 2)
	assert.equal(model.periods[0].id, 'standard')
	assert.equal(model.periods[1].id, 'peak')
	assert.deepEqual(model.periods[1].rates, {
		input: 0.3,
		cachedInput: 0.006,
		output: 1.2,
	})
	assert.match(model.periods[1].condition, /Mon–Fri/)
	assert.match(model.periods[1].condition, /01:00–04:00/)
	assert.match(model.periods[1].condition, /06:00–10:00/)
	assert.equal(model.longContext, null)
})

test('keeps prompt-length thresholds separate from peak pricing', () => {
	const model = normaliseModelPricing({
		id: 'openai/example',
		name: 'OpenAI Example',
		provider: 'OpenAI',
		pricing: {
			prompt: '0.0000001',
			completion: '0.0000005',
			input_cache_read: '0.00000001',
			input_cache_write: '0.000000125',
			overrides: [
				{
					min_prompt_tokens: 272_000,
					prompt: '0.0000002',
					completion: '0.00000075',
					input_cache_read: '0.00000002',
					input_cache_write: '0.00000025',
				},
			],
		},
		source: 'fallback',
		fromFallback: true,
	})
	assert.equal(model.hasTimeBasedPricing, false)
	assert.equal(model.periods.length, 1)
	assert.equal(model.longContext?.minPromptTokens, 272_000)
	assert.deepEqual(model.longContext?.rates, {
		input: 0.2,
		cachedInput: 0.02,
		output: 0.75,
	})
	assert.equal(model.cacheWriteRate, 0.125)
})

test('does not treat a generic override as off-peak pricing', () => {
	const model = normaliseModelPricing({
		id: 'example/generic',
		name: 'Generic',
		provider: 'Example',
		pricing: {
			prompt: '0.000001',
			completion: '0.000002',
			input_cache_read: '0.0000001',
			overrides: [{ some_condition: true, prompt: '0.0000005' }],
		},
		source: 'fallback',
		fromFallback: true,
	})
	assert.equal(model.hasTimeBasedPricing, false)
	assert.equal(model.periods.length, 1)
	assert.equal(model.otherConditionalPricing, true)
})

test('explains when time-based overrides match the standard rates', () => {
	const model = normaliseModelPricing({
		id: 'example/flat',
		name: 'Flat',
		provider: 'Example',
		pricing: {
			prompt: '0.000001',
			completion: '0.000002',
			overrides: [
				{
					utc_days: ['monday'],
					utc_start: 900,
					utc_end: 1700,
					prompt: '0.000001',
					completion: '0.000002',
				},
			],
		},
		source: 'fallback',
		fromFallback: true,
	})
	assert.equal(model.periods.length, 1)
	assert.match(model.timePricingNote, /matches the standard rates/)
})

test('preserves a missing cached-input price', () => {
	const model = normaliseModelPricing({
		id: 'example/no-cache',
		name: 'No Cache Price',
		provider: 'Example',
		pricing: { prompt: '0.000001', completion: '0.000002' },
		source: 'fallback',
		fromFallback: true,
	})
	assert.equal(model.periods[0].rates.cachedInput, null)
	assert.equal(model.periods[0].rates.input, 1)
})

test('gives the custom model editable standard and peak periods', () => {
	const model = createCustomModelPricing()
	assert.equal(model.source, 'custom')
	assert.deepEqual(
		model.periods.map((period) => period.id),
		['standard', 'peak']
	)
	assert.deepEqual(model.periods[0].rates, model.periods[1].rates)
})
