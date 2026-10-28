/** Central WoW class metadata and display colours. */
export interface WowClass {
	id: number
	name: string
	slug: string
	colour: string
}

export const WOW_CLASSES: readonly WowClass[] = [
	{ id: 1, name: 'Warrior', slug: 'warrior', colour: '#C69B6D' },
	{ id: 2, name: 'Paladin', slug: 'paladin', colour: '#F48CBA' },
	{ id: 3, name: 'Hunter', slug: 'hunter', colour: '#AAD372' },
	{ id: 4, name: 'Rogue', slug: 'rogue', colour: '#FFF468' },
	{ id: 5, name: 'Priest', slug: 'priest', colour: '#FFFFFF' },
	{ id: 6, name: 'Death Knight', slug: 'death-knight', colour: '#C41E3A' },
	{ id: 7, name: 'Shaman', slug: 'shaman', colour: '#0070DD' },
	{ id: 8, name: 'Mage', slug: 'mage', colour: '#3FC7EB' },
	{ id: 9, name: 'Warlock', slug: 'warlock', colour: '#8788EE' },
	{ id: 10, name: 'Monk', slug: 'monk', colour: '#00FF98' },
	{ id: 11, name: 'Druid', slug: 'druid', colour: '#FF7C0A' },
	{ id: 12, name: 'Demon Hunter', slug: 'demon-hunter', colour: '#A330C9' },
	{ id: 13, name: 'Evoker', slug: 'evoker', colour: '#33937F' },
] as const

export const UNKNOWN_CLASS_COLOUR = '#9CA3AF'

const BY_ID = new Map(WOW_CLASSES.map((entry) => [entry.id, entry]))

export function wowClass(classId: number | null | undefined): WowClass | undefined {
	return classId === null || classId === undefined ? undefined : BY_ID.get(classId)
}

export function classColour(classId: number | null | undefined): string {
	return wowClass(classId)?.colour ?? UNKNOWN_CLASS_COLOUR
}

/** A dark/light-readable text colour for a class-coloured chip. */
export function classTextColour(classId: number | null | undefined): string {
	const colour = classColour(classId)
	const hex = colour.replace('#', '')
	const r = parseInt(hex.slice(0, 2), 16)
	const g = parseInt(hex.slice(2, 4), 16)
	const b = parseInt(hex.slice(4, 6), 16)
	const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
	return luminance > 0.62 ? '#111827' : '#FFFFFF'
}
