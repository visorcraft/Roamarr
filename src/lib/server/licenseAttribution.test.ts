import { describe, expect, test } from 'vitest';
import { getCreditsData, getLicenseDocument, getLicenseDocuments } from './licenseAttribution';

describe('license attribution data', () => {
	test('provides the expected license documents', () => {
		const docs = getLicenseDocuments();

		expect(docs.map((doc) => doc.id)).toEqual([
			'project',
			'third-party',
			'acknowledgements',
			'runtime'
		]);
		expect(getLicenseDocument('third-party').body).toContain('Third-party licenses');
		expect(getLicenseDocument('runtime').body).toContain('Node.js runtime');
		expect(getLicenseDocument('unknown').id).toBe('project');
	});

	test('provides package and runtime credit rows', () => {
		const credits = getCreditsData();

		expect(credits.packages.length).toBeGreaterThan(0);
		expect(credits.packages.some((pkg) => pkg.name === 'svelte')).toBe(true);
		expect(credits.packages.some((pkg) => pkg.name === 'better-sqlite3')).toBe(true);
		expect(credits.runtimeComponents.some((component) => component.name === 'Node.js runtime')).toBe(true);
		expect(credits.counts.packages).toBe(credits.packages.length);
	});
});
