// Originals remain private and ignored. Export complete, metadata-free screenshots.
// Sharp is already supplied by Astro; no cropping, masking or compositing is used.
import sharp from 'sharp'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const source = 'screenshots-source/self-hosted-ai-chatbot'
const output = 'public/images/projects/self-hosted-ai-chatbot'
const images = [
	['desktop-gemma4.png', 'open-webui'],
	['deepseek-profiles.png', 'deepseek-assistants'],
	['desktop-gemma4-tutor.png', 'gemma-programming-tutor'],
	['linux-system-monitor.png', 'ubuntu-monitoring'],
	['linux-local-model-qwen.png', 'ubuntu-qwen'],
	['desktp-local-model-gemma42.png.png', 'windows-gemma'],
]

await mkdir(output, { recursive: true })
for (const [input, name] of images) {
	for (const [suffix, width, quality] of [
		['', undefined, 94],
		['-featured', 1200, 90],
		['-thumb', 240, 82],
	]) {
		const file = path.join(output, `${name}${suffix}.webp`)
		let image = sharp(path.join(source, input)).toColourspace('srgb')
		if (width) image = image.resize({ width, withoutEnlargement: true })
		// Sharp strips EXIF, XMP and ICC by default; retain all image content.
		const { data, info } = await image
			.webp({ quality, effort: 6, smartSubsample: true })
			.toBuffer({ resolveWithObject: true })
		await writeFile(file, data)
		console.log(
			`${path.basename(file)}: ${info.width}×${info.height}, ${data.length} bytes`
		)
	}
}
