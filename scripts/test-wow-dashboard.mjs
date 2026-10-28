#!/usr/bin/env node
/** Browser, lazy-loading, tab, mobile and accessibility checks for the tabbed dashboard. */
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
const shots = path.resolve(root, 'screenshots-source/wow-mythic-plus')
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

async function waitForServer() {
	for (let attempt = 0; attempt < 90; attempt += 1) {
		try {
			if ((await fetch(url)).ok) return
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
	await mkdir(shots, { recursive: true })
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
		(expected) =>
			document.querySelector('[data-overview-kpi="runs"]')?.textContent ===
			expected,
		{},
		new Intl.NumberFormat('en-GB').format(totalRuns)
	)
	const initialMs = Date.now() - started

	assert.equal(await page.$$eval('[role="tab"]', (nodes) => nodes.length), 5)
	assert.equal(
		await page.$eval('#tab-overview', (node) =>
			node.getAttribute('aria-selected')
		),
		'true'
	)
	assert.equal(
		await page.$$eval('[data-chart] canvas', (nodes) => nodes.length),
		2
	)
	assert.equal(
		await page.$$eval(
			'[role="tabpanel"]',
			(nodes) => nodes.filter((node) => !node.hidden).length
		),
		1
	)
	assert.ok(
		await page.$eval(
			'#tab-overview',
			(node) => node.getAttribute('aria-controls') === 'panel-overview'
		)
	)
	assert.match(
		await page.$eval(
			'[data-chart="overview-key"]',
			(node) => node.getAttribute('aria-label') ?? ''
		),
		/Horizontal axis: Mythic\+ key level\. Vertical axis: Number of runs/
	)
	assert.match(
		await page.$eval(
			'[data-chart="overview-class"]',
			(node) => node.getAttribute('aria-label') ?? ''
		),
		/Horizontal axis: Roster appearances\. Vertical axis: Class/
	)
	assert.equal(
		await page.$eval(
			'[data-chart="overview-key"]',
			(node) => getComputedStyle(node).overflow
		),
		'hidden'
	)
	assert.equal(await page.$$eval('aside', (nodes) => nodes.length), 0)
	assert.ok(
		(await page.$eval(
			'article',
			(node) => node.getBoundingClientRect().width
		)) <= 1400
	)
	assert.ok(
		await page.$eval('a[href="/projects/"]', (node) =>
			node.textContent?.includes('Back to Projects')
		)
	)
	assert.ok(
		await page.$eval(
			'img[src="/images/wow-mythic-plus/hero.svg"]',
			(node) => node.complete && node.naturalWidth > 0
		)
	)
	assert.equal(
		await page.$eval('[data-filter-bar]', (node) => node.hidden),
		true
	)
	assert.ok(
		(
			await page.$eval('[data-methodology]', (node) => node.textContent)
		).includes('pages 0–1000')
	)
	assert.ok(
		!(
			await page.$eval(
				'[data-footer-version]',
				(node) => node.textContent ?? ''
			)
		).includes('undefined')
	)
	const resources = await page.evaluate(() =>
		performance.getEntriesByType('resource').map((entry) => entry.name)
	)
	assert.equal(
		resources.some((name) => name.includes('altar-of-fangs.json')),
		false,
		'overview must not load dungeon run files'
	)
	const dataBytes = await page.evaluate(() =>
		performance
			.getEntriesByType('resource')
			.filter((entry) => entry.name.includes('/data/wow-mythic-plus/'))
			.reduce((sum, entry) => sum + (entry.transferSize || 0), 0)
	)
	assert.ok(
		dataBytes < 500_000,
		`overview data should stay small, got ${dataBytes}`
	)
	assert.equal(
		await page.$$eval('[data-chart-table] table', (nodes) => nodes.length),
		2
	)
	await page.screenshot({
		path: path.join(shots, 'tab-overview-light.png'),
		fullPage: true,
	})
	await page.addStyleTag({
		content: 'main { height: auto !important; overflow: visible !important; }',
	})
	await page.screenshot({
		path: path.join(shots, 'tab-overview-light-full.png'),
		fullPage: true,
	})

	await page.addScriptTag({ path: axePath })
	const axe = async (label) => {
		const result = await page.evaluate(async () => {
			const article = document.querySelector('article')
			return article
				? await window.axe.run(article, {
						runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
					})
				: { violations: [] }
		})
		if (result.violations.length)
			console.error(
				`${label}: ${result.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`).join(' ; ')}`
			)
		assert.equal(
			result.violations.length,
			0,
			`${label} accessibility violations`
		)
	}
	await axe('overview light')

	await page.focus('#tab-overview')
	await page.keyboard.press('ArrowRight')
	await page.waitForFunction(
		() =>
			document.querySelector('#tab-classes')?.getAttribute('aria-selected') ===
			'true'
	)
	await page.waitForFunction(
		() => document.querySelector('[data-chart="spec"] canvas'),
		{ timeout: 120000 }
	)
	assert.match(
		await page.$eval(
			'[data-chart="class"]',
			(node) => node.getAttribute('aria-label') ?? ''
		),
		/Horizontal axis: Roster appearances\. Vertical axis: Class/
	)
	assert.match(
		await page.$eval(
			'[data-chart="spec"]',
			(node) => node.getAttribute('aria-label') ?? ''
		),
		/Horizontal axis: Roster appearances\. Vertical axis: Reported specialisation/
	)
	assert.equal(
		await page.$eval('[data-filter-bar]', (node) => node.hidden),
		false
	)
	assert.ok(
		await page.$$eval('[data-filter-class] option', (nodes) => nodes.length > 1)
	)
	await page.screenshot({
		path: path.join(shots, 'tab-classes-light.png'),
		fullPage: true,
	})
	await axe('classes light')

	const classValue = await page.$$eval(
		'[data-filter-class] option',
		(options) =>
			options.find((option) => option.textContent === 'Paladin')?.value
	)
	await page.select('[data-filter-class]', classValue)
	await page.waitForFunction(
		() =>
			Number(
				document
					.querySelector('[data-filter-summary]')
					?.textContent?.match(/Showing ([\d,]+)/)?.[1]
					?.replace(/,/g, '')
			) < 160108
	)
	await page.click('[data-reset]')
	await page.waitForFunction(
		() =>
			Number(
				document
					.querySelector('[data-filter-summary]')
					?.textContent?.match(/Showing ([\d,]+)/)?.[1]
					?.replace(/,/g, '')
			) === 160108
	)

	await page.click('#tab-runs')
	await page.waitForFunction(
		() => document.querySelectorAll('[data-runs-body] tr').length === 10
	)
	assert.match(
		await page.$eval('[data-page-status]', (node) => node.textContent),
		/Showing runs 1–10 of 160,108/
	)
	assert.equal(
		await page.$$eval(
			'[data-runs-body] a[target="_blank"]',
			(nodes) => nodes.length
		),
		10
	)
	assert.ok(
		await page.$$eval('[data-runs-body] td:nth-child(4)', (cells) =>
			cells.every((cell) =>
				/^\d{2,}:\d{2}\.\d{3}$/.test(cell.textContent ?? '')
			)
		)
	)
	assert.equal(await page.$eval('[data-page-size]', (node) => node.value), '10')
	await page.select('[data-page-size]', '25')
	await page.waitForFunction(
		() => document.querySelectorAll('[data-runs-body] tr').length === 25
	)
	await page.select('[data-page-size]', '10')
	await page.waitForFunction(
		() => document.querySelectorAll('[data-runs-body] tr').length === 10
	)
	const firstRun = await page.$eval(
		'[data-runs-body] th span:last-child',
		(node) => node.textContent?.trim() ?? ''
	)
	await page.type('[data-filter-search]', firstRun)
	await page.waitForFunction(
		() => document.querySelectorAll('[data-runs-body] tr').length === 1
	)
	await page.click('[data-reset]')
	await page.waitForFunction(
		() => document.querySelectorAll('[data-runs-body] tr').length === 10
	)
	await page.select('[data-filter-dungeon]', 'den-of-nalorakk')
	await page.waitForFunction(() =>
		document
			.querySelector('[data-filter-summary]')
			?.textContent?.includes('Den of Nalorakk')
	)
	const denCount = index.dungeons.find(
		(entry) => entry.slug === 'den-of-nalorakk'
	).run_count
	await page.waitForFunction(
		(expected) =>
			document.querySelector('[data-result-count]')?.textContent === expected,
		{},
		`${new Intl.NumberFormat('en-GB').format(denCount)} matching runs`
	)
	await page.click('#tab-classes')
	await page.waitForFunction(
		() =>
			document.querySelector('[data-filter-dungeon]')?.value ===
			'den-of-nalorakk'
	)
	await page.click('#tab-runs')
	await page.waitForFunction(
		() => document.querySelectorAll('[data-runs-body] tr').length === 10
	)
	await page.screenshot({
		path: path.join(shots, 'tab-runs-light.png'),
		fullPage: true,
	})
	await axe('runs light')

	await page.click('#tab-teams')
	await page.waitForFunction(
		() =>
			document.querySelectorAll('[data-composition-list] tbody tr').length > 0
	)
	assert.ok(
		await page
			.$eval('[data-composition-list]', (node) => node.textContent ?? '')
			.then((text) => text.includes('eligible complete teams'))
	)
	await page.screenshot({
		path: path.join(shots, 'tab-teams-light.png'),
		fullPage: true,
	})
	await axe('teams light')

	await page.click('#tab-dungeons')
	await page.waitForFunction(
		() => document.querySelectorAll('[data-dungeon-card]').length === 9
	)
	const cardImages = await page.$$eval('[data-dungeon-card] img', (nodes) =>
		nodes.map((node) => node.complete && node.naturalWidth > 0)
	)
	assert.ok(cardImages.every(Boolean), 'all dungeon card images should load')
	await page.click('[data-dungeon-card="den-of-nalorakk"]')
	await page.waitForFunction(() =>
		document
			.querySelector('[data-dungeon-title]')
			?.textContent?.includes('Den of Nalorakk')
	)
	await page.waitForFunction(
		() =>
			document.querySelectorAll('[data-panel="dungeons"] canvas').length === 3
	)
	assert.match(
		await page.$eval(
			'[data-chart="dungeon-completion"]',
			(node) => node.getAttribute('aria-label') ?? ''
		),
		/Horizontal axis: Completion time \(MM:SS\)\. Vertical axis: Number of runs/
	)
	assert.match(
		await page.$eval(
			'[data-chart="dungeon-margin"]',
			(node) => node.getAttribute('aria-label') ?? ''
		),
		/Horizontal axis: Timer margin \(MM:SS\)\. Vertical axis: Number of runs/
	)
	await page.screenshot({
		path: path.join(shots, 'tab-dungeons-light.png'),
		fullPage: true,
	})
	await axe('dungeons light')
	await page.click('[data-panel="dungeons"] [data-goto-tab="runs"]')
	await page.waitForFunction(
		() =>
			document.querySelector('#tab-runs')?.getAttribute('aria-selected') ===
			'true'
	)
	await page.waitForFunction(
		() =>
			document.querySelector('[data-filter-dungeon]')?.value ===
			'den-of-nalorakk'
	)
	assert.equal(await page.evaluate(() => location.hash), '#runs')

	await page.click('#tab-overview')
	await page.click('#theme-toggle')
	await page.waitForFunction(() =>
		document.documentElement.classList.contains('dark')
	)
	await page.waitForTimeout?.(250)
	await new Promise((resolve) => setTimeout(resolve, 250))
	await page.screenshot({
		path: path.join(shots, 'tab-overview-dark.png'),
		fullPage: true,
	})
	await axe('overview dark')

	await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 })
	await page.goto(`${url}#overview`, { waitUntil: 'networkidle0' })
	await page.waitForSelector('[data-wow-dashboard]:not([hidden])', {
		timeout: 90000,
	})
	await page.waitForFunction(
		(expected) =>
			document.querySelector('[data-overview-kpi="runs"]')?.textContent ===
			expected,
		{},
		new Intl.NumberFormat('en-GB').format(totalRuns)
	)
	assert.equal(
		await page.evaluate(
			() => document.documentElement.scrollWidth > window.innerWidth + 1
		),
		false
	)
	assert.equal(await page.$$eval('[role="tab"]', (nodes) => nodes.length), 5)
	await page.screenshot({
		path: path.join(shots, 'tab-overview-mobile.png'),
		fullPage: true,
	})
	await page.addScriptTag({ path: axePath })
	await axe('overview mobile')
	await page.click('#tab-runs')
	await page.waitForFunction(
		() => document.querySelectorAll('[data-runs-body] tr').length === 10,
		{ timeout: 120000 }
	)
	assert.equal(
		await page.evaluate(
			() => document.documentElement.scrollWidth > window.innerWidth + 1
		),
		false
	)
	await page.click('#tab-dungeons')
	await page.waitForFunction(
		() => document.querySelectorAll('[data-dungeon-card]').length === 9,
		{ timeout: 120000 }
	)
	assert.equal(
		await page.evaluate(
			() => document.documentElement.scrollWidth > window.innerWidth + 1
		),
		false
	)

	const otherPage = await browser.newPage()
	await otherPage.goto(`${base}/projects/`, { waitUntil: 'networkidle0' })
	assert.ok(
		await otherPage.$$eval('aside', (nodes) => nodes.length > 0),
		'other pages must retain the sidebar'
	)
	await otherPage.close()

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
		timeout: 60000,
	})
	assert.match(
		await errorPage.$eval('[data-error-message]', (node) => node.textContent),
		/schema 2/i
	)
	intercept = false
	await errorPage.removeAllListeners('request')
	await errorPage.setRequestInterception(false)
	await errorPage.setCacheEnabled(false)
	await errorPage.click('[data-retry]')
	await errorPage.waitForSelector('[data-wow-dashboard]:not([hidden])', {
		timeout: 90000,
	})
	await errorPage.close()

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
		`Browser checks passed: 5 tabs, ${totalRuns.toLocaleString('en-GB')} runs, lazy loading, filters across tabs, 10/25/50 pagination, dungeon cards, themes, mobile, axe, error/retry.`
	)
	console.log(
		`Overview readiness: ${initialMs} ms; overview data transfer: ${(dataBytes / 1024).toFixed(0)} KiB; navigation: ${JSON.stringify(nav)}`
	)
	console.log(`Screenshots: ${shots}`)
} catch (error) {
	console.error(error)
	if (serverOutput) console.error(`--- preview output ---\n${serverOutput}`)
	process.exitCode = 1
} finally {
	await browser?.close()
	server.kill('SIGTERM')
}
