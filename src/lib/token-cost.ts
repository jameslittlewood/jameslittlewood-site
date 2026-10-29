/**
 * Pure token-cost calculations.
 *
 * All rates are USD per million tokens. All token counts are whole,
 * non-negative numbers. Keeping this module free of Astro or DOM imports
 * makes it directly testable with `node --test`.
 */

export const MAX_TOKEN_COUNT = 1_000_000_000_000_000

export interface Rates {
	input: number | null
	cachedInput: number | null
	output: number | null
}

export interface TokenUsage {
	uncachedInput: number
	cachedInput: number
	output: number
}

export interface CostBreakdown {
	uncachedInputCost: number | null
	cachedInputCost: number | null
	outputCost: number | null
	totalCost: number | null
	totalInputTokens: number
	cacheHitRate: number
	costWithoutCaching: number | null
	cacheSavings: number | null
	unavailable: string[]
}

export interface UsageErrors {
	uncachedInput?: string
	cachedInput?: string
	output?: string
}

export interface SimplifiedUsage {
	totalInput: number
	cacheHitPercent: number
	output: number
}

export interface SimplifiedErrors {
	totalInput?: string
	cacheHitPercent?: string
	output?: string
}

export interface PeriodComparison {
	standard: CostBreakdown
	peak: CostBreakdown
	difference: number | null
	differencePercent: number | null
}

const RATE_EPSILON = 1e-12

/**
 * Convert OpenRouter's USD-per-token string into USD per million tokens.
 * Returns null for missing, non-numeric or negative values; it never treats a
 * missing price as zero.
 */
export function usdPerTokenToPerMillion(value: unknown): number | null {
	if (value === null || value === undefined) return null
	if (typeof value === 'string' && value.trim() === '') return null

	const number =
		typeof value === 'number' ? value : Number(String(value).trim())
	if (!Number.isFinite(number) || number < 0) return null

	// OpenRouter returns decimal strings; trim binary floating-point noise.
	return Number((number * 1_000_000).toPrecision(12))
}

function lineCost(tokens: number, rate: number | null): number | null {
	// Zero tokens cost nothing regardless of whether a rate is published. This
	// is arithmetic on a zero quantity, not an assumption that a missing rate
	// is zero.
	if (tokens === 0) return 0
	if (rate === null || !Number.isFinite(rate) || rate < 0) return null
	return (tokens * rate) / 1_000_000
}

export function calculateCost(usage: TokenUsage, rates: Rates): CostBreakdown {
	const totalInputTokens = usage.uncachedInput + usage.cachedInput
	const uncachedInputCost = lineCost(usage.uncachedInput, rates.input)
	const cachedInputCost = lineCost(usage.cachedInput, rates.cachedInput)
	const outputCost = lineCost(usage.output, rates.output)

	const available = [uncachedInputCost, cachedInputCost, outputCost]
	const totalCost = available.every((value) => value !== null)
		? (available as number[]).reduce((sum, value) => sum + value, 0)
		: null

	const cacheHitRate =
		totalInputTokens > 0 ? (usage.cachedInput / totalInputTokens) * 100 : 0

	const uncachedEquivalent = lineCost(totalInputTokens, rates.input)
	const outputEquivalent = lineCost(usage.output, rates.output)
	const costWithoutCaching =
		uncachedEquivalent === null || outputEquivalent === null
			? null
			: uncachedEquivalent + outputEquivalent

	const cacheSavings =
		totalCost === null || costWithoutCaching === null
			? null
			: costWithoutCaching - totalCost

	const unavailable: string[] = []
	if (uncachedInputCost === null) {
		unavailable.push('Uncached-input pricing is unavailable.')
	}
	if (cachedInputCost === null) {
		unavailable.push('Cached-input pricing is unavailable.')
	}
	if (outputCost === null) {
		unavailable.push('Output pricing is unavailable.')
	}
	if (totalCost === null) {
		unavailable.push('Provide the missing rate to calculate a total.')
	}

	return {
		uncachedInputCost,
		cachedInputCost,
		outputCost,
		totalCost,
		totalInputTokens,
		cacheHitRate,
		costWithoutCaching,
		cacheSavings,
		unavailable,
	}
}

export function comparePeriods(
	usage: TokenUsage,
	standardRates: Rates,
	peakRates: Rates
): PeriodComparison {
	const standard = calculateCost(usage, standardRates)
	const peak = calculateCost(usage, peakRates)
	const difference =
		standard.totalCost === null || peak.totalCost === null
			? null
			: peak.totalCost - standard.totalCost
	const differencePercent =
		difference === null ||
		standard.totalCost === null ||
		Math.abs(standard.totalCost) < RATE_EPSILON
			? null
			: (difference / standard.totalCost) * 100

	return { standard, peak, difference, differencePercent }
}

export function tokenCountError(
	value: number,
	label = 'Token count'
): string | null {
	if (!Number.isFinite(value)) return `${label} must be a number.`
	if (value < 0) return `${label} cannot be negative.`
	if (!Number.isInteger(value)) return `${label} must be a whole number.`
	if (value > MAX_TOKEN_COUNT) {
		return `${label} is too large (maximum ${MAX_TOKEN_COUNT.toLocaleString('en-GB')}).`
	}
	return null
}

export function validateUsage(usage: TokenUsage): UsageErrors {
	const errors: UsageErrors = {}
	const uncachedInput = tokenCountError(
		usage.uncachedInput,
		'Uncached input tokens'
	)
	const cachedInput = tokenCountError(usage.cachedInput, 'Cached input tokens')
	const output = tokenCountError(usage.output, 'Output tokens')
	if (uncachedInput) errors.uncachedInput = uncachedInput
	if (cachedInput) errors.cachedInput = cachedInput
	if (output) errors.output = output
	return errors
}

export function validateSimplified(
	totalInput: number,
	cacheHitPercent: number,
	output: number
): SimplifiedErrors {
	const errors: SimplifiedErrors = {}
	const totalError = tokenCountError(totalInput, 'Total input tokens')
	const outputError = tokenCountError(output, 'Output tokens')
	if (totalError) errors.totalInput = totalError
	if (outputError) errors.output = outputError
	if (!Number.isFinite(cacheHitPercent)) {
		errors.cacheHitPercent = 'Cache hit rate must be a number.'
	} else if (cacheHitPercent < 0 || cacheHitPercent > 100) {
		errors.cacheHitPercent = 'Cache hit rate must be between 0% and 100%.'
	}
	return errors
}

/**
 * Derive exact cached/uncached quantities from a total input count and a
 * cache-hit percentage. Rounding is applied to the cached quantity, and the
 * uncached quantity is the remainder, so the two always add up to the total.
 */
export function deriveSimplified(
	totalInput: number,
	cacheHitPercent: number,
	output: number
): TokenUsage | null {
	if (
		Object.keys(validateSimplified(totalInput, cacheHitPercent, output)).length
	) {
		return null
	}
	const cachedInput = Math.min(
		totalInput,
		Math.max(0, Math.round((totalInput * cacheHitPercent) / 100))
	)
	return {
		uncachedInput: totalInput - cachedInput,
		cachedInput,
		output,
	}
}

export function toSimplified(usage: TokenUsage): SimplifiedUsage {
	const totalInput = usage.uncachedInput + usage.cachedInput
	return {
		totalInput,
		cacheHitPercent:
			totalInput > 0 ? (usage.cachedInput / totalInput) * 100 : 0,
		output: usage.output,
	}
}
