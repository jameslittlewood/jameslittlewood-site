import * as echarts from 'echarts/core'
import type { EChartsType } from 'echarts/core'
import { BarChart } from 'echarts/charts'
import {
	AriaComponent,
	GridComponent,
	LegendComponent,
	TitleComponent,
	TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

import {
	classRepresentation,
	completionHistogram,
	compositionAnalysis,
	compositionFullText,
	compositionText,
	coverage,
	filterRuns,
	formatDate,
	formatDuration,
	formatMargin,
	formatPercent,
	kpis,
	loadWowDataset,
	marginHistogram,
	searchRuns,
	sortRuns,
	specRepresentation,
	type Manifest,
	type RunRow,
	type SortKey,
	type WowDataset,
} from './wowMythic'

echarts.use([
	BarChart,
	GridComponent,
	TooltipComponent,
	TitleComponent,
	LegendComponent,
	AriaComponent,
	CanvasRenderer,
])

type RoleView = 'all' | 'tank' | 'healer' | 'dps'
type SortDirection = 'asc' | 'desc'

interface DashboardState {
	manifest: Manifest
	dataset: WowDataset
	keyLevel: string
	classId: string
	specId: string
	role: RoleView
	search: string
	sortKey: SortKey
	sortDirection: SortDirection
}

interface Palette {
	primary: string
	green: string
	amber: string
	red: string
	text: string
	muted: string
	grid: string
	card: string
}

const CHARTS = [
	'key',
	'class',
	'spec',
	'compositions',
	'completion',
	'margin',
] as const
type ChartName = (typeof CHARTS)[number]

let cleanupActive: (() => void) | undefined
let chartObserver: MutationObserver | undefined

if (typeof document !== 'undefined') {
	document.addEventListener('astro:before-swap', () => {
		cleanupActive?.()
		cleanupActive = undefined
	})
}

const reducedMotion = () =>
	typeof window !== 'undefined' &&
	window.matchMedia('(prefers-reduced-motion: reduce)').matches

const isDark = () => document.documentElement.classList.contains('dark')

function palette(): Palette {
	const styles = getComputedStyle(document.documentElement)
	const token = (name: string, fallback: string) => {
		const value = styles.getPropertyValue(name).trim()
		if (!value) return fallback
		if (typeof CSS !== 'undefined' && CSS.supports?.('color', value))
			return value
		return fallback
	}
	return {
		primary: token('--primary', isDark() ? '#c4b5fd' : '#6d28d9'),
		green: token('--callout-success', isDark() ? '#6ee7b7' : '#047857'),
		amber: token('--callout-warning', isDark() ? '#fbbf24' : '#a16207'),
		red: token('--callout-danger', isDark() ? '#fca5a5' : '#b91c1c'),
		text: token('--foreground', isDark() ? '#ede9f7' : '#2c2438'),
		muted: token('--muted-foreground', isDark() ? '#b9b1ca' : '#655b74'),
		grid: token(
			'--border',
			isDark() ? 'rgba(237,233,247,.12)' : 'rgba(44,36,56,.10)'
		),
		card: token('--card', isDark() ? '#221a31' : '#ffffff'),
	}
}

function roleColour(role: string | null, colours: Palette): string {
	if (role === 'tank') return colours.primary
	if (role === 'healer') return colours.green
	if (role === 'dps') return colours.amber
	return colours.muted
}

function textElement(
	tag: string,
	className: string,
	value: string
): HTMLElement {
	const element = document.createElement(tag)
	element.className = className
	element.textContent = value
	return element
}

function renderSemanticTable(
	container: HTMLElement,
	caption: string,
	headers: string[],
	rows: Array<Array<string | HTMLElement>>
): void {
	container.replaceChildren()
	const table = document.createElement('table')
	table.className = 'w-full border-collapse text-left text-xs'
	const cap = textElement('caption', 'sr-only', caption)
	table.append(cap)
	const thead = document.createElement('thead')
	const headRow = document.createElement('tr')
	for (const header of headers) {
		const th = textElement(
			'th',
			'border-b border-border px-2 py-2 font-semibold text-muted-foreground',
			header
		)
		th.scope = 'col'
		headRow.append(th)
	}
	thead.append(headRow)
	const tbody = document.createElement('tbody')
	for (const row of rows) {
		const tr = document.createElement('tr')
		for (const value of row) {
			const td = document.createElement('td')
			td.className =
				'border-b border-border/40 px-2 py-1.5 text-muted-foreground'
			if (value instanceof HTMLElement) td.append(value)
			else td.textContent = value
			tr.append(td)
		}
		tbody.append(tr)
	}
	table.append(thead, tbody)
	container.append(table)
}

function chartTable(
	container: HTMLElement,
	caption: string,
	headers: string[],
	rows: string[][]
): void {
	renderSemanticTable(container, caption, headers, rows)
}

function axisCommon(colours: Palette): Record<string, unknown> {
	return {
		axisLine: { lineStyle: { color: colours.grid } },
		axisTick: { show: false },
		axisLabel: { color: colours.muted, fontSize: 10 },
		splitLine: { lineStyle: { color: colours.grid } },
	}
}

function baseOption(
	colours: Palette,
	ariaLabel: string
): Record<string, unknown> {
	return {
		backgroundColor: 'transparent',
		animation: !reducedMotion(),
		textStyle: { color: colours.text, fontFamily: 'inherit' },
		aria: { enabled: true, label: { description: ariaLabel } },
		tooltip: {
			trigger: 'item',
			backgroundColor: colours.card,
			borderColor: colours.grid,
			textStyle: { color: colours.text, fontSize: 11 },
			extraCssText: 'border-radius: 10px; box-shadow: none;',
		},
	}
}

function horizontalOption(
	categories: string[],
	values: number[],
	colours: Palette,
	ariaLabel: string,
	colourFor?: (index: number) => string,
	tooltip?: (index: number) => string
): Record<string, unknown> {
	return {
		...baseOption(colours, ariaLabel),
		grid: { left: 8, right: 28, top: 12, bottom: 8, containLabel: true },
		xAxis: {
			type: 'value',
			...axisCommon(colours),
			axisLabel: { color: colours.muted, fontSize: 10 },
		},
		yAxis: {
			type: 'category',
			data: categories,
			inverse: true,
			...axisCommon(colours),
			axisLabel: {
				color: colours.muted,
				fontSize: 9,
				width: 104,
				overflow: 'truncate',
			},
			splitLine: { show: false },
		},
		series: [
			{
				type: 'bar',
				data: values.map((value, index) => ({
					value,
					itemStyle: {
						color: colourFor?.(index) ?? colours.primary,
						borderRadius: [0, 4, 4, 0],
					},
				})),
				barMaxWidth: 18,
				label: {
					show: true,
					position: 'right',
					color: colours.muted,
					fontSize: 10,
				},
				tooltip: tooltip
					? {
							formatter: (params: { dataIndex: number }) =>
								tooltip(params.dataIndex),
						}
					: undefined,
			},
		],
	}
}

function verticalOption(
	categories: string[],
	values: number[],
	colours: Palette,
	ariaLabel: string,
	colourFor?: (index: number) => string,
	tooltip?: (index: number) => string
): Record<string, unknown> {
	return {
		...baseOption(colours, ariaLabel),
		grid: { left: 8, right: 12, top: 20, bottom: 8, containLabel: true },
		xAxis: {
			type: 'category',
			data: categories,
			...axisCommon(colours),
			splitLine: { show: false },
		},
		yAxis: { type: 'value', ...axisCommon(colours), minInterval: 1 },
		series: [
			{
				type: 'bar',
				data: values.map((value, index) => ({
					value,
					itemStyle: {
						color: colourFor?.(index) ?? colours.primary,
						borderRadius: [4, 4, 0, 0],
					},
				})),
				barMaxWidth: 28,
				label: {
					show: true,
					position: 'top',
					color: colours.muted,
					fontSize: 10,
				},
				tooltip: tooltip
					? {
							formatter: (params: { dataIndex: number }) =>
								tooltip(params.dataIndex),
						}
					: undefined,
			},
		],
	}
}

function emptyOption(
	colours: Palette,
	message: string
): Record<string, unknown> {
	return {
		...baseOption(colours, message),
		title: {
			text: message,
			left: 'center',
			top: 'middle',
			textStyle: { color: colours.muted, fontSize: 12, fontWeight: 'normal' },
		},
		xAxis: { show: false },
		yAxis: { show: false },
		series: [],
	}
}

export function mountWowDashboard(): () => void {
	cleanupActive?.()
	const controller = new AbortController()
	const root = document.querySelector<HTMLElement>('[data-wow-dashboard]')
	const loading = document.querySelector<HTMLElement>(
		'[data-dashboard-loading]'
	)
	const errorPanel = document.querySelector<HTMLElement>(
		'[data-dashboard-error]'
	)
	const errorMessage = document.querySelector<HTMLElement>(
		'[data-error-message]'
	)
	const retryButton =
		errorPanel?.querySelector<HTMLButtonElement>('[data-retry]')
	if (!root || !loading || !errorPanel || !errorMessage) return () => undefined

	const charts = new Map<ChartName, EChartsType>()
	const resizeObserver = new ResizeObserver((entries) => {
		for (const entry of entries) {
			const chart = charts.get(
				entry.target.getAttribute('data-chart') as ChartName
			)
			chart?.resize()
		}
	})
	let state: DashboardState | undefined

	const disposeCharts = () => {
		for (const chart of charts.values()) chart.dispose()
		charts.clear()
		resizeObserver.disconnect()
	}

	const ensureChart = (name: ChartName): EChartsType | undefined => {
		const element = root.querySelector<HTMLElement>(`[data-chart="${name}"]`)
		if (!element) return undefined
		let chart = charts.get(name)
		if (!chart) {
			chart = echarts.init(element, undefined, { renderer: 'canvas' })
			charts.set(name, chart)
			resizeObserver.observe(element)
		}
		return chart
	}

	const currentRuns = (): { runs: RunRow[]; appearances: number } => {
		if (!state) return { runs: [], appearances: 0 }
		const filtered = filterRuns(state.dataset.runs, state)
		const searched = searchRuns(filtered, state.search)
		return {
			runs: searched,
			appearances: searched.reduce((sum, run) => sum + run.roster.length, 0),
		}
	}

	const setText = (selector: string, value: string) => {
		const element = root.querySelector<HTMLElement>(selector)
		if (element) element.textContent = value
	}

	const populateFilters = () => {
		if (!state) return
		const keySelect = root.querySelector<HTMLSelectElement>('[data-filter-key]')
		const classSelect = root.querySelector<HTMLSelectElement>(
			'[data-filter-class]'
		)
		const specSelect =
			root.querySelector<HTMLSelectElement>('[data-filter-spec]')
		if (!keySelect || !classSelect || !specSelect) return
		const levels = [
			...new Set(state.dataset.runs.map((run) => run.mythic_level)),
		].sort((a, b) => a - b)
		keySelect.replaceChildren(new Option('All key levels', 'all'))
		for (const level of levels)
			keySelect.append(new Option(`+${level}`, String(level)))
		const classes = [
			...new Map(
				state.dataset.runs
					.flatMap((run) => run.roster)
					.filter((member) => member.class_id !== null && member.class_name)
					.map((member) => [
						member.class_id as number,
						member.class_name as string,
					])
			).entries(),
		].sort((a, b) => a[1].localeCompare(b[1]))
		classSelect.replaceChildren(new Option('All classes', 'all'))
		for (const [id, name] of classes)
			classSelect.append(new Option(name, String(id)))
		specSelect.replaceChildren(new Option('All reported specs', 'all'))
		keySelect.value = state.keyLevel
		classSelect.value = state.classId
		specSelect.value = state.specId
	}

	const populateSpecs = () => {
		if (!state) return
		const specSelect =
			root.querySelector<HTMLSelectElement>('[data-filter-spec]')
		if (!specSelect) return
		const specs = new Map<number, { name: string; role: string | null }>()
		for (const run of state.dataset.runs) {
			for (const member of run.roster) {
				if (member.spec_id === null || !member.spec_name) continue
				if (
					state.classId !== 'all' &&
					member.class_id !== Number(state.classId)
				)
					continue
				specs.set(member.spec_id, { name: member.spec_name, role: member.role })
			}
		}
		specSelect.replaceChildren(new Option('All reported specs', 'all'))
		for (const [id, value] of [...specs.entries()].sort((a, b) =>
			a[1].name.localeCompare(b[1].name)
		)) {
			specSelect.append(new Option(value.name, String(id)))
		}
		if (![...specs.keys()].includes(Number(state.specId))) state.specId = 'all'
		specSelect.value = state.specId
	}

	const updateKpis = (runs: RunRow[]) => {
		if (!state) return
		const summary = kpis(runs)
		setText('[data-kpi="runs"]', String(summary.runs))
		setText(
			'[data-kpi="runs-detail"]',
			`${summary.completeTeams} complete · ${summary.incompleteTeams} incomplete`
		)
		setText(
			'[data-kpi="highest"]',
			summary.highest === null ? '—' : `+${summary.highest}`
		)
		setText(
			'[data-kpi="key-average"]',
			summary.average === null
				? '—'
				: `avg +${summary.average.toFixed(2)} · median +${summary.median?.toFixed(1)}`
		)
		setText('[data-kpi="appearances"]', String(summary.appearances))
		setText(
			'[data-kpi="teams-detail"]',
			`${summary.completeTeams} complete teams`
		)
		const pages = coverage(state.dataset)
		setText('[data-kpi="pages"]', `${pages.succeeded}/${pages.requested}`)
		setText('[data-kpi="pages-detail"]', `pages ${pages.pagesLabel}`)
		setText(
			'[data-observation-window]',
			`${formatDate(state.dataset.population.observation_window.started_at)} – ${formatDate(state.dataset.population.observation_window.completed_at)}`
		)
		setText('[data-exported-at]', formatDate(state.dataset.exported_at))
		setText(
			'[data-collection-id]',
			`#${state.dataset.population.collection.id} · ${state.dataset.population.collection.key.slice(0, 8)}…`
		)
		setText(
			'[data-selection-method]',
			state.dataset.population.selection_method === 'latest_complete_collection'
				? 'latest successful complete collection'
				: state.dataset.population.selection_method.replaceAll('_', ' ')
		)
		setText('[data-dataset-version]', state.dataset.dataset_version)
		setText(
			'[data-footer-version]',
			`Validated schema ${state.dataset.schema_version} · dataset ${state.dataset.dataset_version} · exported ${formatDate(state.dataset.exported_at)}`
		)
		setText(
			'[data-scope-region]',
			state.dataset.population.scope.region.toUpperCase()
		)
		setText('[data-scope-season]', state.dataset.population.scope.season)
		setText(
			'[data-scope-dungeon]',
			state.dataset.runs[0]?.dungeon.name ??
				state.dataset.population.scope.dungeon
		)
	}

	const updateWarnings = (runs: RunRow[]) => {
		if (!state) return
		const stale = document.querySelector<HTMLElement>('[data-dataset-stale]')
		const incomplete = document.querySelector<HTMLElement>(
			'[data-dataset-incomplete]'
		)
		const exported = new Date(state.dataset.exported_at).valueOf()
		if (stale)
			stale.hidden = !(
				Number.isFinite(exported) &&
				Date.now() - exported > 14 * 24 * 60 * 60 * 1000
			)
		if (incomplete) {
			const missingClass = runs.reduce(
				(sum, run) =>
					sum +
					run.roster.filter(
						(member) => member.class_id === null || !member.class_name
					).length,
				0
			)
			const missingSpec = runs.reduce(
				(sum, run) =>
					sum +
					run.roster.filter(
						(member) => member.spec_id === null || !member.spec_name
					).length,
				0
			)
			const missingRole = runs.reduce(
				(sum, run) =>
					sum + run.roster.filter((member) => member.role === null).length,
				0
			)
			const incompleteTeams = runs.filter(
				(run) => run.roster.length !== 5
			).length
			const messages: string[] = []
			if (incompleteTeams)
				messages.push(
					`${incompleteTeams} run${incompleteTeams === 1 ? '' : 's'} in view have incomplete rosters.`
				)
			if (missingClass)
				messages.push(
					`${missingClass} roster appearance${missingClass === 1 ? '' : 's'} have no reported class.`
				)
			if (missingSpec)
				messages.push(
					`${missingSpec} roster appearance${missingSpec === 1 ? '' : 's'} have no reported spec.`
				)
			if (missingRole)
				messages.push(
					`${missingRole} roster appearance${missingRole === 1 ? '' : 's'} have no reported role and are omitted from role views.`
				)
			incomplete.hidden = messages.length === 0
			incomplete.textContent = messages.length
				? `Data completeness: ${messages.join(' ')}`
				: ''
		}
	}

	const updateFilterSummary = (runs: RunRow[], appearances: number) => {
		if (!state) return
		const roleLabel = state.role === 'all' ? 'all roles' : `${state.role} only`
		const composition = compositionAnalysis(runs)
		setText(
			'[data-filter-summary]',
			`Showing ${runs.length} of ${state.dataset.runs.length} runs · ${appearances} roster appearances · ${roleLabel} appearance view · ${composition.eligibleTeams} eligible complete teams (${composition.incompleteTeams} incomplete and ${composition.excludedMissing} missing-spec/role teams excluded).`
		)
	}

	const renderCharts = (runs: RunRow[]) => {
		if (!state) return
		const colours = palette()
		const comps = compositionAnalysis(runs)
		const classData = classRepresentation(runs, state.role)
		const specData = specRepresentation(runs, state.role)
		const completion = completionHistogram(runs, 30)
		const margins = marginHistogram(runs, 30)
		const keyLevels = [...new Set(runs.map((run) => run.mythic_level))].sort(
			(a, b) => a - b
		)
		const levels = keyLevels.map(
			(level) => runs.filter((run) => run.mythic_level === level).length
		)

		const keyChart = ensureChart('key')
		keyChart?.setOption(
			keyLevels.length
				? verticalOption(
						keyLevels.map((level) => `+${level}`),
						levels,
						colours,
						`Bar chart of runs by key level: ${keyLevels.map((level, index) => `+${level}: ${levels[index]} runs`).join(', ')}.`,
						undefined,
						(index) => `+${keyLevels[index]}: ${levels[index]} runs`
					)
				: emptyOption(colours, 'No runs match the current filters'),
			true
		)
		if (keyChart)
			keyChart
				.getDom()
				.setAttribute(
					'aria-label',
					keyLevels.length
						? `Runs by key level: ${keyLevels.map((level, index) => `+${level}, ${levels[index]} runs`).join('; ')}`
						: 'No runs match the current filters'
				)
		chartTable(
			root.querySelector<HTMLElement>('[data-chart-table="key"]')!,
			'Key-level distribution data',
			['Key level', 'Runs'],
			keyLevels.map((level, index) => [`+${level}`, String(levels[index])])
		)

		const classChart = ensureChart('class')
		classChart?.setOption(
			classData.data.length
				? horizontalOption(
						classData.data.map((row) => row.className),
						classData.data.map((row) => row.appearances),
						colours,
						`Bar chart of class appearances: ${classData.data
							.slice(0, 5)
							.map((row) => `${row.className} ${row.appearances}`)
							.join(', ')}.`,
						undefined,
						(index) => {
							const row = classData.data[index]
							return `${row.className}: ${row.appearances} appearances (${formatPercent(row.percentage)} of ${classData.denominator}); ${row.teams} complete teams`
						}
					)
				: emptyOption(colours, 'No class appearances in view'),
			true
		)
		if (classChart)
			classChart.getDom().setAttribute(
				'aria-label',
				classData.data.length
					? `Class appearances: ${classData.data
							.slice(0, 5)
							.map((row) => `${row.className} ${row.appearances}`)
							.join(
								'; '
							)}${classData.data.length > 5 ? `; and ${classData.data.length - 5} more classes` : ''}. See the data table for all values.`
					: 'No class appearances in view'
			)
		chartTable(
			root.querySelector<HTMLElement>('[data-chart-table="class"]')!,
			'Class appearance data',
			['Class', 'Appearances', 'Share', 'Complete teams'],
			classData.data.map((row) => [
				row.className,
				String(row.appearances),
				formatPercent(row.percentage),
				String(row.teams),
			])
		)

		const topSpecs = specData.data.slice(0, 12)
		const specChart = ensureChart('spec')
		specChart?.setOption(
			topSpecs.length
				? horizontalOption(
						topSpecs.map(
							(row) =>
								`${row.specName}${row.className ? ` · ${row.className}` : ''}`
						),
						topSpecs.map((row) => row.appearances),
						colours,
						`Bar chart of reported specialisation appearances by role view ${state.role}: ${topSpecs
							.slice(0, 5)
							.map((row) => `${row.specName} ${row.appearances}`)
							.join(', ')}.`,
						(index) => roleColour(topSpecs[index].role, colours),
						(index) => {
							const row = topSpecs[index]
							return `${row.specName} (${row.className ?? 'unknown class'}): ${row.appearances} appearances (${formatPercent(row.percentage)} of ${state.role === 'all' ? 'all' : `${state.role} `}appearances); ${row.teams} complete teams`
						}
					)
				: emptyOption(colours, 'No reported specialisations in view'),
			true
		)
		if (specChart)
			specChart.getDom().setAttribute(
				'aria-label',
				topSpecs.length
					? `Reported specialisation appearances: ${topSpecs
							.slice(0, 5)
							.map((row) => `${row.specName} ${row.appearances}`)
							.join(
								'; '
							)}${topSpecs.length > 5 ? '; and more' : ''}. See the data table for all values.`
					: 'No reported specialisations in view'
			)
		chartTable(
			root.querySelector<HTMLElement>('[data-chart-table="spec"]')!,
			'Reported specialisation data',
			[
				'Reported spec',
				'Class',
				'Role',
				'Appearances',
				'Share',
				'Complete teams',
			],
			topSpecs.map((row) => [
				row.specName,
				row.className ?? '—',
				row.role ?? '—',
				String(row.appearances),
				formatPercent(row.percentage),
				String(row.teams),
			])
		)

		const topComps = comps.compositions.slice(0, 8)
		const compChart = ensureChart('compositions')
		compChart?.setOption(
			topComps.length
				? horizontalOption(
						topComps.map((row) => row.labels.join(' / ')),
						topComps.map((row) => row.occurrences),
						colours,
						`Bar chart of team compositions: ${topComps
							.slice(0, 3)
							.map((row) => `${row.labels.join(', ')}: ${row.occurrences}`)
							.join('; ')}.`,
						undefined,
						(index) => {
							const row = topComps[index]
							return `${row.labels.join(' · ')}: ${row.occurrences} of ${comps.eligibleTeams} eligible complete teams (${formatPercent(row.percentage)})`
						}
					)
				: emptyOption(colours, 'No eligible complete teams in view'),
			true
		)
		if (compChart)
			compChart.getDom().setAttribute(
				'aria-label',
				topComps.length
					? `Team compositions: ${topComps
							.slice(0, 3)
							.map((row) => `${row.labels.join(' ')} ${row.occurrences}`)
							.join(
								'; '
							)}${topComps.length > 3 ? '; and more' : ''}. See the data table for all values.`
					: 'No eligible complete teams in view'
			)
		chartTable(
			root.querySelector<HTMLElement>('[data-chart-table="compositions"]')!,
			'Team composition data',
			['Reported composition', 'Occurrences', 'Share', 'Roles'],
			topComps.map((row) => [
				row.labels.join(' · '),
				String(row.occurrences),
				formatPercent(row.percentage),
				row.roles.join(', '),
			])
		)

		const completionChart = ensureChart('completion')
		completionChart?.setOption(
			completion.length
				? verticalOption(
						completion.map((bin) => bin.label),
						completion.map((bin) => bin.count),
						colours,
						`Histogram of clear times in 30 second bins: ${completion.map((bin) => `${bin.label}: ${bin.count}`).join('; ')}.`,
						undefined,
						(index) =>
							`${completion[index].label}: ${completion[index].count} runs`
					)
				: emptyOption(colours, 'No completion times in view'),
			true
		)
		if (completionChart)
			completionChart
				.getDom()
				.setAttribute(
					'aria-label',
					completion.length
						? `Clear-time histogram with ${completion.length} bins. See the data table for bin counts.`
						: 'No completion times in view'
				)
		chartTable(
			root.querySelector<HTMLElement>('[data-chart-table="completion"]')!,
			'Completion-time data',
			['Clear-time bin', 'Runs'],
			completion.map((bin) => [bin.label, String(bin.count)])
		)

		const marginChart = ensureChart('margin')
		marginChart?.setOption(
			margins.length
				? verticalOption(
						margins.map((bin) => bin.label),
						margins.map((bin) => bin.count),
						colours,
						`Histogram of timer margins in 30 second bins: ${margins.map((bin) => `${bin.label}: ${bin.count}`).join('; ')}.`,
						(index) => (margins[index].min >= 0 ? colours.green : colours.red),
						(index) => `${margins[index].label}: ${margins[index].count} runs`
					)
				: emptyOption(colours, 'No timer margins in view'),
			true
		)
		if (marginChart)
			marginChart
				.getDom()
				.setAttribute(
					'aria-label',
					margins.length
						? `Timer-margin histogram with ${margins.length} bins. See the data table for bin counts.`
						: 'No timer margins in view'
				)
		chartTable(
			root.querySelector<HTMLElement>('[data-chart-table="margin"]')!,
			'Timer-margin data',
			['Timer-margin bin', 'Runs'],
			margins.map((bin) => [bin.label, String(bin.count)])
		)
	}

	const updateSortAria = () => {
		if (!state) return
		for (const button of root.querySelectorAll<HTMLButtonElement>(
			'[data-sort]'
		)) {
			const th = button.closest('th')
			if (!th) continue
			if (button.dataset.sort === state.sortKey)
				th.setAttribute(
					'aria-sort',
					state.sortDirection === 'asc' ? 'ascending' : 'descending'
				)
			else th.setAttribute('aria-sort', 'none')
		}
	}

	const renderTable = (runs: RunRow[]) => {
		if (!state) return
		const body = root.querySelector<HTMLElement>('[data-runs-body]')
		const empty = root.querySelector<HTMLElement>('[data-runs-empty]')
		if (!body || !empty) return
		const sorted = sortRuns(runs, state.sortKey, state.sortDirection)
		body.replaceChildren()
		empty.hidden = sorted.length > 0
		for (const run of sorted) {
			const tr = document.createElement('tr')
			tr.className =
				'border-b border-border/40 align-top last:border-b-0 hover:bg-muted/20'
			const rank = document.createElement('th')
			rank.scope = 'row'
			rank.className = 'px-3 py-2.5 text-left font-normal'
			rank.append(
				textElement(
					'span',
					'font-mono text-xs font-semibold text-foreground',
					`#${run.source_rank}`
				)
			)
			rank.append(
				textElement(
					'span',
					'mt-1 block font-mono text-[10px] text-muted-foreground',
					String(run.run_id)
				)
			)
			const key = document.createElement('td')
			key.className = 'px-3 py-2.5'
			key.append(
				textElement(
					'span',
					'rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.5 font-mono text-xs font-semibold text-primary',
					`+${run.mythic_level}`
				)
			)
			const dungeon = textElement(
				'td',
				'px-3 py-2.5 text-xs text-muted-foreground',
				run.dungeon.name
			)
			const clear = textElement(
				'td',
				'px-3 py-2.5 font-mono text-xs text-foreground',
				formatDuration(run.clear_time_seconds)
			)
			const margin = textElement(
				'td',
				'px-3 py-2.5 font-mono text-xs',
				formatMargin(run.timer_margin_seconds)
			)
			margin.classList.add(
				run.timer_margin_seconds !== null && run.timer_margin_seconds < 0
					? 'wow-negative'
					: 'wow-positive'
			)
			const score = textElement(
				'td',
				'px-3 py-2.5 font-mono text-xs text-muted-foreground',
				run.source_score === null ? '—' : `${run.source_score.toFixed(1)}*`
			)
			score.title =
				'* Leaderboard source score; semantics unverified and not a run-details score.'
			score.setAttribute(
				'aria-label',
				run.source_score === null
					? 'No source score'
					: `${run.source_score.toFixed(1)} leaderboard source score, semantics unverified`
			)
			const composition = document.createElement('td')
			composition.className =
				'max-w-[20rem] px-3 py-2.5 text-xs text-muted-foreground'
			const compositionSpan = textElement(
				'span',
				'whitespace-normal',
				compositionText(run)
			)
			compositionSpan.title = compositionFullText(run)
			composition.append(compositionSpan)
			const source = document.createElement('td')
			source.className = 'px-3 py-2.5'
			const link = document.createElement('a')
			link.href = run.source_url
			link.target = '_blank'
			link.rel = 'noopener noreferrer'
			link.className =
				'inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline'
			link.textContent = 'Raider.IO ↗'
			link.setAttribute(
				'aria-label',
				`Open run ${run.run_id} on Raider.IO (opens in a new tab)`
			)
			source.append(link)
			tr.append(rank, key, dungeon, clear, margin, score, composition, source)
			body.append(tr)
		}
		setText(
			'[data-result-count]',
			`${sorted.length} run${sorted.length === 1 ? '' : 's'} shown`
		)
		updateSortAria()
		const labels: Record<SortKey, string> = {
			rank: 'rank',
			key: 'key level',
			clear: 'clear time',
			margin: 'timer margin',
			score: 'source score',
			composition: 'reported composition',
		}
		setText(
			'[data-sort-status]',
			`Sorted by ${labels[state.sortKey]} ${state.sortDirection === 'asc' ? 'ascending' : 'descending'}.`
		)
	}

	const render = () => {
		if (!state) return
		const { runs, appearances } = currentRuns()
		updateKpis(runs)
		updateWarnings(runs)
		updateFilterSummary(runs, appearances)
		renderCharts(runs)
		renderTable(runs)
	}

	let searchTimer: ReturnType<typeof setTimeout> | undefined
	const bindControls = () => {
		const keySelect = root.querySelector<HTMLSelectElement>('[data-filter-key]')
		const classSelect = root.querySelector<HTMLSelectElement>(
			'[data-filter-class]'
		)
		const specSelect =
			root.querySelector<HTMLSelectElement>('[data-filter-spec]')
		const search = root.querySelector<HTMLInputElement>('[data-filter-search]')
		keySelect?.addEventListener(
			'change',
			() => {
				if (!state) return
				state.keyLevel = keySelect.value
				render()
			},
			{ signal: controller.signal }
		)
		classSelect?.addEventListener(
			'change',
			() => {
				if (!state) return
				state.classId = classSelect.value
				state.specId = 'all'
				populateSpecs()
				render()
			},
			{ signal: controller.signal }
		)
		specSelect?.addEventListener(
			'change',
			() => {
				if (!state) return
				state.specId = specSelect.value
				render()
			},
			{ signal: controller.signal }
		)
		search?.addEventListener(
			'input',
			() => {
				if (!state) return
				if (searchTimer) clearTimeout(searchTimer)
				searchTimer = setTimeout(() => {
					if (!state) return
					state.search = search.value
					render()
				}, 200)
			},
			{ signal: controller.signal }
		)
		for (const button of root.querySelectorAll<HTMLButtonElement>(
			'[data-role]'
		)) {
			button.addEventListener(
				'click',
				() => {
					if (!state) return
					state.role = (button.dataset.role as RoleView) ?? 'all'
					for (const peer of root.querySelectorAll<HTMLButtonElement>(
						'[data-role]'
					)) {
						const active = peer === button
						peer.setAttribute('aria-pressed', String(active))
						peer.className = active
							? 'rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary'
							: 'rounded-full border border-border bg-muted/30 px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:border-primary/30 hover:text-primary'
					}
					render()
				},
				{ signal: controller.signal }
			)
		}
		root.querySelector<HTMLButtonElement>('[data-reset]')?.addEventListener(
			'click',
			() => {
				if (!state) return
				state.keyLevel = 'all'
				state.classId = 'all'
				state.specId = 'all'
				state.role = 'all'
				state.search = ''
				state.sortKey = 'rank'
				state.sortDirection = 'asc'
				populateFilters()
				populateSpecs()
				if (search) search.value = ''
				for (const peer of root.querySelectorAll<HTMLButtonElement>(
					'[data-role]'
				)) {
					const active = peer.dataset.role === 'all'
					peer.setAttribute('aria-pressed', String(active))
					peer.className = active
						? 'rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary'
						: 'rounded-full border border-border bg-muted/30 px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:border-primary/30 hover:text-primary'
				}
				render()
			},
			{ signal: controller.signal }
		)
		for (const button of root.querySelectorAll<HTMLButtonElement>(
			'[data-sort]'
		)) {
			button.addEventListener(
				'click',
				() => {
					if (!state) return
					const key = button.dataset.sort as SortKey
					if (state.sortKey === key)
						state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc'
					else {
						state.sortKey = key
						state.sortDirection = key === 'composition' ? 'asc' : 'desc'
					}
					renderTable(currentRuns().runs)
				},
				{ signal: controller.signal }
			)
		}
	}

	const load = async () => {
		loading.hidden = false
		errorPanel.hidden = true
		root.hidden = true
		root.setAttribute('aria-busy', 'true')
		try {
			const dataBase =
				(import.meta.env.PUBLIC_WOW_MPLUS_DATA_BASE as string | undefined) ||
				'/data/wow-mythic-plus'
			const { manifest, dataset } = await loadWowDataset(fetch, dataBase)
			if (controller.signal.aborted) return
			state = {
				manifest,
				dataset,
				keyLevel: 'all',
				classId: 'all',
				specId: 'all',
				role: 'all',
				search: '',
				sortKey: 'rank',
				sortDirection: 'asc',
			}
			populateFilters()
			populateSpecs()
			const definitions = root.querySelector<HTMLElement>('[data-definitions]')
			if (definitions) {
				definitions.replaceChildren()
				for (const [key, value] of Object.entries(dataset.definitions)) {
					if (!value || typeof value !== 'object') continue
					const record = value as Record<string, string>
					const p = document.createElement('p')
					const strong = textElement(
						'strong',
						'font-semibold text-foreground',
						key.replaceAll('_', ' ')
					)
					p.append(
						strong,
						document.createTextNode(`: ${record.description ?? ''} `)
					)
					if (record.denominator)
						p.append(
							document.createTextNode(`Denominator: ${record.denominator}. `)
						)
					if (record.unit)
						p.append(document.createTextNode(`Unit: ${record.unit}.`))
					definitions.append(p)
				}
			}
			loading.hidden = true
			errorPanel.hidden = true
			root.hidden = false
			root.setAttribute('aria-busy', 'false')
			const status = document.querySelector<HTMLElement>(
				'[data-dashboard-status]'
			)
			if (status)
				status.textContent = `Dashboard loaded: ${dataset.runs.length} collected runs.`
			render()
			chartObserver?.disconnect()
			chartObserver = new MutationObserver(() => {
				if (state) renderCharts(currentRuns().runs)
			})
			chartObserver.observe(document.documentElement, {
				attributes: true,
				attributeFilter: ['class'],
			})
		} catch (error) {
			if (controller.signal.aborted) return
			loading.hidden = true
			root.hidden = true
			errorPanel.hidden = false
			root.setAttribute('aria-busy', 'false')
			errorMessage.textContent =
				error instanceof Error ? error.message : 'Unknown data-loading failure.'
		}
	}

	retryButton?.addEventListener('click', load, { signal: controller.signal })
	bindControls()
	if (typeof window !== 'undefined')
		window.addEventListener(
			'resize',
			() => {
				for (const chart of charts.values()) chart.resize()
			},
			{ signal: controller.signal, passive: true }
		)

	const cleanup = () => {
		controller.abort()
		if (searchTimer) clearTimeout(searchTimer)
		chartObserver?.disconnect()
		chartObserver = undefined
		disposeCharts()
	}
	cleanupActive = cleanup
	load()
	return cleanup
}
