import { expect, test } from 'vitest';
import { load } from './+page.server';

const locals = { user: { id: 1, role: 'user' } };

test('licenses load defaults to project document', () => {
	const result = load({
		locals,
		url: new URL('http://localhost/settings/about/licenses')
	} as any) as any;

	expect(result.activeTab).toBe('project');
	expect(result.tabs.map((tab: { id: string }) => tab.id)).toContain('third-party');
	expect(result.currentDocument.title).toBe('Roamarr License');
});

test('licenses load selects requested tab', () => {
	const result = load({
		locals,
		url: new URL('http://localhost/settings/about/licenses?tab=third-party')
	} as any) as any;

	expect(result.activeTab).toBe('third-party');
	expect(result.currentDocument.body).toContain('Third-party licenses');
});
