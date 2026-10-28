#!/usr/bin/env node
/**
 * Copy the current validated Mythic+ publication into the site's static assets.
 *
 * Usage:
 *   node scripts/sync-wow-mythic-data.mjs --source /path/to/wow-mythic-plus/data/published
 *
 * The source directory must contain manifest.json and the versioned file it
 * references. The manifest checksum/size and the schema 1.1 run rows are
 * verified before any static file is replaced.
 */
import { createHash } from 'node:crypto'
import {
	copyFile,
	mkdir,
	readFile,
	readdir,
	rename,
	rm,
	writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const sourceIndex = args.indexOf('--source')
const source = path.resolve(
	sourceIndex >= 0
		? args[sourceIndex + 1]
		: process.env.WOW_MPLUS_PUBLISHED_DIR ||
				path.resolve(here, '../../data/published')
)
const target = path.resolve(here, '../public/data/wow-mythic-plus')
const manifestPath = path.join(source, 'manifest.json')
const sha256 = (data) => createHash('sha256').update(data).digest('hex')

function fail(message) {
	console.error(`sync-wow-mythic-data: ${message}`)
	process.exit(1)
}

function assert(condition, message) {
	if (!condition) fail(message)
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
assert(manifest.manifest_version === 1, 'manifest_version must be 1')
assert(typeof manifest.schema_version === 'string', 'schema_version missing')
const [major, minor] = manifest.schema_version.split('.').map(Number)
assert(
	major === 1 && minor >= 1,
	`dashboard requires schema 1.1+, got ${manifest.schema_version}`
)
assert(typeof manifest.collection_key === 'string', 'collection_key missing')
assert(typeof manifest.dataset_version === 'string', 'dataset_version missing')
assert(
	typeof manifest.file === 'string' &&
		path.basename(manifest.file) === manifest.file,
	'unsafe manifest file name'
)
assert(
	typeof manifest.sha256 === 'string' && /^[0-9a-f]{64}$/.test(manifest.sha256),
	'manifest sha256 invalid'
)
assert(
	Number.isInteger(manifest.size_bytes) && manifest.size_bytes > 0,
	'manifest size_bytes invalid'
)

const sourceFile = path.join(source, manifest.file)
const raw = await readFile(sourceFile)
assert(raw.length === manifest.size_bytes, 'manifest size does not match file')
assert(sha256(raw) === manifest.sha256, 'manifest checksum does not match file')
const dataset = JSON.parse(raw.toString('utf8'))
assert(
	dataset.schema_version === manifest.schema_version,
	'dataset schema_version mismatch'
)
assert(
	dataset.dataset_version === manifest.dataset_version,
	'dataset dataset_version mismatch'
)
assert(Array.isArray(dataset.runs), 'dataset has no run rows')
assert(
	dataset.runs.length === dataset.population?.cohort?.runs,
	'run rows do not match cohort runs'
)
assert(
	dataset.population?.collection?.key === manifest.collection_key,
	'collection key mismatch'
)
assert(
	dataset.runs.every(
		(run) => !('character_id' in run) && !('character_name' in run)
	),
	'run rows contain character identifiers'
)
assert(
	dataset.runs.every(
		(run) =>
			typeof run.source_url === 'string' &&
			run.source_url.startsWith('https://raider.io/')
	),
	'run source URL invalid'
)

await mkdir(target, { recursive: true })
const stagedFile = path.join(target, `.tmp-${manifest.file}`)
await writeFile(stagedFile, raw)
assert(
	sha256(await readFile(stagedFile)) === manifest.sha256,
	'staged copy checksum mismatch'
)
await rename(stagedFile, path.join(target, manifest.file))

const stagedManifest = path.join(target, '.tmp-manifest.json')
await writeFile(stagedManifest, `${JSON.stringify(manifest, null, 2)}\n`)
await rename(stagedManifest, path.join(target, 'manifest.json'))

for (const entry of await readdir(target)) {
	if (entry.startsWith('analytics-v1.') && entry !== manifest.file) {
		await rm(path.join(target, entry), { force: true })
	}
}
console.log(
	`Synced ${manifest.dataset_version} (${manifest.schema_version}) to ${target}`
)
console.log(`File: ${manifest.file}`)
console.log(`SHA-256: ${manifest.sha256}`)
