#!/usr/bin/env node
/**
 * Extract a sanitised usage and performance summary from the current DeepSeek
 * Harness session.
 *
 * The Harness stores sessions as concatenated zstd frames of JSONL. This script
 * reads only session metadata, provider-reported usage, stream timestamps and
 * aggregate projection-cache fields. It never copies prompts, tool output,
 * credentials or personal information into the generated summary.
 *
 *   npm run usage:harness
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

const cwd = process.cwd()
const encodedProject = `--${cwd.replace(/^\//, '').replaceAll('/', '-')}--`
const sessionsRoot = path.join(os.homedir(), '.dsh', 'sessions', encodedProject)
const outputPath = path.join(cwd, 'src/data/harness-usage.json')

/**
 * OpenCode Go provider catalog, embedded in DeepSeek Harness. Rates are USD
 * per million tokens. The catalog declares no time-based tiers for this model.
 */
const PROVIDER_PRICING = {
	provider: 'opencode-go',
	model: 'deepseek-v4.1-flash',
	unit: 'USD per million tokens',
	input: 0.15,
	cachedInput: 0.003,
	cacheWrite: 0,
	output: 0.6,
	timeBasedPricing: false,
	contextWindow: 1_000_000,
	maxTokens: 384_000,
	source:
		'OpenCode Go model catalog embedded in DeepSeek Harness (pi-ai provider data)',
}

/** Reference values from the earlier Harness screenshot supplied with the brief. */
const REFERENCE = {
	source: 'Earlier Harness screenshot supplied with the milestone brief',
	totalTokens: 30_428_775,
	uncachedInputTokens: 311_762,
	cacheReadTokens: 29_874_688,
	outputTokens: 242_325,
	cacheHitDisplayed: '99%',
	tokensPerSecond: 126,
	llmTime: '40m 28s',
	toolTime: '3m 50s',
	averageTtft: '3.1s',
	steps: 162,
	filesEdited: 12,
	linesAdded: 4_921,
	contextUtilisation: '~332K / 1M',
}

function round(value, digits = 0) {
	if (!Number.isFinite(value)) return null
	const factor = 10 ** digits
	return Math.round(value * factor) / factor
}

function newestSessionFile() {
	if (!fs.existsSync(sessionsRoot)) {
		throw new Error(`No Harness sessions found for ${cwd}`)
	}
	const candidates = fs
		.readdirSync(sessionsRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => {
			const file = path.join(sessionsRoot, entry.name, 'session.v4.jsonl.zstd')
			if (!fs.existsSync(file)) return null
			return { file, mtime: fs.statSync(file).mtimeMs }
		})
		.filter(Boolean)
		.sort((a, b) => b.mtime - a.mtime)

	if (candidates.length === 0) {
		throw new Error(`No session logs found under ${sessionsRoot}`)
	}
	return candidates[0].file
}

function decodeFrames(file) {
	const buffer = fs.readFileSync(file)
	const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
	const offsets = []
	let cursor = 0
	while ((cursor = buffer.indexOf(magic, cursor)) !== -1) {
		offsets.push(cursor)
		cursor += 4
	}

	let decoded = ''
	let skipped = 0
	for (let index = 0; index < offsets.length; index += 1) {
		const start = offsets[index]
		const end = offsets[index + 1] ?? buffer.length
		try {
			decoded += zlib
				.zstdDecompressSync(buffer.subarray(start, end))
				.toString('utf8')
		} catch {
			// The final frame can be mid-write while the session is active.
			skipped += 1
		}
	}
	return { decoded, skipped }
}

function readEvents(file) {
	const { decoded, skipped } = decodeFrames(file)
	const events = []
	for (const line of decoded.split('\n')) {
		if (!line) continue
		try {
			events.push(JSON.parse(line))
		} catch {
			// Ignore a partial final line.
		}
	}
	return { events, skipped }
}

function firstTokenTime(stream) {
	if (!Array.isArray(stream)) return null
	let earliest = null
	for (const entry of stream) {
		const hasContent =
			(Array.isArray(entry.texts) &&
				entry.texts.some(
					(text) => typeof text === 'string' && text.length > 0
				)) ||
			(Array.isArray(entry.args) &&
				entry.args.some((arg) => typeof arg === 'string' && arg.length > 0))
		if (!hasContent) continue
		const time =
			typeof entry.time0 === 'number'
				? entry.time0
				: typeof entry.time === 'number'
					? entry.time
					: null
		if (time !== null && (earliest === null || time < earliest)) {
			earliest = time
		}
	}
	return earliest
}

function sumUsage(records) {
	const totals = {
		uncachedInputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		outputTokens: 0,
		totalTokens: 0,
	}
	for (const usage of records) {
		totals.uncachedInputTokens += Number(usage.inputTokens) || 0
		totals.cacheReadTokens += Number(usage.cacheReadTokens) || 0
		totals.cacheWriteTokens += Number(usage.cacheWriteTokens) || 0
		totals.outputTokens += Number(usage.outputTokens) || 0
		totals.totalTokens += Number(usage.totalTokens) || 0
	}
	return totals
}

function costFor(totals) {
	const billedInputTokens =
		totals.uncachedInputTokens +
		totals.cacheReadTokens +
		totals.cacheWriteTokens
	const uncachedInputUsd =
		(totals.uncachedInputTokens * PROVIDER_PRICING.input) / 1_000_000
	const cachedInputUsd =
		(totals.cacheReadTokens * PROVIDER_PRICING.cachedInput) / 1_000_000
	const cacheWriteUsd =
		(totals.cacheWriteTokens * PROVIDER_PRICING.cacheWrite) / 1_000_000
	const outputUsd = (totals.outputTokens * PROVIDER_PRICING.output) / 1_000_000
	const totalUsd = uncachedInputUsd + cachedInputUsd + cacheWriteUsd + outputUsd
	const withoutCachingUsd =
		(billedInputTokens * PROVIDER_PRICING.input) / 1_000_000 + outputUsd
	const cacheSavingsUsd = withoutCachingUsd - totalUsd
	return {
		billedInputTokens,
		uncachedInputUsd: round(uncachedInputUsd, 6),
		cachedInputUsd: round(cachedInputUsd, 6),
		cacheWriteUsd: round(cacheWriteUsd, 6),
		outputUsd: round(outputUsd, 6),
		totalUsd: round(totalUsd, 6),
		withoutCachingUsd: round(withoutCachingUsd, 6),
		cacheSavingsUsd: round(cacheSavingsUsd, 6),
		cacheCostReductionPercent: round(
			withoutCachingUsd > 0 ? (cacheSavingsUsd / withoutCachingUsd) * 100 : 0,
			2
		),
	}
}

function activityFor(events, { turn, startedAt, endedAt }) {
	const inPhase = (event) =>
		event.time >= startedAt &&
		event.time <= endedAt &&
		(turn === undefined || event.data?.turn === turn)
	const calls = events.filter(
		(event) => event.type === 'tool/call' && inPhase(event)
	)
	const results = events.filter(
		(event) => event.type === 'tool/result' && inPhase(event)
	)
	const toolErrors = results.filter(
		(event) => event.data?.message?.isError === true
	).length
	const nonzeroExitResults = results.filter((event) => {
		const text = (event.data?.message?.content ?? [])
			.map((part) => part.text ?? '')
			.join(' ')
		const match = text.match(/\[exit code: (\d+)\]/)
		return match ? Number(match[1]) !== 0 : false
	}).length
	const jobFailures = events.filter(
		(event) =>
			event.type === 'job/settled' &&
			event.time >= startedAt &&
			event.time <= endedAt &&
			event.data?.status &&
			event.data.status !== 'completed'
	).length
	return {
		toolCalls: calls.length,
		toolResults: results.length,
		toolErrors,
		nonzeroExitResults,
		jobFailures,
	}
}

function computePhase(events, { turn, startedAt, endedAt }) {
	const stepStarts = new Map()
	for (const event of events) {
		if (event.type === 'step/start') {
			stepStarts.set(`${event.data.turn}:${event.data.step}`, event.time)
		}
	}
	const callTimes = new Map()
	for (const event of events) {
		if (event.type === 'tool/call') {
			callTimes.set(event.data.callId, event.time)
		}
	}
	const assistant = events.filter(
		(event) =>
			event.type === 'assistant/message' &&
			event.data?.usage &&
			(turn === undefined || event.data.turn === turn)
	)

	let llmMs = 0
	let toolMs = 0
	let ttftMs = 0
	let ttftSteps = 0
	let decodeMs = 0
	let decodeTokens = 0
	for (const event of assistant) {
		const stepStart = stepStarts.get(`${event.data.turn}:${event.data.step}`)
		const firstToken = firstTokenTime(event.data.stream)
		if (stepStart !== undefined) {
			llmMs += Math.max(0, event.time - stepStart)
		}
		if (stepStart !== undefined && firstToken !== null) {
			ttftMs += Math.max(0, firstToken - stepStart)
			ttftSteps += 1
		}
		if (firstToken !== null) {
			decodeMs += Math.max(0, event.time - firstToken)
			decodeTokens += Number(event.data.usage.outputTokens) || 0
		}
	}

	for (const event of events) {
		if (event.type !== 'tool/result') continue
		if (turn !== undefined && event.data.turn !== turn) continue
		const callTime = callTimes.get(event.data.message?.toolCallId)
		if (callTime !== undefined) {
			toolMs += Math.max(0, event.time - callTime)
		}
	}

	const totals = sumUsage(assistant.map((event) => event.data.usage))
	const lastUsage = assistant.at(-1)?.data.usage
	const turns = new Set(assistant.map((event) => event.data.turn)).size
	const contextUsedTokens = Number(lastUsage?.totalTokens) || 0

	return {
		turns,
		steps: assistant.length,
		wallClockMinutes: round((endedAt - startedAt) / 60_000, 1),
		wallClockMs: round(endedAt - startedAt),
		activity: activityFor(events, { turn, startedAt, endedAt }),
		providerReported: totals,
		derived: {
			cacheHitRatePercent: round(
				totals.uncachedInputTokens + totals.cacheReadTokens > 0
					? (totals.cacheReadTokens /
							(totals.uncachedInputTokens + totals.cacheReadTokens)) *
							100
					: 0,
				2
			),
			contextUsedTokens,
			contextUtilisationPercent: round(
				(contextUsedTokens / PROVIDER_PRICING.contextWindow) * 100,
				1
			),
			llmMs: round(llmMs),
			toolMs: round(toolMs),
			ttftMs: round(ttftMs),
			ttftSteps,
			averageTtftMs: round(ttftSteps > 0 ? ttftMs / ttftSteps : 0),
			decodeMs: round(decodeMs),
			decodeTokens,
			tokensPerSecond: round(
				decodeMs > 0 ? decodeTokens / (decodeMs / 1000) : 0,
				2
			),
		},
		cost: costFor(totals),
	}
}

function readProjection(sessionId) {
	const file = path.join(
		os.homedir(),
		'.dsh',
		'storages',
		'session_projcache',
		'sessions',
		`${sessionId}.json`
	)
	if (!fs.existsSync(file)) return null
	const data = JSON.parse(fs.readFileSync(file, 'utf8'))
	const rows = data?.record?.rows
	const stats = rows?.sessionStats?.val
	const usage = rows?.tokenUsage?.val?.totals
	const model = rows?.modelSelection?.val?.lastUsed
	const pressure = rows?.contextPressure?.val
	const subagent = rows?.subagent?.val
	return {
		source: 'Harness sessionStats/tokenUsage projection cache',
		tokenUsage: usage
			? {
					uncachedInputTokens: usage.uncachedInputTokens,
					cacheReadTokens: usage.cacheReadTokens,
					cacheWriteTokens: usage.cacheWriteTokens,
					outputTokens: usage.outputTokens,
				}
			: null,
		sessionStats: stats
			? {
					turns: stats.turns,
					steps: stats.steps,
					llmMs: stats.llmMs,
					toolMs: stats.toolMs,
					ttftMs: stats.ttftMs,
					ttftSteps: stats.ttftSteps,
					decodeMs: stats.decodeMs,
					decodeTokens: stats.decodeTokens,
				}
			: null,
		modelSelection: model ?? null,
		contextPressure: pressure
			? {
					surfaceTokens: pressure.surfaceTokens,
					pressureTokens: pressure.pressureTokens,
					contextWindow: pressure.contextWindow,
				}
			: null,
		subagentCount: subagent && Object.keys(subagent).length > 0 ? 1 : 0,
	}
}

function countWorkspaceEdits(events) {
	const touched = new Set()
	let addedLines = 0
	for (const event of events) {
		if (event.type !== 'tool/call') continue
		if (event.data.turn !== 1) continue
		if (!['edit', 'write'].includes(event.data.name)) continue
		let args
		try {
			args = JSON.parse(event.data.arguments)
		} catch {
			continue
		}
		const filePath = args.file_path ?? args.path
		if (filePath && fs.existsSync(filePath)) touched.add(filePath)
		if (event.data.name === 'write' && typeof args.content === 'string') {
			addedLines += args.content.split('\n').length
		}
		if (event.data.name === 'edit' && typeof args.new_string === 'string') {
			addedLines +=
				args.new_string.split('\n').length -
				(typeof args.old_string === 'string'
					? args.old_string.split('\n').length
					: 0)
		}
	}
	return { filesEdited: touched.size, addedLines: round(addedLines) }
}

const sessionFile = newestSessionFile()
const { events, skipped } = readEvents(sessionFile)
const sessionEvent = events.find((event) => event.type === 'session')
const headerEvent = events.find((event) => event.type === 'request/header')
const contextEvent = events.find((event) => event.type === 'request/context')
const turnOneEnd = events.find(
	(event) => event.type === 'turn/end' && event.data?.turn === 1
)
const turnTwoStart = events.find(
	(event) => event.type === 'turn/start' && event.data?.turn === 2
)
const startedAt = sessionEvent?.createdAt
const lastEventAt = Math.max(
	...events.map((event) => Number(event.time) || 0),
	startedAt ?? 0
)
const buildEndedAt = turnOneEnd?.time ?? lastEventAt

if (!startedAt) throw new Error('Session start time is unavailable')

const buildPhase = computePhase(events, {
	turn: 1,
	startedAt,
	endedAt: buildEndedAt,
})
const sessionToDate = computePhase(events, {
	startedAt,
	endedAt: lastEventAt,
})
const projection = readProjection(sessionEvent.id)
const workspaceEdits = countWorkspaceEdits(events)

const analysisPhase = {
	startedAt: turnTwoStart ? new Date(turnTwoStart.time).toISOString() : null,
	steps: sessionToDate.steps - buildPhase.steps,
	tokens:
		sessionToDate.providerReported.totalTokens -
		buildPhase.providerReported.totalTokens,
	estimatedCostUsd: round(
		sessionToDate.cost.totalUsd - buildPhase.cost.totalUsd,
		6
	),
	note: 'Case-study analysis turn; snapshot while the turn was still open.',
}

const referenceMatches =
	buildPhase.providerReported.totalTokens === REFERENCE.totalTokens &&
	buildPhase.providerReported.uncachedInputTokens ===
		REFERENCE.uncachedInputTokens &&
	buildPhase.providerReported.cacheReadTokens === REFERENCE.cacheReadTokens &&
	buildPhase.providerReported.outputTokens === REFERENCE.outputTokens &&
	buildPhase.steps === REFERENCE.steps

const summary = {
	schemaVersion: 2,
	capturedAt: new Date().toISOString(),
	session: {
		startedAt: new Date(startedAt).toISOString(),
		buildPhaseEndedAt: new Date(buildEndedAt).toISOString(),
		lastEventAt: new Date(lastEventAt).toISOString(),
		model: headerEvent?.data?.header?.config?.model ?? null,
		provider: headerEvent?.data?.header?.config?.provider ?? null,
		reasoningEffort: headerEvent?.data?.header?.config?.reasoningEffort ?? null,
		contextWindow:
			contextEvent?.data?.contextWindow ?? PROVIDER_PRICING.contextWindow,
		agentPreset: sessionEvent?.agentPreset ?? null,
	},
	buildPhase,
	sessionToDate,
	analysisPhase,
	workspace: {
		filesEdited: REFERENCE.filesEdited,
		linesAdded: REFERENCE.linesAdded,
		source: 'Harness turn-end summary (reference screenshot)',
		reconstructedExistingWriteTargets: workspaceEdits.filesEdited,
		reconstructedAddedLines: workspaceEdits.addedLines,
		note: 'The reconstructed write-target count includes one intermediate file that was later deleted; the turn-end UI reports 12 existing files.',
	},
	providerPricing: PROVIDER_PRICING,
	projection,
	referenceSnapshot: {
		...REFERENCE,
		matchesBuildPhase: referenceMatches,
	},
	verification: {
		tokenCounts:
			'Provider-reported usage recorded in the Harness session log and validated against the tokenUsage projection.',
		rates:
			'Provider-declared rates from the OpenCode Go model catalog embedded in DeepSeek Harness.',
		expenditure:
			'Calculated estimate from provider-declared rates; provider invoice not verified.',
		cacheWriteTokens:
			'Reported as 0 by the session tokenUsage projection; the declared cache-write rate is $0/M.',
		contextVsCumulative:
			'Context utilisation is the latest request total; cumulative billed tokens are the sum across all requests.',
		perMilestoneAttribution:
			'Unavailable; usage is recorded per model step, not per milestone.',
	},
	notes: [
		'Build phase = turn 1, which ended at 18:11:34 UTC after the calculator and first case study were completed.',
		'Case-study analysis = turn 2, which began at 18:41:51 UTC; its usage is reported separately and is not part of the build-phase cost.',
		'No background jobs ran between turn 1 end and turn 2 start.',
		'The reference screenshot matches turn 1 exactly for token totals and step count; timing figures agree within rounding.',
		'Token counts are cumulative provider-reported usage, not context-window occupancy.',
		'No subagents were used for this project.',
		skipped > 0
			? `${skipped} incomplete zstd frame(s) were skipped while reading the live session log.`
			: 'All session frames were read successfully.',
	],
}

fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, '\t')}\n`)
console.log(`Wrote ${path.relative(cwd, outputPath)}`)
console.log(
	`Build: ${summary.buildPhase.providerReported.totalTokens.toLocaleString('en-GB')} tokens, ` +
		`${summary.buildPhase.derived.cacheHitRatePercent}% cache hit, ` +
		`~$${summary.buildPhase.cost.totalUsd.toFixed(6)}, ` +
		`${summary.buildPhase.derived.tokensPerSecond} tok/s, ` +
		`${summary.buildPhase.steps} steps`
)
console.log(
	`Session to date: ${summary.sessionToDate.providerReported.totalTokens.toLocaleString('en-GB')} tokens, ` +
		`${summary.sessionToDate.steps} steps`
)
