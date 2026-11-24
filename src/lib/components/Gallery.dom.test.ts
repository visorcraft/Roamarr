// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
// @ts-ignore — internal Svelte client runtime, used by the inline DOM test helper
import { mount, unmount } from '../../../node_modules/svelte/src/internal/client/render.js';
// @ts-ignore — internal Svelte client runtime
import { flushSync } from '../../../node_modules/svelte/src/internal/client/reactivity/batch.js';
// @ts-ignore — raw text import handled by Vite
import gallerySource from './Gallery.svelte?raw';
import Gallery from './Gallery.svelte';

const images = [
	{ id: 1, url: '/places/3/gallery/1', caption: 'Sunset', filename: 'sunset.png' },
	{ id: 2, url: '/places/3/gallery/2', caption: null, filename: 'trail.png' },
	{ id: 3, url: '/places/3/gallery/3', caption: 'Lake', filename: 'lake.png' }
];

function thumbnail(index: number): HTMLButtonElement {
	const thumb = document.querySelector<HTMLButtonElement>(`.gallery-thumb[data-gallery-index="${index}"]`);
	expect(thumb).toBeTruthy();
	return thumb as HTMLButtonElement;
}

function lightbox(): HTMLElement {
	const el = document.querySelector<HTMLElement>('.gallery-lightbox');
	expect(el).toBeTruthy();
	return el as HTMLElement;
}

function prev(): HTMLButtonElement {
	return document.querySelector<HTMLButtonElement>('.gallery-lightbox-prev') as HTMLButtonElement;
}

function next(): HTMLButtonElement {
	return document.querySelector<HTMLButtonElement>('.gallery-lightbox-next') as HTMLButtonElement;
}

function close(): HTMLButtonElement {
	return document.querySelector<HTMLButtonElement>('.gallery-lightbox-close') as HTMLButtonElement;
}

function backdrop(): HTMLButtonElement {
	return document.querySelector<HTMLButtonElement>('.gallery-lightbox-backdrop') as HTMLButtonElement;
}

function statusLine(): HTMLElement {
	const el = document.querySelector<HTMLElement>('.gallery-lightbox [role="status"]');
	expect(el).toBeTruthy();
	return el as HTMLElement;
}

function pressKey(key: string, shiftKey = false): KeyboardEvent {
	const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
	(document.activeElement as HTMLElement).dispatchEvent(event);
	flushSync();
	return event;
}

describe('Gallery (client)', () => {
	const mounted: unknown[] = [];

	afterEach(() => {
		for (const app of mounted) {
			unmount(app);
		}
		mounted.length = 0;
		document.body.innerHTML = '';
	});

	function mountGallery(props?: Record<string, unknown>) {
		const app = mount(Gallery, {
			target: document.body,
			props: { images, canEdit: false, ...(props ?? {}) }
		});
		flushSync();
		mounted.push(app);
		return app;
	}

	function openAt(index: number) {
		thumbnail(index).click();
		flushSync();
	}

	it('moves focus into the dialog when a thumbnail is activated', () => {
		mountGallery();

		expect(document.querySelector('[role="dialog"]')).toBeNull();
		expect(thumbnail(0).getAttribute('data-gallery-index')).toBe('0');
		expect(thumbnail(1).getAttribute('data-gallery-index')).toBe('1');
		expect(thumbnail(2).getAttribute('data-gallery-index')).toBe('2');

		openAt(0);

		const dialog = lightbox();
		expect(document.activeElement).toBe(dialog);
		expect(dialog.getAttribute('role')).toBe('dialog');
		expect(dialog.getAttribute('aria-modal')).toBe('true');
		expect(dialog.tabIndex).toBe(-1);
	});

	it('traps Tab and Shift+Tab inside the viewer', () => {
		mountGallery();
		openAt(0);

		let event = pressKey('Tab');
		expect(event.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(prev());

		// Native browser Tab move is not simulated by jsdom; move focus the way the browser would.
		next().focus();
		event = pressKey('Tab');
		expect(event.defaultPrevented).toBe(false);
		close().focus();

		event = pressKey('Tab');
		expect(event.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(prev());

		event = pressKey('Tab', true);
		expect(event.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(close());
	});

	it('keeps the backdrop as a pointer target only, not a tab stop', () => {
		mountGallery();
		openAt(0);

		expect(backdrop().tabIndex).toBe(-1);
		expect(backdrop().getAttribute('aria-label')).toBe('Close viewer');
	});

	it('returns focus to the thumbnail of the photo last viewed on Escape', () => {
		mountGallery();
		openAt(0);

		pressKey('ArrowRight');
		expect(lightbox().getAttribute('aria-label')).toBe('trail.png');
		expect(document.activeElement).toBe(lightbox());

		pressKey('Escape');
		expect(document.querySelector('.gallery-lightbox')).toBeNull();
		expect(document.activeElement).toBe(thumbnail(1));
	});

	it('returns focus to the thumbnail that opened the viewer when Escape is pressed without stepping', () => {
		mountGallery();
		openAt(2);

		pressKey('Escape');
		expect(document.querySelector('.gallery-lightbox')).toBeNull();
		expect(document.activeElement).toBe(thumbnail(2));
	});

	it('returns focus to the thumbnail when the Close button or backdrop is clicked', () => {
		mountGallery();
		openAt(0);
		close().click();
		flushSync();
		expect(document.querySelector('.gallery-lightbox')).toBeNull();
		expect(document.activeElement).toBe(thumbnail(0));

		openAt(1);
		backdrop().click();
		flushSync();
		expect(document.querySelector('.gallery-lightbox')).toBeNull();
		expect(document.activeElement).toBe(thumbnail(1));
	});

	it('announces the viewed photo in a polite live region that tracks ArrowRight', () => {
		mountGallery();
		openAt(0);

		expect(statusLine().getAttribute('aria-live')).toBe('polite');
		expect(statusLine().textContent?.trim()).toBe('Sunset');

		pressKey('ArrowRight');
		expect(statusLine().textContent?.trim()).toBe('trail.png');

		pressKey('ArrowRight');
		expect(statusLine().textContent?.trim()).toBe('Lake');
	});

	it('keeps a single image trapped on the Close control', () => {
		mountGallery({ images: [images[0]] });
		thumbnail(0).click();
		flushSync();

		expect(prev().disabled).toBe(true);
		expect(next().disabled).toBe(true);

		let event = pressKey('Tab');
		expect(event.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(close());

		event = pressKey('Tab');
		expect(event.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(close());

		event = pressKey('Tab', true);
		expect(event.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(close());
	});

	it('declares the focus-visible reset and imports the a11y helper', () => {
		const source = gallerySource as string;
		expect(source).toContain('.gallery-lightbox:focus-visible');
		expect(source).toContain('outline: none');
		expect(source).toContain("from './galleryLightboxA11y'");
	});
});
