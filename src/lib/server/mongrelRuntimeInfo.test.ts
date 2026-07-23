import { expect, test } from 'vitest';
import { getMongrelRuntimeInfo } from './mongrelRuntimeInfo';

test('reports installed package versions and native build identity', () => {
	const info = getMongrelRuntimeInfo();
	expect(info.enginePackageVersion).toMatch(/^\d+\.\d+\.\d+/);
	expect(info.kitPackageVersion).toMatch(/^\d+\.\d+\.\d+/);
	expect(info.engineVersion).toMatch(/^\d+\.\d+\.\d+/);
	expect(info.artifactVersion).toMatch(/^\d+\.\d+\.\d+/);
	expect(info.queryVersion).toMatch(/^\d+\.\d+\.\d+/);
	expect(info.gitSha.length).toBeGreaterThan(7);
});
