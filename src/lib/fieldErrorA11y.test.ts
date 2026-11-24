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

test('wires hints already present at install time', () => {
	const dom = new JSDOM(`<!DOCTYPE html><body>
		<div class="field">
			<label class="label" for="donorId">Donor trip</label>
			<p class="field-help">This trip is deleted after its contents move.</p>
			<select id="donorId"><option value="">Choose donor</option></select>
		</div></body>`);
	const doc = dom.window.document;
	const disconnect = installFieldErrorA11y(doc);

	const select = doc.getElementById('donorId')!;
	const hint = doc.querySelector('.field-help')!;
	expect(hint.id).toBe('donorId-hint-1');
	expect(select.getAttribute('aria-describedby')).toBe('donorId-hint-1');
	expect(select.getAttribute('aria-invalid')).toBeNull();
	disconnect();
});

test('keeps the hint described while an error is shown and after it clears', async () => {
	const dom = new JSDOM(`<!DOCTYPE html><body>
		<div class="field">
			<label class="label" for="donorId">Donor trip</label>
			<p class="field-help">This trip is deleted after its contents move.</p>
			<select id="donorId"><option value="">Choose donor</option></select>
		</div></body>`);
	const doc = dom.window.document;
	const field = doc.querySelector('.field')!;
	const select = doc.getElementById('donorId')!;
	const disconnect = installFieldErrorA11y(doc);

	const error = doc.createElement('p');
	error.className = 'field-error';
	error.textContent = 'Required';
	field.appendChild(error);
	await tick();

	expect(select.getAttribute('aria-invalid')).toBe('true');
	expect(select.getAttribute('aria-describedby')).toBe('donorId-hint-1 donorId-error');

	error.remove();
	await tick();

	expect(select.getAttribute('aria-invalid')).toBeNull();
	expect(select.getAttribute('aria-describedby')).toBe('donorId-hint-1');
	disconnect();
});

test('preserves describedby tokens the template authored', async () => {
	const dom = new JSDOM(`<!DOCTYPE html><body>
		<div class="field">
			<input id="expiresAt" aria-describedby="external-note" />
			<p class="field-help">Leave empty for a key that never expires.</p>
			<p class="field-error">Enter a valid date</p>
		</div></body>`);
	const doc = dom.window.document;
	const input = doc.getElementById('expiresAt')!;
	const disconnect = installFieldErrorA11y(doc);

	expect(input.getAttribute('aria-describedby')).toBe('external-note expiresAt-hint-1 expiresAt-error');

	doc.querySelector('.field-error')!.remove();
	await tick();

	expect(input.getAttribute('aria-describedby')).toBe('external-note expiresAt-hint-1');
	disconnect();
});

test('reuses an id the hint already has', () => {
	const dom = new JSDOM(`<!DOCTYPE html><body>
		<div class="field">
			<input id="expiresAt" />
			<p class="field-help" id="expiry-help">Leave empty for a key that never expires.</p>
		</div></body>`);
	const doc = dom.window.document;
	const disconnect = installFieldErrorA11y(doc);

	const input = doc.getElementById('expiresAt')!;
	const hint = doc.querySelector('.field-help')!;
	expect(hint.id).toBe('expiry-help');
	expect(input.getAttribute('aria-describedby')).toBe('expiry-help');
	disconnect();
});

test('wires hints added after install and drops them on removal', async () => {
	const dom = new JSDOM(`<!DOCTYPE html><body>
		<div class="field">
			<input id="q" />
		</div></body>`);
	const doc = dom.window.document;
	const field = doc.querySelector('.field')!;
	const input = doc.getElementById('q')!;
	const disconnect = installFieldErrorA11y(doc);

	expect(input.getAttribute('aria-describedby')).toBeNull();

	const hint = doc.createElement('p');
	hint.className = 'field-help';
	hint.textContent = 'Markdown supported';
	field.appendChild(hint);
	await tick();

	expect(input.getAttribute('aria-describedby')).toBe('q-hint-1');
	expect(hint.id).toBe('q-hint-1');

	hint.remove();
	await tick();

	expect(input.getAttribute('aria-describedby')).toBeNull();
	disconnect();
});

test('gives id-less errors unique ids and keeps the survivor described', async () => {
	const dom = new JSDOM(`<!DOCTYPE html><body>
		<div class="field">
			<input id="tags" />
		</div></body>`);
	const doc = dom.window.document;
	const field = doc.querySelector('.field')!;
	const input = doc.getElementById('tags')!;
	const disconnect = installFieldErrorA11y(doc);

	const first = doc.createElement('p');
	first.className = 'field-error';
	first.textContent = 'Required';
	field.appendChild(first);
	await tick();

	const second = doc.createElement('p');
	second.className = 'field-error';
	second.textContent = 'Too many';
	field.appendChild(second);
	await tick();

	expect(first.id).toBe('tags-error');
	expect(second.id).toBe('tags-error-2');
	expect(first.id).not.toBe(second.id);
	expect(doc.querySelectorAll('#tags-error').length).toBe(1);
	expect(doc.querySelectorAll('#tags-error-2').length).toBe(1);
	expect(input.getAttribute('aria-describedby')).toBe('tags-error tags-error-2');

	first.remove();
	await tick();

	expect(input.getAttribute('aria-describedby')).toBe('tags-error-2');
	expect(input.getAttribute('aria-invalid')).toBe('true');

	second.remove();
	await tick();

	expect(input.getAttribute('aria-invalid')).toBeNull();
	expect(input.getAttribute('aria-describedby')).toBeNull();
	disconnect();
});

test('scopes hints to their nearest field', () => {
	const dom = new JSDOM(`<!DOCTYPE html><body>
		<div class="field">
			<label class="label" for="outer">Outer</label>
			<input id="outer" />
			<p class="field-help">Outer hint</p>
			<div class="field">
				<label class="label" for="inner">Inner</label>
				<input id="inner" />
				<p class="field-help">Inner hint</p>
			</div>
		</div>
		<div class="settings-row">
			<p class="field-help">Row hint</p>
		</div></body>`);
	const doc = dom.window.document;
	const disconnect = installFieldErrorA11y(doc);

	const outer = doc.getElementById('outer')!;
	const inner = doc.getElementById('inner')!;
	const outerHint = doc.querySelector('.field > .field-help')!;
	const innerHint = doc.querySelector('.field .field > .field-help')!;
	const rowHint = doc.querySelector('.settings-row .field-help')!;
	expect(outerHint.id).toBe('outer-hint-1');
	expect(innerHint.id).toBe('inner-hint-1');
	expect(outer.getAttribute('aria-describedby')).toBe('outer-hint-1');
	expect(inner.getAttribute('aria-describedby')).toBe('inner-hint-1');
	expect(rowHint.id).toBe('');
	disconnect();
});

test('leaves controls without an id untouched', () => {
	const dom = new JSDOM(`<!DOCTYPE html><body>
		<div class="field">
			<input />
			<p class="field-help">Markdown supported</p>
		</div></body>`);
	const doc = dom.window.document;
	const disconnect = installFieldErrorA11y(doc);

	const input = doc.querySelector('.field input')!;
	const hint = doc.querySelector('.field-help')!;
	expect(input.getAttribute('aria-describedby')).toBeNull();
	expect(hint.id).toBe('');
	disconnect();
});
