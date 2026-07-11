import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// The target project root (where package.json + package-lock.json + the
// license data file live) defaults to cwd. Tests override via BUMP_ROOT.
const root = process.env.BUMP_ROOT ?? process.cwd();
const packagePath = path.join(root, 'package.json');
const lockPath = path.join(root, 'package-lock.json');

// The credits generator lives next to this script — its location is fixed
// relative to the bump script itself, not the project being bumped.
const here = path.dirname(fileURLToPath(import.meta.url));
const creditsScript = path.join(here, 'generate-license-data.mjs');

const arg = process.argv[2] ?? 'patch';
const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
const current = pkg.version;
if (typeof current !== 'string' || !/^\d+\.\d+\.\d+/.test(current)) {
	throw new Error(`package.json version "${current}" is not plain semver x.y.z`);
}

let next;
if (/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(arg)) {
	next = arg;
} else if (arg === 'major' || arg === 'minor' || arg === 'patch') {
	const [maj, min, pat] = current.split('.').map((n) => Number.parseInt(n, 10));
	next = arg === 'major' ? `${maj + 1}.0.0` : arg === 'minor' ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`;
} else {
	throw new Error(`usage: node scripts/bump-version.mjs [patch|minor|major|x.y.z]`);
}

pkg.version = next;
writeFileSync(packagePath, `${JSON.stringify(pkg, null, '\t')}\n`);

// Sync the lockfile root version. Both occurrences (top-level + "": entry)
// hold the same version string we just wrote into package.json, so a global
// replace on that single value is safe — and avoids spawning npm install
// which would risk unwanted transitive churn.
if (existsSync(lockPath)) {
	const lockRaw = readFileSync(lockPath, 'utf8');
	const replaced = lockRaw.split(`"version": "${current}"`).join(`"version": "${next}"`);
	if (replaced !== lockRaw) {
		writeFileSync(lockPath, replaced);
	}
}

// Regenerate credits so source.packageVersion + lockfileSha256 match.
const credits = spawnSync(process.execPath, [creditsScript], { cwd: root, stdio: 'inherit' });
if (credits.status !== 0) {
	process.exit(credits.status ?? 1);
}

console.log(`Bumped ${current} → ${next}`);