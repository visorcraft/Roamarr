// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-ignore — internal Svelte client runtime, used by the inline DOM mount harness
import { mount, unmount } from '../../../../node_modules/svelte/src/internal/client/render.js';
// @ts-ignore — internal Svelte client runtime
import { flushSync } from '../../../../node_modules/svelte/src/internal/client/reactivity/batch.js';

// Force the bare `svelte` specifier to its client build. Vitest runs under the
// node condition, which otherwise resolves `svelte` to index-server.js and makes
// lifecycle functions throw during this jsdom mount harness.
// @ts-ignore — internal Svelte client runtime
vi.mock('svelte', async () => await import('../../../../node_modules/svelte/src/index-client.js'));

// Stub the kit modules the page imports but never calls in this flow.
const { submitted } = vi.hoisted(() => ({ submitted: [] as Array<(o: any) => Promise<void>> }));
vi.mock('$app/forms', () => ({
	enhance: (node: HTMLFormElement, param: (info: unknown) => (o: any) => Promise<void>) => {
		node.addEventListener('submit', (event) => {
			event.preventDefault();
			submitted.push(param({ formElement: node, formData: new FormData(node), action: node.action, cancel() {}, submitter: undefined }));
		});
		return { destroy() {} };
	}
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
// The modal components gate mount work on `$app/env` browser.
vi.mock('$app/env', () => ({ browser: true, dev: false, building: false, version: '0.0.0' }));

import { tick } from 'svelte';
import ContactsPage from './+page.svelte';

function buildData() {
	return {
		emergencyContacts: [
			{ id: 1, name: 'Ada Lovelace', relationship: null, phone: null, email: null, isPrimary: false }
		]
	} as any;
}

describe('profile/contacts (client)', () => {
	const mounted: unknown[] = [];

	afterEach(() => {
		submitted.length = 0;
		for (const app of mounted) {
			unmount(app);
		}
		mounted.length = 0;
		document.body.innerHTML = '';
	});

	function mountPage() {
		const app = mount(ContactsPage, {
			target: document.body,
			props: { data: buildData(), form: undefined } as any
		});
		flushSync();
		mounted.push(app);
		return app;
	}

	async function openEditor() {
		const editButton = document.querySelector('button[aria-label="Edit Ada Lovelace"]') as HTMLButtonElement;
		expect(editButton).toBeTruthy();
		editButton.click();
		await tick();
	}

	function editForm() {
		const nameInput = document.querySelector('#ec-name-1') as HTMLInputElement | null;
		expect(nameInput).toBeTruthy();
		return nameInput!.closest('form') as HTMLFormElement;
	}

	function saveButton() {
		return Array.from(editForm().querySelectorAll('button')).find(
			(b) => b.textContent?.trim() === 'Save'
		) as HTMLButtonElement;
	}

	function addButton() {
		const nameInput = document.querySelector('#ec-name') as HTMLInputElement;
		const form = nameInput.closest('form') as HTMLFormElement;
		return Array.from(form.querySelectorAll('button')).find(
			(b) => b.textContent?.trim() === 'Add contact'
		) as HTMLButtonElement;
	}

	function submitEditForm() {
		const nameInput = document.querySelector('#ec-name-1') as HTMLInputElement;
		nameInput.value = 'Ada King';
		nameInput.dispatchEvent(new Event('input', { bubbles: true }));
		const form = editForm();
		form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
	}

	it('keeps the typed edit values when the action fails', async () => {
		mountPage();
		await openEditor();
		submitEditForm();
		await tick();

		const save = saveButton();
		expect(save.disabled).toBe(true);
		expect(save.getAttribute('aria-busy')).toBe('true');
		const add = addButton();
		expect(add.disabled).toBe(false);

		expect(submitted.length).toBe(1);
		await submitted[0]({
			result: { type: 'failure', status: 400, data: { error: 'x' } },
			update: async () => undefined
		});
		await tick();

		const after = document.querySelector('#ec-name-1') as HTMLInputElement | null;
		expect(after).toBeTruthy();
		expect(after!.value).toBe('Ada King');
		const saveAfter = saveButton();
		expect(saveAfter.disabled).toBe(false);
		expect(saveAfter.getAttribute('aria-busy')).toBe('false');
	});

	it('resets the editing state when the request rejects', async () => {
		mountPage();
		await openEditor();
		submitEditForm();
		await tick();

		expect(submitted.length).toBe(1);
		await expect(
			submitted[0]({
				result: undefined,
				update: async () => {
					throw new Error('network');
				}
			})
		).rejects.toThrow('network');
		await tick();

		const after = document.querySelector('#ec-name-1') as HTMLInputElement | null;
		expect(after).toBeTruthy();
		const saveAfter = saveButton();
		expect(saveAfter.disabled).toBe(false);
		expect(saveAfter.getAttribute('aria-busy')).toBe('false');
	});

	it('keeps the typed edit values when the action returns an error', async () => {
		mountPage();
		await openEditor();
		submitEditForm();
		await tick();

		expect(submitted.length).toBe(1);
		await submitted[0]({
			result: { type: 'error', status: 500, error: { message: 'boom' } },
			update: async () => undefined
		});
		await tick();

		const after = document.querySelector('#ec-name-1') as HTMLInputElement | null;
		expect(after).toBeTruthy();
		expect(after!.value).toBe('Ada King');
		const saveAfter = saveButton();
		expect(saveAfter.disabled).toBe(false);
		expect(saveAfter.getAttribute('aria-busy')).toBe('false');
	});

	it('closes the editor on a successful submit', async () => {
		mountPage();
		await openEditor();
		submitEditForm();
		await tick();

		expect(submitted.length).toBe(1);
		await submitted[0]({
			result: { type: 'success', status: 200 },
			update: async () => undefined
		});
		await tick();

		expect(document.querySelector('#ec-name-1')).toBeNull();
		expect(document.querySelector('button[aria-label="Edit Ada Lovelace"]')).toBeTruthy();
	});

	it('keeps the add-form values when the action fails', async () => {
		mountPage();
		const nameInput = document.querySelector('#ec-name') as HTMLInputElement;
		nameInput.value = 'Grace Hopper';
		nameInput.dispatchEvent(new Event('input', { bubbles: true }));
		const form = nameInput.closest('form') as HTMLFormElement;
		form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
		await tick();

		const add = addButton();
		expect(add.disabled).toBe(true);
		expect(add.getAttribute('aria-busy')).toBe('true');

		expect(submitted.length).toBe(1);
		await submitted[0]({
			result: { type: 'failure', status: 400, data: { error: 'x' } },
			update: async () => undefined
		});
		await tick();

		const addAfter = addButton();
		expect(addAfter.disabled).toBe(false);
		expect(addAfter.getAttribute('aria-busy')).toBe('false');
		expect((document.querySelector('#ec-name') as HTMLInputElement).value).toBe('Grace Hopper');
	});
});
