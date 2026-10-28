#!/usr/bin/env node
/** Local browser, mobile, performance and accessibility checks for dashboard v2. */
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const chrome =
	process.env.CHROME_PATH ||
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const port = Number(process.env.WOW_TEST_PORT || 4329)
const base = `http://127.0.0.1:${port}`
const url = `${base}/projects/wow-mythic-plus/`
const screenshotDir = path.resolve(root, 'screenshots-source/wow-mythic-plus')
const require = createRequire(import.meta.url)
const axePath = require.resolve('axe-core/axe.min.js')
const index = JSON.parse(
	await readFile(
		path.join(root, 'public/data/wow-mythic-plus/manifest.json'),
		'utf8'
	)
)
const totalRuns = index.dungeons.reduce(
	(sum, entry) => sum + entry.run_count,
	0
)
const firstDungeon = index.dungeons[0]

async function waitForServer() {
	for (let attempt = 0; attempt < 90; attempt += 1) {
		try {
			const response = await fetch(url)
			if (response.ok) return
		} catch {}
		await new Promise((resolve) => setTimeout(resolve, 500))
	}
	throw new Error('Astro preview server did not become ready')
}

const server = spawn(
	process.execPath,
	[
		path.join(root, 'node_modules/astro/bin/astro.mjs'),
		'preview',
		'--host',
		'127.0.0.1',
		'--port',
		String(port),
	],
	{ cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }
)
let serverOutput = ''
server.stdout.on('data', (chunk) => (serverOutput += chunk))
server.stderr.on('data', (chunk) => (serverOutput += chunk))

let browser
try {
	await waitForServer()
	await mkdir(screenshotDir, { recursive: true })
	browser = await puppeteer.launch({
		executablePath: chrome,
		headless: true,
		args: ['--no-sandbox', '--disable-gpu'],
	})
	const page = await browser.newPage()
	const consoleErrors = []
	page.on('console', (message) => {
		if (message.type() === 'error') consoleErrors.push(message.text())
	})
	page.on('pageerror', (error) =>
		consoleErrors.push(`pageerror: ${error.message}`)
	)
	await page.setViewport({ width: 1600, height: 1100, deviceScaleFactor: 1 })
	const started = Date.now()
	await page.goto(url, { waitUntil: 'networkidle0' })
	await page.waitForSelector('[data-wow-dashboard]:not([hidden])', {
		timeout: 90000,
	})
	await page.waitForFunction(
		() => document.querySelectorAll('[data-runs-body] tr').length === 10
	)
	const loadMs = Date.now() - started

	assert.equal(
		await page.$eval('[data-kpi="runs"]', (el) => el.textContent),
		new Intl.NumberFormat('en-GB').format(totalRuns)
	)
	assert.equal(
		await page.$$eval('[data-chart] canvas', (nodes) => nodes.length),
		6
	)
	assert.equal(
		await page.$$eval('[data-chart-table] table', (nodes) => nodes.length),
		6
	)
	assert.equal(await page.$$eval('aside', (nodes) => nodes.length), 0)
	assert.equal(
		await page.$eval(
			'[data-chart="compositions"]',
			(el) => getComputedStyle(el).overflow
		),
		'hidden'
	)
	assert.equal(await page.$eval('[data-page-size]', (el) => el.value), '10')
	assert.ok(
		(await page.$eval('article', (el) => el.getBoundingClientRect().width)) <=
			1400
	)
	assert.ok(
		await page.$eval('a[href="/projects/"]', (el) =>
			el.textContent?.includes('Back to Projects')
		)
	)
	await page.select('[data-page-size]', '25')
	await page.waitForFunction(
		() => document.querySelectorAll('[data-runs-body] tr').length === 25
	)
	await page.select('[data-page-size]', '10')
	await page.waitForFunction(
		() => document.querySelectorAll('[data-runs-body] tr').length === 10
	)
	assert.equal(
		await page.$$eval(
			"[data-runs-body] a[target='_blank']",
			(nodes) => nodes.length
		),
		10
	)
	assert.ok(
		await page.$$eval('[data-runs-body] a', (nodes) =>
			nodes.every((node) => (node.href || '').startsWith('https://raider.io/'))
		)
	)
	assert.equal(
		await page.$$eval('[data-filter-dungeon] option', (nodes) => nodes.length),
		index.dungeons.length + 1
	)
	assert.ok(
		await page.$$eval(
			"[data-runs-body] th[scope='row']",
			(nodes) => nodes.length === 10
		)
	)
	assert.ok(
		await page.$$eval(
			'[data-composition-list] tbody tr',
			(nodes) => nodes.length > 0
		)
	)
	const times = await page.$$eval(
		'[data-runs-body] tr td:nth-child(4)',
		(cells) => cells.map((cell) => cell.textContent?.trim())
	)
	assert.ok(
		times.every(
			(value) => value === '—' || /^\d{2,}:\d{2}\.\d{3}$/.test(value ?? '')
		)
	)
	const classChips = await page.$$eval(
		"[data-runs-body] span[style*='background-color']",
		(nodes) => nodes.length
	)
	assert.ok(classChips > 0, 'class-coloured roster chips should render')

	const accessibility = await page.evaluate(() => {
		const inputs = [
			...document.querySelectorAll(
				'[data-wow-dashboard] input, [data-wow-dashboard] select'
			),
		]
		const labelled = inputs.every(
			(input) =>
				(input.labels?.length ?? 0) > 0 || input.getAttribute('aria-label')
		)
		const charts = [...document.querySelectorAll('[data-chart]')]
		const chartLabels = charts.every(
			(chart) => !!chart.getAttribute('aria-label')
		)
		const ids = [
			...document.querySelectorAll(
				'[data-wow-dashboard] [id], #filter-key, #filter-class, #filter-spec, #filter-search, #filter-dungeon'
			),
		].map((node) => node.id)
		const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
		return {
			labelled,
			chartLabels,
			duplicates,
			headings: [
				...document.querySelectorAll('article h1, article h2, article h3'),
			].map((node) => node.tagName),
			rankSort: document
				.querySelector('th[aria-sort]')
				?.getAttribute('aria-sort'),
			tableRegion: document
				.querySelector(".overflow-x-auto[role='region']")
				?.getAttribute('tabindex'),
			smallTargets: [
				...document.querySelectorAll('[data-wow-dashboard] button'),
			]
				.map((node) => node.getBoundingClientRect())
				.filter(
					(rect) => rect.width > 0 && (rect.width < 24 || rect.height < 24)
				).length,
		}
	})
	assert.equal(accessibility.labelled, true)
	assert.equal(accessibility.chartLabels, true)
	assert.deepEqual(accessibility.duplicates, [])
	assert.equal(accessibility.rankSort, 'ascending')
	assert.equal(accessibility.tableRegion, '0')
	assert.equal(accessibility.smallTargets, 0)
	assert.deepEqual(
		accessibility.headings.filter((tag) => tag === 'H1'),
		['H1']
	)
	assert.ok(
		accessibility.headings.indexOf('H1') < accessibility.headings.indexOf('H2')
	)

	await page.addScriptTag({ path: axePath })
	const lightAxe = await page.evaluate(async () => {
		const article = document.querySelector('article')
		return article
			? await window.axe.run(article, {
					runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
				})
			: { violations: [] }
	})
	if (lightAxe.violations.length)
		console.error(
			lightAxe.violations.map((v) => `${v.id}: ${v.description}`).join('\n')
		)
	assert.equal(lightAxe.violations.length, 0)

	await page.screenshot({
		path: path.join(screenshotDir, 'dashboard-desktop.png'),
		fullPage: true,
	})
	await page.addStyleTag({
		content: 'main { height: auto !important; overflow: visible !important; }',
	})
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(resolve))
			)
	)
	await page.screenshot({
		path: path.join(screenshotDir, 'dashboard-desktop-full.png'),
		fullPage: true,
	})

	await page.select('[data-filter-dungeon]', firstDungeon.slug)
	await page.waitForFunction(
		(expected) =>
			document.querySelector('[data-kpi="runs"]')?.textContent === expected,
		{},
		new Intl.NumberFormat('en-GB').format(firstDungeon.run_count)
	)
	assert.equal(
		await page.$$eval('[data-runs-body] tr', (nodes) => nodes.length),
		10
	)
	await page.select(
		'[data-filter-key]',
		await page.$$eval(
			'[data-filter-key] option',
			(options) => options.find((option) => option.value !== 'all')?.value
		)
	)
	await page.waitForFunction(
		(expected) =>
			Number(
				document
					.querySelector('[data-kpi="runs"]')
					?.textContent?.replace(/,/g, '')
			) < expected,
		{},
		firstDungeon.run_count
	)
	await page.click('[data-reset]')
	await page.waitForFunction(
		(expected) =>
			Number(
				document
					.querySelector('[data-kpi="runs"]')
					?.textContent?.replace(/,/g, '')
			) === expected,
		{},
		firstDungeon.run_count
	)
	await page.select('[data-filter-dungeon]', 'all')
	await page.waitForFunction(
		(expected) =>
			Number(
				document
					.querySelector('[data-kpi="runs"]')
					?.textContent?.replace(/,/g, '')
			) === expected,
		{},
		totalRuns
	)

	const firstRunId = await page.$eval(
		'[data-runs-body] tr th span:nth-child(2)',
		(el) => el.textContent?.trim() ?? ''
	)
	await page.type('[data-filter-search]', firstRunId)
	await page.waitForFunction(
		() => document.querySelectorAll('[data-runs-body] tr').length === 1
	)
	await page.click('[data-reset]')
	await page.waitForFunction(
		() => document.querySelectorAll('[data-runs-body] tr').length === 10
	)

	await page.click("[data-sort='clear']")
	await page.waitForFunction(
		() =>
			document
				.querySelector("[data-sort='clear']")
				?.closest('th')
				?.getAttribute('aria-sort') !== 'none'
	)
	await page.focus("[data-sort='clear']")
	await page.keyboard.press('Enter')
	assert.equal(
		await page.$eval("[data-sort='clear']", (button) =>
			button.closest('th')?.getAttribute('aria-sort')
		),
		'ascending'
	)
	await page.click('[data-page-next]')
	await page.waitForFunction(() =>
		document
			.querySelector('[data-page-status]')
			?.textContent?.startsWith('Showing runs 11')
	)
	await page.click('[data-page-prev]')

	await page.click("[data-role='healer']")
	assert.equal(
		await page.$eval("[data-role='healer']", (el) =>
			el.getAttribute('aria-pressed')
		),
		'true'
	)
	await page.click('[data-reset]')

	await page.click('#theme-toggle')
	await page.waitForFunction(() =>
		document.documentElement.classList.contains('dark')
	)
	await new Promise((resolve) => setTimeout(resolve, 200))
	const darkAxe = await page.evaluate(async () => {
		const article = document.querySelector('article')
		return article
			? await window.axe.run(article, {
					runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
				})
			: { violations: [] }
	})
	if (darkAxe.violations.length)
		console.error(
			darkAxe.violations
				.map(
					(v) =>
						`${v.id}: ${v.description} :: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`
				)
				.join('\n')
		)
	assert.equal(darkAxe.violations.length, 0)
	await page.screenshot({
		path: path.join(screenshotDir, 'dashboard-dark.png'),
		fullPage: true,
	})
	await page.click('#theme-toggle')

	await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 })
	await page.reload({ waitUntil: 'networkidle0' })
	await page.waitForSelector('[data-wow-dashboard]:not([hidden])', {
		timeout: 90000,
	})
	await page.waitForFunction(
		() => document.querySelectorAll('[data-runs-body] tr').length === 10
	)
	assert.equal(
		await page.evaluate(
			() => document.documentElement.scrollWidth > window.innerWidth + 1
		),
		false
	)
	const mobileCharts = await page.$$eval('[data-chart] canvas', (nodes) =>
		nodes.map((node) => node.clientWidth)
	)
	assert.ok(mobileCharts.every((width) => width > 200))
	await page.addScriptTag({ path: axePath })
	const mobileAxe = await page.evaluate(async () => {
		const article = document.querySelector('article')
		return article
			? await window.axe.run(article, {
					runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
				})
			: { violations: [] }
	})
	if (mobileAxe.violations.length)
		console.error(
			mobileAxe.violations
				.map(
					(v) =>
						`${v.id}: ${v.description} :: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`
				)
				.join('\n')
		)
	assert.equal(mobileAxe.violations.length, 0)
	await page.screenshot({
		path: path.join(screenshotDir, 'dashboard-mobile.png'),
		fullPage: true,
	})

	const stalePage = await browser.newPage()
	await stalePage.setRequestInterception(true)
	stalePage.on('request', (request) => {
		if (request.url().endsWith('/data/wow-mythic-plus/manifest.json')) {
			request.respond({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					...index,
					generated_at: new Date(Date.now() - 30 * 86400000).toISOString(),
				}),
			})
		} else request.continue()
	})
	await stalePage.goto(url, { waitUntil: 'networkidle0' })
	await stalePage.waitForSelector('[data-dataset-stale]:not([hidden])', {
		timeout: 90000,
	})

	const errorPage = await browser.newPage()
	let intercept = true
	await errorPage.setRequestInterception(true)
	errorPage.on('request', (request) => {
		if (!intercept) {
			request.continue()
			return
		}
		if (request.url().endsWith('/data/wow-mythic-plus/manifest.json'))
			request.respond({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ ...index, schema_version: '1.1.0' }),
			})
		else request.continue()
	})
	await errorPage.goto(url, { waitUntil: 'networkidle0' })
	await errorPage.waitForSelector('[data-dashboard-error]:not([hidden])', {
		timeout: 90000,
	})
	assert.match(
		await errorPage.$eval('[data-error-message]', (el) => el.textContent),
		/schema 2/
	)
	intercept = false
	errorPage.removeAllListeners('request')
	await errorPage.setRequestInterception(false)
	await errorPage.setCacheEnabled(false)
	await errorPage.click('[data-retry]')
	await errorPage.waitForSelector('[data-wow-dashboard]:not([hidden])', {
		timeout: 90000,
	})
	await errorPage.waitForFunction(
		() => document.querySelectorAll('[data-runs-body] tr').length === 10
	)

	const otherPage = await browser.newPage()
	await otherPage.goto(`${base}/projects/`, { waitUntil: 'networkidle0' })
	assert.ok(
		await otherPage.$$eval('aside', (nodes) => nodes.length > 0),
		'other pages must retain the sidebar'
	)
	await otherPage.close()

	const dataBytes = index.dungeons.reduce(
		(sum, entry) => sum + entry.size_bytes,
		0
	)
	const nav = await page.evaluate(() => {
		const entry = performance.getEntriesByType('navigation')[0]
		return entry
			? {
					domContentLoaded: entry.domContentLoadedEventEnd,
					load: entry.loadEventEnd,
				}
			: null
	})
	assert.deepEqual(consoleErrors, [])
	console.log(
		`Browser checks passed: ${index.dungeons.length} dungeons, ${totalRuns.toLocaleString('en-GB')} runs, six charts, filters, pagination, dark/light/mobile axe, stale/error/retry.`
	)
	console.log(
		`Initial dashboard readiness: ${loadMs} ms; dataset JSON: ${(dataBytes / 1048576).toFixed(1)} MiB; navigation: ${JSON.stringify(nav)}`
	)
	console.log(`Screenshots: ${screenshotDir}`)
} catch (error) {
	console.error(error)
	if (serverOutput) console.error(`--- preview output ---\n${serverOutput}`)
	process.exitCode = 1
} finally {
	await browser?.close()
	server.kill('SIGTERM')
}
