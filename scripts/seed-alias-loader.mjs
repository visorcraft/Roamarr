import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const repoRoot = new URL('../', import.meta.url);
const APP_ENV_URL = 'virtual:$app/environment';

/**
 * Resolve a `$lib/` specifier to a concrete `.ts` file URL.
 * Tries `<subpath>.ts` first, then `<subpath>/index.ts`.
 */
function resolveLibUrl(specifier) {
	const subpath = specifier.slice(5);
	const basePath = new URL('src/lib/' + subpath, repoRoot).pathname;

	const candidates = [basePath + '.ts', basePath + '/index.ts'];
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return pathToFileURL(candidate).href;
		}
	}
	return null;
}

/**
 * True when the specifier's final path segment has no known module extension.
 * Treats `.` and `..` as extensionless so they can be directory indexes.
 */
function isExtensionless(specifier) {
	const base = specifier.split('/').pop();
	if (base === '.' || base === '..') return true;
	const lastDot = base.lastIndexOf('.');
	if (lastDot <= 0) return true;
	const ext = base.slice(lastDot);
	const knownExts = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.node']);
	return !knownExts.has(ext);
}

/**
 * Build candidate URLs for an extensionless file/directory import.
 */
function candidateUrls(specifier, parentUrl) {
	const base = specifier.startsWith('file:')
		? specifier
		: new URL(specifier, parentUrl).href;
	const trimmed = base.replace(/\/$/, '');
	return [trimmed + '.ts', trimmed + '/index.ts'];
}

/**
 * True for relative or absolute file-path specifiers that we may want to
 * backfill with a `.ts` extension or `index.ts` directory entry.
 */
function isLocalPathSpecifier(specifier) {
	return (
		specifier.startsWith('./') ||
		specifier.startsWith('../') ||
		specifier.startsWith('/') ||
		specifier.startsWith('file:')
	);
}

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === '$app/environment') {
			return { url: APP_ENV_URL, shortCircuit: true };
		}

		if (specifier.startsWith('$lib/')) {
			const resolved = resolveLibUrl(specifier);
			if (!resolved) {
				throw new Error(`Cannot resolve $lib import: ${specifier}`);
			}
			return nextResolve(resolved, context);
		}

		try {
			return nextResolve(specifier, context);
		} catch (err) {
			const retryCodes = new Set(['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT']);
			if (
				!retryCodes.has(err?.code) ||
				!isExtensionless(specifier) ||
				!isLocalPathSpecifier(specifier)
			) {
				throw err;
			}

			const parentUrl = context.parentURL ?? repoRoot.href;
			for (const candidate of candidateUrls(specifier, parentUrl)) {
				try {
					return nextResolve(candidate, context);
				} catch {
					// try the next candidate
				}
			}

			throw err;
		}
	},

	load(url, context, nextLoad) {
		if (url === APP_ENV_URL) {
			return {
				format: 'module',
				source:
					"export const dev = false;\n" +
					"export const browser = false;\n" +
					"export const building = false;\n" +
					"export const version = 'seed';\n",
				shortCircuit: true
			};
		}

		return nextLoad(url, context);
	}
});
