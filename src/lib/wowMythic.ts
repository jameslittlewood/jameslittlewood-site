/**
 * Schema 2 index, compact dungeon files, filtering and denominator helpers.
 * The frontend never connects to PostgreSQL and never receives character IDs.
 */
import { classColour, classTextColour, wowClass, WOW_CLASSES } from './wowClasses.ts'

export type Role = 'tank' | 'healer' | 'dps' | string

export interface DungeonEntry {
	slug: string
	name: string
	file: string
	sha256: string
	size_bytes: number
	run_count: number
	roster_appearances: number
	complete_rosters: number
	coverage_status: string
	pages_requested?: number
	pages_succeeded?: number
	positions?: number
	duplicate_positions?: number
	missing_character_id_appearances?: number
	observation_window: { started_at: string | null; completed_at: string | null }
}

export interface Manifest {
	manifest_version: 2
	schema_version: string
	dataset_version: string
	generated_at: string
	region: string
	season: string
	season_name: string
	scope: { region: string; season: string }
	partial: boolean
	dungeons: DungeonEntry[]
	combined: { file: string; sha256: string; size_bytes: number; run_count: number; roster_appearances: number }
	notes: string[]
}

export interface ClassReference {
	id: number
	name: string
	slug: string
	colour: string
}

export interface SpecReference {
	id: number
	name: string
	class_id: number | null
	role: string | null
}

export interface References {
	classes: ClassReference[]
	specs: SpecReference[]
	roles: string[]
}

export interface CompactRun {
	id: number
	rank: number
	key: number
	clear: number | null
	timer: number | null
	score: number | null
	page: number
	roster: Array<[number | null, number | null, number]>
}

export interface RosterMember {
	roster_position: number
	class_id: number | null
	class_name: string | null
	spec_id: number | null
	spec_name: string | null
	role: string | null
	colour: string
	text_colour: string
}

export interface RunRow {
	run_id: number
	dungeon: { id: number | null; slug: string; name: string }
	source_rank: number
	source_page: number
	source_score: number | null
	mythic_level: number
	clear_time_seconds: number | null
	keystone_time_seconds: number | null
	timer_margin_seconds: number | null
	roster_complete: boolean
	roster: RosterMember[]
	source_url: string
}

export interface DungeonDataset {
	schema_version: string
	dataset_version: string
	exported_at: string
	season_name: string
	dungeon: { id: number | null; slug: string; name: string }
	population: {
		cohort: {
			runs: number
			roster_appearances: number
			complete_rosters: number
			incomplete_rosters: number
			eligible_complete_teams: number
		}
		observation_window: { started_at: string | null; completed_at: string | null }
		collection: {
			id: number
			key: string
			pages_requested: number
			pages_succeeded: number
			coverage_status: string
		}
		historical_context: Record<string, number>
	}
	completeness: Record<string, unknown>
	run_statistics: Record<string, unknown>
	class_representation: Record<string, unknown>
	spec_representation: Record<string, unknown>
	team_compositions: Record<string, unknown>
	performance: Record<string, unknown>
	references: References
	definitions: Record<string, unknown>
	notes: string[]
	runs: CompactRun[]
}

export interface DungeonData {
	entry: DungeonEntry
	dataset: DungeonDataset
	runs: RunRow[]
}

export interface RunFilters {
	keyLevel: string
	classId: string
	specId: string
}

export interface Appearance {
	run: RunRow
	member: RosterMember
}

export interface ClassDatum {
	classId: number
	className: string
	colour: string
	textColour: string
	appearances: number
	percentage: number
	teams: number
}

export interface SpecDatum {
	specId: number
	specName: string
	classId: number | null
	className: string | null
	role: string | null
	colour: string
	appearances: number
	percentage: number
	teams: number
}

export interface CompositionDatum {
	key: string
	specIds: number[]
	specNames: string[]
	labels: string[]
	colours: string[]
	roles: string[]
	occurrences: number
	percentage: number
}

export interface CompositionAnalysis {
	compositions: CompositionDatum[]
	completeTeams: number
	eligibleTeams: number
	incompleteTeams: number
	excludedMissing: number
}

export interface HistogramBin {
	label: string
	min: number
	max: number
	count: number
}

export interface Kpis {
	runs: number
	highest: number | null
	average: number | null
	median: number | null
	appearances: number
	completeTeams: number
	incompleteTeams: number
	missingClass: number
	missingSpec: number
	missingRole: number
}

const CHARACTER_KEYS = new Set(['character_id', 'character_name'])
const ROLE_NAMES = ['tank', 'healer', 'dps']

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message)
}

export function schemaParts(version: string): [number, number, number] {
	const parts = version.split('.').map(Number)
	assert(parts.length === 3 && parts.every((part) => Number.isInteger(part) && part >= 0), `Invalid schema version: ${version}`)
	return [parts[0], parts[1], parts[2]]
}

export function isSupportedSchema(version: string): boolean {
	const [major] = schemaParts(version)
	return major === 2
}

function assertNoCharacterKeys(value: unknown, path = 'dataset'): void {
	if (Array.isArray(value)) {
		value.forEach((item, index) => assertNoCharacterKeys(item, `${path}[${index}]`))
	} else if (isRecord(value)) {
		for (const [key, item] of Object.entries(value)) {
			assert(!CHARACTER_KEYS.has(key), `${path} contains a forbidden character identifier field`)
			assertNoCharacterKeys(item, `${path}.${key}`)
		}
	}
}

export function validateIndex(input: unknown): Manifest {
	assert(isRecord(input), 'Index is not an object')
	assert(input.manifest_version === 2, 'Unsupported manifest version')
	assert(typeof input.schema_version === 'string' && isSupportedSchema(input.schema_version), `Dashboard requires schema 2.x, got ${String(input.schema_version)}`)
	assert(typeof input.dataset_version === 'string', 'Dataset version missing')
	assert(typeof input.season_name === 'string', 'Season name missing')
	assert(Array.isArray(input.dungeons) && input.dungeons.length > 0, 'Dungeon index empty')
	const slugs = new Set<string>()
	for (const [index, entry] of input.dungeons.entries()) {
		assert(isRecord(entry), `Dungeon ${index} invalid`)
		assert(typeof entry.slug === 'string' && entry.slug.length > 0, `Dungeon ${index} slug invalid`)
		assert(!slugs.has(entry.slug), `Duplicate dungeon ${entry.slug}`)
		slugs.add(entry.slug)
		assert(typeof entry.name === 'string', `Dungeon ${index} name missing`)
		assert(typeof entry.file === 'string' && !entry.file.includes('/'), `Dungeon ${index} file unsafe`)
		assert(typeof entry.sha256 === 'string' && /^[0-9a-f]{64}$/.test(entry.sha256), `Dungeon ${index} checksum invalid`)
		assert(Number.isInteger(entry.size_bytes) && entry.size_bytes > 0, `Dungeon ${index} size invalid`)
		assert(Number.isInteger(entry.run_count) && entry.run_count >= 0, `Dungeon ${index} run count invalid`)
	}
	assert(isRecord(input.scope), 'Index scope missing')
	return input as unknown as Manifest
}

export function validateDungeon(input: unknown): DungeonDataset {
	assert(isRecord(input), 'Dungeon dataset is not an object')
	assert(typeof input.schema_version === 'string' && isSupportedSchema(input.schema_version), 'Dungeon schema unsupported')
	assert(typeof input.dataset_version === 'string', 'Dungeon version missing')
	assert(isRecord(input.dungeon), 'Dungeon metadata missing')
	assert(isRecord(input.references), 'Class/spec references missing')
	assert(isRecord(input.population) && isRecord(input.population.cohort), 'Dungeon cohort missing')
	assert(Array.isArray(input.runs), 'Dungeon runs missing')
	if (input.runs.length !== input.population.cohort.runs) throw new Error('Run rows do not match cohort')
	assertNoCharacterKeys(input.runs)
	const ids = new Set<number>()
	const ranks = new Set<number>()
	for (const [index, run] of input.runs.entries()) {
		assert(isRecord(run), `Run ${index} invalid`)
		assert(Number.isInteger(run.id) && run.id > 0, `Run ${index} id invalid`)
		assert(!ids.has(run.id as number), `Run ${index} duplicate id`)
		ids.add(run.id as number)
		assert(Number.isInteger(run.rank) && run.rank > 0, `Run ${index} rank invalid`)
		assert(!ranks.has(run.rank as number), `Run ${index} duplicate rank`)
		ranks.add(run.rank as number)
		assert(Number.isInteger(run.key) && run.key > 0, `Run ${index} key invalid`)
		assert(Array.isArray(run.roster) && run.roster.length <= 5, `Run ${index} roster invalid`)
		for (const member of run.roster) {
			assert(Array.isArray(member) && member.length === 3, `Run ${index} roster member invalid`)
			assert(member[0] === null || Number.isInteger(member[0]), `Run ${index} class invalid`)
			assert(member[1] === null || Number.isInteger(member[1]), `Run ${index} spec invalid`)
			assert(typeof member[2] === 'number' && [-1, 0, 1, 2].includes(member[2]), `Run ${index} role invalid`)
		}
	}
	return input as unknown as DungeonDataset
}

async function verifyFile(response: Response, sha256: string, size: number): Promise<ArrayBuffer> {
	const raw = await response.arrayBuffer()
	if (raw.byteLength !== size) throw new Error('Dataset size does not match the index')
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', raw))
	const checksum = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
	if (checksum !== sha256) throw new Error('Dataset checksum does not match the index')
	return raw
}

export async function loadIndex(fetcher: typeof fetch = fetch, base = '/data/wow-mythic-plus'): Promise<Manifest> {
	const response = await fetcher(`${base.replace(/\/$/, '')}/manifest.json`, { cache: 'no-cache' })
	if (!response.ok) throw new Error(`Could not load dataset index (HTTP ${response.status})`)
	return validateIndex(await response.json())
}

export interface CombinedDataset {
	schema_version: string
	dataset_version: string
	exported_at: string
	season_name: string
	population: {
		cohort: { runs: number; roster_appearances: number; complete_rosters: number; incomplete_rosters: number; eligible_complete_teams: number }
		observation_window: { started_at: string | null; completed_at: string | null }
		dungeons: Array<{ slug: string; collection_key: string; run_count: number }>
		historical_context: Record<string, number>
	}
	completeness: Record<string, unknown>
	run_statistics: {
		total_distinct_runs: number
		key_level: { highest: number | null; lowest: number | null; average: number | null; median: number | null }
		by_key_level: Array<{ mythic_level: number; runs: number; percentage_of_runs: number }>
	}
	class_representation: { classes: ClassDatum[]; denominators: Record<string, number> }
	spec_representation: { specs: SpecDatum[]; denominators: Record<string, unknown> }
	team_compositions: Record<string, unknown>
	performance: Record<string, unknown>
	definitions: Record<string, unknown>
	notes: string[]
}

export function validateCombined(input: unknown): CombinedDataset {
	assert(isRecord(input), 'Combined dataset is not an object')
	assert(typeof input.schema_version === 'string' && isSupportedSchema(input.schema_version), 'Combined schema unsupported')
	assert(isRecord(input.population) && isRecord(input.population.cohort), 'Combined cohort missing')
	assert(Array.isArray(input.population.dungeons), 'Combined dungeon list missing')
	assert(isRecord(input.run_statistics) && Array.isArray(input.run_statistics.by_key_level), 'Combined statistics missing')
	assert(isRecord(input.class_representation) && Array.isArray(input.class_representation.classes), 'Combined class data missing')
	assertNoCharacterKeys(input)
	return input as unknown as CombinedDataset
}

export async function loadCombined(
	index: Manifest,
	fetcher: typeof fetch = fetch,
	base = '/data/wow-mythic-plus',
): Promise<CombinedDataset> {
	const response = await fetcher(`${base.replace(/\/$/, '')}/${index.combined.file}`, { cache: 'no-cache' })
	if (!response.ok) throw new Error(`Could not load combined analytics (HTTP ${response.status})`)
	const dataset = validateCombined(
		JSON.parse(new TextDecoder().decode(await verifyFile(response, index.combined.sha256, index.combined.size_bytes))),
	)
	if (dataset.dataset_version !== index.dataset_version) throw new Error('Combined dataset version does not match the index')
	return dataset
}

export async function loadDungeon(
	index: Manifest,
	entry: DungeonEntry,
	fetcher: typeof fetch = fetch,
	base = '/data/wow-mythic-plus',
): Promise<DungeonData> {
	const response = await fetcher(`${base.replace(/\/$/, '')}/${entry.file}`, { cache: 'no-cache' })
	if (!response.ok) throw new Error(`Could not load ${entry.name} (HTTP ${response.status})`)
	const dataset = validateDungeon(JSON.parse(new TextDecoder().decode(await verifyFile(response, entry.sha256, entry.size_bytes))))
	if (dataset.dataset_version !== index.dataset_version) throw new Error('Dungeon dataset version does not match the index')
	if (dataset.dungeon.slug !== entry.slug) throw new Error('Dungeon slug does not match the index')
	return { entry, dataset, runs: hydrateRuns(dataset, index) }
}

export async function loadAllDungeons(index: Manifest, fetcher: typeof fetch = fetch, base = '/data/wow-mythic-plus'): Promise<DungeonData[]> {
	const results: DungeonData[] = []
	for (const entry of index.dungeons) results.push(await loadDungeon(index, entry, fetcher, base))
	return results
}

function hydrateRuns(dataset: DungeonDataset, index: Manifest): RunRow[] {
	const classes = new Map(dataset.references.classes.map((entry) => [entry.id, entry]))
	const specs = new Map(dataset.references.specs.map((entry) => [entry.id, entry]))
	return dataset.runs.map((run) => ({
		run_id: run.id,
		dungeon: dataset.dungeon,
		source_rank: run.rank,
		source_page: run.page,
		source_score: run.score,
		mythic_level: run.key,
		clear_time_seconds: run.clear === null ? null : run.clear / 1000,
		keystone_time_seconds: run.timer === null ? null : run.timer / 1000,
		timer_margin_seconds: run.clear === null || run.timer === null ? null : (run.timer - run.clear) / 1000,
		roster_complete: run.roster.length === 5,
		roster: run.roster.map(([classId, specId, roleCode], position) => {
			const classRef = classId === null ? undefined : classes.get(classId)
			const specRef = specId === null ? undefined : specs.get(specId)
			const role = roleCode >= 0 ? ROLE_NAMES[roleCode] ?? null : null
			return {
				roster_position: position + 1,
				class_id: classId,
				class_name: classRef?.name ?? null,
				spec_id: specId,
				spec_name: specRef?.name ?? null,
				role,
				colour: classColour(classId),
				text_colour: classTextColour(classId),
			}
		}),
		source_url: `https://raider.io/mythic-plus-rankings/runs/${encodeURIComponent(index.region)}/${encodeURIComponent(index.season)}/${encodeURIComponent(dataset.dungeon.slug)}/${run.id}`,
	}))
}

export function mean(values: number[]): number | null {
	if (!values.length) return null
	return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function median(values: number[]): number | null {
	if (!values.length) return null
	const ordered = [...values].sort((a, b) => a - b)
	const middle = Math.floor(ordered.length / 2)
	return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2
}

/** MM:SS.mmm; durations may exceed 59 minutes. */
export function formatDuration(seconds: number | null | undefined): string {
	if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—'
	const totalMs = Math.round(Math.abs(seconds) * 1000)
	const minutes = Math.floor(totalMs / 60000)
	const remainder = totalMs - minutes * 60000
	const secs = Math.floor(remainder / 1000)
	const ms = remainder % 1000
	return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

export function formatMargin(seconds: number | null | undefined): string {
	if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—'
	return `${seconds < 0 ? '-' : '+'}${formatDuration(Math.abs(seconds))}`
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
	if (value === null || value === undefined || !Number.isFinite(value)) return '—'
	return `${value.toFixed(digits)}%`
}

export function formatDate(value: string | null | undefined): string {
	if (!value) return '—'
	const date = new Date(value)
	if (Number.isNaN(date.valueOf())) return '—'
	return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' }).format(date)
}

export function formatCount(value: number): string {
	return new Intl.NumberFormat('en-GB').format(value)
}

export function filterRuns(runs: RunRow[], filters: RunFilters): RunRow[] {
	const keyLevel = filters.keyLevel === 'all' ? null : Number(filters.keyLevel)
	const classId = filters.classId === 'all' ? null : Number(filters.classId)
	const specId = filters.specId === 'all' ? null : Number(filters.specId)
	return runs.filter((run) => {
		if (keyLevel !== null && run.mythic_level !== keyLevel) return false
		if (classId !== null && !run.roster.some((member) => member.class_id === classId)) return false
		if (specId !== null && !run.roster.some((member) => member.spec_id === specId)) return false
		return true
	})
}

export function classOptions(runs: RunRow[]): Array<{ id: number; name: string; colour: string }> {
	const values = new Map<number, string>()
	for (const run of runs) for (const member of run.roster) if (member.class_id !== null && member.class_name) values.set(member.class_id, member.class_name)
	return [...values.entries()].map(([id, name]) => ({ id, name, colour: classColour(id) })).sort((a, b) => a.name.localeCompare(b.name))
}

export function specOptions(runs: RunRow[], classId: string): Array<{ id: number; name: string; role: string | null }> {
	const selected = classId === 'all' ? null : Number(classId)
	const values = new Map<number, { id: number; name: string; role: string | null }>()
	for (const run of runs) for (const member of run.roster) {
		if (member.spec_id === null || !member.spec_name) continue
		if (selected !== null && member.class_id !== selected) continue
		values.set(member.spec_id, { id: member.spec_id, name: member.spec_name, role: member.role })
	}
	return [...values.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function appearanceRows(runs: RunRow[], role = 'all'): Appearance[] {
	const rows: Appearance[] = []
	for (const run of runs) for (const member of run.roster) {
		if (role !== 'all' && member.role !== role) continue
		rows.push({ run, member })
	}
	return rows
}

export function classRepresentation(runs: RunRow[], role = 'all'): { data: ClassDatum[]; denominator: number; missing: number } {
	const appearances = appearanceRows(runs, role)
	const counts = new Map<number, { name: string; count: number; teams: Set<number> }>()
	let missing = 0
	for (const { run, member } of appearances) {
		if (member.class_id === null || !member.class_name) { missing += 1; continue }
		const entry = counts.get(member.class_id) ?? { name: member.class_name, count: 0, teams: new Set<number>() }
		entry.count += 1
		if (run.roster.length === 5) entry.teams.add(run.run_id)
		counts.set(member.class_id, entry)
	}
	const denominator = appearances.length
	return {
		data: [...counts.entries()].map(([classId, entry]) => ({
			classId,
			className: entry.name,
			colour: classColour(classId),
			textColour: classTextColour(classId),
			appearances: entry.count,
			percentage: denominator ? (entry.count * 100) / denominator : 0,
			teams: entry.teams.size,
		})).sort((a, b) => b.appearances - a.appearances || a.className.localeCompare(b.className)),
		denominator,
		missing,
	}
}

export function specRepresentation(runs: RunRow[], role = 'all'): { data: SpecDatum[]; denominator: number; missing: number; missingRole: number } {
	const appearances = appearanceRows(runs, role)
	const counts = new Map<number, { name: string; classId: number | null; className: string | null; role: string | null; count: number; teams: Set<number> }>()
	let missing = 0
	let missingRole = 0
	for (const { run, member } of appearances) {
		if (member.role === null) missingRole += 1
		if (member.spec_id === null || !member.spec_name) { missing += 1; continue }
		const entry = counts.get(member.spec_id) ?? { name: member.spec_name, classId: member.class_id, className: member.class_name, role: member.role, count: 0, teams: new Set<number>() }
		entry.count += 1
		if (run.roster.length === 5) entry.teams.add(run.run_id)
		counts.set(member.spec_id, entry)
	}
	const denominator = appearances.length
	return {
		data: [...counts.entries()].map(([specId, entry]) => ({
			specId,
			specName: entry.name,
			classId: entry.classId,
			className: entry.className,
			role: entry.role,
			colour: classColour(entry.classId),
			appearances: entry.count,
			percentage: denominator ? (entry.count * 100) / denominator : 0,
			teams: entry.teams.size,
		})).sort((a, b) => b.appearances - a.appearances || a.specName.localeCompare(b.specName)),
		denominator,
		missing,
		missingRole,
	}
}

export function compositionAnalysis(runs: RunRow[]): CompositionAnalysis {
	const completeTeams = runs.filter((run) => run.roster.length === 5)
	const incompleteTeams = runs.length - completeTeams.length
	const groups = new Map<string, { specIds: number[]; specNames: string[]; labels: string[]; colours: string[]; roles: string[]; occurrences: number }>()
	let excludedMissing = 0
	for (const run of completeTeams) {
		const members = [...run.roster].sort((a, b) => (a.spec_id ?? 0) - (b.spec_id ?? 0))
		if (members.some((member) => member.spec_id === null || !member.spec_name || !member.role)) { excludedMissing += 1; continue }
		const specIds = members.map((member) => member.spec_id as number)
		const key = specIds.join(',')
		const entry = groups.get(key) ?? {
			specIds,
			specNames: members.map((member) => member.spec_name as string),
			labels: members.map((member) => `${member.spec_name} ${member.class_name ?? ''}`.trim()),
			colours: members.map((member) => classColour(member.class_id)),
			roles: members.map((member) => member.role as string),
			occurrences: 0,
		}
		entry.occurrences += 1
		groups.set(key, entry)
	}
	const eligibleTeams = completeTeams.length - excludedMissing
	return {
		compositions: [...groups.values()].map((entry) => ({
			key: entry.specIds.join(','),
			specIds: entry.specIds,
			specNames: entry.specNames,
			labels: entry.labels,
			colours: entry.colours,
			roles: entry.roles,
			occurrences: entry.occurrences,
			percentage: eligibleTeams ? (entry.occurrences * 100) / eligibleTeams : 0,
		})).sort((a, b) => b.occurrences - a.occurrences || a.key.localeCompare(b.key)),
		completeTeams: completeTeams.length,
		eligibleTeams,
		incompleteTeams,
		excludedMissing,
	}
}

export function kpis(runs: RunRow[]): Kpis {
	const levels = runs.map((run) => run.mythic_level)
	const appearances = runs.flatMap((run) => run.roster)
	let highest: number | null = null
	for (const level of levels) if (highest === null || level > highest) highest = level
	return {
		runs: runs.length,
		highest,
		average: mean(levels),
		median: median(levels),
		appearances: appearances.length,
		completeTeams: runs.filter((run) => run.roster.length === 5).length,
		incompleteTeams: runs.filter((run) => run.roster.length !== 5).length,
		missingClass: appearances.filter((member) => member.class_id === null || !member.class_name).length,
		missingSpec: appearances.filter((member) => member.spec_id === null || !member.spec_name).length,
		missingRole: appearances.filter((member) => member.role === null).length,
	}
}

export function histogram(values: number[], binSize: number, unit = 's'): HistogramBin[] {
	if (!values.length || binSize <= 0) return []
	let lowestValue = values[0]
	let highestValue = values[0]
	for (const value of values) {
		if (value < lowestValue) lowestValue = value
		if (value > highestValue) highestValue = value
	}
	const min = Math.floor(lowestValue / binSize) * binSize
	const max = Math.ceil(highestValue / binSize) * binSize
	const bins: HistogramBin[] = []
	for (let start = min; start < max || (!bins.length && start === max); start += binSize) {
		const end = start + binSize
		bins.push({ label: `${start.toFixed(0)}–${end.toFixed(0)} ${unit}`, min: start, max: end, count: values.filter((value) => value >= start && (value < end || (start === max && value === max))).length })
	}
	return bins
}

export function completionHistogram(runs: RunRow[], binSeconds = 30): HistogramBin[] {
	return histogram(runs.flatMap((run) => (run.clear_time_seconds === null ? [] : [run.clear_time_seconds])), binSeconds)
}

export function marginHistogram(runs: RunRow[], binSeconds = 30): HistogramBin[] {
	return histogram(runs.flatMap((run) => (run.timer_margin_seconds === null ? [] : [run.timer_margin_seconds])), binSeconds)
}

export function compositionText(run: RunRow): string {
	if (run.roster.length !== 5) return `Incomplete roster (${run.roster.length}/5)`
	return [...run.roster].sort((a, b) => (a.spec_id ?? 0) - (b.spec_id ?? 0)).map((member) => member.spec_name ?? 'Unknown spec').join(' · ')
}

export function compositionFullText(run: RunRow): string {
	return [...run.roster].sort((a, b) => (a.spec_id ?? 0) - (b.spec_id ?? 0)).map((member) => `${member.spec_name ?? 'Unknown spec'} ${member.class_name ?? ''} (${member.role ?? 'unknown role'})`.trim()).join(' · ')
}

export function searchRuns(runs: RunRow[], query: string): RunRow[] {
	const term = query.trim().toLowerCase()
	if (!term) return runs
	return runs.filter((run) => {
		const haystack = [String(run.run_id), String(run.source_rank), String(run.mythic_level), run.dungeon.name, run.dungeon.slug, compositionFullText(run)].join(' ').toLowerCase()
		return haystack.includes(term)
	})
}

export type SortKey = 'rank' | 'key' | 'clear' | 'margin' | 'score' | 'composition'
export function sortRuns(runs: RunRow[], key: SortKey, direction: 'asc' | 'desc'): RunRow[] {
	const factor = direction === 'asc' ? 1 : -1
	const value = (run: RunRow): number | string | null => {
		switch (key) {
			case 'rank': return run.source_rank
			case 'key': return run.mythic_level
			case 'clear': return run.clear_time_seconds
			case 'margin': return run.timer_margin_seconds
			case 'score': return run.source_score
			case 'composition': return compositionText(run)
		}
	}
	return [...runs].sort((a, b) => {
		const left = value(a)
		const right = value(b)
		if (left === null && right === null) return 0
		if (left === null) return 1
		if (right === null) return -1
		if (typeof left === 'string' || typeof right === 'string') return String(left).localeCompare(String(right)) * factor
		return (left - right) * factor
	})
}

export function dungeonScopeLabel(index: Manifest): string {
	return `${index.region.toUpperCase()} · ${index.season_name}`
}

export function classReference(classId: number | null): ClassReference | undefined {
	const known = wowClass(classId)
	return known ? { ...known, colour: classColour(classId) } : undefined
}

export function allClassReferences(): readonly { id: number; name: string; slug: string; colour: string }[] {
	return WOW_CLASSES
}
