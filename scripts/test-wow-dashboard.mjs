#!/usr/bin/env node
/**
 * Local browser smoke, interaction, mobile and accessibility checks.
 * Requires `npm run build` first and Google Chrome at the standard macOS path.
 */
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
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

async function waitForServer() {
	for (let attempt = 0; attempt < 60; attempt += 1) {
		try {
			const response = await fetch(url)
			if (response.ok) return
		} catch {
			// Server not ready yet.
		}
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
	{
		cwd: root,
		stdio: ['ignore', 'pipe', 'pipe'],
	}
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
	await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 })
	await page.goto(url, { waitUntil: 'networkidle0' })
	await page.waitForSelector('[data-wow-dashboard]:not([hidden])', {
		timeout: 15000,
	})
	await page.waitForFunction(
		() => document.querySelectorAll('[data-runs-body] tr').length === 40
	)

	assert.equal(
		await page.$eval('[data-kpi="runs"]', (el) => el.textContent),
		'40'
	)
	assert.equal(
		await page.$eval('[data-kpi="highest"]', (el) => el.textContent),
		'+24'
	)
	assert.equal(
		await page.$eval('[data-result-count]', (el) => el.textContent),
		'40 runs shown'
	)
	assert.equal(
		await page.$$eval('[data-chart] canvas', (nodes) => nodes.length),
		6
	)
	assert.equal(
		await page.$$eval('[data-chart-table] table', (nodes) => nodes.length),
		6
	)
	assert.equal(
		await page.$$eval(
			"[data-runs-body] a[target='_blank']",
			(nodes) => nodes.length
		),
		40
	)
	assert.ok(
		await page.$$eval('[data-runs-body] a', (nodes) =>
			nodes.every((node) => (node.href || '').startsWith('https://raider.io/'))
		)
	)

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
				'[data-wow-dashboard] [id], #filter-key, #filter-class, #filter-spec, #filter-search'
			),
		].map((node) => node.id)
		const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
		const scopes = [...document.querySelectorAll("table th[scope='col']")]
			.length
		const headings = [
			...document.querySelectorAll('article h1, article h2, article h3'),
		].map((node) => node.tagName)
		return {
			labelled,
			chartLabels,
			duplicates,
			scopes,
			headings,
			rankSort: document
				.querySelector('th[aria-sort]')
				?.getAttribute('aria-sort'),
		}
	})
	assert.equal(accessibility.labelled, true)
	assert.equal(accessibility.chartLabels, true)
	assert.deepEqual(accessibility.duplicates, [])
	assert.ok(accessibility.scopes >= 8)
	assert.equal(accessibility.rankSort, 'ascending')
	assert.deepEqual(
		accessibility.headings.filter((tag) => tag === 'H1'),
		['H1']
	)
	assert.ok(
		accessibility.headings.indexOf('H1') < accessibility.headings.indexOf('H2')
	)
	assert.equal(
		await page.$eval('.overflow-x-auto[role="region"]', (el) =>
			el.getAttribute('tabindex')
		),
		'0'
	)
	const smallTargets = await page.$$eval(
		'[data-wow-dashboard] button',
		(nodes) =>
			nodes
				.map((node) => node.getBoundingClientRect())
				.filter(
					(rect) => rect.width > 0 && (rect.width < 24 || rect.height < 24)
				).length
	)
	assert.equal(
		smallTargets,
		0,
		'dashboard buttons should meet the 24px target size'
	)

	await page.addScriptTag({ path: axePath })
	const axeResults = await page.evaluate(async () => {
		const article = document.querySelector('article')
		return article
			? await window.axe.run(article, {
					runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
				})
			: { violations: [] }
	})
	if (axeResults.violations.length) {
		console.error(
			axeResults.violations.map((v) => `${v.id}: ${v.description}`).join('\n')
		)
	}
	assert.equal(
		axeResults.violations.length,
		0,
		'axe WCAG A/AA violations must be zero'
	)

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

	const chartTableRows = await page.$$eval(
		'[data-chart-table] table tbody tr',
		(nodes) => nodes.length
	)
	assert.ok(chartTableRows >= 40, 'chart alternatives should be populated')

	await page.click('#theme-toggle')
	await page.waitForFunction(() =>
		document.documentElement.classList.contains('dark')
	)
	await new Promise((resolve) => setTimeout(resolve, 150))
	assert.equal(
		await page.$$eval('[data-chart] canvas', (nodes) => nodes.length),
		6
	)
	const darkAxe = await page.evaluate(async () => {
		const article = document.querySelector('article')
		return article
			? await window.axe.run(article, {
					runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
				})
			: { violations: [] }
	})
	if (darkAxe.violations.length) {
		console.error(
			darkAxe.violations
				.map(
					(v) =>
						`${v.id}: ${v.description} :: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`
				)
				.join('\n')
		)
	}
	assert.equal(
		darkAxe.violations.length,
		0,
		'axe WCAG A/AA violations must be zero in dark mode'
	)
	await page.screenshot({
		path: path.join(screenshotDir, 'dashboard-dark.png'),
		fullPage: true,
	})
	await page.click('#theme-toggle')
	await page.waitForFunction(
		() => !document.documentElement.classList.contains('dark')
	)

	await page.select('[data-filter-key]', '24')
	await page.waitForFunction(
		() => document.querySelectorAll('[data-runs-body] tr').length === 10
	)
	assert.equal(
		await page.$eval('[data-kpi="runs"]', (el) => el.textContent),
		'10'
	)
	assert.match(
		await page.$eval('[data-filter-summary]', (el) => el.textContent),
		/Showing 10 of 40 runs/
	)
	assert.deepEqual(
		await page.$$eval('[data-chart-table="key"] tbody tr', (rows) =>
			rows.map((row) => [...row.children].map((cell) => cell.textContent))
		),
		[['+24', '10']]
	)

	await page.select('[data-filter-key]', 'all')
	await page.select('[data-filter-class]', '8')
	await page.waitForFunction(
		() => document.querySelectorAll('[data-runs-body] tr').length === 3
	)
	assert.equal(
		await page.$eval('[data-kpi="runs"]', (el) => el.textContent),
		'3'
	)
	assert.equal(
		await page.$$eval(
			'[data-chart-table="class"] tbody tr',
			(rows) => rows.filter((row) => row.textContent?.includes('Mage')).length
		),
		1
	)
	assert.match(
		await page.$eval(
			'[data-chart-table="class"]',
			(table) => table.textContent
		),
		/Mage320\.0%3/
	)

	await page.select('[data-filter-class]', 'all')
	await page.select('[data-filter-spec]', '62')
	await page.waitForFunction(
		() => document.querySelectorAll('[data-runs-body] tr').length === 3
	)
	await page.select('[data-filter-spec]', 'all')

	await page.type('[data-filter-search]', '23351424')
	await page.waitForFunction(
		() => document.querySelectorAll('[data-runs-body] tr').length === 1
	)
	await page.click('[data-reset]')
	await page.waitForFunction(
		() => document.querySelectorAll('[data-runs-body] tr').length === 40
	)

	await page.click("[data-sort='key']")
	await page.waitForFunction(() =>
		document
			.querySelector('[data-runs-body] tr td:nth-child(2)')
			?.textContent?.includes('+24')
	)
	await page.focus("[data-sort='key']")
	await page.keyboard.press('Enter')
	await page.waitForFunction(() =>
		document
			.querySelector('[data-runs-body] tr td:nth-child(2)')
			?.textContent?.includes('+23')
	)
	assert.equal(
		await page.$eval("[data-sort='key']", (button) =>
			button.closest('th')?.getAttribute('aria-sort')
		),
		'ascending'
	)

	await page.click("[data-role='healer']")
	assert.equal(
		await page.$eval("[data-role='healer']", (el) =>
			el.getAttribute('aria-pressed')
		),
		'true'
	)
	assert.match(
		await page.$eval('[data-filter-summary]', (el) => el.textContent),
		/healer only/
	)
	assert.equal(
		await page.$eval('[data-kpi="runs"]', (el) => el.textContent),
		'40'
	)
	assert.ok(
		await page.$$eval(
			'[data-chart-table="spec"] tbody tr td:nth-child(3)',
			(cells) =>
				cells.length > 0 && cells.every((cell) => cell.textContent === 'healer')
		)
	)

	await page.type('[data-filter-search]', 'zzzz-no-match')
	await page.waitForFunction(
		() => !document.querySelector('[data-runs-empty]')?.hasAttribute('hidden')
	)
	assert.equal(
		await page.$$eval('[data-runs-body] tr', (nodes) => nodes.length),
		0
	)
	await page.click('[data-reset]')
	await page.waitForFunction(
		() => document.querySelectorAll('[data-runs-body] tr').length === 40
	)

	await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 })
	await page.reload({ waitUntil: 'networkidle0' })
	await page.waitForSelector('[data-wow-dashboard]:not([hidden])')
	await page.waitForFunction(
		() => document.querySelectorAll('[data-runs-body] tr').length === 40
	)
	const mobileOverflow = await page.evaluate(
		() => document.documentElement.scrollWidth > window.innerWidth + 1
	)
	assert.equal(
		mobileOverflow,
		false,
		'mobile page should not overflow horizontally'
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
	assert.equal(
		mobileAxe.violations.length,
		0,
		'axe WCAG 2.0 A/AA violations must be zero at mobile width'
	)
	await page.screenshot({
		path: path.join(screenshotDir, 'dashboard-mobile.png'),
		fullPage: true,
	})

	await page.emulateMediaFeatures([
		{ name: 'prefers-reduced-motion', value: 'reduce' },
	])
	await page.reload({ waitUntil: 'networkidle0' })
	await page.waitForSelector('[data-wow-dashboard]:not([hidden])')
	assert.equal(
		await page.$$eval('[data-chart] canvas', (nodes) => nodes.length),
		6
	)

	const stalePage = await browser.newPage()
	const manifest = JSON.parse(
		await readFile(
			path.join(root, 'public/data/wow-mythic-plus/manifest.json'),
			'utf8'
		)
	)
	const staleTimestamp = new Date(
		Date.now() - 30 * 24 * 60 * 60 * 1000
	).toISOString()
	const publishedDataset = JSON.parse(
		await readFile(
			path.join(root, 'public/data/wow-mythic-plus', manifest.file),
			'utf8'
		)
	)
	const staleDatasetBody = JSON.stringify({
		...publishedDataset,
		exported_at: staleTimestamp,
	})
	const staleManifest = {
		...manifest,
		generated_at: staleTimestamp,
		size_bytes: Buffer.byteLength(staleDatasetBody),
		sha256: createHash('sha256').update(staleDatasetBody).digest('hex'),
	}
	await stalePage.setRequestInterception(true)
	stalePage.on('request', (request) => {
		if (request.url().endsWith('/data/wow-mythic-plus/manifest.json')) {
			request.respond({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(staleManifest),
			})
		} else if (request.url().endsWith(manifest.file)) {
			request.respond({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					...publishedDataset,
					exported_at: staleTimestamp,
				}),
			})
		} else {
			request.continue()
		}
	})
	await stalePage.goto(url, { waitUntil: 'networkidle0' })
	await stalePage.waitForSelector('[data-dataset-stale]:not([hidden])')

	const errorPage = await browser.newPage()
	let interceptError = true
	await errorPage.setRequestInterception(true)
	errorPage.on('request', (request) => {
		if (!interceptError) {
			request.continue()
			return
		}
		if (request.url().endsWith('/data/wow-mythic-plus/manifest.json')) {
			request.respond({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ ...manifest, schema_version: '1.0.0' }),
			})
		} else {
			request.continue()
		}
	})
	await errorPage.goto(url, { waitUntil: 'networkidle0' })
	await errorPage.waitForSelector('[data-dashboard-error]:not([hidden])')
	assert.match(
		await errorPage.$eval('[data-error-message]', (el) => el.textContent),
		/schema 1\.1/
	)
	interceptError = false
	errorPage.removeAllListeners('request')
	await errorPage.setRequestInterception(false)
	await errorPage.setCacheEnabled(false)
	await errorPage.click('[data-retry]')
	await errorPage.waitForSelector('[data-wow-dashboard]:not([hidden])', {
		timeout: 15000,
	})
	await errorPage.waitForFunction(
		() => document.querySelectorAll('[data-runs-body] tr').length === 40
	)

	assert.deepEqual(consoleErrors, [])
	console.log(
		'Browser checks passed: 40 rows, six charts, filters, sort, empty state, dark/light axe, mobile 390×844, reduced motion, stale and error states.'
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
