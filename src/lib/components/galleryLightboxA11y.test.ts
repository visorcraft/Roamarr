// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { focusableWithin, wrappedTabTarget, lightboxReturnTarget } from './galleryLightboxA11y';

function button(attrs: Record<string, string> = {}): HTMLButtonElement {
	const el = document.createElement('button');
	for (const [name, value] of Object.entries(attrs)) {
		el.setAttribute(name, value);
	}
	return el;
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('focusableWithin', () => {
	it('returns enabled controls in DOM order and skips ineligible ones', () => {
		const root = document.createElement('div');
		const first = button();
		const disabled = button({ disabled: '' });
		const hiddenInput = document.createElement('input');
		hiddenInput.setAttribute('type', 'hidden');
		const hiddenButton = button();
		hiddenButton.setAttribute('hidden', '');
		const ariaHiddenWrapper = document.createElement('div');
		ariaHiddenWrapper.setAttribute('aria-hidden', 'true');
		const ariaHiddenButton = button();
		ariaHiddenWrapper.appendChild(ariaHiddenButton);
		const tabStopNegative = button({ tabindex: '-1' });
		const anchorWithoutHref = document.createElement('a');
		const anchor = document.createElement('a');
		anchor.setAttribute('href', '#photo');
		anchor.setAttribute('tabindex', '0');
		const select = document.createElement('select');
		const textarea = document.createElement('textarea');

		for (const el of [first, disabled, hiddenInput, hiddenButton, ariaHiddenWrapper, tabStopNegative, anchorWithoutHref, anchor, select, textarea]) {
			root.appendChild(el);
		}

		const items = focusableWithin(root);
		expect(items).toEqual([first, anchor, select, textarea]);
		// anchor matches multiple selector parts and appears exactly once
		expect(items.filter((el) => el === anchor)).toHaveLength(1);
	});

	it('skips elements inside a [hidden] ancestor', () => {
		const root = document.createElement('div');
		const wrapper = document.createElement('div');
		wrapper.setAttribute('hidden', '');
		const inner = button();
		wrapper.appendChild(inner);
		const outer = button();
		root.appendChild(wrapper);
		root.appendChild(outer);

		expect(focusableWithin(root)).toEqual([outer]);
	});
});

describe('wrappedTabTarget', () => {
	it('returns null for a null root', () => {
		expect(wrappedTabTarget(null, null, false)).toBeNull();
		expect(wrappedTabTarget(null, document.body, true)).toBeNull();
	});

	it('returns the first / last control when focus is outside the root', () => {
		const root = document.createElement('div');
		const first = button();
		const middle = button();
		const last = button();
		root.append(first, middle, last);
		document.body.appendChild(root);
		const outside = button();
		document.body.appendChild(outside);
		outside.focus();

		expect(wrappedTabTarget(root, outside, false)).toBe(first);
		expect(wrappedTabTarget(root, outside, true)).toBe(last);
	});

	it('wraps at both ends and returns null for middle controls', () => {
		const root = document.createElement('div');
		const first = button();
		const middle = button();
		const last = button();
		root.append(first, middle, last);

		expect(wrappedTabTarget(root, last, false)).toBe(first);
		expect(wrappedTabTarget(root, first, true)).toBe(last);
		expect(wrappedTabTarget(root, middle, false)).toBeNull();
		expect(wrappedTabTarget(root, middle, true)).toBeNull();
	});

	it('returns the root when it has a tabindex and no focusable children, else null', () => {
		const rootWithTabindex = document.createElement('div');
		rootWithTabindex.setAttribute('tabindex', '-1');
		expect(wrappedTabTarget(rootWithTabindex, null, false)).toBe(rootWithTabindex);
		expect(wrappedTabTarget(rootWithTabindex, rootWithTabindex, true)).toBe(rootWithTabindex);

		const rootWithoutTabindex = document.createElement('div');
		expect(wrappedTabTarget(rootWithoutTabindex, null, false)).toBeNull();
	});

	it('keeps a single focusable control on Tab and Shift+Tab', () => {
		const root = document.createElement('div');
		const only = button();
		root.appendChild(only);

		expect(wrappedTabTarget(root, only, false)).toBe(only);
		expect(wrappedTabTarget(root, only, true)).toBe(only);
		expect(wrappedTabTarget(root, null, false)).toBe(only);
		expect(wrappedTabTarget(root, null, true)).toBe(only);
	});
});

describe('lightboxReturnTarget', () => {
	it('returns the connected thumbnail for the viewed index', () => {
		const root = document.createElement('div');
		const thumbs = [0, 1, 2].map((index) => {
			const thumb = button();
			thumb.setAttribute('data-gallery-index', String(index));
			root.appendChild(thumb);
			return thumb;
		});
		document.body.appendChild(root);

		expect(lightboxReturnTarget(root, 2, null)).toBe(thumbs[2]);
		expect(lightboxReturnTarget(root, 1, null)).toBe(thumbs[1]);
	});

	it('falls back to the previous focus target when no thumbnail matches', () => {
		const root = document.createElement('div');
		root.appendChild(button());
		document.body.appendChild(root);
		const previous = button();
		document.body.appendChild(previous);

		expect(lightboxReturnTarget(root, 5, previous)).toBe(previous);
		expect(lightboxReturnTarget(root, null, previous)).toBe(previous);
		expect(lightboxReturnTarget(null, 1, previous)).toBe(previous);
	});

	it('returns null when the fallback is null or disconnected', () => {
		const root = document.createElement('div');
		document.body.appendChild(root);

		expect(lightboxReturnTarget(root, null, null)).toBeNull();

		const disconnected = button();
		expect(lightboxReturnTarget(root, null, disconnected)).toBeNull();
	});

	it('ignores the previous target when the thumbnail exists', () => {
		const root = document.createElement('div');
		const thumb = button();
		thumb.setAttribute('data-gallery-index', '1');
		root.appendChild(thumb);
		document.body.appendChild(root);
		const previous = button();
		document.body.appendChild(previous);

		expect(lightboxReturnTarget(root, 1, previous)).toBe(thumb);
	});
});
