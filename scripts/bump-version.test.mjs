import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = join(import.meta.dirname, '..');
const script = join(repoRoot, 'scripts/bump-version.mjs');

function makeFixture() {
	const dir = mkdtempSync(join(tmpdir(), 'bump-version-test-'));
	mkdirSync(join(dir, 'src', 'lib', 'server'), { recursive: true });

	const pkg = {
		name: 'fixture',
		version: '1.2.3',
		license: 'GPL-3.0-only',
		type: 'module'
	};
	writeFileSync(join(dir, 'package.json'), `${JSON.stringify(pkg, null, '\t')}\n`);

	// Mirror the real lockfile structure: two `"version": "<x>"` lines at root
	// (the top-level version field + the "": entry's version field) that must
	// both get rewritten to match package.json.
	const lock = `{
	"name": "fixture",
	"version": "1.2.3",
	"lockfileVersion": 3,
	"packages": {
		"": {
			"name": "fixture",
			"version": "1.2.3"
		}
	}
}
`;
	writeFileSync(join(dir, 'package-lock.json'), lock);

	// Mirror the license data header that holds `packageVersion`.
	const credits = {
		schemaVersion: 1,
		source: {
			packageName: 'fixture',
			packageVersion: '1.2.3',
			lockfileSha256: 'placeholder'
		}
	};
	writeFileSync(join(dir, 'src', 'lib', 'server', 'licenseData.generated.json'), `${JSON.stringify(credits, null, '\t')}\n`);

	return dir;
}

function run(dir, arg) {
	return spawnSync(process.execPath, [script, arg], { cwd: dir, encoding: 'utf8' });
}

describe('bump-version', () => {
	let dir;

	beforeEach(() => {
		dir = makeFixture();
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it('bumps patch by default', () => {
		const r = run(dir, 'patch');
		expect(r.status, r.stderr).toBe(0);
		const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
		expect(pkg.version).toBe('1.2.4');
	});

	it('bumps minor', () => {
		const r = run(dir, 'minor');
		expect(r.status, r.stderr).toBe(0);
		expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version).toBe('1.3.0');
	});

	it('bumps major', () => {
		const r = run(dir, 'major');
		expect(r.status, r.stderr).toBe(0);
		expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version).toBe('2.0.0');
	});

	it('accepts explicit semver', () => {
		const r = run(dir, '4.5.6');
		expect(r.status, r.stderr).toBe(0);
		expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version).toBe('4.5.6');
	});

	it('rejects non-semver explicit args', () => {
		const r = run(dir, 'not-a-version');
		expect(r.status).not.toBe(0);
	});

	it('rejects package.json with non-x.y.z version', () => {
		const pkgPath = join(dir, 'package.json');
		const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
		pkg.version = 'v1.2.3';
		writeFileSync(pkgPath, `${JSON.stringify(pkg, null, '\t')}\n`);
		const r = run(dir, 'patch');
		expect(r.status).not.toBe(0);
	});

	it('syncs package-lock.json root version fields', () => {
		const r = run(dir, 'patch');
		expect(r.status, r.stderr).toBe(0);
		const lock = readFileSync(join(dir, 'package-lock.json'), 'utf8');
		expect(lock).not.toContain('"version": "1.2.3"');
		expect(lock).toContain('"version": "1.2.4"');
	});

	it('regenerates licenseData.generated.json packageVersion', () => {
		const r = run(dir, 'patch');
		expect(r.status, r.stderr).toBe(0);
		const credits = JSON.parse(readFileSync(join(dir, 'src/lib/server/licenseData.generated.json'), 'utf8'));
		expect(credits.source.packageVersion).toBe('1.2.4');
		expect(credits.source.lockfileSha256).not.toBe('placeholder');
	});
});