import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mongreldb from '@visorcraft/mongreldb';

export type MongrelRuntimeInfo = {
	/** Installed `@visorcraft/mongreldb` package version. */
	enginePackageVersion: string | null;
	/** Installed `@visorcraft/mongreldb-kit` package version. */
	kitPackageVersion: string | null;
	/** Native addon build identity from `buildInfo()`. */
	artifactVersion: string;
	engineVersion: string;
	queryVersion: string;
	gitSha: string;
};

function installedPackageVersion(packageName: string): string | null {
	try {
		const entryUrl = import.meta.resolve(packageName);
		let dir = dirname(fileURLToPath(entryUrl));
		for (let i = 0; i < 6; i++) {
			const packageJsonPath = join(dir, 'package.json');
			if (existsSync(packageJsonPath)) {
				const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
					name?: string;
					version?: string;
				};
				if (pkg.name === packageName && typeof pkg.version === 'string') {
					return pkg.version;
				}
			}
			const parent = dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
	} catch {
		// Missing install or unresolvable package — surface as null.
	}
	return null;
}

/**
 * Snapshot of the MongrelDB engine + kit versions running in this process.
 * Used by About / ops surfaces so an upgrade can be verified without shell access.
 */
export function getMongrelRuntimeInfo(): MongrelRuntimeInfo {
	const build = mongreldb.buildInfo();
	return {
		enginePackageVersion: installedPackageVersion('@visorcraft/mongreldb'),
		kitPackageVersion: installedPackageVersion('@visorcraft/mongreldb-kit'),
		artifactVersion: build.artifactVersion,
		engineVersion: build.engineVersion,
		queryVersion: build.queryVersion,
		gitSha: build.mongreldbGitSha
	};
}
