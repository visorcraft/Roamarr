import { test, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { installFieldErrorA11y } from './fieldErrorA11y';

const tick = () => new Promise((r) => setTimeout(r, 0));

test('wires errors already present at install time', () => {
	const dom = new JSDOM(`<!DOCTYPE html><body>
		<div class="field">
			<input id="email" class="input" />
			<p class="field-error">Invalid email</p>
		</div></body>`);
	const doc = dom.window.document;
	const disconnect = installFieldErrorA11y(doc);

	const input = doc.getElementById('email')!;
	const error = doc.querySelector('.field-error')!;
	expect(input.getAttribute('aria-invalid')).toBe('true');
	expect(input.getAttribute('aria-describedby')).toBe('email-error');
	expect(error.id).toBe('email-error');
	disconnect();
});

test('reactively wires errors added after install and clears on removal', async () => {
	const dom = new JSDOM(`<!DOCTYPE html><body>
		<div class="field">
			<input id="title" class="input" />
		</div></body>`);
	const doc = dom.window.document;
	const field = doc.querySelector('.field')!;
	const input = doc.getElementById('title')!;
	const disconnect = installFieldErrorA11y(doc);

	expect(input.getAttribute('aria-invalid')).toBeNull();

	const error = doc.createElement('p');
	error.className = 'field-error';
	error.textContent = 'Required';
	field.appendChild(error);
	await tick();

	expect(input.getAttribute('aria-invalid')).toBe('true');
	expect(input.getAttribute('aria-describedby')).toBe('title-error');
	expect(error.id).toBe('title-error');

	error.remove();
	await tick();
	expect(input.getAttribute('aria-invalid')).toBeNull();
	expect(input.getAttribute('aria-describedby')).toBeNull();
	disconnect();
});

test('works for select and textarea controls', async () => {
	const dom = new JSDOM(`<!DOCTYPE html><body>
		<div class="field">
			<select id="country"><option>US</option></select>
		</div>
		<div class="field">
			<textarea id="notes"></textarea>
		</div></body>`);
	const doc = dom.window.document;
	const disconnect = installFieldErrorA11y(doc);

	doc.querySelector('.field:nth-of-type(1)')!.append(Object.assign(doc.createElement('p'), { className: 'field-error', textContent: 'Pick one' }));
	doc.querySelector('.field:nth-of-type(2)')!.append(Object.assign(doc.createElement('p'), { className: 'field-error', textContent: 'Required' }));
	await tick();

	expect(doc.getElementById('country')!.getAttribute('aria-invalid')).toBe('true');
	expect(doc.getElementById('country')!.getAttribute('aria-describedby')).toBe('country-error');
	expect(doc.getElementById('notes')!.getAttribute('aria-invalid')).toBe('true');
	expect(doc.getElementById('notes')!.getAttribute('aria-describedby')).toBe('notes-error');
	disconnect();
});

test('no-ops gracefully when there is no control or no id', async () => {
	const dom = new JSDOM(`<!DOCTYPE html><body>
		<div class="field"><p class="field-error">orphan</p></div></body>`);
	const doc = dom.window.document;
	const disconnect = installFieldErrorA11y(doc);
	// no control present — nothing to wire, must not throw
	expect(doc.querySelector('.field-error')!.id).toBe('');
	disconnect();
});
