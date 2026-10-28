import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
	classRepresentation, compositionAnalysis, filterRuns, formatCount, formatDuration,
	formatMargin, completionHistogram, marginHistogram, kpis, loadDungeon, loadIndex,
	searchRuns, sortRuns, specRepresentation, validateDungeon, validateIndex,
	type DungeonDataset, type Manifest,
} from '../src/lib/wowMythic.ts'
import { WOW_CLASSES, classColour, classTextColour } from '../src/lib/wowClasses.ts'

const classes = WOW_CLASSES.map((entry) => ({ ...entry }))
const specs = [
	{ id: 71, name: 'Arms', class_id: 1, role: 'dps' },
	{ id: 65, name: 'Holy', class_id: 2, role: 'healer' },
	{ id: 104, name: 'Guardian', class_id: 11, role: 'tank' },
	{ id: 261, name: 'Subtlety', class_id: 4, role: 'dps' },
	{ id: 262, name: 'Elemental', class_id: 7, role: 'dps' },
]
const dataset: DungeonDataset = {
	schema_version: '2.0.0', dataset_version: 'v2-season-20260101T000000Z', exported_at: '2026-01-01T00:00:00Z',
	season_name: 'MN Season 2', dungeon: { id: 16368, slug: 'den-of-nalorakk', name: 'Den of Nalorakk' },
	population: {
		cohort: { runs: 4, roster_appearances: 19, complete_rosters: 3, incomplete_rosters: 1, eligible_complete_teams: 3 },
		observation_window: { started_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-01T00:00:00Z' },
		collection: { id: 1, key: 'key', pages_requested: 1001, pages_succeeded: 1001, coverage_status: 'api_page_limit' },
		historical_context: {},
	},
	completeness: {}, run_statistics: {}, class_representation: {}, spec_representation: {},
	team_compositions: {}, performance: {}, definitions: {}, notes: [],
	references: { classes, specs, roles: ['tank', 'healer', 'dps'] },
	runs: [
		{ id: 1001, rank: 1, key: 23, clear: 1577035, timer: 1920999, score: 500, page: 0, roster: [[1, 71, 2], [2, 65, 1], [11, 104, 0], [4, 261, 2], [7, 262, 2]] },
		{ id: 1002, rank: 2, key: 23, clear: 1600000, timer: 1920999, score: 490, page: 0, roster: [[1, 71, 2], [2, 65, 1], [11, 104, 0], [4, 261, 2], [7, 262, 2]] },
		{ id: 1003, rank: 3, key: 24, clear: 1916259, timer: 1920999, score: 480, page: 0, roster: [[1, 71, 2], [2, 65, 1], [11, 104, 0], [4, 261, 2], [7, 262, 2]] },
		{ id: 1004, rank: 4, key: 24, clear: null, timer: 1920999, score: null, page: 0, roster: [[1, 71, 2], [2, 65, 1], [11, 104, 0], [4, 261, 2]] },
	],
}
const raw = Buffer.from(JSON.stringify(dataset))
const sha = createHash('sha256').update(raw).digest('hex')
const index: Manifest = {
	manifest_version: 2, schema_version: '2.0.0', dataset_version: dataset.dataset_version,
	generated_at: '2026-01-01T00:00:00Z', region: 'eu', season: 'season-mn-2', season_name: 'MN Season 2',
	scope: { region: 'eu', season: 'season-mn-2' },
	dungeons: [{ slug: 'den-of-nalorakk', name: 'Den of Nalorakk', file: 'dungeon.json', sha256: sha, size_bytes: raw.length, run_count: 4, roster_appearances: 19, complete_rosters: 3, coverage_status: 'api_page_limit', observation_window: dataset.population.observation_window }],
	combined: { file: 'combined.json', sha256: sha, size_bytes: raw.length, run_count: 4, roster_appearances: 20 }, notes: [],
}
const fetcher = (async (url: string) => {
	if (String(url).endsWith('manifest.json')) return new Response(JSON.stringify(index), { status: 200 })
	return new Response(raw, { status: 200 })
}) as unknown as typeof fetch

const loaded = await loadIndex(fetcher)
const dungeon = await loadDungeon(loaded, loaded.dungeons[0], fetcher)
const runs = dungeon.runs

test('schema 2 index and dungeon checksum are validated', () => {
	assert.equal(validateIndex(index).dungeons.length, 1)
	assert.equal(validateDungeon(dataset).runs.length, 4)
	assert.equal(runs.length, 4)
	assert.ok(runs.every((run) => run.source_url.startsWith('https://raider.io/')))
})

test('timing formatter uses MM:SS.mmm and handles signs and long durations', () => {
	assert.equal(formatDuration(1577.035), '26:17.035')
	assert.equal(formatDuration(1916.259), '31:56.259')
	assert.equal(formatMargin(197.634), '+03:17.634')
	assert.equal(formatMargin(-5.25), '-00:05.250')
	assert.equal(formatDuration(3600), '60:00.000')
	assert.equal(formatMargin(null), '—')
})

test('class colours are central and readable variants exist', () => {
	assert.equal(classColour(6), '#C41E3A')
	assert.equal(classColour(5), '#FFFFFF')
	assert.equal(classColour(8), '#3FC7EB')
	assert.equal(classColour(99), '#9CA3AF')
	assert.equal(classTextColour(5), '#111827')
	assert.equal(classTextColour(6), '#FFFFFF')
})

test('run filters and KPIs recalculate from the selected population', () => {
	assert.equal(filterRuns(runs, { keyLevel: '24', classId: 'all', specId: 'all' }).length, 2)
	assert.equal(filterRuns(runs, { keyLevel: 'all', classId: '7', specId: 'all' }).length, 3)
	assert.equal(filterRuns(runs, { keyLevel: 'all', classId: 'all', specId: '104' }).length, 4)
	const summary = kpis(filterRuns(runs, { keyLevel: '24', classId: 'all', specId: 'all' }))
	assert.equal(summary.runs, 2)
	assert.equal(summary.highest, 24)
	assert.equal(summary.average, 24)
	assert.equal(summary.completeTeams, 1)
})

test('class/spec representation uses appearance denominators and class colours', () => {
	const classes = classRepresentation(runs)
	assert.equal(classes.denominator, 19)
	assert.equal(classes.data.find((row) => row.className === 'Warrior')?.appearances, 4)
	assert.equal(classes.data.find((row) => row.className === 'Warrior')?.colour, '#C69B6D')
	const specs = specRepresentation(runs)
	assert.equal(specs.denominator, 19)
	assert.equal(specs.data.find((row) => row.specName === 'Arms')?.appearances, 4)
	const healer = specRepresentation(runs, 'healer')
	assert.equal(healer.denominator, 4)
	assert.equal(healer.data[0].specName, 'Holy')
	assert.equal(healer.data[0].percentage, 100)
})

test('compositions preserve five-spec multisets and exclusions', () => {
	const result = compositionAnalysis(runs)
	assert.equal(result.completeTeams, 3)
	assert.equal(result.eligibleTeams, 3)
	assert.equal(result.incompleteTeams, 1)
	assert.equal(result.excludedMissing, 0)
	assert.equal(result.compositions[0].occurrences, 3)
	assert.equal(result.compositions[0].specIds.length, 5)
})

test('search, sort and histograms use numeric data', () => {
	assert.equal(searchRuns(runs, '1003').length, 1)
	const sorted = sortRuns(runs, 'clear', 'asc')
	assert.ok(sorted[0].clear_time_seconds !== null)
	assert.equal(searchRuns(runs, 'guardian').length, 4)
	assert.equal(completionHistogram(runs, 30).reduce((sum, bin) => sum + bin.count, 0), 3)
	assert.equal(marginHistogram(runs, 30).reduce((sum, bin) => sum + bin.count, 0), 3)
	assert.equal(formatCount(20020), '20,020')
})

test('checksum mismatch and unsupported schema are rejected', async () => {
	const badFetcher = (async (url: string) => {
		if (String(url).endsWith('manifest.json')) return new Response(JSON.stringify(index), { status: 200 })
		return new Response(Buffer.concat([raw, Buffer.from(' ')]), { status: 200 })
	}) as unknown as typeof fetch
	await assert.rejects(() => loadDungeon(loaded, loaded.dungeons[0], badFetcher), /size|checksum/)
	assert.throws(() => validateIndex({ ...index, schema_version: '1.1.0' }), /schema 2/)
})
