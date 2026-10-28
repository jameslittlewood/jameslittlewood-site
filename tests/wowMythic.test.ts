import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
	classRepresentation,
	compositionAnalysis,
	compositionFullText,
	completionHistogram,
	filterRuns,
	formatDuration,
	formatMargin,
	formatPercent,
	histogram,
	kpis,
	loadWowDataset,
	marginHistogram,
	searchRuns,
	sortRuns,
	specRepresentation,
	validateDataset,
	validateManifest,
} from '../src/lib/wowMythic.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.resolve(here, '../public/data/wow-mythic-plus')
const manifest = validateManifest(
	JSON.parse(await readFile(path.join(dataDir, 'manifest.json'), 'utf8'))
)
const dataset = validateDataset(
	JSON.parse(await readFile(path.join(dataDir, manifest.file), 'utf8'))
)

test('validated manifest and dataset use schema 1.1 and 40 public run rows', () => {
	assert.equal(manifest.schema_version, '1.1.0')
	assert.equal(dataset.runs.length, 40)
	assert.equal(dataset.population.cohort.runs, 40)
	assert.ok(
		dataset.runs.every((run) => run.source_url.startsWith('https://raider.io/'))
	)
	assert.ok(
		dataset.runs.every(
			(run) => !('character_id' in run) && !('character_name' in run)
		)
	)
})

test('run-level filters recalculate the population', () => {
	const all = dataset.runs
	assert.equal(
		filterRuns(all, { keyLevel: '24', classId: 'all', specId: 'all' }).length,
		10
	)
	assert.equal(
		filterRuns(all, { keyLevel: '23', classId: 'all', specId: 'all' }).length,
		30
	)
	const shaman = classRepresentation(all).data.find(
		(row) => row.className === 'Shaman'
	)
	assert.ok(shaman)
	assert.equal(
		filterRuns(all, {
			keyLevel: 'all',
			classId: String(shaman.classId),
			specId: 'all',
		}).length,
		40
	)
	const arms = specRepresentation(all).data.find(
		(row) => row.specName === 'Arms'
	)
	assert.ok(arms)
	assert.equal(
		filterRuns(all, {
			keyLevel: 'all',
			classId: 'all',
			specId: String(arms.specId),
		}).length,
		37
	)
})

test('KPIs and denominators use the filtered run population', () => {
	const filtered = filterRuns(dataset.runs, {
		keyLevel: '24',
		classId: 'all',
		specId: 'all',
	})
	const summary = kpis(filtered)
	assert.equal(summary.runs, 10)
	assert.equal(summary.highest, 24)
	assert.equal(summary.average, 24)
	assert.equal(summary.appearances, 50)
	assert.equal(summary.completeTeams, 10)
	const classes = classRepresentation(filtered)
	assert.equal(classes.denominator, 50)
	assert.equal(
		classes.data.reduce((sum, row) => sum + row.appearances, 0),
		50
	)
})

test('role filter changes roster appearance denominators, not run count', () => {
	const healer = specRepresentation(dataset.runs, 'healer')
	assert.equal(healer.denominator, 40)
	const holy = healer.data.find(
		(row) => row.specName === 'Holy' && row.className === 'Paladin'
	)
	assert.ok(holy)
	assert.equal(holy.appearances, 29)
	assert.equal(holy.percentage, 72.5)
	assert.equal(kpis(dataset.runs).runs, 40)
})

test('composition analysis preserves five-spec multisets and exclusions', () => {
	const analysis = compositionAnalysis(dataset.runs)
	assert.equal(analysis.completeTeams, 40)
	assert.equal(analysis.eligibleTeams, 40)
	assert.equal(analysis.compositions.length, 8)
	assert.equal(analysis.compositions[0].occurrences, 20)
	assert.equal(analysis.compositions[0].percentage, 50)
	assert.equal(analysis.compositions[0].specIds.length, 5)
	assert.equal(
		analysis.compositions.reduce((sum, row) => sum + row.occurrences, 0),
		40
	)
})

test('missing values and empty populations are defined', () => {
	const empty = kpis([])
	assert.equal(empty.runs, 0)
	assert.equal(empty.highest, null)
	assert.equal(empty.average, null)
	assert.equal(classRepresentation([]).denominator, 0)
	assert.equal(compositionAnalysis([]).eligibleTeams, 0)
	assert.deepEqual(histogram([], 30), [])

	const syntheticRun = {
		...dataset.runs[0],
		run_id: 999,
		source_rank: 999,
		clear_time_seconds: null,
		timer_margin_seconds: null,
		roster: [
			{
				...dataset.runs[0].roster[0],
				class_id: null,
				class_name: null,
				spec_id: null,
				spec_name: null,
				role: null,
			},
		],
		roster_complete: false,
	}
	const summary = kpis([syntheticRun])
	assert.equal(summary.runs, 1)
	assert.equal(summary.missingClass, 1)
	assert.equal(summary.missingSpec, 1)
	assert.equal(classRepresentation([syntheticRun]).missing, 1)
	assert.equal(completionHistogram([syntheticRun]).length, 0)
})

test('search and sort are deterministic and null-safe', () => {
	assert.equal(searchRuns(dataset.runs, '23351424').length, 1)
	const filtered = searchRuns(dataset.runs, 'Shaman')
	assert.ok(filtered.length > 0)
	const sorted = sortRuns(dataset.runs, 'clear', 'asc')
	assert.ok(sorted.every((run) => run.clear_time_seconds !== null))
	assert.ok(
		sorted[0].clear_time_seconds! <=
			sorted[sorted.length - 1].clear_time_seconds!
	)
	assert.equal(sortRuns(dataset.runs, 'rank', 'desc')[0].source_rank, 40)
})

test('formatting is explicit about seconds and margins', () => {
	assert.equal(formatDuration(1674.349), '27:54.3')
	assert.equal(formatDuration(59.96), '1:00.0')
	assert.equal(formatMargin(246.65), '+4:06.7')
	assert.equal(formatMargin(-4.74), '−0:04.7')
	assert.equal(formatPercent(72.5), '72.5%')
	assert.match(compositionFullText(dataset.runs[0]), /Holy Paladin/)
})

test('histograms are contiguous and total populated runs', () => {
	const completion = completionHistogram(dataset.runs, 30)
	assert.equal(
		completion.reduce((sum, bin) => sum + bin.count, 0),
		40
	)
	const margin = marginHistogram(dataset.runs, 30)
	assert.equal(
		margin.reduce((sum, bin) => sum + bin.count, 0),
		40
	)
})

test('manifest compatibility rejects schema 1.0 and unsafe files', () => {
	assert.throws(
		() => validateManifest({ ...manifest, schema_version: '1.0.0' }),
		/schema 1.1/
	)
	assert.throws(
		() => validateManifest({ ...manifest, file: '../secret.json' }),
		/unsafe/
	)
	assert.throws(
		() => validateDataset({ ...dataset, schema_version: '2.0.0' }),
		/unsupported/
	)
})

test('loadWowDataset fetches manifest then the versioned file', async () => {
	const calls: string[] = []
	const rawDataset = await readFile(path.join(dataDir, manifest.file))
	const fakeFetch = (async (url: string) => {
		calls.push(String(url))
		const body = String(url).endsWith('manifest.json')
			? JSON.stringify(manifest)
			: rawDataset
		return new Response(body, {
			status: 200,
			headers: { 'content-type': 'application/json' },
		})
	}) as unknown as typeof fetch
	const loaded = await loadWowDataset(fakeFetch)
	assert.equal(loaded.dataset.dataset_version, dataset.dataset_version)
	assert.deepEqual(calls, [
		'/data/wow-mythic-plus/manifest.json',
		`/data/wow-mythic-plus/${manifest.file}`,
	])
})

test('loadWowDataset rejects a checksum mismatch', async () => {
	const rawDataset = await readFile(path.join(dataDir, manifest.file))
	const tampered = Buffer.from(rawDataset)
	tampered[tampered.length - 2] ^= 1
	const fakeFetch = (async (url: string) => {
		const body = String(url).endsWith('manifest.json')
			? JSON.stringify(manifest)
			: tampered
		return new Response(body, { status: 200 })
	}) as unknown as typeof fetch
	await assert.rejects(() => loadWowDataset(fakeFetch), /checksum|size/)
})

test('run-row validation rejects inconsistent complete flags and scope', () => {
	const clone = JSON.parse(JSON.stringify(dataset)) as typeof dataset
	clone.runs[0].roster = []
	clone.runs[0].roster_complete = true
	assert.throws(() => validateDataset(clone), /roster_complete/)
	const scopeClone = JSON.parse(JSON.stringify(dataset)) as typeof dataset
	scopeClone.population.scope.season = 'season-other'
	assert.throws(
		() => validateDataset(scopeClone),
		/season does not match scope/
	)
})

test('five-slot rosters define complete teams consistently', () => {
	const run = structuredClone(dataset.runs[0])
	run.roster_complete = false
	const classes = classRepresentation([run])
	assert.equal(classes.data.reduce((sum, row) => sum + row.teams, 0) > 0, true)
	assert.equal(kpis([run]).completeTeams, 1)
})

test('composition analysis reports incomplete and missing-role exclusions', () => {
	const incomplete = structuredClone(dataset.runs[0])
	incomplete.roster = incomplete.roster.slice(0, 4)
	incomplete.roster_complete = false
	const missingRole = structuredClone(dataset.runs[1])
	missingRole.roster[0].role = null
	const result = compositionAnalysis([incomplete, missingRole])
	assert.equal(result.completeTeams, 1)
	assert.equal(result.incompleteTeams, 1)
	assert.equal(result.excludedMissing, 1)
	assert.equal(result.eligibleTeams, 0)
	assert.equal(result.compositions.length, 0)
})

test('negative timer margins remain in the histogram', () => {
	const negative = structuredClone(dataset.runs[0])
	negative.timer_margin_seconds = -12.5
	negative.clear_time_seconds = negative.keystone_time_seconds! + 12.5
	const bins = marginHistogram([negative, dataset.runs[1]], 30)
	assert.equal(
		bins.reduce((sum, bin) => sum + bin.count, 0),
		2
	)
	assert.ok(bins.some((bin) => bin.min < 0 && bin.count > 0))
})
