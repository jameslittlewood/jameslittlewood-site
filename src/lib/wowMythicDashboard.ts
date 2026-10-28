import * as echarts from 'echarts/core'
import type { EChartsType } from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { AriaComponent, GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import {
	classOptions, classRepresentation, completionHistogram, compositionAnalysis, formatCount,
	formatDate, formatDuration, formatMargin, formatPercent, kpis, loadCombined, loadDungeon,
	loadIndex, marginHistogram, searchRuns, sortRuns, specOptions, specRepresentation,
	type ClassDatum, type CombinedDataset, type DungeonData, type DungeonEntry, type Manifest,
	type RunRow, type SortKey,
} from './wowMythic'
import { classColour } from './wowClasses'

echarts.use([BarChart, GridComponent, TooltipComponent, AriaComponent, CanvasRenderer])

type Tab = 'overview' | 'classes' | 'dungeons' | 'teams' | 'runs'
type RoleView = 'all' | 'tank' | 'healer' | 'dps'
type SortDirection = 'asc' | 'desc'
type ChartName = 'overview-key' | 'overview-class' | 'class' | 'spec' | 'dungeon-key' | 'dungeon-completion' | 'dungeon-margin'
type Palette = { primary: string; text: string; muted: string; grid: string; card: string }
type HistogramBin = { min: number; max: number; count: number }

const TABS: Tab[] = ['overview', 'classes', 'dungeons', 'teams', 'runs']
const DEFAULT_PAGE_SIZE = 10
const ROLE_LABELS: Record<RoleView, string> = { all: 'all roles', tank: 'tank', healer: 'healer', dps: 'dps' }
let activeCleanup: (() => void) | undefined

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

function tokens(): Palette {
	const styles = getComputedStyle(document.documentElement)
	const token = (name: string, fallback: string) => {
		const value = styles.getPropertyValue(name).trim()
		return value && CSS.supports?.('color', value) ? value : fallback
	}
	return {
		primary: token('--primary', '#6d28d9'), text: token('--foreground', '#2c2438'),
		muted: token('--muted-foreground', '#655b74'), grid: token('--border', 'rgba(44,36,56,.12)'),
		card: token('--card', '#ffffff'),
	}
}

function element(tag: string, className: string, text?: string): HTMLElement {
	const node = document.createElement(tag)
	node.className = className
	if (text !== undefined) node.textContent = text
	return node
}

function formatAxisTime(seconds: number): string {
	const total = Math.round(seconds)
	return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function formatMarginAxis(seconds: number): string {
	const total = Math.round(Math.abs(seconds))
	return `${seconds < 0 ? '-' : '+'}${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
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

function chip(label: string, classId: number): HTMLElement {
	const span = element('span', 'inline-flex items-center rounded-md border border-l-4 bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-foreground')
	span.style.borderColor = 'var(--border)'
	span.style.borderLeftColor = classColour(classId)
	span.textContent = label
	return span
}

export function mountWowDashboard(): () => void {
	activeCleanup?.()
	const controller = new AbortController()
	const signal = controller.signal
	const root = document.querySelector<HTMLElement>('[data-wow-dashboard]')
	const loading = document.querySelector<HTMLElement>('[data-dashboard-loading]')
	const errorPanel = document.querySelector<HTMLElement>('[data-dashboard-error]')
	const errorMessage = document.querySelector<HTMLElement>('[data-error-message]')
	const retry = errorPanel?.querySelector<HTMLButtonElement>('[data-retry]')
	if (!root || !loading || !errorPanel || !errorMessage) return () => undefined

	const charts = new Map<ChartName, EChartsType>()
	const resizeObserver = new ResizeObserver((entries) => {
		for (const entry of entries) charts.get(entry.target.getAttribute('data-chart') as ChartName)?.resize()
	})
	root.querySelectorAll<HTMLElement>('[data-chart]').forEach((node) => resizeObserver.observe(node))

	let state: {
		index: Manifest; combined: CombinedDataset; datasets: Map<string, DungeonData>
		tab: Tab; dungeon: string; keyLevel: string; classId: string; specId: string
		role: RoleView; search: string; sortKey: SortKey; sortDirection: SortDirection
		page: number; pageSize: number
	} | undefined
	let requestSerial = 0
	let searchTimer: ReturnType<typeof setTimeout> | undefined
	let pendingTab: Tab = 'overview'
	let themeTimer: ReturnType<typeof setTimeout> | undefined

	const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"][data-tab]')]
	const panels = [...root.querySelectorAll<HTMLElement>('[data-panel]')]
	const filterBar = root.querySelector<HTMLElement>('[data-filter-bar]')
	const setText = (selector: string, value: string) => { root.querySelector<HTMLElement>(selector)?.replaceChildren(document.createTextNode(value)) }
	const totalRuns = () => state?.index.dungeons.reduce((sum, entry) => sum + entry.run_count, 0) ?? 0
	const allRuns = () => {
		if (!state) return []
		const merged = new Map<number, RunRow>()
		for (const data of state.datasets.values()) for (const run of data.runs) merged.set(run.run_id, run)
		return [...merged.values()]
	}
	const setStatus = (text: string) => { document.querySelector<HTMLElement>('[data-dashboard-status]')?.replaceChildren(document.createTextNode(text)) }

	const applyFilters = (context: Tab): RunRow[] => {
		if (!state) return []
		let rows = allRuns()
		if (state.dungeon !== 'all') rows = rows.filter((run) => run.dungeon.slug === state.dungeon)
		if (state.keyLevel !== 'all') rows = rows.filter((run) => String(run.mythic_level) === state.keyLevel)
		const useClassFilters = context === 'classes' || context === 'runs'
		if (useClassFilters && state.classId !== 'all') rows = rows.filter((run) => run.roster.some((member) => String(member.class_id) === state.classId))
		if (useClassFilters && state.specId !== 'all') rows = rows.filter((run) => run.roster.some((member) => String(member.spec_id) === state.specId))
		if (useClassFilters && state.role !== 'all') rows = rows.filter((run) => run.roster.some((member) => member.role === state.role))
		if (context === 'runs' && state.search.trim()) rows = searchRuns(rows, state.search.trim())
		return rows
	}

	const updateFilterSummary = (context: Tab, rows: RunRow[]) => {
		if (!state) return
		const total = totalRuns()
		const appearances = rows.reduce((sum, run) => sum + run.roster.length, 0)
		const scope = state.dungeon === 'all' ? 'all dungeons' : (state.index.dungeons.find((entry) => entry.slug === state.dungeon)?.name ?? 'selected dungeon')
		const roleSuffix = context === 'classes' || context === 'runs' ? ` · ${ROLE_LABELS[state.role]} view` : ''
		setText('[data-filter-summary]', `Showing ${formatCount(rows.length)} of ${formatCount(total)} collected runs · ${scope} · ${formatCount(appearances)} roster appearances${roleSuffix}`)
	}

	const setFilterVisibility = (tab: Tab) => {
		if (!state) return
		if (filterBar) filterBar.hidden = tab === 'overview'
		const allowed = new Set(tab === 'classes' ? ['class-spec', 'role'] : tab === 'runs' ? ['class-spec', 'role', 'search'] : [])
		root.querySelectorAll<HTMLElement>('[data-filter-group]').forEach((group) => {
			group.hidden = !allowed.has(group.dataset.filterGroup ?? '')
		})
	}

	const setTab = (tab: Tab, updateHash = true) => {
		if (!TABS.includes(tab)) tab = 'overview'
		pendingTab = tab
		for (const button of tabs) {
			const active = button.dataset.tab === tab
			button.setAttribute('aria-selected', String(active))
			button.tabIndex = active ? 0 : -1
		}
		for (const panel of panels) panel.hidden = panel.dataset.panel !== tab
		setFilterVisibility(tab)
		if (state) state.tab = tab
		if (updateHash) history.replaceState(null, '', `#${tab}`)
		if (!state) return
		void activateTab(tab)
	}

	const activateTab = async (tab: Tab) => {
		if (!state) return
		const serial = ++requestSerial
		try {
			if (tab !== 'overview') await ensureData(tab === 'dungeons' ? 'dungeons' : 'runs', serial)
			if (serial !== requestSerial || state.tab !== tab) return
			populateFilters()
			if (tab === 'overview') renderOverview()
			if (tab === 'classes') renderClasses()
			if (tab === 'dungeons') renderDungeons()
			if (tab === 'teams') renderTeams()
			if (tab === 'runs') renderRuns()
		} catch (error) {
			fail(error)
		}
	}

	const ensureData = async (kind: 'runs' | 'dungeons', serial: number) => {
		if (!state) return
		const slugs = kind === 'dungeons' || state.dungeon === 'all'
			? state.index.dungeons.map((entry) => entry.slug)
			: [state.dungeon]
		const missing = slugs.filter((slug) => !state?.datasets.has(slug))
		if (!missing.length) return
		for (let index = 0; index < missing.length; index += 1) {
			if (serial !== requestSerial) return
			setStatus(`Loading ${kind === 'dungeons' ? 'dungeon explorer' : 'leaderboard'} data: ${index + 1} of ${missing.length}`)
			setText('[data-filter-summary]', `Loading ${missing.length === 8 ? 'all eight dungeon datasets' : 'dungeon data'}… ${index + 1}/${missing.length}`)
			const entry = state.index.dungeons.find((item) => item.slug === missing[index])
			if (!entry) throw new Error(`Unknown dungeon: ${missing[index]}`)
			const data = await loadDungeon(state.index, entry)
			state.datasets.set(missing[index], data)
			if (kind === 'dungeons') populateDungeonCards()
		}
		setStatus('Dashboard data loaded')
	}

	const populateDungeonCards = () => {
		if (!state) return
		const grid = root.querySelector<HTMLElement>('[data-dungeon-cards]')
		if (!grid) return
		grid.replaceChildren()
		const allData = [...state.datasets.values()]
		const total = totalRuns()
		const highest = allData.reduce<number | null>((max, data) => {
			const value = data.dataset.run_statistics.key_level.highest
			return value === null ? max : Math.max(max ?? value, value)
		}, null)
		const makeCard = (slug: string, name: string, art: string, count: number, high: number | null) => {
			const button = document.createElement('button')
			button.type = 'button'
			button.dataset.dungeonCard = slug
			button.dataset.selected = String(state?.dungeon === slug)
			button.className = 'group overflow-hidden rounded-2xl border border-border/60 bg-card text-left transition hover:-translate-y-0.5 hover:border-primary/40 focus-visible:border-primary motion-reduce:transform-none'
			button.innerHTML = `<img src="${art}" alt="" width="640" height="360" loading="lazy" class="h-28 w-full object-cover opacity-90 transition group-hover:opacity-100"><span class="block p-3"><span class="block text-sm font-bold">${name}</span><span class="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground"><span>${formatCount(count)} runs</span><span>Highest ${high === null ? '—' : `+${high}`}</span></span></span>`
			button.addEventListener('click', () => {
				if (!state) return
				state.dungeon = slug
				state.page = 0
				const select = root.querySelector<HTMLSelectElement>('[data-filter-dungeon]')
				if (select) select.value = slug
				populateDungeonCards()
				populateFilters()
				renderDungeons()
			}, { signal })
			grid.append(button)
		}
		makeCard('all', 'All Dungeons', '/images/wow-mythic-plus/hero.svg', total, highest)
		for (const entry of state.index.dungeons) {
			const dataset = state.datasets.get(entry.slug)
			makeCard(entry.slug, entry.name, `/images/wow-mythic-plus/${entry.slug}.svg`, entry.run_count, dataset?.dataset.run_statistics.key_level.highest ?? null)
		}
	}

	const populateFilters = () => {
		if (!state) return
		const dungeon = root.querySelector<HTMLSelectElement>('[data-filter-dungeon]')
		if (dungeon) {
			dungeon.replaceChildren(new Option('All dungeons', 'all'))
			for (const entry of state.index.dungeons) dungeon.append(new Option(entry.name, entry.slug))
			dungeon.value = state.dungeon
		}
		const rows = allRuns()
		const levels = [...new Set(rows.map((run) => run.mythic_level))].sort((a, b) => a - b)
		const key = root.querySelector<HTMLSelectElement>('[data-filter-key]')
		if (key) {
			key.replaceChildren(new Option('All key levels', 'all'))
			for (const level of levels) key.append(new Option(`+${level}`, String(level)))
			key.value = levels.includes(Number(state.keyLevel)) ? state.keyLevel : 'all'
			if (key.value === 'all') state.keyLevel = 'all'
		}
		const classes = classOptions(rows)
		const classSelect = root.querySelector<HTMLSelectElement>('[data-filter-class]')
		if (classSelect) {
			classSelect.replaceChildren(new Option('All classes', 'all'))
			for (const option of classes) classSelect.append(new Option(option.name, String(option.id)))
			classSelect.value = classes.some((option) => String(option.id) === state?.classId) ? state.classId : 'all'
			if (classSelect.value === 'all') state.classId = 'all'
		}
		const specs = specOptions(rows, state.classId)
		const specSelect = root.querySelector<HTMLSelectElement>('[data-filter-spec]')
		if (specSelect) {
			specSelect.replaceChildren(new Option('All reported specs', 'all'))
			for (const option of specs) specSelect.append(new Option(`${option.name}${option.role ? ` · ${option.role}` : ''}`, String(option.id)))
			specSelect.value = specs.some((option) => String(option.id) === state?.specId) ? state.specId : 'all'
			if (specSelect.value === 'all') state.specId = 'all'
		}
	}

	const palette = () => tokens()
	const axisCommon = (colours: Palette) => ({
		axisLine: { lineStyle: { color: colours.grid } }, axisTick: { show: false },
		axisLabel: { color: colours.muted, fontSize: 10 },
		splitLine: { lineStyle: { color: colours.grid } },
	})
	const baseOption = (colours: Palette, aria: string) => ({
		backgroundColor: 'transparent', animation: !reducedMotion(),
		textStyle: { color: colours.text, fontFamily: 'inherit' },
		aria: { enabled: true, label: { description: aria } },
		tooltip: {
			trigger: 'item', confine: true, appendToBody: false,
			backgroundColor: colours.card, borderColor: colours.grid,
			textStyle: { color: colours.text, fontSize: 11 },
			extraCssText: 'border-radius: 10px; box-shadow: none; max-width: min(360px, 85vw); white-space: normal;',
		},
	})

	const verticalOption = (labels: string[], values: number[], colours: Palette, xName: string, yName: string, aria: string, colourFor: (index: number) => string, tip: (index: number) => string, rotate = 0) => ({
		...baseOption(colours, `${aria}. Horizontal axis: ${xName}. Vertical axis: ${yName}.`),
		grid: { left: 12, right: 16, top: 28, bottom: 54, containLabel: true },
		xAxis: { type: 'category', data: labels, name: xName, nameLocation: 'middle', nameGap: 32, ...axisCommon(colours), axisLabel: { color: colours.muted, fontSize: 10, rotate }, splitLine: { show: false } },
		yAxis: { type: 'value', name: yName, nameLocation: 'middle', nameGap: 46, nameRotate: 90, minInterval: 1, ...axisCommon(colours), axisLabel: { color: colours.muted, fontSize: 10, formatter: (value: number) => formatCount(value) } },
		series: [{ type: 'bar', data: values.map((value, index) => ({ value, itemStyle: { color: colourFor(index), borderColor: colours.text, borderWidth: 1, borderRadius: [4, 4, 0, 0] } })), barMaxWidth: 30, tooltip: { formatter: (params: { dataIndex: number }) => tip(params.dataIndex) } }],
	})

	const horizontalOption = (labels: string[], values: number[], colours: Palette, xName: string, yName: string, aria: string, colourFor: (index: number) => string, tip: (index: number) => string, labelWidth = 150) => ({
		...baseOption(colours, `${aria}. Horizontal axis: ${xName}. Vertical axis: ${yName}.`),
		grid: { left: 12, right: 24, top: 36, bottom: 42, containLabel: true },
		xAxis: { type: 'value', name: xName, nameLocation: 'middle', nameGap: 28, ...axisCommon(colours), axisLabel: { color: colours.muted, fontSize: 10, formatter: (value: number) => formatCount(value) } },
		yAxis: { type: 'category', data: labels, inverse: true, name: yName, nameLocation: 'middle', nameGap: 62, ...axisCommon(colours), axisLabel: { color: colours.muted, fontSize: 9, width: labelWidth, overflow: 'truncate' }, splitLine: { show: false } },
		series: [{ type: 'bar', data: values.map((value, index) => ({ value, itemStyle: { color: colourFor(index), borderColor: colours.text, borderWidth: 1, borderRadius: [0, 4, 4, 0] } })), barMaxWidth: 20, tooltip: { formatter: (params: { dataIndex: number }) => tip(params.dataIndex) } }],
	})

	const renderChart = (name: ChartName, option: Record<string, unknown>, caption: string, headers: string[], rows: Array<Array<string | HTMLElement>>, axes: string) => {
		const container = root.querySelector<HTMLElement>(`[data-chart="${name}"]`)
		if (!container) return
		container.setAttribute('aria-label', `${caption}. ${axes}. Chart data is also available in the table below.`)
		let chart = charts.get(name)
		if (!chart) {
			chart = echarts.init(container, undefined, { renderer: 'canvas' })
			charts.set(name, chart)
		}
		chart.setOption(option, true)
		const table = root.querySelector<HTMLElement>(`[data-chart-table="${name}"]`)
		if (table) semanticTable(table, caption, headers, rows)
	}

	const emptyChart = (name: ChartName, caption: string) => {
		const colours = palette()
		renderChart(name, {
			...baseOption(colours, `${caption}. No eligible data in view.`),
			title: { text: 'No eligible data in view', left: 'center', top: 'middle', textStyle: { color: colours.muted, fontSize: 12, fontWeight: 'normal' } },
			xAxis: { show: false }, yAxis: { show: false }, series: [],
		}, caption, ['Metric', 'Value'], [['Runs', '0']], 'No data')
	}

	const renderOverview = () => {
		if (!state) return
		const cohort = state.combined.population.cohort
		const key = state.combined.run_statistics.key_level
		setText('[data-overview-kpi="runs"]', formatCount(cohort.runs))
		setText('[data-overview-kpi="highest"]', key.highest === null ? '—' : `+${key.highest}`)
		setText('[data-overview-kpi="average"]', `${key.average?.toFixed(2) ?? '—'} / ${key.median?.toFixed(0) ?? '—'}`)
		setText('[data-overview-kpi="dungeons"]', String(state.combined.population.dungeons.length))
		setText('[data-overview-kpi="appearances"]', formatCount(cohort.roster_appearances))
		setText('[data-overview-kpi="teams"]', formatCount(cohort.eligible_complete_teams))
		const colours = palette()
		const keyRows = state.combined.run_statistics.by_key_level
		renderChart('overview-key', verticalOption(
			keyRows.map((row) => `+${row.mythic_level}`), keyRows.map((row) => row.runs), colours,
			'Mythic+ key level', 'Number of runs', 'Key-level distribution across all eight dungeons',
			(index) => colours.primary, (index) => `+${keyRows[index].mythic_level}: ${formatCount(keyRows[index].runs)} runs`,
		), 'Key-level distribution', ['Key level', 'Runs'], keyRows.map((row) => [`+${row.mythic_level}`, formatCount(row.runs)]), 'Horizontal axis: Mythic+ key level. Vertical axis: Number of runs')
		const classes = [...state.combined.class_representation.classes].sort((a, b) => b.appearances - a.appearances || a.class_id - b.class_id)
		renderChart('overview-class', horizontalOption(
			classes.map((row) => row.class_name), classes.map((row) => row.appearances), colours,
			'Roster appearances', 'Class', 'Class appearance distribution across all eight dungeons',
			(index) => classColour(classes[index].classId),
			(index) => `${classes[index].className}: ${formatCount(classes[index].appearances)} appearances (${formatPercent(classes[index].percentage)})`,
		), 'Class appearance distribution', ['Class', 'Appearances', 'Share'], classes.map((row) => [row.class_name, formatCount(row.appearances), formatPercent(row.percentage_of_roster_appearances)]), 'Horizontal axis: Roster appearances. Vertical axis: Class')
		setText('[data-hero-runs]', formatCount(cohort.runs))
		setText('[data-hero-dungeons]', String(state.combined.population.dungeons.length))
		setText('[data-footer-version]', `Validated schema ${state.index.schema_version} · dataset ${state.index.dataset_version}`)
		const completeness = state.combined.completeness as Record<string, number | string>
		const methodology = root.querySelector<HTMLElement>('[data-methodology]')
		if (methodology) {
			const paragraphs = [
				`Source: Raider.IO public Mythic+ leaderboard API, region EU, season ${state.combined.season_name}. This is collected top leaderboard data, not a census of every Mythic+ run.`,
				`Coverage: ${formatCount(cohort.runs)} distinct runs across ${state.combined.population.dungeons.length} dungeons. The provider API allowed pages 0–1000; page 1001 is rejected, so coverage is an API page ceiling rather than proven result-set exhaustion.`,
				`Denominators: ${formatCount(cohort.roster_appearances)} roster appearances; ${formatCount(cohort.eligible_complete_teams)} eligible complete five-player teams. ${formatCount(Number(completeness.incomplete_rosters ?? 0))} incomplete roster(s) are excluded only from complete-team analyses. ${formatCount(Number(completeness.missing_character_id_appearances ?? 0))} appearances lack character IDs because the provider returns 0 deep in the leaderboard; class, spec and role are still reported.`,
				'Reported specialisation is the leaderboard-reported value, not verified run-time specialisation. Appearance frequency is not class strength. Completion-time and timer-margin charts show run counts; precise timing remains MM:SS.mmm in tables and tooltips.',
				`Last refresh: ${formatDate(state.index.generated_at)}. Dataset: ${state.index.dataset_version}.`,
			]
			methodology.replaceChildren(...paragraphs.map((text) => element('p', '', text)))
		}
	}

	const renderClasses = () => {
		if (!state) return
		const rows = applyFilters('classes')
		updateFilterSummary('classes', rows)
		const colours = palette()
		const classResult = classRepresentation(rows, state.role)
		const specResult = specRepresentation(rows, state.role)
		if (!classResult.data.length) {
			emptyChart('class', 'Class appearances')
			emptyChart('spec', 'Reported specialisations')
		} else {
			const classes = [...classResult.data].sort((a, b) => b.appearances - a.appearances)
			renderChart('class', horizontalOption(
				classes.map((row) => row.class_name), classes.map((row) => row.appearances), colours,
				'Roster appearances', 'Class', `Class appearances for ${ROLE_LABELS[state.role]}`,
				(index) => classColour(classes[index].classId),
				(index) => `${classes[index].className}: ${formatCount(classes[index].appearances)} appearances (${formatPercent(classes[index].percentage)})`,
			), 'Class appearances', ['Class', 'Appearances', 'Share'], classes.map((row) => [row.class_name, formatCount(row.appearances), formatPercent(row.percentage_of_roster_appearances)]), 'Horizontal axis: Roster appearances. Vertical axis: Class')
			const specs = [...specResult.data].sort((a, b) => b.appearances - a.appearances).slice(0, 24)
			renderChart('spec', horizontalOption(
				specs.map((row) => `${row.spec_name} · ${row.class_name}`), specs.map((row) => row.appearances), colours,
				'Roster appearances', 'Reported specialisation', `Reported specialisation appearances for ${ROLE_LABELS[state.role]}`,
				(index) => classColour(specs[index].classId),
				(index) => `${specs[index].specName} ${specs[index].className}: ${formatCount(specs[index].appearances)} appearances (${formatPercent(specs[index].percentage)})`,
				190,
			), 'Reported specialisations', ['Reported specialisation', 'Class', 'Appearances'], specs.map((row) => [row.spec_name, row.class_name, formatCount(row.appearances)]), 'Horizontal axis: Roster appearances. Vertical axis: Reported specialisation')
		}
		setText('[data-class-summary]', `${formatCount(rows.length)} filtered runs · ${formatCount(classResult.denominator)} classified roster appearances · ${ROLE_LABELS[state.role]} view · specialisations are reported, not verified run-time truth.`)
	}

	const renderDungeons = () => {
		if (!state) return
		const rows = applyFilters('dungeons')
		updateFilterSummary('dungeons', rows)
		const name = state.dungeon === 'all' ? 'All Dungeons' : state.index.dungeons.find((entry) => entry.slug === state.dungeon)?.name ?? 'Dungeon'
		setText('[data-dungeon-title]', `${name} · ${formatCount(rows.length)} filtered runs`)
		populateDungeonCards()
		const colours = palette()
		const keyRows = [...new Set(rows.map((run) => run.mythic_level))].sort((a, b) => a - b).map((level) => ({ level, count: rows.filter((run) => run.mythic_level === level).length }))
		renderChart('dungeon-key', verticalOption(
			keyRows.map((row) => `+${row.level}`), keyRows.map((row) => row.count), colours,
			'Mythic+ key level', 'Number of runs', `Key-level distribution for ${name}`,
			(index) => colours.primary, (index) => `+${keyRows[index].level}: ${formatCount(keyRows[index].count)} runs`,
		), `Key-level distribution — ${name}`, ['Key level', 'Runs'], keyRows.map((row) => [`+${row.level}`, formatCount(row.count)]), 'Horizontal axis: Mythic+ key level. Vertical axis: Number of runs')
		const completion = completionHistogram(rows, 30)
		renderChart('dungeon-completion', verticalOption(
			completion.map((bin) => formatAxisTime(bin.min)), completion.map((bin) => bin.count), colours,
			'Completion time (MM:SS)', 'Number of runs', `Completion-time histogram for ${name}`,
			(index) => colours.primary, (index) => `${formatDuration(completion[index].min)}–${formatDuration(completion[index].max)}: ${formatCount(completion[index].count)} runs`, 35,
		), `Completion-time distribution — ${name}`, ['Completion time', 'Runs'], completion.map((bin) => [`${formatDuration(bin.min)}–${formatDuration(bin.max)}`, formatCount(bin.count)]), 'Horizontal axis: Completion time (MM:SS). Vertical axis: Number of runs')
		const margins = marginHistogram(rows, 30)
		renderChart('dungeon-margin', verticalOption(
			margins.map((bin) => formatMarginAxis(bin.min)), margins.map((bin) => bin.count), colours,
			'Timer margin (MM:SS)', 'Number of runs', `Timer-margin histogram for ${name}`,
			(index) => (margins[index].min >= 0 ? '#047857' : '#b91c1c'), (index) => `${formatMargin(margins[index].min)} to ${formatMargin(margins[index].max)}: ${formatCount(margins[index].count)} runs`, 35,
		), `Timer-margin distribution — ${name}`, ['Timer margin', 'Runs'], margins.map((bin) => [`${formatMargin(bin.min)} to ${formatMargin(bin.max)}`, formatCount(bin.count)]), 'Horizontal axis: Timer margin (MM:SS). Vertical axis: Number of runs')
	}

	const renderTeams = () => {
		if (!state) return
		const rows = applyFilters('teams')
		updateFilterSummary('teams', rows)
		const analysis = compositionAnalysis(rows)
		const container = root.querySelector<HTMLElement>('[data-composition-list]')
		if (!container) return
		const table = document.createElement('table')
		table.className = 'w-full min-w-[44rem] border-collapse text-left text-sm'
		table.append(element('caption', 'sr-only', 'Ranked five-specialisation team compositions'))
		const thead = document.createElement('thead')
		thead.className = 'border-b border-border bg-muted/40 text-[11px] tracking-widest text-muted-foreground uppercase'
		const head = document.createElement('tr')
		for (const value of ['#', 'Composition', 'Teams', 'Share', 'Roles']) {
			const th = element('th', 'px-3 py-3 font-semibold', value)
			th.scope = 'col'; head.append(th)
		}
		thead.append(head)
		const tbody = document.createElement('tbody')
		analysis.compositions.slice(0, 50).forEach((row, index) => {
			const tr = document.createElement('tr')
			tr.className = 'border-b border-border/40 hover:bg-muted/20'
			tr.append(element('td', 'px-3 py-2.5 font-mono text-xs text-muted-foreground', String(index + 1)))
			const composition = document.createElement('td')
			composition.className = 'px-3 py-2.5'
			const chips = element('div', 'flex flex-wrap gap-1')
			row.labels.forEach((label, labelIndex) => {
				const classMatch = label.replace(row.specNames[labelIndex], '').trim()
				const classId = [...state!.datasets.values()].flatMap((data) => data.dataset.references.classes).find((entry) => entry.name === classMatch)?.id ?? 99
				chips.append(chip(label, classId))
			})
			composition.append(chips)
			tr.append(composition, element('td', 'px-3 py-2.5 tabular-nums', formatCount(row.occurrences)), element('td', 'px-3 py-2.5 tabular-nums', formatPercent(row.percentage)), element('td', 'px-3 py-2.5 text-xs text-muted-foreground', row.roles.map((role) => role.toUpperCase()).join(' · ')))
			tbody.append(tr)
		})
		table.append(thead, tbody)
		container.replaceChildren(table)
		if (!analysis.compositions.length) container.append(element('p', 'p-6 text-sm text-muted-foreground', 'No eligible complete five-player teams match these filters.'))
		container.insertAdjacentHTML('beforeend', `<p class="border-t border-border/50 p-3 text-xs text-muted-foreground">${formatCount(analysis.eligibleTeams)} eligible complete teams · ${formatCount(analysis.excludedMissing)} excluded for missing spec/role · top 50 shown. Frequency is not a strength claim.</p>`)
	}

	const renderRuns = () => {
		if (!state) return
		let rows = applyFilters('runs')
		rows = sortRuns(rows, state.sortKey, state.sortDirection)
		updateFilterSummary('runs', rows)
		setText('[data-result-count]', `${formatCount(rows.length)} matching runs`)
		const totalPages = Math.max(1, Math.ceil(rows.length / state.pageSize))
		if (state.page >= totalPages) state.page = totalPages - 1
		const start = state.page * state.pageSize
		const page = rows.slice(start, start + state.pageSize)
		const body = root.querySelector<HTMLElement>('[data-runs-body]')
		if (!body) return
		body.replaceChildren()
		for (const run of page) {
			const tr = document.createElement('tr')
			tr.className = 'border-b border-border/40 align-top hover:bg-muted/20'
			const rank = document.createElement('th')
			rank.scope = 'row'; rank.className = 'px-3 py-2.5 font-mono text-xs'
			rank.append(element('span', 'text-muted-foreground', `#${formatCount(run.source_rank)}`), document.createElement('br'), element('span', 'text-[10px] text-muted-foreground', run.run_id))
			const key = element('td', 'px-3 py-2.5 font-mono text-xs font-semibold', `+${run.mythic_level}`)
			const dungeon = element('td', 'px-3 py-2.5 text-xs text-muted-foreground', run.dungeon.name)
			const clear = element('td', 'px-3 py-2.5 font-mono text-xs text-foreground', formatDuration(run.clear_time_seconds))
			const margin = element('td', `px-3 py-2.5 font-mono text-xs ${run.timer_margin_seconds !== null && run.timer_margin_seconds < 0 ? 'wow-negative' : 'wow-positive'}`, formatMargin(run.timer_margin_seconds))
			const score = element('td', 'px-3 py-2.5 font-mono text-xs', run.source_score == null ? '—' : run.source_score.toFixed(1))
			const composition = element('td', 'px-3 py-2.5')
			const chips = element('div', 'flex flex-wrap gap-1')
			for (const member of run.roster) chips.append(chip(member.spec_name ?? 'Unknown', member.class_id ?? 99))
			composition.append(chips)
			const source = document.createElement('td'); source.className = 'px-3 py-2.5'
			const link = document.createElement('a'); link.href = run.source_url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.className = 'text-xs font-semibold text-primary underline underline-offset-4'; link.textContent = 'Raider.IO'
			source.append(link)
			tr.append(rank, key, dungeon, clear, margin, score, composition, source)
			body.append(tr)
		}
		const empty = root.querySelector<HTMLElement>('[data-runs-empty]')
		if (empty) empty.hidden = rows.length > 0
		setText('[data-page-status]', rows.length ? `Showing runs ${formatCount(start + 1)}–${formatCount(Math.min(start + state.pageSize, rows.length))} of ${formatCount(rows.length)}` : 'No matching runs')
		const prev = root.querySelector<HTMLButtonElement>('[data-page-prev]')
		const next = root.querySelector<HTMLButtonElement>('[data-page-next]')
		if (prev) prev.disabled = state.page <= 0
		if (next) next.disabled = state.page >= totalPages - 1
		root.querySelectorAll<HTMLElement>('[data-sort]').forEach((button) => {
			const th = button.closest('th')
			th?.setAttribute('aria-sort', button.dataset.sort === state?.sortKey ? (state.sortDirection === 'asc' ? 'ascending' : 'descending') : 'none')
		})
	}

	const renderActive = () => {
		if (!state) return
		if (state.tab === 'overview') renderOverview()
		if (state.tab === 'classes') renderClasses()
		if (state.tab === 'dungeons') renderDungeons()
		if (state.tab === 'teams') renderTeams()
		if (state.tab === 'runs') renderRuns()
	}

	const fail = (error: unknown) => {
		loading.hidden = true
		errorPanel.hidden = false
		message(error)
		setStatus('Dashboard data could not be loaded')
	}
	const message = (error: unknown) => { errorMessage.textContent = error instanceof Error ? error.message : String(error) }

	const bind = () => {
		tabs.forEach((button) => button.addEventListener('click', () => setTab(button.dataset.tab as Tab), { signal }))
		document.querySelector('[role="tablist"]')?.addEventListener('keydown', ((event: KeyboardEvent) => {
			const current = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true')
			let next = current
			if (event.key === 'ArrowRight') next = (current + 1) % tabs.length
			else if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length
			else if (event.key === 'Home') next = 0
			else if (event.key === 'End') next = tabs.length - 1
			else return
			event.preventDefault(); tabs[next].focus(); setTab(tabs[next].dataset.tab as Tab)
		}) as EventListener, { signal })
		window.addEventListener('hashchange', () => {
			const tab = location.hash.slice(1) as Tab
			if (TABS.includes(tab) && tab !== state?.tab) setTab(tab, false)
		}, { signal })
		root.querySelectorAll<HTMLElement>('[data-goto-tab]').forEach((button) => button.addEventListener('click', () => setTab(button.dataset.gotoTab as Tab), { signal }))
		root.querySelector<HTMLSelectElement>('[data-filter-dungeon]')?.addEventListener('change', (event) => {
			if (!state) return
			state.dungeon = (event.target as HTMLSelectElement).value
			state.keyLevel = 'all'; state.page = 0
			if (state.tab === 'dungeons') populateDungeonCards()
			void activateTab(state.tab)
		}, { signal })
		root.querySelector<HTMLSelectElement>('[data-filter-key]')?.addEventListener('change', (event) => {
			if (!state) return
			state.keyLevel = (event.target as HTMLSelectElement).value; state.page = 0; void activateTab(state.tab)
		}, { signal })
		root.querySelector<HTMLSelectElement>('[data-filter-class]')?.addEventListener('change', (event) => {
			if (!state) return
			state.classId = (event.target as HTMLSelectElement).value; state.specId = 'all'; state.page = 0; populateFilters(); void activateTab(state.tab)
		}, { signal })
		root.querySelector<HTMLSelectElement>('[data-filter-spec]')?.addEventListener('change', (event) => {
			if (!state) return
			state.specId = (event.target as HTMLSelectElement).value; state.page = 0; void activateTab(state.tab)
		}, { signal })
		root.querySelectorAll<HTMLButtonElement>('[data-role]').forEach((button) => button.addEventListener('click', () => {
			if (!state) return
			state.role = button.dataset.role as RoleView; state.page = 0
			root.querySelectorAll<HTMLButtonElement>('[data-role]').forEach((item) => {
				const active = item === button
				item.setAttribute('aria-pressed', String(active))
				item.className = active ? 'rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary' : 'rounded-full border border-border bg-muted/30 px-3 py-1.5 text-xs font-semibold text-muted-foreground'
			})
			void activateTab(state.tab)
		}, { signal }))
		const search = root.querySelector<HTMLInputElement>('[data-filter-search]')
		search?.addEventListener('input', () => {
			if (!state) return
			state.search = search.value; state.page = 0
			clearTimeout(searchTimer)
			searchTimer = setTimeout(() => { if (state?.tab === 'runs') renderRuns() }, 180)
		}, { signal })
		root.querySelector<HTMLButtonElement>('[data-reset]')?.addEventListener('click', () => {
			if (!state) return
			state.dungeon = 'all'; state.keyLevel = 'all'; state.classId = 'all'; state.specId = 'all'; state.role = 'all'; state.search = ''; state.page = 0; state.sortKey = 'rank'; state.sortDirection = 'asc'
			const searchInput = root.querySelector<HTMLInputElement>('[data-filter-search]'); if (searchInput) searchInput.value = ''
			root.querySelectorAll<HTMLButtonElement>('[data-role]').forEach((item) => {
				const active = item.dataset.role === 'all'; item.setAttribute('aria-pressed', String(active))
				item.className = active ? 'rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary' : 'rounded-full border border-border bg-muted/30 px-3 py-1.5 text-xs font-semibold text-muted-foreground'
			})
			populateFilters(); void activateTab(state.tab)
		}, { signal })
		root.querySelectorAll<HTMLElement>('[data-sort]').forEach((button) => button.addEventListener('click', () => {
			if (!state) return
			const key = button.dataset.sort as SortKey
			if (state.sortKey === key) state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc'
			else { state.sortKey = key; state.sortDirection = key === 'rank' ? 'asc' : 'desc' }
			state.page = 0; renderRuns()
		}, { signal }))
		root.querySelector<HTMLSelectElement>('[data-page-size]')?.addEventListener('change', (event) => {
			if (!state) return
			state.pageSize = Number((event.target as HTMLSelectElement).value) || DEFAULT_PAGE_SIZE; state.page = 0; renderRuns()
		}, { signal })
		root.querySelector<HTMLButtonElement>('[data-page-prev]')?.addEventListener('click', () => { if (!state) return; state.page = Math.max(0, state.page - 1); renderRuns() }, { signal })
		root.querySelector<HTMLButtonElement>('[data-page-next]')?.addEventListener('click', () => { if (!state) return; state.page += 1; renderRuns() }, { signal })
	}

	const init = async () => {
		try {
			setStatus('Loading dataset index')
			const index = await loadIndex()
			setStatus('Loading overview aggregates')
			const combined = await loadCombined(index)
			state = { index, combined, datasets: new Map(), tab: pendingTab, dungeon: 'all', keyLevel: 'all', classId: 'all', specId: 'all', role: 'all', search: '', sortKey: 'rank', sortDirection: 'asc', page: 0, pageSize: DEFAULT_PAGE_SIZE }
			loading.hidden = true
			root.hidden = false
			populateFilters()
			renderOverview()
			const initial = TABS.includes(location.hash.slice(1) as Tab) ? location.hash.slice(1) as Tab : 'overview'
			setTab(initial, false)
		} catch (error) {
			fail(error)
		}
	}

	bind()
	retry?.addEventListener('click', () => window.location.reload(), { signal })
	const themeObserver = new MutationObserver(() => {
		clearTimeout(themeTimer)
		themeTimer = setTimeout(() => { if (state) renderActive() }, 120)
	})
	themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
	activeCleanup = () => {
		controller.abort()
		resizeObserver.disconnect()
		themeObserver.disconnect()
		for (const chart of charts.values()) chart.dispose()
		charts.clear()
	}
	void init()
	return activeCleanup
}
