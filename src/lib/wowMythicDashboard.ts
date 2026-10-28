import * as echarts from 'echarts/core'
import type { EChartsType } from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { AriaComponent, GridComponent, LegendComponent, TitleComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import {
	classOptions, classRepresentation, completionHistogram, compositionAnalysis, filterRuns,
	formatCount, formatDate, formatDuration, formatMargin, formatPercent, histogram, kpis,
	loadAllDungeons, loadDungeon, loadIndex, marginHistogram, searchRuns, sortRuns,
	specOptions, specRepresentation,
	type DungeonData, type DungeonEntry, type Manifest, type RunRow, type SortKey,
} from './wowMythic'
import { classColour, WOW_CLASSES } from './wowClasses'

echarts.use([BarChart, GridComponent, TooltipComponent, TitleComponent, LegendComponent, AriaComponent, CanvasRenderer])

type RoleView = 'all' | 'tank' | 'healer' | 'dps'
type SortDirection = 'asc' | 'desc'
type ChartName = 'key' | 'class' | 'spec' | 'compositions' | 'completion' | 'margin'
const DEFAULT_PAGE_SIZE = 10

interface State {
	index: Manifest
	datasets: Map<string, DungeonData>
	selected: string
	runs: RunRow[]
	totalRuns: number
	keyLevel: string
	classId: string
	specId: string
	role: RoleView
	search: string
	sortKey: SortKey
	sortDirection: SortDirection
	page: number
	pageSize: number
}

interface Palette { primary: string; text: string; muted: string; grid: string; card: string }

let activeCleanup: (() => void) | undefined

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

function tokens(): Palette {
	const styles = getComputedStyle(document.documentElement)
	const token = (name: string, fallback: string) => {
		const value = styles.getPropertyValue(name).trim()
		return value && CSS.supports?.('color', value) ? value : fallback
	}
	return {
		primary: token('--primary', '#6d28d9'), text: token('--foreground', '#2c2438'),
		muted: token('--muted-foreground', '#655b74'), grid: token('--border', 'rgba(44,36,56,.10)'),
		card: token('--card', '#ffffff'),
	}
}

function element(tag: string, className: string, text?: string): HTMLElement {
	const node = document.createElement(tag)
	node.className = className
	if (text !== undefined) node.textContent = text
	return node
}

function axis(colours: Palette) {
	return {
		axisLine: { lineStyle: { color: colours.grid } }, axisTick: { show: false },
		axisLabel: { color: colours.muted, fontSize: 10 },
		splitLine: { lineStyle: { color: colours.grid } },
	}
}

function base(colours: Palette, ariaLabel: string) {
	return {
		backgroundColor: 'transparent', animation: !reducedMotion(),
		textStyle: { color: colours.text, fontFamily: 'inherit' },
		aria: { enabled: true, label: { description: ariaLabel } },
		tooltip: {
			trigger: 'item', confine: true, appendToBody: false,
			backgroundColor: colours.card, borderColor: colours.grid,
			textStyle: { color: colours.text, fontSize: 11 },
			extraCssText: 'border-radius: 10px; box-shadow: none; max-width: min(360px, 85vw); white-space: normal;',
		},
	}
}

function verticalOption(labels: string[], values: number[], colours: Palette, ariaLabel: string, colourFor?: (index: number) => string, tooltip?: (index: number) => string) {
	return {
		...base(colours, ariaLabel),
		grid: { left: 8, right: 12, top: 24, bottom: 8, containLabel: true },
		xAxis: { type: 'category', data: labels, ...axis(colours), splitLine: { show: false } },
		yAxis: { type: 'value', ...axis(colours), minInterval: 1 },
		series: [{ type: 'bar', data: values.map((value, index) => ({ value, itemStyle: { color: colourFor?.(index) ?? colours.primary, borderColor: colours.grid, borderWidth: 1, borderRadius: [4, 4, 0, 0] } })), barMaxWidth: 30, label: { show: true, position: 'top', color: colours.muted, fontSize: 10 }, tooltip: tooltip ? { formatter: (params: { dataIndex: number }) => tooltip(params.dataIndex) } : undefined }],
	}
}

function horizontalOption(labels: string[], values: number[], colours: Palette, ariaLabel: string, colourFor?: (index: number) => string, tooltip?: (index: number) => string, labelWidth = 130) {
	return {
		...base(colours, ariaLabel),
		grid: { left: 8, right: 34, top: 12, bottom: 8, containLabel: true },
		xAxis: { type: 'value', ...axis(colours) },
		yAxis: { type: 'category', data: labels, inverse: true, ...axis(colours), axisLabel: { color: colours.muted, fontSize: 9, width: labelWidth, overflow: 'truncate' }, splitLine: { show: false } },
		series: [{ type: 'bar', data: values.map((value, index) => ({ value, itemStyle: { color: colourFor?.(index) ?? colours.primary, borderColor: colours.grid, borderWidth: 1, borderRadius: [0, 4, 4, 0] } })), barMaxWidth: 20, label: { show: true, position: 'right', color: colours.muted, fontSize: 10 }, tooltip: tooltip ? { formatter: (params: { dataIndex: number }) => tooltip(params.dataIndex) } : undefined }],
	}
}

function emptyOption(colours: Palette, message: string) {
	return { ...base(colours, message), title: { text: message, left: 'center', top: 'middle', textStyle: { color: colours.muted, fontSize: 12, fontWeight: 'normal' } }, xAxis: { show: false }, yAxis: { show: false }, series: [] }
}

function semanticTable(container: HTMLElement, caption: string, headers: string[], rows: Array<Array<string | HTMLElement>>) {
	container.replaceChildren()
	const table = document.createElement('table')
	table.className = 'w-full border-collapse text-left text-xs'
	table.append(element('caption', 'sr-only', caption))
	const thead = document.createElement('thead')
	const head = document.createElement('tr')
	for (const value of headers) {
		const th = element('th', 'border-b border-border px-2 py-2 font-semibold text-muted-foreground', value)
		th.scope = 'col'
		head.append(th)
	}
	thead.append(head)
	const tbody = document.createElement('tbody')
	for (const row of rows) {
		const tr = document.createElement('tr')
		for (const value of row) {
			const td = document.createElement('td')
			td.className = 'border-b border-border/40 px-2 py-1.5 text-muted-foreground'
			if (value instanceof HTMLElement) td.append(value)
			else td.textContent = value
			tr.append(td)
		}
		tbody.append(tr)
	}
	table.append(thead, tbody)
	container.append(table)
}

function chip(specName: string, classId: number | null): HTMLElement {
	const span = element('span', 'inline-flex items-center rounded-md border border-l-4 px-1.5 py-0.5 text-[10px] font-semibold')
	// Keep the text high-contrast; class colour is encoded by the left border.
	span.style.backgroundColor = 'var(--muted)'
	span.style.color = 'var(--foreground)'
	span.style.borderColor = 'var(--border)'
	span.style.borderLeftColor = classColour(classId)
	span.textContent = specName
	return span
}

function formatAxisTime(seconds: number): string {
	const total = Math.round(seconds)
	return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function formatMarginAxis(seconds: number): string {
	const total = Math.round(Math.abs(seconds))
	return `${seconds < 0 ? '-' : '+'}${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export function mountWowDashboard(): () => void {
	activeCleanup?.()
	const controller = new AbortController()
	const root = document.querySelector<HTMLElement>('[data-wow-dashboard]')
	const loading = document.querySelector<HTMLElement>('[data-dashboard-loading]')
	const errorPanel = document.querySelector<HTMLElement>('[data-dashboard-error]')
	const errorMessage = document.querySelector<HTMLElement>('[data-error-message]')
	const retry = errorPanel?.querySelector<HTMLButtonElement>('[data-retry]')
	if (!root || !loading || !errorPanel || !errorMessage) return () => undefined

	const charts = new Map<ChartName, EChartsType>()
	const observer = new ResizeObserver((entries) => {
		for (const entry of entries) charts.get(entry.target.getAttribute('data-chart') as ChartName)?.resize()
	})
	let state: State | undefined
	let requestId = 0
	let searchTimer: ReturnType<typeof setTimeout> | undefined
	let themeObserver: MutationObserver | undefined

	const setText = (selector: string, value: string) => {
		root.querySelector<HTMLElement>(selector)?.replaceChildren(document.createTextNode(value))
	}

	const ensureChart = (name: ChartName): EChartsType | undefined => {
		const node = root.querySelector<HTMLElement>(`[data-chart="${name}"]`)
		if (!node) return undefined
		let chart = charts.get(name)
		if (!chart) {
			chart = echarts.init(node, undefined, { renderer: 'canvas' })
			charts.set(name, chart)
			observer.observe(node)
		}
		return chart
	}

	const selectedEntries = (): DungeonEntry[] => {
		if (!state) return []
		return state.selected === 'all' ? state.index.dungeons : state.index.dungeons.filter((entry) => entry.slug === state?.selected)
	}

	const populateFilters = () => {
		if (!state) return
		const dungeon = root.querySelector<HTMLSelectElement>('[data-filter-dungeon]')
		const key = root.querySelector<HTMLSelectElement>('[data-filter-key]')
		const classes = root.querySelector<HTMLSelectElement>('[data-filter-class]')
		if (!dungeon || !key || !classes) return
		dungeon.replaceChildren(new Option('All dungeons', 'all'))
		for (const entry of state.index.dungeons) dungeon.append(new Option(entry.name, entry.slug))
		dungeon.value = state.selected
		const levels = [...new Set(state.runs.map((run) => run.mythic_level))].sort((a, b) => a - b)
		key.replaceChildren(new Option('All key levels', 'all'))
		for (const level of levels) key.append(new Option(`+${level}`, String(level)))
		key.value = state.keyLevel
		classes.replaceChildren(new Option('All classes', 'all'))
		for (const option of classOptions(state.runs)) {
			const count = state.runs.filter((run) => run.roster.some((member) => member.class_id === option.id)).length
			classes.append(new Option(`${option.name} (${formatCount(count)})`, String(option.id)))
		}
		classes.value = state.classId
		populateSpecs()
	}

	const populateSpecs = () => {
		if (!state) return
		const select = root.querySelector<HTMLSelectElement>('[data-filter-spec]')
		if (!select) return
		select.replaceChildren(new Option('All reported specs', 'all'))
		for (const option of specOptions(state.runs, state.classId)) select.append(new Option(option.name, String(option.id)))
		if (![...select.options].some((option) => option.value === state?.specId)) state.specId = 'all'
		select.value = state.specId
	}

	const filteredRuns = (): RunRow[] => (state ? searchRuns(filterRuns(state.runs, state), state.search) : [])

	const loadSelection = async (slug: string) => {
		if (!state) return
		const current = ++requestId
		state.selected = slug
		const entries = slug === 'all' ? state.index.dungeons : state.index.dungeons.filter((entry) => entry.slug === slug)
		const loaded: DungeonData[] = []
		for (const [index, entry] of entries.entries()) {
			loading.hidden = false
			loading.textContent = slug === 'all' ? `Loading dungeon ${index + 1} of ${entries.length}: ${entry.name}…` : `Loading ${entry.name}…`
			let data = state.datasets.get(entry.slug)
			if (!data) {
				data = await loadDungeon(state.index, entry)
				state.datasets.set(entry.slug, data)
			}
			if (controller.signal.aborted || current !== requestId) return
			loaded.push(data)
		}
		const merged = new Map<number, RunRow>()
		for (const item of loaded) for (const run of item.runs) merged.set(run.run_id, run)
		state.runs = [...merged.values()]
		state.totalRuns = entries.reduce((sum, entry) => sum + entry.run_count, 0)
		state.keyLevel = 'all'
		state.classId = 'all'
		state.specId = 'all'
		state.page = 0
		populateFilters()
		loading.hidden = true
		root.hidden = false
		render()
	}

	const updateHeader = () => {
		if (!state) return
		const entry = state.selected === 'all' ? null : state.index.dungeons.find((item) => item.slug === state?.selected)
		const entries = selectedEntries()
		setText('[data-scope-region]', state.index.region.toUpperCase())
		setText('[data-scope-season]', state.index.season_name)
		setText('[data-scope-dungeon]', entry?.name ?? 'All dungeons')
		setText('[data-dataset-version]', state.index.dataset_version)
		setText('[data-collection-id]', entry ? `${formatCount(entry.run_count)} runs` : `${entries.length} dungeon collections`)
		setText('[data-selection-method]', state.selected === 'all' ? 'combined latest complete dungeon collections' : 'latest complete dungeon collection')
		setText('[data-pages-detail]', entries.map((item) => `${item.slug}: ${item.coverage_status}`).join('; '))
		setText('[data-coverage-status]', entries.every((item) => item.coverage_status === 'api_page_limit') ? 'API page ceiling' : 'Mixed coverage')
		setText('[data-footer-version]', `Validated schema ${state.index.schema_version} · ${state.dataset_version} · ${state.index.partial ? 'partial dataset' : '8 verified dungeons'}`)
		const dates = entries.map((item) => item.observation_window.completed_at).filter(Boolean) as string[]
		setText('[data-observation-window]', dates.length ? `${formatDate(dates.sort()[0])} – ${formatDate(dates.sort().at(-1) ?? null)}` : '—')
		setText('[data-exported-at]', formatDate(state.index.generated_at))
	}

	const updateKpis = (runs: RunRow[]) => {
		const summary = kpis(runs)
		const entries = selectedEntries()
		setText('[data-kpi="runs"]', formatCount(summary.runs))
		setText('[data-kpi="runs-detail"]', `${formatCount(summary.completeTeams)} complete · ${formatCount(summary.incompleteTeams)} incomplete`)
		setText('[data-kpi="highest"]', summary.highest === null ? '—' : `+${summary.highest}`)
		setText('[data-kpi="key-average"]', summary.average === null ? '—' : `avg +${summary.average.toFixed(2)} · median +${summary.median?.toFixed(1)}`)
		setText('[data-kpi="appearances"]', formatCount(summary.appearances))
		setText('[data-kpi="teams-detail"]', `${formatCount(summary.completeTeams)} complete teams`)
		const pages = entries.reduce((sum, entry) => sum + (entry.pages_succeeded ?? 1001), 0)
		const positions = entries.reduce((sum, entry) => sum + (entry.positions ?? entry.run_count), 0)
		const duplicates = entries.reduce((sum, entry) => sum + (entry.duplicate_positions ?? 0), 0)
		setText('[data-kpi="pages"]', formatCount(pages))
		setText('[data-kpi="pages-detail"]', `${formatCount(positions)} positions · ${formatCount(duplicates)} duplicates`)
		setText('[data-pages-detail]', `${formatCount(pages)} pages · ${formatCount(positions)} positions · ${formatCount(duplicates)} repeated positions`)
		setText('[data-filter-summary]', `Showing ${formatCount(runs.length)} of ${formatCount(state?.totalRuns ?? 0)} collected runs · ${formatCount(summary.appearances)} roster appearances · ${state?.role === 'all' ? 'all roles' : `${state?.role} only`} view`)
	}

	const updateWarnings = (runs: RunRow[]) => {
		const warning = document.querySelector<HTMLElement>('[data-dataset-incomplete]')
		const stale = document.querySelector<HTMLElement>('[data-dataset-stale]')
		if (!state) return
		const summary = kpis(runs)
		const missing: string[] = []
		if (summary.incompleteTeams) missing.push(`${formatCount(summary.incompleteTeams)} incomplete rosters`)
		if (summary.missingClass) missing.push(`${formatCount(summary.missingClass)} missing class values`)
		if (summary.missingSpec) missing.push(`${formatCount(summary.missingSpec)} missing spec values`)
		if (summary.missingRole) missing.push(`${formatCount(summary.missingRole)} missing role values`)
		if (warning) {
			warning.hidden = missing.length === 0
			warning.textContent = missing.length ? `Completeness: ${missing.join('; ')}.` : ''
		}
		if (stale) {
			const generated = new Date(state.index.generated_at).valueOf()
			stale.hidden = !(Number.isFinite(generated) && Date.now() - generated > 14 * 86400000)
		}
	}

	const renderCompositionList = (comps: ReturnType<typeof compositionAnalysis>) => {
		const container = root.querySelector<HTMLElement>('[data-composition-list]')
		if (!container) return
		container.replaceChildren()
		const table = document.createElement('table')
		table.className = 'w-full min-w-[48rem] border-collapse text-left text-xs'
		table.append(element('caption', 'sr-only', 'Ranked eligible complete-team compositions'))
		const thead = document.createElement('thead')
		const head = document.createElement('tr')
		for (const title of ['#', 'Composition', 'Occurrences', 'Share', 'Roles']) {
			const th = element('th', 'border-b border-border px-3 py-2 font-semibold text-muted-foreground', title)
			th.scope = 'col'
			head.append(th)
		}
		thead.append(head)
		const tbody = document.createElement('tbody')
		comps.compositions.slice(0, 15).forEach((row, index) => {
			const tr = document.createElement('tr')
			tr.className = 'border-b border-border/40 last:border-0'
			const rank = element('td', 'px-3 py-2 font-mono text-muted-foreground', String(index + 1))
			const composition = document.createElement('td')
			composition.className = 'px-3 py-2'
			const wrap = element('div', 'flex flex-wrap gap-1')
			row.labels.forEach((label, labelIndex) => {
				const specName = row.specNames[labelIndex]
				const className = label.replace(specName, '').trim()
				const classId = WOW_CLASSES.find((entry) => entry.name === className)?.id ?? null
				wrap.append(chip(specName, classId))
			})
			composition.append(wrap)
			tr.append(rank, composition, element('td', 'px-3 py-2 font-mono', formatCount(row.occurrences)), element('td', 'px-3 py-2 font-mono', formatPercent(row.percentage)), element('td', 'px-3 py-2 text-muted-foreground', row.roles.join(', ')))
			tbody.append(tr)
		})
		table.append(thead, tbody)
		container.append(table)
	}

	const renderCharts = (runs: RunRow[]) => {
		const colours = tokens()
		const levels = [...new Set(runs.map((run) => run.mythic_level))].sort((a, b) => a - b)
		const levelCounts = levels.map((level) => runs.filter((run) => run.mythic_level === level).length)
		const keyChart = ensureChart('key')
		keyChart?.setOption(levels.length ? verticalOption(levels.map((level) => `+${level}`), levelCounts, colours, `Runs by key level.`, undefined, (index) => `+${levels[index]}: ${formatCount(levelCounts[index])} runs`) : emptyOption(colours, 'No runs match the filters'), true)
		semanticTable(root.querySelector<HTMLElement>('[data-chart-table="key"]')!, 'Key-level distribution data', ['Key level', 'Runs'], levels.map((level, index) => [`+${level}`, formatCount(levelCounts[index])]))

		const classData = classRepresentation(runs, state?.role ?? 'all')
		const classChart = ensureChart('class')
		classChart?.setOption(classData.data.length ? horizontalOption(classData.data.map((row) => row.className), classData.data.map((row) => row.appearances), colours, `Class appearances.`, (index) => classData.data[index].colour, (index) => `${classData.data[index].className}: ${formatCount(classData.data[index].appearances)} appearances; ${formatCount(classData.data[index].teams)} complete teams`, 130) : emptyOption(colours, 'No class appearances in view'), true)
		classChart?.getDom().setAttribute('aria-label', classData.data.length ? `Class appearances: ${classData.data.slice(0, 8).map((row) => `${row.className} ${row.appearances}`).join('; ')}. See the data table.` : 'No class appearances in view')
		semanticTable(root.querySelector<HTMLElement>('[data-chart-table="class"]')!, 'Class appearance data', ['Class', 'Appearances', 'Share', 'Teams'], classData.data.map((row) => [row.className, formatCount(row.appearances), formatPercent(row.percentage), formatCount(row.teams)]))

		const specs = specRepresentation(runs, state?.role ?? 'all')
		const topSpecs = specs.data.slice(0, 24)
		const specChart = ensureChart('spec')
		specChart?.setOption(topSpecs.length ? horizontalOption(topSpecs.map((row) => `${row.specName} · ${row.className ?? 'Unknown'}`), topSpecs.map((row) => row.appearances), colours, `Reported specialisations by class colour and role.`, (index) => topSpecs[index].colour, (index) => `${topSpecs[index].specName} (${topSpecs[index].className ?? 'unknown'}): ${formatCount(topSpecs[index].appearances)} appearances; ${formatPercent(topSpecs[index].percentage)}`, 180) : emptyOption(colours, 'No specialisation appearances in view'), true)
		specChart?.getDom().setAttribute('aria-label', topSpecs.length ? `Reported specialisations: ${topSpecs.slice(0, 8).map((row) => `${row.specName} ${row.appearances}`).join('; ')}. See the data table.` : 'No specialisation appearances in view')
		semanticTable(root.querySelector<HTMLElement>('[data-chart-table="spec"]')!, 'Reported specialisation data', ['Spec', 'Class', 'Role', 'Appearances', 'Share', 'Teams'], topSpecs.map((row) => [row.specName, row.className ?? '—', row.role ?? '—', formatCount(row.appearances), formatPercent(row.percentage), formatCount(row.teams)]))

		const comps = compositionAnalysis(runs)
		const topComps = comps.compositions.slice(0, 12)
		const compChart = ensureChart('compositions')
		compChart?.setOption(topComps.length ? horizontalOption(topComps.map((row) => row.specNames.join(' / ')), topComps.map((row) => row.occurrences), colours, `Most common team compositions.`, undefined, (index) => `${topComps[index].labels.join(' · ')}: ${formatCount(topComps[index].occurrences)} teams`, 250) : emptyOption(colours, 'No eligible complete teams in view'), true)
		compChart?.getDom().setAttribute('aria-label', topComps.length ? `Top team compositions: ${topComps.slice(0, 4).map((row) => `${row.specNames.join(' ')} ${row.occurrences}`).join('; ')}. See the ranked table.` : 'No eligible complete teams in view')
		semanticTable(root.querySelector<HTMLElement>('[data-chart-table="compositions"]')!, 'Team composition data', ['Reported composition', 'Occurrences', 'Share'], topComps.map((row) => [row.labels.join(' · '), formatCount(row.occurrences), formatPercent(row.percentage)]))
		renderCompositionList(comps)

		const completion = completionHistogram(runs, 30)
		const completionChart = ensureChart('completion')
		completionChart?.setOption(completion.length ? verticalOption(completion.map((bin) => formatAxisTime(bin.min)), completion.map((bin) => bin.count), colours, `Clear-time histogram in 30-second bins.`, undefined, (index) => `${formatDuration(completion[index].min)}–${formatDuration(completion[index].max)}: ${formatCount(completion[index].count)} runs`) : emptyOption(colours, 'No completion times in view'), true)
		semanticTable(root.querySelector<HTMLElement>('[data-chart-table="completion"]')!, 'Completion-time data', ['From', 'To', 'Runs'], completion.map((bin) => [formatDuration(bin.min), formatDuration(bin.max), formatCount(bin.count)]))

		const margins = marginHistogram(runs, 30)
		const marginChart = ensureChart('margin')
		marginChart?.setOption(margins.length ? verticalOption(margins.map((bin) => formatMarginAxis(bin.min)), margins.map((bin) => bin.count), colours, `Timer-margin histogram.`, (index) => (margins[index].min >= 0 ? '#047857' : '#B91C1C'), (index) => `${formatMargin(margins[index].min)} to ${formatMargin(margins[index].max)}: ${formatCount(margins[index].count)} runs`) : emptyOption(colours, 'No timer margins in view'), true)
		semanticTable(root.querySelector<HTMLElement>('[data-chart-table="margin"]')!, 'Timer-margin data', ['From', 'To', 'Runs'], margins.map((bin) => [formatMargin(bin.min), formatMargin(bin.max), formatCount(bin.count)]))
	}

	const updateTable = (runs: RunRow[]) => {
		if (!state) return
		const sorted = sortRuns(runs, state.sortKey, state.sortDirection)
		const totalPages = Math.max(1, Math.ceil(sorted.length / state.pageSize))
		if (state.page >= totalPages) state.page = totalPages - 1
		const start = state.page * state.pageSize
		const page = sorted.slice(start, start + state.pageSize)
		const body = root.querySelector<HTMLElement>('[data-runs-body]')
		const empty = root.querySelector<HTMLElement>('[data-runs-empty]')
		if (!body || !empty) return
		body.replaceChildren()
		empty.hidden = sorted.length > 0
		for (const run of page) {
			const tr = document.createElement('tr')
			tr.className = 'border-b border-border/40 align-top last:border-0 hover:bg-muted/20'
			const rank = document.createElement('th')
			rank.scope = 'row'
			rank.className = 'px-3 py-2.5 text-left font-normal'
			rank.append(element('span', 'block font-mono text-xs font-semibold text-foreground', `#${run.source_rank}`), element('span', 'mt-1 block font-mono text-[10px] text-muted-foreground', String(run.run_id)))
			const key = document.createElement('td')
			key.className = 'px-3 py-2.5'
			key.append(element('span', 'rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.5 font-mono text-xs font-semibold text-primary', `+${run.mythic_level}`))
			const composition = document.createElement('td')
			composition.className = 'min-w-[18rem] px-3 py-2.5'
			const wrap = element('div', 'flex flex-wrap gap-1')
			for (const member of [...run.roster].sort((a, b) => (a.spec_id ?? 0) - (b.spec_id ?? 0))) wrap.append(chip(member.spec_name ?? 'Unknown', member.class_id))
			composition.append(wrap)
			const source = document.createElement('td')
			source.className = 'px-3 py-2.5'
			const link = document.createElement('a')
			link.href = run.source_url
			link.target = '_blank'
			link.rel = 'noopener noreferrer'
			link.className = 'text-xs font-semibold text-primary hover:underline'
			link.textContent = 'Raider.IO ↗'
			link.setAttribute('aria-label', `Open run ${run.run_id} on Raider.IO (opens in a new tab)`)
			source.append(link)
			const score = element('td', 'px-3 py-2.5 font-mono text-xs text-muted-foreground', run.source_score === null ? '—' : `${run.source_score.toFixed(1)}*`)
			score.title = '* Leaderboard source score; semantics unverified'
			const margin = element('td', `px-3 py-2.5 font-mono text-xs ${run.timer_margin_seconds !== null && run.timer_margin_seconds < 0 ? 'wow-negative' : 'wow-positive'}`, formatMargin(run.timer_margin_seconds))
			tr.append(rank, key, element('td', 'px-3 py-2.5 text-xs text-muted-foreground', run.dungeon.name), element('td', 'px-3 py-2.5 font-mono text-xs text-foreground', formatDuration(run.clear_time_seconds)), margin, score, composition, source)
			body.append(tr)
		}
		setText('[data-result-count]', `${formatCount(sorted.length)} runs shown`)
		setText('[data-page-status]', sorted.length ? `Showing runs ${formatCount(start + 1)}–${formatCount(Math.min(start + state.pageSize, sorted.length))} of ${formatCount(sorted.length)}` : 'No matching runs')
		const prev = root.querySelector<HTMLButtonElement>('[data-page-prev]')
		const next = root.querySelector<HTMLButtonElement>('[data-page-next]')
		if (prev) prev.disabled = state.page <= 0
		if (next) next.disabled = state.page >= totalPages - 1
		for (const button of root.querySelectorAll<HTMLButtonElement>('[data-sort]')) button.closest('th')?.setAttribute('aria-sort', button.dataset.sort === state.sortKey ? (state.sortDirection === 'asc' ? 'ascending' : 'descending') : 'none')
		setText('[data-sort-status]', `Sorted by ${state.sortKey} ${state.sortDirection === 'asc' ? 'ascending' : 'descending'}.`)
	}

	const render = () => {
		if (!state) return
		const runs = filteredRuns()
		updateHeader()
		updateKpis(runs)
		updateWarnings(runs)
		renderCharts(runs)
		updateTable(runs)
	}

	const bindControls = () => {
		root.querySelector<HTMLSelectElement>('[data-filter-dungeon]')?.addEventListener('change', (event) => {
			void loadSelection((event.target as HTMLSelectElement).value).catch(showError)
		}, { signal: controller.signal })
		root.querySelector<HTMLSelectElement>('[data-filter-key]')?.addEventListener('change', (event) => {
			if (!state) return
			state.keyLevel = (event.target as HTMLSelectElement).value
			state.page = 0
			render()
		}, { signal: controller.signal })
		root.querySelector<HTMLSelectElement>('[data-filter-class]')?.addEventListener('change', (event) => {
			if (!state) return
			state.classId = (event.target as HTMLSelectElement).value
			state.specId = 'all'
			state.page = 0
			populateSpecs()
			render()
		}, { signal: controller.signal })
		root.querySelector<HTMLSelectElement>('[data-filter-spec]')?.addEventListener('change', (event) => {
			if (!state) return
			state.specId = (event.target as HTMLSelectElement).value
			state.page = 0
			render()
		}, { signal: controller.signal })
		root.querySelector<HTMLInputElement>('[data-filter-search]')?.addEventListener('input', (event) => {
			if (!state) return
			if (searchTimer) clearTimeout(searchTimer)
			searchTimer = setTimeout(() => {
				if (!state) return
				state.search = (event.target as HTMLInputElement).value
				state.page = 0
				render()
			}, 180)
		}, { signal: controller.signal })
		for (const button of root.querySelectorAll<HTMLButtonElement>('[data-role]')) {
			button.addEventListener('click', () => {
				if (!state) return
				state.role = (button.dataset.role as RoleView) ?? 'all'
				for (const peer of root.querySelectorAll<HTMLButtonElement>('[data-role]')) {
					const active = peer === button
					peer.setAttribute('aria-pressed', String(active))
					peer.className = active ? 'rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary' : 'rounded-full border border-border bg-muted/30 px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:border-primary/30 hover:text-primary'
				}
				render()
			}, { signal: controller.signal })
		}
		root.querySelector<HTMLSelectElement>('[data-page-size]')?.addEventListener('change', (event) => {
			if (!state) return
			state.pageSize = Number((event.target as HTMLSelectElement).value) || DEFAULT_PAGE_SIZE
			state.page = 0
			updateTable(filteredRuns())
		}, { signal: controller.signal })
		root.querySelector<HTMLButtonElement>('[data-reset]')?.addEventListener('click', () => {
			if (!state) return
			state.keyLevel = 'all'
			state.classId = 'all'
			state.specId = 'all'
			state.role = 'all'
			state.search = ''
			state.page = 0
			state.sortKey = 'rank'
			state.sortDirection = 'asc'
			const search = root.querySelector<HTMLInputElement>('[data-filter-search]')
			if (search) search.value = ''
			populateFilters()
			for (const peer of root.querySelectorAll<HTMLButtonElement>('[data-role]')) {
				const active = peer.dataset.role === 'all'
				peer.setAttribute('aria-pressed', String(active))
				peer.className = active ? 'rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary' : 'rounded-full border border-border bg-muted/30 px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:border-primary/30 hover:text-primary'
			}
			render()
		}, { signal: controller.signal })
		for (const button of root.querySelectorAll<HTMLButtonElement>('[data-sort]')) {
			button.addEventListener('click', () => {
				if (!state) return
				const key = button.dataset.sort as SortKey
				if (state.sortKey === key) state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc'
				else { state.sortKey = key; state.sortDirection = key === 'composition' ? 'asc' : 'desc' }
				state.page = 0
				updateTable(filteredRuns())
			}, { signal: controller.signal })
		}
		root.querySelector<HTMLButtonElement>('[data-page-prev]')?.addEventListener('click', () => {
			if (!state) return
			state.page = Math.max(0, state.page - 1)
			updateTable(filteredRuns())
		}, { signal: controller.signal })
		root.querySelector<HTMLButtonElement>('[data-page-next]')?.addEventListener('click', () => {
			if (!state) return
			state.page += 1
			updateTable(filteredRuns())
		}, { signal: controller.signal })
	}

	const showError = (error: unknown) => {
		loading.hidden = true
		root.hidden = true
		errorPanel.hidden = false
		errorMessage.textContent = error instanceof Error ? error.message : 'Unknown data-loading failure.'
	}

	const start = async () => {
		loading.hidden = false
		errorPanel.hidden = true
		root.hidden = true
		root.setAttribute('aria-busy', 'true')
		try {
			const index = await loadIndex()
			if (controller.signal.aborted) return
			state = {
				index, datasets: new Map(), selected: 'all', runs: [],
				totalRuns: index.dungeons.reduce((sum, entry) => sum + entry.run_count, 0),
				keyLevel: 'all', classId: 'all', specId: 'all', role: 'all',
				search: '', sortKey: 'rank', sortDirection: 'asc', page: 0, pageSize: DEFAULT_PAGE_SIZE,
			}
			bindControls()
			populateFilters()
			await loadSelection('all')
			if (controller.signal.aborted) return
			root.setAttribute('aria-busy', 'false')
			const status = document.querySelector<HTMLElement>('[data-dashboard-status]')
			if (status) status.textContent = `Dashboard loaded: ${formatCount(state.totalRuns)} collected runs across ${index.dungeons.length} dungeons.`
			render()
			themeObserver?.disconnect()
			themeObserver = new MutationObserver(() => {
				if (state) renderCharts(filteredRuns())
			})
			themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
		} catch (error) {
			if (!controller.signal.aborted) showError(error)
		}
	}

	retry?.addEventListener('click', () => void start(), { signal: controller.signal })
	const cleanup = () => {
		controller.abort()
		if (searchTimer) clearTimeout(searchTimer)
		themeObserver?.disconnect()
		observer.disconnect()
		for (const chart of charts.values()) chart.dispose()
		charts.clear()
	}
	activeCleanup = cleanup
	if (typeof document !== 'undefined') document.addEventListener('astro:before-swap', () => activeCleanup?.(), { once: true })
	void start()
	return cleanup
}
