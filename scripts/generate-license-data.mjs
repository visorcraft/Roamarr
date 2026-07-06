import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'src/lib/server/licenseData.generated.json');

const PROJECT_LICENSE_NAMES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING', 'COPYING.md'];
const PACKAGE_LICENSE_RE = /^(licen[cs]e|copying|copyright|notice)(\..*)?$/i;

function runtimeComponentsFor(lock) {
	const components = [
		{
			name: 'Node.js runtime',
			licenses: 'MIT',
			url: 'https://nodejs.org/',
			usage: 'Required JavaScript runtime for the SvelteKit adapter-node server.'
		}
	];

	for (const packageName of ['@visorcraft/mongreldb', '@visorcraft/mongreldb-kit']) {
		const packagePath = `node_modules/${packageName}`;
		const packageJsonPath = path.join(root, packagePath, 'package.json');
		if (!existsSync(packageJsonPath)) continue;
		const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
		const version = pkg.version ?? lock.packages?.[packagePath]?.version ?? 'unknown';
		const license = licenseExpression(pkg);
		const url = normalizeRepository(pkg.repository, pkg.homepage, pkg.bugs);
		if (packageName === '@visorcraft/mongreldb') {
			components.push({
				name: `MongrelDB engine ${version}`,
				licenses: license,
				url,
				usage: 'Native database engine (Rust) bundled in the @visorcraft/mongreldb npm package.'
			});
		} else {
			components.push({
				name: `MongrelDB Kit ${version}`,
				licenses: license,
				url,
				usage: 'Schema/query-builder layer (TypeScript/Rust/Python) bundled in the @visorcraft/mongreldb-kit npm package.'
			});
		}
	}

	return components;
}

function buildRuntimeLicensesText(components) {
	const lines = [
		'Runtime components',
		'==================',
		'',
		'Roamarr is a Node.js application. These runtime components are required for',
		'common source builds and deployments, but most are provided by the host operating',
		'system rather than by Roamarr source code. The @visorcraft/mongreldb and',
		'@visorcraft/mongreldb-kit packages bundle Rust crates that power the database',
		'engine and persistence layer.',
		''
	];
	for (const component of components) {
		const title = component.name;
		lines.push(title);
		lines.push('-'.repeat(title.length));
		lines.push(`License: ${component.licenses}`);
		lines.push(`Project: ${component.url}`);
		lines.push(`Usage: ${component.usage}`);
		lines.push('');
	}
	lines.push(
		'Node.js itself carries its own bundled third-party notices. For the complete',
		'notice set for the exact Node.js binary you distribute, include the LICENSE file',
		'shipped by that Node.js release.'
	);
	return lines.join('\n');
}

function readJson(file) {
	return JSON.parse(readFileSync(path.join(root, file), 'utf8'));
}

function normalizeRepository(repo, homepage, bugs) {
	let url = '';
	if (typeof repo === 'string') url = repo;
	else if (repo && typeof repo.url === 'string') url = repo.url;
	else if (typeof homepage === 'string') url = homepage;
	else if (bugs && typeof bugs.url === 'string') url = bugs.url;

	url = url
		.trim()
		.replace(/^git\+/, '')
		.replace(/^git:\/\//, 'https://')
		.replace(/^ssh:\/\/git@github\.com[:/]/, 'https://github.com/')
		.replace(/^ssh:\/\/github\.com\//, 'https://github.com/')
		.replace(/^git@github\.com:/, 'https://github.com/')
		.replace(/^github:/, 'https://github.com/')
		.replace(/\.git(#.*)?$/, '');

	if (/^[\w.-]+\/[\w.-]+$/.test(url)) return `https://github.com/${url}`;
	return url;
}

function licenseExpression(pkg) {
	if (typeof pkg.license === 'string') return pkg.license;
	if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type;
	if (Array.isArray(pkg.licenses)) {
		const licenses = pkg.licenses
			.map((license) => (typeof license === 'string' ? license : license?.type))
			.filter(Boolean);
		if (licenses.length) return licenses.join(' OR ');
	}
	return 'UNKNOWN';
}

function findProjectLicense(rootPackage) {
	for (const name of PROJECT_LICENSE_NAMES) {
		const candidate = path.join(root, name);
		if (existsSync(candidate)) {
			return {
				title: 'Roamarr License',
				subtitle: `${name} bundled from the repository root.`,
				body: readFileSync(candidate, 'utf8').replace(/\r\n/g, '\n').trimEnd()
			};
		}
	}

	const declared = licenseExpression(rootPackage);
	const declaredLine = declared === 'UNKNOWN' ? 'No package.json license field was found.' : `Declared package license: ${declared}.`;
	return {
		title: 'Roamarr License',
		subtitle: 'No top-level project license file is currently bundled.',
		body: `Roamarr does not currently include a top-level LICENSE file.

${declaredLine}

This page is reserved for the Roamarr project license. Add a LICENSE file at the
repository root and rerun npm run credits:generate to bundle it here.

Third-party dependency and runtime attributions are bundled in the adjacent tabs.`
	};
}

function findLicenseFiles(packageDir) {
	if (!existsSync(packageDir)) return [];
	const entries = readdirSync(packageDir, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile() && PACKAGE_LICENSE_RE.test(entry.name))
		.map((entry) => path.join(packageDir, entry.name))
		.sort((a, b) => {
			const aa = path.basename(a).toLowerCase();
			const bb = path.basename(b).toLowerCase();
			const rank = (name) => (name.startsWith('license') ? 0 : name.startsWith('copying') ? 1 : name.startsWith('notice') ? 2 : 3);
			return rank(aa) - rank(bb) || aa.localeCompare(bb);
		});
}

function readLicenseText(files) {
	if (!files.length) return '';
	return files
		.map((file) => {
			const label = path.basename(file);
			const body = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trimEnd();
			return files.length === 1 ? body : `${label}\n${'='.repeat(label.length)}\n\n${body}`;
		})
		.join('\n\n');
}

function packageRows(lock) {
	const rows = [];
	const seen = new Map();

	for (const [packagePath, meta] of Object.entries(lock.packages)) {
		if (!packagePath.startsWith('node_modules/')) continue;
		const packageJsonPath = path.join(root, packagePath, 'package.json');
		if (!existsSync(packageJsonPath)) continue;

		const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
		const name = pkg.name ?? packagePath.replace(/^node_modules\//, '');
		const version = pkg.version ?? meta.version ?? '0.0.0';
		const key = `${name}@${version}`;
		const scope = meta.dev ? 'development' : 'production';
		const licenseFiles = findLicenseFiles(path.dirname(packageJsonPath));
		const licenseText = readLicenseText(licenseFiles);
		const row = {
			name,
			version,
			license: licenseExpression(pkg),
			scope,
			url: normalizeRepository(pkg.repository, pkg.homepage, pkg.bugs),
			packagePath,
			licenseFiles: licenseFiles.map((file) => path.relative(path.dirname(packageJsonPath), file)),
			licenseText
		};

		const existing = seen.get(key);
		if (!existing) {
			seen.set(key, row);
			continue;
		}
		if (existing.scope === 'development' && row.scope === 'production') {
			seen.set(key, { ...row, scope: 'production' });
		}
	}

	rows.push(...seen.values());
	return rows.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

function lineCount(text) {
	return text.length ? text.split('\n').length : 0;
}

function buildThirdPartyText(packages) {
	const counts = new Map();
	for (const pkg of packages) counts.set(pkg.license, (counts.get(pkg.license) ?? 0) + 1);
	const overview = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
	const packageList = packages.map((pkg) => `- ${pkg.name} ${pkg.version} (${pkg.scope}) - ${pkg.license}`).join('\n');
	const sections = packages
		.map((pkg) => {
			const fileLine = pkg.licenseFiles.length ? pkg.licenseFiles.join(', ') : 'No license file found in installed package.';
			const source = pkg.url || 'No repository URL declared.';
			const body = pkg.licenseText || `No license text was found in the installed package. Declared license: ${pkg.license}.`;
			return `## ${pkg.name} ${pkg.version}

Scope: ${pkg.scope}
License: ${pkg.license}
Project: ${source}
License files: ${fileLine}

${body}`;
		})
		.join('\n\n---\n\n');

	return `Third-party licenses
====================

This document lists npm packages installed from Roamarr's package-lock.json on
the generation host. It includes production and development packages because the
source distribution, test suite, build pipeline, and runtime all rely on parts of
the locked dependency graph.

Regenerate with:

    npm run credits:generate

License expressions in package metadata are summaries. The package license text
bundled below is copied from each installed package when a license, copying,
copyright, or notice file is present.

Packages: ${packages.length}

Licenses in use
---------------

${overview.map(([license, count]) => `- ${license}: ${count}`).join('\n')}

Packages
--------

${packageList}

License texts
-------------

${sections}
`;
}

function buildAcknowledgementsText(packages, components) {
	const production = packages.filter((pkg) => pkg.scope === 'production').length;
	const development = packages.length - production;
	return `Credits and attribution
=======================

Roamarr is built with SvelteKit, Svelte, MongrelDB Kit, Tailwind CSS,
Vitest, and the wider npm ecosystem. The @visorcraft/mongreldb and
@visorcraft/mongreldb-kit packages bundle Rust crates that provide the
MongrelDB database engine and persistence layer.

This attribution bundle was generated from package-lock.json and the installed
package metadata in node_modules.

Package summary
---------------

- Total npm packages listed here: ${packages.length}
- Production/runtime packages: ${production}
- Development/build/test packages: ${development}
- Runtime components: ${components.length}

Runtime components
------------------

${components.map((component) => `- ${component.name}: ${component.licenses} (${component.url})`).join('\n')}

Reporting attribution gaps
--------------------------

If you find code, assets, or packages in this repository that are not credited
correctly, please open an issue so the attribution record can be corrected.
`;
}

function redactPackageForCredits(pkg) {
	return {
		name: pkg.name,
		version: pkg.version,
		license: pkg.license,
		scope: pkg.scope,
		url: pkg.url,
		packagePath: pkg.packagePath
	};
}

const rootPackage = readJson('package.json');
const lock = readJson('package-lock.json');
const packages = packageRows(lock);
const projectLicense = findProjectLicense(rootPackage);
const runtimeComponents = runtimeComponentsFor(lock);
const thirdPartyLicensesText = buildThirdPartyText(packages);
const acknowledgementsText = buildAcknowledgementsText(packages, runtimeComponents);
const runtimeLicensesText = buildRuntimeLicensesText(runtimeComponents);
const lockHash = createHash('sha256').update(readFileSync(path.join(root, 'package-lock.json'))).digest('hex');

const output = {
	schemaVersion: 1,
	source: {
		packageName: rootPackage.name,
		packageVersion: rootPackage.version,
		lockfileSha256: lockHash
	},
	projectLicense: {
		...projectLicense,
		lineCount: lineCount(projectLicense.body)
	},
	thirdPartyLicensesText,
	acknowledgementsText,
	runtimeLicensesText,
	packages: packages.map(redactPackageForCredits),
	runtimeComponents,
	counts: {
		packages: packages.length,
		productionPackages: packages.filter((pkg) => pkg.scope === 'production').length,
		developmentPackages: packages.filter((pkg) => pkg.scope === 'development').length,
		runtimeComponents: runtimeComponents.length
	}
};

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(output, null, '\t')}\n`);
console.log(`Wrote ${path.relative(root, outputPath)} with ${packages.length} package credits.`);
