#!/usr/bin/env node
/** Copy and verify the schema 2 multi-dungeon publication into static assets. */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateDungeon } from "../src/lib/wowMythic.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const sourceIndex = args.indexOf("--source");
const source = path.resolve(
	sourceIndex >= 0
		? args[sourceIndex + 1]
		: process.env.WOW_MPLUS_PUBLISHED_DIR || path.resolve(here, "../../data/published"),
);
const target = path.resolve(here, "../public/data/wow-mythic-plus");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

function fail(message) {
	console.error(`sync-wow-mythic-data: ${message}`);
	process.exit(1);
}
function assert(condition, message) {
	if (!condition) fail(message);
}

const index = JSON.parse(await readFile(path.join(source, "manifest.json"), "utf8"));
assert(index.manifest_version === 2, "manifest_version must be 2");
assert(typeof index.schema_version === "string" && index.schema_version.startsWith("2."), "dashboard requires schema 2.x");
assert(typeof index.dataset_version === "string", "dataset_version missing");
assert(typeof index.season_name === "string", "season_name missing");
assert(Array.isArray(index.dungeons) && index.dungeons.length > 0, "dungeon index empty");
assert(index.combined && typeof index.combined.file === "string", "combined file missing");

const files = [];
for (const entry of index.dungeons) {
	assert(typeof entry.file === "string" && path.basename(entry.file) === entry.file, "unsafe dungeon filename");
	const raw = await readFile(path.join(source, entry.file));
	assert(raw.length === entry.size_bytes, `${entry.file} size mismatch`);
	assert(sha256(raw) === entry.sha256, `${entry.file} checksum mismatch`);
	const dataset = validateDungeon(JSON.parse(raw.toString("utf8")));
	assert(dataset.dungeon.slug === entry.slug, `${entry.slug} slug mismatch`);
	assert(dataset.dataset_version === index.dataset_version, `${entry.slug} dataset version mismatch`);
	assert(dataset.runs.length === entry.run_count, `${entry.slug} run count mismatch`);
	assert(["api_page_limit", "exhausted", "incomplete"].includes(entry.coverage_status), `${entry.slug} coverage invalid`);
	files.push({ file: entry.file, raw });
}
const combinedRaw = await readFile(path.join(source, index.combined.file));
assert(combinedRaw.length === index.combined.size_bytes, "combined size mismatch");
assert(sha256(combinedRaw) === index.combined.sha256, "combined checksum mismatch");
files.push({ file: index.combined.file, raw: combinedRaw });

await mkdir(target, { recursive: true });
for (const item of files) {
	const staged = path.join(target, `.tmp-${item.file}`);
	await writeFile(staged, item.raw);
	assert(sha256(await readFile(staged)) === sha256(item.raw), `${item.file} staged checksum mismatch`);
	await rename(staged, path.join(target, item.file));
}
const stagedIndex = path.join(target, ".tmp-manifest.json");
await writeFile(stagedIndex, `${JSON.stringify(index, null, 2)}\n`);
await rename(stagedIndex, path.join(target, "manifest.json"));
const keep = new Set(["manifest.json", ...files.map((item) => item.file)]);
for (const entry of await readdir(target)) {
	if (entry.startsWith("analytics-") && !keep.has(entry)) await rm(path.join(target, entry), { force: true });
}
console.log(`Synced ${index.dataset_version} (${index.schema_version}) to ${target}`);
console.log(`Dungeons: ${index.dungeons.length}; combined + ${files.length} files verified`);
