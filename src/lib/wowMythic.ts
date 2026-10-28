/**
 * Pure data, filtering and denominator helpers for the Mythic+ dashboard.
 *
 * These functions operate on the public static JSON contract only. They never
 * access PostgreSQL and never use character names or character identifiers.
 */

export type Role = 'tank' | 'healer' | 'dps' | string

export interface Manifest {
	manifest_version: number
	schema_version: string
	analytics_version?: string
	dataset_version: string
	generated_at: string
	file: string
	sha256: string
	size_bytes: number
	scope: { region: string; season: string; dungeon: string }
	collection_key: string
	collection_id?: number
	cohort?: Record<string, number>
}

export interface RosterMember {
	roster_position: number
	class_id: number | null
	class_name: string | null
	spec_id: number | null
	spec_name: string | null
	role: string | null
}

export interface RunRow {
	run_id: number
	season: string
	dungeon: { id: number; name: string; slug: string }
	source_rank: number
	source_page: number
	source_score: number | null
	source_score_semantics_verified: false
	mythic_level: number
	status: string
	completed_at: string | null
	clear_time_seconds: number | null
	keystone_time_seconds: number | null
	timer_margin_seconds: number | null
	timer_margin_percent: number | null
	num_chests: number | null
	roster_complete: boolean
	roster: RosterMember[]
	source_url: string
}

export interface MetricSummary {
	unit: string
	available_runs: number
	missing_runs: number
	min: number | null
	max: number | null
	mean: number | null
	median: number | null
}

export interface WowDataset {
	schema_version: string
	dataset_version: string
	exported_at: string
	source: Record<string, string>
	population: {
		selection_method: string
		scope: { region: string; season: string; dungeon: string }
		collection: {
			id: number
			key: string
			status: string
			started_at: string | null
			completed_at: string | null
			fetch_started_at: string | null
			fetch_completed_at: string | null
			pages_requested: number
			pages_succeeded: number
			requested_pages: number[]
		}
		observation_window: {
			started_at: string | null
			completed_at: string | null
		}
		cohort: {
			runs: number
			roster_appearances: number
			complete_rosters: number
			incomplete_rosters: number
			eligible_complete_teams: number
		}
		historical_context: Record<string, number>
	}
	completeness: Record<string, unknown>
	run_statistics: {
		total_distinct_runs: number
		key_level: {
			highest: number | null
			lowest: number | null
			average: number | null
			median: number | null
		}
		by_key_level: Array<{
			mythic_level: number
			runs: number
			percentage_of_runs: number
		}>
		by_key_bracket: Array<{ label: string; runs: number }>
		completion_time: MetricSummary
		timer_margin: MetricSummary
		source_ranking_score: MetricSummary & { semantics_verified: boolean }
	}
	class_representation: {
		classes: Array<Record<string, unknown>>
		denominators: Record<string, number>
	}
	spec_representation: {
		specs: Array<Record<string, unknown>>
		denominators: Record<string, unknown>
	}
	team_compositions: {
		compositions: Array<Record<string, unknown>>
		denominators: Record<string, number>
	}
	performance: Record<string, unknown>
	definitions: Record<string, unknown>
	notes: string[]
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
	appearances: number
	percentage: number
	teams: number
}

export interface CompositionDatum {
	key: string
	specIds: number[]
	specNames: string[]
	labels: string[]
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message)
}

export function schemaParts(version: string): [number, number, number] {
	const parts = version.split('.').map(Number)
	assert(
		parts.length === 3 &&
			parts.every((part) => Number.isInteger(part) && part >= 0),
		`Invalid schema version: ${version}`
	)
	return [parts[0], parts[1], parts[2]]
}

export function isSupportedSchema(version: string): boolean {
	const [major, minor] = schemaParts(version)
	return major === 1 && minor >= 1
}

function assertNoCharacterKeys(value: unknown, path = 'dataset'): void {
	if (Array.isArray(value)) {
		value.forEach((item, index) =>
			assertNoCharacterKeys(item, `${path}[${index}]`)
		)
	} else if (isRecord(value)) {
		for (const [key, item] of Object.entries(value)) {
			assert(
				!CHARACTER_KEYS.has(key),
				`${path} contains a forbidden character identifier field`
			)
			assertNoCharacterKeys(item, `${path}.${key}`)
		}
	}
}

export function validateManifest(input: unknown): Manifest {
	assert(isRecord(input), 'Manifest is not an object')
	assert(input.manifest_version === 1, 'Unsupported manifest version')
	assert(
		typeof input.schema_version === 'string',
		'Manifest schema version missing'
	)
	assert(
		isSupportedSchema(input.schema_version),
		`Dashboard requires schema 1.1+, got ${input.schema_version}`
	)
	assert(
		typeof input.dataset_version === 'string',
		'Manifest dataset version missing'
	)
	assert(
		typeof input.file === 'string' &&
			input.file.length > 0 &&
			!input.file.includes('/'),
		'Manifest file name is unsafe'
	)
	assert(
		typeof input.sha256 === 'string' && /^[0-9a-f]{64}$/.test(input.sha256),
		'Manifest checksum invalid'
	)
	assert(
		Number.isInteger(input.size_bytes) && input.size_bytes > 0,
		'Manifest size invalid'
	)
	assert(isRecord(input.scope), 'Manifest scope missing')
	for (const key of ['region', 'season', 'dungeon']) {
		assert(
			typeof input.scope[key] === 'string' && input.scope[key].length > 0,
			`Manifest scope.${key} invalid`
		)
	}
	assert(
		typeof input.collection_key === 'string',
		'Manifest collection key missing'
	)
	return input as unknown as Manifest
}

export function validateDataset(input: unknown): WowDataset {
	assert(isRecord(input), 'Dataset is not an object')
	assert(
		typeof input.schema_version === 'string' &&
			isSupportedSchema(input.schema_version),
		'Dataset schema is unsupported'
	)
	assert(typeof input.dataset_version === 'string', 'Dataset version missing')
	assert(isRecord(input.population), 'Dataset population missing')
	assert(isRecord(input.population.collection), 'Dataset collection missing')
	assert(isRecord(input.population.cohort), 'Dataset cohort missing')
	assert(Array.isArray(input.runs), 'Dataset has no run rows')
	assert(
		input.runs.length === input.population.cohort.runs,
		'Run row count does not match cohort'
	)
	assertNoCharacterKeys(input.runs)

	const runIds = new Set<number>()
	const ranks = new Set<number>()
	for (const [index, value] of input.runs.entries()) {
		assert(isRecord(value), `Run ${index} is malformed`)
		assert(
			Number.isInteger(value.run_id) && value.run_id > 0,
			`Run ${index} has invalid run_id`
		)
		assert(
			!runIds.has(value.run_id as number),
			`Run ${index} duplicates run_id`
		)
		runIds.add(value.run_id as number)
		assert(
			Number.isInteger(value.source_rank) && value.source_rank > 0,
			`Run ${index} has invalid source_rank`
		)
		assert(
			value.source_score_semantics_verified === false,
			`Run ${index} source score must remain unverified`
		)
		assert(
			!ranks.has(value.source_rank as number),
			`Run ${index} duplicates source_rank`
		)
		ranks.add(value.source_rank as number)
		assert(
			Number.isInteger(value.mythic_level) && value.mythic_level > 0,
			`Run ${index} has invalid key level`
		)
		assert(
			Number.isInteger(value.source_page) && value.source_page >= 0,
			`Run ${index} has invalid source page`
		)
		assert(
			value.season === input.population.scope.season,
			`Run ${index} season does not match scope`
		)
		assert(
			typeof value.status === 'string' && value.status.length > 0,
			`Run ${index} has invalid status`
		)
		assert(isRecord(value.dungeon), `Run ${index} has no dungeon`)
		assert(
			value.dungeon.slug === input.population.scope.dungeon,
			`Run ${index} dungeon does not match scope`
		)
		for (const field of [
			'clear_time_seconds',
			'keystone_time_seconds',
			'timer_margin_seconds',
			'timer_margin_percent',
			'source_score',
		]) {
			assert(
				value[field] === null ||
					(typeof value[field] === 'number' && Number.isFinite(value[field])),
				`Run ${index} has invalid ${field}`
			)
		}
		assert(
			value.completed_at === null ||
				(typeof value.completed_at === 'string' &&
					!Number.isNaN(Date.parse(value.completed_at))),
			`Run ${index} has invalid completion timestamp`
		)
		assert(
			typeof value.source_url === 'string' &&
				value.source_url.startsWith('https://raider.io/'),
			`Run ${index} has unsafe source URL`
		)
		assert(
			Array.isArray(value.roster) && value.roster.length <= 5,
			`Run ${index} has invalid roster`
		)
		assert(
			value.roster_complete === (value.roster.length === 5),
			`Run ${index} roster_complete disagrees with its roster`
		)
		const positions = new Set<number>()
		for (const member of value.roster) {
			assert(isRecord(member), `Run ${index} has malformed roster member`)
			assert(
				Number.isInteger(member.roster_position) &&
					member.roster_position >= 1 &&
					member.roster_position <= 5,
				`Run ${index} has invalid roster position`
			)
			assert(
				!positions.has(member.roster_position as number),
				`Run ${index} has duplicate roster position`
			)
			positions.add(member.roster_position as number)
			for (const field of ['class_id', 'spec_id']) {
				assert(
					member[field] === null || Number.isInteger(member[field]),
					`Run ${index} has invalid roster ${field}`
				)
			}
			for (const field of ['class_name', 'spec_name', 'role']) {
				assert(
					member[field] === null || typeof member[field] === 'string',
					`Run ${index} has invalid roster ${field}`
				)
			}
		}
	}
	return input as unknown as WowDataset
}

export async function loadWowDataset(
	fetcher: typeof fetch = fetch,
	base = '/data/wow-mythic-plus'
): Promise<{ manifest: Manifest; dataset: WowDataset }> {
	const root = base.replace(/\/$/, '')
	const manifestResponse = await fetcher(`${root}/manifest.json`, {
		cache: 'no-cache',
	})
	if (!manifestResponse.ok)
		throw new Error(
			`Could not load dataset manifest (HTTP ${manifestResponse.status})`
		)
	const manifest = validateManifest(await manifestResponse.json())
	const datasetResponse = await fetcher(`${root}/${manifest.file}`, {
		cache: 'no-cache',
	})
	if (!datasetResponse.ok)
		throw new Error(`Could not load dataset (HTTP ${datasetResponse.status})`)
	const raw = new Uint8Array(await datasetResponse.arrayBuffer())
	if (raw.byteLength !== manifest.size_bytes)
		throw new Error('Dataset size does not match the manifest')
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', raw))
	const checksum = [...digest]
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')
	if (checksum !== manifest.sha256)
		throw new Error('Dataset checksum does not match the manifest')
	const dataset = validateDataset(JSON.parse(new TextDecoder().decode(raw)))
	assert(
		dataset.schema_version === manifest.schema_version,
		'Manifest and dataset schema versions disagree'
	)
	assert(
		dataset.dataset_version === manifest.dataset_version,
		'Manifest and dataset versions disagree'
	)
	assert(
		dataset.population.collection.key === manifest.collection_key,
		'Manifest and dataset collection keys disagree'
	)
	assert(
		dataset.population.scope.region === manifest.scope.region,
		'Manifest and dataset scopes disagree'
	)
	return { manifest, dataset }
}

export function mean(values: number[]): number | null {
	if (!values.length) return null
	return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function median(values: number[]): number | null {
	if (!values.length) return null
	const ordered = [...values].sort((a, b) => a - b)
	const middle = Math.floor(ordered.length / 2)
	return ordered.length % 2
		? ordered[middle]
		: (ordered[middle - 1] + ordered[middle]) / 2
}

export function formatSeconds(
	value: number | null | undefined,
	digits = 1
): string {
	if (value === null || value === undefined || !Number.isFinite(value))
		return '—'
	return `${value.toFixed(digits)} s`
}

export function formatDuration(value: number | null | undefined): string {
	if (value === null || value === undefined || !Number.isFinite(value))
		return '—'
	const sign = value < 0 ? '−' : ''
	const absolute = Math.round(Math.abs(value) * 10) / 10
	const minutes = Math.floor(absolute / 60)
	const seconds = absolute - minutes * 60
	return `${sign}${minutes}:${seconds.toFixed(1).padStart(4, '0')}`
}

export function formatMargin(value: number | null | undefined): string {
	if (value === null || value === undefined || !Number.isFinite(value))
		return '—'
	return `${value >= 0 ? '+' : '−'}${formatDuration(Math.abs(value))}`
}

export function formatPercent(
	value: number | null | undefined,
	digits = 1
): string {
	if (value === null || value === undefined || !Number.isFinite(value))
		return '—'
	return `${value.toFixed(digits)}%`
}

export function formatDate(value: string | null | undefined): string {
	if (!value) return '—'
	const date = new Date(value)
	if (Number.isNaN(date.valueOf())) return '—'
	return new Intl.DateTimeFormat('en-GB', {
		dateStyle: 'medium',
		timeStyle: 'short',
		timeZone: 'Europe/London',
	}).format(date)
}

export function filterRuns(runs: RunRow[], filters: RunFilters): RunRow[] {
	const keyLevel = filters.keyLevel === 'all' ? null : Number(filters.keyLevel)
	const classId = filters.classId === 'all' ? null : Number(filters.classId)
	const specId = filters.specId === 'all' ? null : Number(filters.specId)
	return runs.filter((run) => {
		if (keyLevel !== null && run.mythic_level !== keyLevel) return false
		if (
			classId !== null &&
			!run.roster.some((member) => member.class_id === classId)
		)
			return false
		if (
			specId !== null &&
			!run.roster.some((member) => member.spec_id === specId)
		)
			return false
		return true
	})
}

export function classOptions(
	runs: RunRow[]
): Array<{ id: number; name: string }> {
	const values = new Map<number, string>()
	for (const run of runs) {
		for (const member of run.roster) {
			if (member.class_id !== null && member.class_name)
				values.set(member.class_id, member.class_name)
		}
	}
	return [...values.entries()]
		.map(([id, name]) => ({ id, name }))
		.sort((a, b) => a.name.localeCompare(b.name))
}

export function specOptions(
	runs: RunRow[],
	classId: string
): Array<{ id: number; name: string; role: string | null }> {
	const selected = classId === 'all' ? null : Number(classId)
	const values = new Map<
		number,
		{ id: number; name: string; role: string | null }
	>()
	for (const run of runs) {
		for (const member of run.roster) {
			if (member.spec_id === null || !member.spec_name) continue
			if (selected !== null && member.class_id !== selected) continue
			values.set(member.spec_id, {
				id: member.spec_id,
				name: member.spec_name,
				role: member.role,
			})
		}
	}
	return [...values.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function appearanceRows(runs: RunRow[], role = 'all'): Appearance[] {
	const rows: Appearance[] = []
	for (const run of runs) {
		for (const member of run.roster) {
			if (role !== 'all' && member.role !== role) continue
			rows.push({ run, member })
		}
	}
	return rows
}

export function classRepresentation(
	runs: RunRow[],
	role = 'all'
): { data: ClassDatum[]; denominator: number; missing: number } {
	const appearances = appearanceRows(runs, role)
	const counts = new Map<
		number,
		{ name: string; count: number; teams: Set<number> }
	>()
	let missing = 0
	for (const { run, member } of appearances) {
		if (member.class_id === null || !member.class_name) {
			missing += 1
			continue
		}
		const entry = counts.get(member.class_id) ?? {
			name: member.class_name,
			count: 0,
			teams: new Set<number>(),
		}
		entry.count += 1
		if (run.roster.length === 5) entry.teams.add(run.run_id)
		counts.set(member.class_id, entry)
	}
	const denominator = appearances.length
	const data = [...counts.entries()]
		.map(([classId, entry]) => ({
			classId,
			className: entry.name,
			appearances: entry.count,
			percentage: denominator ? (entry.count * 100) / denominator : 0,
			teams: entry.teams.size,
		}))
		.sort(
			(a, b) =>
				b.appearances - a.appearances || a.className.localeCompare(b.className)
		)
	return { data, denominator, missing }
}

export function specRepresentation(
	runs: RunRow[],
	role = 'all'
): {
	data: SpecDatum[]
	denominator: number
	missing: number
	missingRole: number
} {
	const appearances = appearanceRows(runs, role)
	const counts = new Map<
		number,
		{
			name: string
			classId: number | null
			className: string | null
			role: string | null
			count: number
			teams: Set<number>
		}
	>()
	let missing = 0
	let missingRole = 0
	for (const { run, member } of appearances) {
		if (member.role === null) missingRole += 1
		if (member.spec_id === null || !member.spec_name) {
			missing += 1
			continue
		}
		const entry = counts.get(member.spec_id) ?? {
			name: member.spec_name,
			classId: member.class_id,
			className: member.class_name,
			role: member.role,
			count: 0,
			teams: new Set<number>(),
		}
		entry.count += 1
		if (run.roster.length === 5) entry.teams.add(run.run_id)
		counts.set(member.spec_id, entry)
	}
	const denominator = appearances.length
	const data = [...counts.entries()]
		.map(([specId, entry]) => ({
			specId,
			specName: entry.name,
			classId: entry.classId,
			className: entry.className,
			role: entry.role,
			appearances: entry.count,
			percentage: denominator ? (entry.count * 100) / denominator : 0,
			teams: entry.teams.size,
		}))
		.sort(
			(a, b) =>
				b.appearances - a.appearances || a.specName.localeCompare(b.specName)
		)
	return { data, denominator, missing, missingRole }
}

export function compositionAnalysis(runs: RunRow[]): CompositionAnalysis {
	const completeTeams = runs.filter((run) => run.roster.length === 5)
	const incompleteTeams = runs.length - completeTeams.length
	const groups = new Map<
		string,
		{
			specIds: number[]
			specNames: string[]
			labels: string[]
			roles: string[]
			occurrences: number
		}
	>()
	let excludedMissing = 0
	for (const run of completeTeams) {
		const members = [...run.roster].sort(
			(a, b) => (a.spec_id ?? 0) - (b.spec_id ?? 0)
		)
		if (
			members.some(
				(member) => member.spec_id === null || !member.spec_name || !member.role
			)
		) {
			excludedMissing += 1
			continue
		}
		const specIds = members.map((member) => member.spec_id as number)
		const key = specIds.join(',')
		const entry = groups.get(key) ?? {
			specIds,
			specNames: members.map((member) => member.spec_name as string),
			labels: members.map((member) =>
				`${member.spec_name} ${member.class_name ?? ''}`.trim()
			),
			roles: members.map((member) => member.role as string),
			occurrences: 0,
		}
		entry.occurrences += 1
		groups.set(key, entry)
	}
	const eligibleTeams = completeTeams.length - excludedMissing
	const compositions = [...groups.values()]
		.map((entry) => ({
			key: entry.specIds.join(','),
			specIds: entry.specIds,
			specNames: entry.specNames,
			labels: entry.labels,
			roles: entry.roles,
			occurrences: entry.occurrences,
			percentage: eligibleTeams ? (entry.occurrences * 100) / eligibleTeams : 0,
		}))
		.sort((a, b) => b.occurrences - a.occurrences || a.key.localeCompare(b.key))
	return {
		compositions,
		completeTeams: completeTeams.length,
		eligibleTeams,
		incompleteTeams,
		excludedMissing,
	}
}

export function kpis(runs: RunRow[]): Kpis {
	const levels = runs.map((run) => run.mythic_level)
	const appearances = runs.flatMap((run) => run.roster)
	return {
		runs: runs.length,
		highest: levels.length ? Math.max(...levels) : null,
		average: mean(levels),
		median: median(levels),
		appearances: appearances.length,
		completeTeams: runs.filter((run) => run.roster.length === 5).length,
		incompleteTeams: runs.filter((run) => run.roster.length !== 5).length,
		missingClass: appearances.filter(
			(member) => member.class_id === null || !member.class_name
		).length,
		missingSpec: appearances.filter(
			(member) => member.spec_id === null || !member.spec_name
		).length,
		missingRole: appearances.filter((member) => member.role === null).length,
	}
}

export function histogram(
	values: number[],
	binSize: number,
	unit = 's'
): HistogramBin[] {
	if (!values.length || binSize <= 0) return []
	const min = Math.floor(Math.min(...values) / binSize) * binSize
	const max = Math.ceil(Math.max(...values) / binSize) * binSize
	const bins: HistogramBin[] = []
	for (
		let start = min;
		start < max || (!bins.length && start === max);
		start += binSize
	) {
		const end = start + binSize
		bins.push({
			label: `${start.toFixed(0)}–${end.toFixed(0)} ${unit}`,
			min: start,
			max: end,
			count: values.filter(
				(value) =>
					value >= start && (value < end || (start === max && value === max))
			).length,
		})
	}
	return bins
}

export function completionHistogram(
	runs: RunRow[],
	binSeconds = 30
): HistogramBin[] {
	return histogram(
		runs.flatMap((run) =>
			run.clear_time_seconds === null ? [] : [run.clear_time_seconds]
		),
		binSeconds
	)
}

export function marginHistogram(
	runs: RunRow[],
	binSeconds = 30
): HistogramBin[] {
	return histogram(
		runs.flatMap((run) =>
			run.timer_margin_seconds === null ? [] : [run.timer_margin_seconds]
		),
		binSeconds
	)
}

export function compositionText(run: RunRow): string {
	if (run.roster.length !== 5)
		return `Incomplete roster (${run.roster.length}/5)`
	return [...run.roster]
		.sort((a, b) => (a.spec_id ?? 0) - (b.spec_id ?? 0))
		.map((member) => member.spec_name ?? 'Unknown spec')
		.join(' · ')
}

export function compositionFullText(run: RunRow): string {
	return [...run.roster]
		.sort((a, b) => (a.spec_id ?? 0) - (b.spec_id ?? 0))
		.map((member) =>
			`${member.spec_name ?? 'Unknown spec'} ${member.class_name ?? ''} (${member.role ?? 'unknown role'})`.trim()
		)
		.join(' · ')
}

export function searchRuns(runs: RunRow[], query: string): RunRow[] {
	const term = query.trim().toLowerCase()
	if (!term) return runs
	return runs.filter((run) => {
		const haystack = [
			String(run.run_id),
			String(run.source_rank),
			String(run.mythic_level),
			run.dungeon.name,
			run.dungeon.slug,
			compositionFullText(run),
		]
			.join(' ')
			.toLowerCase()
		return haystack.includes(term)
	})
}

export type SortKey =
	| 'rank'
	| 'key'
	| 'clear'
	| 'margin'
	| 'score'
	| 'composition'

export function sortRuns(
	runs: RunRow[],
	key: SortKey,
	direction: 'asc' | 'desc'
): RunRow[] {
	const factor = direction === 'asc' ? 1 : -1
	const value = (run: RunRow): number | string | null => {
		switch (key) {
			case 'rank':
				return run.source_rank
			case 'key':
				return run.mythic_level
			case 'clear':
				return run.clear_time_seconds
			case 'margin':
				return run.timer_margin_seconds
			case 'score':
				return run.source_score
			case 'composition':
				return compositionText(run)
		}
	}
	return [...runs].sort((a, b) => {
		const left = value(a)
		const right = value(b)
		if (left === null && right === null) return 0
		if (left === null) return 1
		if (right === null) return -1
		if (typeof left === 'string' || typeof right === 'string') {
			return String(left).localeCompare(String(right)) * factor
		}
		return (left - right) * factor
	})
}

export function coverage(dataset: WowDataset): {
	requested: number
	succeeded: number
	pages: number[]
	pagesLabel: string
} {
	const collection = dataset.population.collection
	return {
		requested: collection.pages_requested,
		succeeded: collection.pages_succeeded,
		pages: collection.requested_pages,
		pagesLabel: collection.requested_pages.length
			? collection.requested_pages.join(', ')
			: '—',
	}
}
