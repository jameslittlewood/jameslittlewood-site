import { tokenCountError, type Rates, type TokenUsage, type SimplifiedUsage } from './token-cost.ts'

/** Keep independent cached rates intact; only substitute them for calculations/display. */
export function effectiveRates(rates: Rates, cachingUnavailable: boolean): Rates {
	return cachingUnavailable ? { ...rates, cachedInput: rates.input } : { ...rates }
}

/** Project saved caching values into a no-cache workload without changing its total. */
export function effectiveTokenState(
	exact: TokenUsage,
	simplified: SimplifiedUsage,
	cachingUnavailable: boolean
): { exact: TokenUsage; simplified: SimplifiedUsage } {
	return {
		exact: cachingUnavailable
			? { ...exact, uncachedInput: exact.uncachedInput + exact.cachedInput, cachedInput: 0 }
			: { ...exact },
		simplified: { ...simplified, cacheHitPercent: cachingUnavailable ? 0 : simplified.cacheHitPercent },
	}
}

/** Edit a no-cache total while retaining the previous cached quantity where it still fits. */
export function withExactTotalInput(exact: TokenUsage, totalInput: number): TokenUsage {
	if (tokenCountError(totalInput)) {
		return { ...exact, uncachedInput: totalInput - exact.cachedInput }
	}
	const cachedInput = tokenCountError(exact.cachedInput) ? 0 : Math.min(exact.cachedInput, totalInput)
	return { ...exact, uncachedInput: totalInput - cachedInput, cachedInput }
}
