// Private originals are intentionally ignored. Run from the repository root.
// Uses Sharp already supplied by Astro; exports only cropped, metadata-free WebPs.
import sharp from 'sharp'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const source = 'screenshots-source/self-hosted-ai-chatbot'
const output = 'public/images/projects/self-hosted-ai-chatbot'
const images = [
	{
		input: 'desktop-gemma4.png',
		name: 'open-webui',
		crop: [0, 170, 3024, 1510],
		thumb: 1200,
	},
	{
		input: 'deepseek-profiles.png',
		name: 'deepseek-assistants',
		crop: [0, 170, 3024, 1490],
	},
	{
		input: 'desktop-gemma4-tutor.png',
		name: 'gemma-programming-tutor',
		crop: [0, 170, 3024, 1794],
	},
	{
		input: 'linux-system-monitor.png',
		name: 'ubuntu-monitoring',
		crop: [0, 242, 1920, 508],
		monitoring: true,
	},
	{
		input: 'linux-local-model-qwen.png',
		name: 'ubuntu-qwen',
		crop: [0, 117, 1920, 958],
	},
	// Exclude the desktop chrome, taskbar and lower performance tooltip.
	{
		input: 'desktp-local-model-gemma42.png.png',
		name: 'windows-gemma',
		crop: [280, 36, 1920, 890],
	},
]

await mkdir(output, { recursive: true })
for (const item of images) {
	const [left, top, width, height] = item.crop
	let image = await sharp(path.join(source, item.input))
		.toColourspace('srgb')
		.extract({ left, top, width, height })
		.png()
		.toBuffer()
	if (item.monitoring) {
		// Opaque masks: service health labels and all numeric operational values.
		// Coordinates refer to the original 1920×1075 screenshot, before cropping.
		const boxes = []
		const cells = (xs, y1, y2) =>
			xs.forEach(([x1, x2]) => boxes.push([x1, y1, x2, y2]))
		const leftCells = [
			[45, 265],
			[273, 492],
			[500, 719],
			[727, 948],
		]
		const rightFour = [
			[972, 1193],
			[1200, 1420],
			[1428, 1649],
			[1657, 1876],
		]
		const rightThree = [
			[972, 1267],
			[1275, 1571],
			[1579, 1875],
		]
		cells(leftCells, 360, 383)
		cells(rightThree, 360, 383)
		cells(leftCells, 525, 550)
		cells(rightFour, 525, 550)
		cells(leftCells, 646, 672)
		cells(rightFour, 646, 672)
		cells(rightThree, 697, 724)
		boxes.push(
			[896, 299, 949, 318],
			[891, 463, 949, 482],
			[1825, 463, 1877, 482],
			[891, 583, 949, 603],
			[1825, 583, 1877, 603]
		)
		const masks = boxes
			.map(
				([x1, y1, x2, y2]) =>
					`<rect x="${x1 - left}" y="${y1 - top}" width="${x2 - x1}" height="${y2 - y1}" fill="#141222"/>`
			)
			.join('')
		image = await sharp(image)
			.composite([
				{
					input: Buffer.from(
						`<svg width="${width}" height="${height}">${masks}</svg>`
					),
				},
			])
			.png()
			.toBuffer()
	}
	for (const [suffix, maxWidth, quality] of [
		['', 2400, 90],
		['-thumb', item.thumb || 768, 86],
	]) {
		const file = path.join(output, `${item.name}${suffix}.webp`)
		// No withMetadata()/keepMetadata(): Sharp drops EXIF, XMP and ICC metadata.
		const { data, info } = await sharp(image)
			.resize({ width: maxWidth, withoutEnlargement: true })
			.webp({ quality, effort: 6, smartSubsample: true })
			.toBuffer({ resolveWithObject: true })
		await writeFile(file, data)
		console.log(
			`${path.basename(file)}: ${info.width}×${info.height}, ${data.length} bytes`
		)
	}
}
