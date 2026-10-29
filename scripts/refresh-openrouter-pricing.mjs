#!/usr/bin/env node
/**
 * Refresh the committed OpenRouter pricing snapshot.
 *
 * The site fetches the public catalogue at build time and falls back to this
 * snapshot when the API is unavailable. Run this script when you want to
 * update the fallback data:
 *
 *   npm run pricing:refresh
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CATALOGUE_URL, CURATED_MODEL_IDS } from '../src/data/models.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = path.join(root, 'src/data/openrouter-fallback.json')

const ids = CURATED_MODEL_IDS

const priceKeys = [
	'prompt',
	'completion',
	'input_cache_read',
	'input_cache_write',
	'input_cache_write_1h',
]
const overrideKeys = [
	'utc_days',
	'utc_start',
	'utc_end',
	'min_prompt_tokens',
	...priceKeys,
]

function pick(source, keys) {
	const result = {}
	for (const key of keys) {
		if (source?.[key] !== undefined) result[key] = source[key]
	}
	return result
}

function sanitisePricing(pricing = {}) {
	const result = pick(pricing, priceKeys)
	if (Array.isArray(pricing.overrides)) {
		result.overrides = pricing.overrides
			.map((override) => pick(override, overrideKeys))
			.filter((override) => Object.keys(override).length > 0)
	}
	return result
}

function perMillion(value) {
	const number = Number(value)
	return Number.isFinite(number) ? `$${(number * 1_000_000).toFixed(4)}/M` : '—'
}

const response = await fetch(CATALOGUE_URL, {
	headers: { Accept: 'application/json' },
	signal: AbortSignal.timeout(20_000),
})

if (!response.ok) {
	throw new Error(
		`OpenRouter catalogue request failed: ${response.status} ${response.statusText}`
	)
}

const payload = await response.json()
if (!Array.isArray(payload?.data)) {
	throw new Error('OpenRouter catalogue response did not contain a data array')
}

const catalogue = new Map(payload.data.map((model) => [model.id, model]))
const missing = ids.filter((id) => !catalogue.has(id))

if (missing.length > 0) {
	console.error('Curated model identifiers missing from OpenRouter:')
	for (const id of missing) console.error(`  - ${id}`)
	process.exit(1)
}

const models = {}
for (const id of ids) {
	const model = catalogue.get(id)
	models[id] = {
		name: model.name,
		pricing: sanitisePricing(model.pricing),
	}
}

const snapshot = {
	retrievedAt: new Date().toISOString(),
	source: CATALOGUE_URL,
	models,
}

fs.writeFileSync(outputPath, `${JSON.stringify(snapshot, null, '\t')}\n`)

console.log(`Wrote ${ids.length} models to ${path.relative(root, outputPath)}`)
for (const id of ids) {
	const pricing = models[id].pricing
	console.log(
		`  ${id}: input ${perMillion(pricing.prompt)}, cached ${perMillion(
			pricing.input_cache_read
		)}, output ${perMillion(pricing.completion)}`
	)
}
