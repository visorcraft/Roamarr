import { expect, test } from 'vitest';
import pkg from '../../package.json';
import { appInfo } from './appInfo';

test('uses package metadata for app display info', () => {
	expect(appInfo.name).toBe('Roamarr');
	expect(appInfo.version).toBe(pkg.version);
});
