import { usdPerTokenToPerMillion, type Rates } from './token-cost.ts'

/** The subset of OpenRouter's pricing object used by the calculator. */
export interface RawPricingOverride {
	utc_days?: string[]
	utc_start?: number
	utc_end?: number
	min_prompt_tokens?: number
	prompt?: string
	completion?: string
	input_cache_read?: string
	input_cache_write?: string
	input_cache_write_1h?: string
}

export interface RawPricing {
	prompt?: string
	completion?: string
	input_cache_read?: string
	input_cache_write?: string
	input_cache_write_1h?: string
	overrides?: RawPricingOverride[]
}

export type PeriodKind = 'standard' | 'peak' | 'off-peak'
export type RateSource = 'openrouter' | 'fallback' | 'manual' | 'custom'

export interface PricingPeriod {
	id: string
	kind: PeriodKind
	label: string
	rates: Rates
	/** Human-readable time window, only present for time-based overrides. */
	condition: string | null
	source: 'base' | 'override' | 'manual'
}

export interface LongContextPricing {
	minPromptTokens: number
	rates: Rates
}

export interface ModelPricing {
	id: string
	name: string
	provider: string
	periods: PricingPeriod[]
	hasTimeBasedPricing: boolean
	timePricingNote: string | null
	cacheWriteRate: number | null
	cacheWrite1hRate: number | null
	longContext: LongContextPricing | null
	/** True when an override exists that this calculator does not model. */
	otherConditionalPricing: boolean
	source: RateSource
	fromFallback: boolean
}

interface NormaliseInput {
	id: string
	name: string
	provider: string
	pricing: RawPricing | null | undefined
	source: RateSource
	fromFallback: boolean
}

const RATE_KEYS = ['input', 'cachedInput', 'output'] as const
const RATE_EPSILON = 1e-12
const DAY_ORDER = [
	'monday',
	'tuesday',
	'wednesday',
	'thursday',
	'friday',
	'saturday',
	'sunday',
]
const DAY_SHORT: Record<string, string> = {
	monday: 'Mon',
	tuesday: 'Tue',
	wednesday: 'Wed',
	thursday: 'Thu',
	friday: 'Fri',
	saturday: 'Sat',
	sunday: 'Sun',
}

function rateValue(
	rawValue: string | undefined,
	baseValue: number | null | undefined
): number | null {
	if (rawValue === undefined) return baseValue ?? null
	return usdPerTokenToPerMillion(rawValue)
}

function ratesFrom(raw: RawPricing | RawPricingOverride, base?: Rates): Rates {
	return {
		input: rateValue(raw.prompt, base?.input),
		cachedInput: rateValue(raw.input_cache_read, base?.cachedInput),
		output: rateValue(raw.completion, base?.output),
	}
}

function hasRateDifference(candidate: Rates, base: Rates): boolean {
	return RATE_KEYS.some((key) => {
		const a = candidate[key]
		const b = base[key]
		return a !== null && b !== null && Math.abs(a - b) > RATE_EPSILON
	})
}

type RateDelta = 'higher' | 'lower' | 'same' | 'mixed'

function rateDelta(candidate: Rates, base: Rates): RateDelta {
	let higher = false
	let lower = false
	for (const key of RATE_KEYS) {
		const a = candidate[key]
		const b = base[key]
		if (a === null || b === null) continue
		if (a > b + RATE_EPSILON) higher = true
		if (a < b - RATE_EPSILON) lower = true
	}
	if (higher && lower) return 'mixed'
	if (higher) return 'higher'
	if (lower) return 'lower'
	return 'same'
}

function combineRates(
	candidates: Rates[],
	mode: 'max' | 'min',
	base: Rates
): Rates {
	const result: Rates = { ...base }
	for (const key of RATE_KEYS) {
		const values = candidates
			.map((candidate) => candidate[key])
			.filter((value): value is number => value !== null)
		if (values.length > 0) {
			result[key] = mode === 'max' ? Math.max(...values) : Math.min(...values)
		}
	}
	return result
}

function isTimeOverride(override: RawPricingOverride): boolean {
	const hasDays =
		Array.isArray(override.utc_days) && override.utc_days.length > 0
	const hasStart =
		override.utc_start !== undefined &&
		Number.isFinite(Number(override.utc_start))
	const hasEnd =
		override.utc_end !== undefined && Number.isFinite(Number(override.utc_end))
	return hasDays || hasStart || hasEnd
}

function thresholdValue(override: RawPricingOverride): number | null {
	if (override.min_prompt_tokens === undefined) return null
	const value = Number(override.min_prompt_tokens)
	return Number.isFinite(value) && value > 0 ? value : null
}

function formatDays(days: string[] | undefined): string {
	if (!days || days.length === 0) return 'Daily'
	const unique = [...new Set(days.map((day) => day.toLowerCase()))].sort(
		(a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b)
	)
	if (unique.length === 7) return 'Daily'
	if (
		unique.length === 5 &&
		['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].every((day) =>
			unique.includes(day)
		)
	) {
		return 'Mon–Fri'
	}
	if (
		unique.length === 2 &&
		unique.includes('saturday') &&
		unique.includes('sunday')
	) {
		return 'Sat–Sun'
	}
	return unique.map((day) => DAY_SHORT[day] ?? day).join(', ')
}

/**
 * OpenRouter expresses utc_start/utc_end as HHMM (for example 100 = 01:00 and
 * 1000 = 10:00). An end of 0 means midnight at the end of the day.
 */
function formatUtcTime(
	value: number | undefined,
	isEnd = false
): string | null {
	if (value === undefined || !Number.isFinite(Number(value))) return null
	const numeric = Number(value)
	if (!Number.isInteger(numeric) || numeric < 0 || numeric > 2400) return null
	if (isEnd && numeric === 0) return '24:00'
	const hours = Math.floor(numeric / 100)
	const minutes = numeric % 100
	if (hours > 23 || minutes > 59) return null
	return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function formatWindows(overrides: RawPricingOverride[]): string | null {
	if (overrides.length === 0) return null
	const byDays = new Map<string, string[]>()
	for (const override of overrides) {
		const days = formatDays(override.utc_days)
		const start = formatUtcTime(override.utc_start)
		const end = formatUtcTime(override.utc_end, true)
		const range =
			start && end
				? `${start}–${end}`
				: start
					? `from ${start}`
					: end
						? `until ${end}`
						: null
		const ranges = byDays.get(days) ?? []
		if (range && !ranges.includes(range)) ranges.push(range)
		byDays.set(days, ranges)
	}
	const parts = [...byDays.entries()].map(([days, ranges]) =>
		ranges.length > 0 ? `${days}, ${ranges.join(' and ')} UTC` : days
	)
	return parts.length > 0 ? parts.join('; ') : null
}

/**
 * Normalise one OpenRouter pricing object into standard and (only where
 * verified) peak/off-peak periods. Prompt-length thresholds are kept separate
 * and are never mistaken for a time-based discount.
 */
export function normaliseModelPricing({
	id,
	name,
	provider,
	pricing,
	source,
	fromFallback,
}: NormaliseInput): ModelPricing {
	const raw = pricing ?? {}
	const base = ratesFrom(raw)
	const overrides = Array.isArray(raw.overrides)
		? raw.overrides.filter(
				(override): override is RawPricingOverride =>
					override !== null && typeof override === 'object'
			)
		: []

	const timeOverrides = overrides.filter(isTimeOverride)
	const thresholdOverrides = overrides
		.map((override) => ({
			override,
			threshold: thresholdValue(override),
		}))
		.filter(
			(entry): entry is { override: RawPricingOverride; threshold: number } =>
				entry.threshold !== null
		)
		.sort((a, b) => a.threshold - b.threshold)
	const otherOverrides = overrides.filter(
		(override) => !isTimeOverride(override) && thresholdValue(override) === null
	)

	const candidateRates = timeOverrides.map((override) => ({
		override,
		rates: ratesFrom(override, base),
	}))
	const higher = candidateRates.filter(({ rates }) => {
		const delta = rateDelta(rates, base)
		return delta === 'higher' || delta === 'mixed'
	})
	const lower = candidateRates.filter(
		({ rates }) => rateDelta(rates, base) === 'lower'
	)

	const peakRates =
		higher.length > 0
			? combineRates(
					higher.map(({ rates }) => rates),
					'max',
					base
				)
			: null
	const offPeakRates =
		lower.length > 0
			? combineRates(
					lower.map(({ rates }) => rates),
					'min',
					base
				)
			: null

	const hasPeak = peakRates !== null && hasRateDifference(peakRates, base)
	const hasOffPeak =
		offPeakRates !== null && hasRateDifference(offPeakRates, base)

	const periods: PricingPeriod[] = [
		{
			id: 'standard',
			kind: 'standard',
			label: hasPeak && !hasOffPeak ? 'Off-peak / standard' : 'Standard',
			rates: base,
			condition:
				hasPeak && !hasOffPeak
					? 'All times outside the published peak windows'
					: null,
			source: 'base',
		},
	]

	if (hasPeak && peakRates) {
		periods.push({
			id: 'peak',
			kind: 'peak',
			label: 'Peak',
			rates: peakRates,
			condition: formatWindows(higher.map(({ override }) => override)),
			source: 'override',
		})
	}

	if (hasOffPeak && offPeakRates) {
		periods.push({
			id: 'off-peak',
			kind: 'off-peak',
			label: 'Off-peak',
			rates: offPeakRates,
			condition: formatWindows(lower.map(({ override }) => override)),
			source: 'override',
		})
	}

	let timePricingNote: string | null = null
	if (timeOverrides.length === 0) {
		timePricingNote =
			'No time-based pricing is published for this model; the same rates apply all day.'
	} else if (!hasPeak && !hasOffPeak) {
		timePricingNote =
			'OpenRouter publishes time-based pricing for this model, but it matches the standard rates. No separate peak or off-peak rate is available.'
	}

	const longContext =
		thresholdOverrides.length > 0
			? {
					minPromptTokens: thresholdOverrides[0].threshold,
					rates: ratesFrom(thresholdOverrides[0].override, base),
				}
			: null

	return {
		id,
		name,
		provider,
		periods,
		hasTimeBasedPricing: timeOverrides.length > 0,
		timePricingNote,
		cacheWriteRate: usdPerTokenToPerMillion(raw.input_cache_write),
		cacheWrite1hRate: usdPerTokenToPerMillion(raw.input_cache_write_1h),
		longContext,
		otherConditionalPricing:
			otherOverrides.length > 0 || thresholdOverrides.length > 1,
		source,
		fromFallback,
	}
}

export function createCustomModelPricing(): ModelPricing {
	const standard: Rates = { input: 1, cachedInput: 0.1, output: 2 }
	const peak: Rates = { input: 1, cachedInput: 0.1, output: 2 }
	return {
		id: 'custom',
		name: 'Custom model',
		provider: 'Custom',
		periods: [
			{
				id: 'standard',
				kind: 'standard',
				label: 'Standard',
				rates: standard,
				condition: null,
				source: 'manual',
			},
			{
				id: 'peak',
				kind: 'peak',
				label: 'Peak',
				rates: peak,
				condition: null,
				source: 'manual',
			},
		],
		hasTimeBasedPricing: true,
		timePricingNote: null,
		cacheWriteRate: null,
		cacheWrite1hRate: null,
		longContext: null,
		otherConditionalPricing: false,
		source: 'custom',
		fromFallback: false,
	}
}

export function placeholderModelPricing(
	id: string,
	name: string,
	provider: string
): ModelPricing {
	return {
		id,
		name,
		provider,
		periods: [
			{
				id: 'standard',
				kind: 'standard',
				label: 'Standard',
				rates: { input: null, cachedInput: null, output: null },
				condition: null,
				source: 'base',
			},
		],
		hasTimeBasedPricing: false,
		timePricingNote:
			'Pricing could not be loaded. Enter rates manually to use the calculator.',
		cacheWriteRate: null,
		cacheWrite1hRate: null,
		longContext: null,
		otherConditionalPricing: false,
		source: 'fallback',
		fromFallback: true,
	}
}
