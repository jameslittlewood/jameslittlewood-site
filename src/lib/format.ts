/** Display helpers shared by the calculator and the case study. */

function roundForDisplay(value: number, digits: number): number {
	const factor = 10 ** digits
	// A tiny relative nudge avoids binary floating-point values such as
	// 0.11024999999999999 being displayed as 0.1102 instead of 0.1103.
	const rounded = Math.round(Math.abs(value) * factor + 1e-9) / factor
	return Math.sign(value) * rounded
}

export function formatUSD(value: number | null | undefined): string {
	if (value === null || value === undefined || !Number.isFinite(value)) {
		return '—'
	}
	const absolute = Math.abs(value)
	let maximumFractionDigits = 2
	if (absolute > 0 && absolute < 0.01) {
		maximumFractionDigits = Math.min(
			12,
			Math.max(4, Math.ceil(-Math.log10(absolute)) + 3)
		)
	} else if (absolute < 1) {
		maximumFractionDigits = 4
	}
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		minimumFractionDigits: 2,
		maximumFractionDigits,
	}).format(roundForDisplay(value, maximumFractionDigits))
}

export function formatRate(value: number | null | undefined): string {
	if (value === null || value === undefined || !Number.isFinite(value)) {
		return '—'
	}
	const absolute = Math.abs(value)
	const maximumFractionDigits = absolute > 0 && absolute < 0.01 ? 8 : 4
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		minimumFractionDigits: 2,
		maximumFractionDigits,
	}).format(roundForDisplay(value, maximumFractionDigits))
}

export function formatTokens(value: number | null | undefined): string {
	if (value === null || value === undefined || !Number.isFinite(value)) {
		return '—'
	}
	return new Intl.NumberFormat('en-GB', {
		maximumFractionDigits: 0,
	}).format(value)
}

export function formatPercent(value: number | null | undefined): string {
	if (value === null || value === undefined || !Number.isFinite(value)) {
		return '—'
	}
	return `${new Intl.NumberFormat('en-GB', {
		maximumFractionDigits: 2,
	}).format(value)}%`
}

export function formatRetrievedAt(value: string | null | undefined): string {
	if (!value) return 'date unavailable'
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return 'date unavailable'
	return `${date.toLocaleString('en-GB', {
		dateStyle: 'medium',
		timeStyle: 'short',
		timeZone: 'UTC',
	})} UTC`
}

export function formatDuration(minutes: number | null | undefined): string {
	if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) {
		return '—'
	}
	if (minutes < 1) return `${Math.round(minutes * 60)}s`
	const whole = Math.round(minutes)
	const hours = Math.floor(whole / 60)
	const remainder = whole % 60
	if (hours === 0) return `${remainder}m`
	return `${hours}h ${remainder}m`
}
