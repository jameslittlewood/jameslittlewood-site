import fallbackSnapshot from '../data/openrouter-fallback.json' with { type: 'json' }
import { CATALOGUE_URL, CURATED_GROUPS } from '../data/models.ts'
import {
	normaliseModelPricing,
	placeholderModelPricing,
	type ModelPricing,
	type RawPricing,
} from './pricing.ts'

interface FallbackModel {
	name?: string
	pricing?: RawPricing
}

interface FallbackSnapshot {
	retrievedAt?: string
	source?: string
	models?: Record<string, FallbackModel>
}

export interface PricingCatalogue {
	models: ModelPricing[]
	source: 'live' | 'fallback'
	retrievedAt: string | null
	warnings: string[]
}

const fallback = fallbackSnapshot as FallbackSnapshot
const CACHE_MS = 60 * 60 * 1000
let cache: { at: number; value: PricingCatalogue } | null = null

interface LiveModel {
	name?: string
	pricing?: RawPricing
}

async function fetchLiveCatalogue(): Promise<Map<string, LiveModel>> {
	const response = await fetch(CATALOGUE_URL, {
		headers: { Accept: 'application/json' },
		signal: AbortSignal.timeout(8_000),
	})
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}`)
	}
	const payload = (await response.json()) as { data?: unknown }
	if (!Array.isArray(payload.data)) {
		throw new Error('Unexpected catalogue response')
	}
	const models = new Map<string, LiveModel>()
	for (const entry of payload.data) {
		if (entry === null || typeof entry !== 'object') continue
		const model = entry as {
			id?: unknown
			name?: unknown
			pricing?: RawPricing
		}
		if (typeof model.id !== 'string') continue
		models.set(model.id, {
			name: typeof model.name === 'string' ? model.name : undefined,
			pricing: model.pricing,
		})
	}
	return models
}

async function loadCatalogue(): Promise<PricingCatalogue> {
	const warnings: string[] = []
	const fetchedAt = new Date().toISOString()
	let live: Map<string, LiveModel> | null = null

	try {
		if (process.env.AI_TOKEN_CALCULATOR_FORCE_FALLBACK === '1') {
			throw new Error('forced fallback')
		}
		live = await fetchLiveCatalogue()
	} catch (error) {
		const message = error instanceof Error ? error.message : 'unknown error'
		console.warn(
			`[ai-token-calculator] Live OpenRouter pricing unavailable (${message}); using cached snapshot.`
		)
		warnings.push(
			'Live OpenRouter pricing was unavailable at build time. Cached snapshot rates are shown.'
		)
	}

	const models: ModelPricing[] = []
	for (const group of CURATED_GROUPS) {
		for (const model of group.models) {
			const liveModel = live?.get(model.id)
			const cachedModel = fallback.models?.[model.id]

			if (liveModel?.pricing) {
				models.push(
					normaliseModelPricing({
						id: model.id,
						name: model.name,
						provider: group.provider,
						pricing: liveModel.pricing,
						source: 'openrouter',
						fromFallback: false,
					})
				)
				continue
			}

			if (live && !liveModel) {
				warnings.push(
					`${model.name} was missing from the live OpenRouter catalogue; cached rates were used.`
				)
			}

			if (cachedModel?.pricing) {
				models.push(
					normaliseModelPricing({
						id: model.id,
						name: model.name,
						provider: group.provider,
						pricing: cachedModel.pricing,
						source: 'fallback',
						fromFallback: true,
					})
				)
			} else {
				warnings.push(
					`${model.name} pricing is unavailable; enter rates manually.`
				)
				models.push(
					placeholderModelPricing(model.id, model.name, group.provider)
				)
			}
		}
	}

	const usedLive = models.some((model) => model.source === 'openrouter')
	const source = usedLive ? 'live' : 'fallback'
	const retrievedAt = usedLive ? fetchedAt : (fallback.retrievedAt ?? null)

	return {
		models,
		source,
		retrievedAt,
		warnings: [...new Set(warnings)],
	}
}

/**
 * Return the curated catalogue, fetching OpenRouter once per build. The
 * committed snapshot is used whenever the API is unavailable. This function
 * never throws, so a pricing outage cannot break the site build.
 */
export async function getPricingCatalogue(): Promise<PricingCatalogue> {
	if (cache && Date.now() - cache.at < CACHE_MS) return cache.value
	const value = await loadCatalogue()
	cache = { at: Date.now(), value }
	return value
}
