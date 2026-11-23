import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import { test, expect } from 'vitest';
import { m } from '$lib/paraglide/messages';
import Gallery from './Gallery.svelte';

const images = [
	{ id: 1, url: '/places/3/gallery/1', caption: 'Sunset', filename: 'sunset.png' },
	{ id: 2, url: '/places/3/gallery/2', caption: null, filename: 'trail.png' }
];

test('renders a thumbnail per image with accessible labels', () => {
	const { body } = render(Gallery, { props: { images, canEdit: false } });
	expect(body).toContain('src="/places/3/gallery/1"');
	expect(body).toContain('alt="Sunset"');
	expect(body).toContain('aria-label="View photo Sunset"');
	expect(body).toContain('aria-label="View photo trail.png"');
});

test('does not render the lightbox until a thumbnail is activated', () => {
	const { body } = render(Gallery, { props: { images, canEdit: false } });
	expect(body).not.toContain('gallery-lightbox');
	expect(body).not.toContain('role="dialog"');
});

test('hides edit controls for read-only viewers', () => {
	const { body } = render(Gallery, {
		props: { images, canEdit: false, uploadAction: '?/uploadGalleryImages', removeAction: '?/removeGalleryImage' }
	});
	expect(body).not.toContain('Delete photo');
	expect(body).not.toContain('Add photos');
	expect(body).not.toContain('name="caption"');
});

test('renders upload, move, delete, and caption controls when editable', () => {
	const { body } = render(Gallery, {
		props: {
			images,
			canEdit: true,
			uploadAction: '?/uploadGalleryImages',
			removeAction: '?/removeGalleryImage',
			moveAction: '?/moveGalleryImage',
			captionAction: '?/setGalleryCaption',
			hiddenFields: { id: 3 }
		}
	});
	expect(body).toContain('action="?/uploadGalleryImages"');
	expect(body).toContain('action="?/removeGalleryImage"');
	expect(body).toContain('action="?/moveGalleryImage"');
	expect(body).toContain('action="?/setGalleryCaption"');
	expect(body).toContain('multiple');
	expect(body).toContain('accept="image/jpeg,image/png,image/webp"');
	expect(body).toContain('name="id" value="3"');
	expect(body).toContain('value="Sunset"');
});

test('shows the empty message when there are no images', () => {
	const { body } = render(Gallery, { props: { images: [], emptyMessage: 'Nothing here.' } });
	expect(body).toContain('Nothing here.');
});

test('pins the English gallery strings', () => {
	expect(m.gallery_empty()).toBe('No photos yet.');
	expect(m.gallery_view_photo({ name: 'Sunset' })).toBe('View photo Sunset');
	expect(m.gallery_move_earlier()).toBe('Move earlier');
	expect(m.gallery_move_earlier_named({ filename: 'trail.png' })).toBe('Move trail.png earlier');
	expect(m.gallery_move_later()).toBe('Move later');
	expect(m.gallery_move_later_named({ filename: 'trail.png' })).toBe('Move trail.png later');
	expect(m.gallery_delete_photo()).toBe('Delete photo');
	expect(m.gallery_delete_photo_confirm({ name: 'Sunset' })).toBe('Delete Sunset? This cannot be undone.');
	expect(m.gallery_caption_placeholder()).toBe('Caption');
	expect(m.gallery_caption_for({ filename: 'trail.png' })).toBe('Caption for trail.png');
	expect(m.gallery_save_caption()).toBe('Save caption');
	expect(m.gallery_save_caption_for({ filename: 'trail.png' })).toBe('Save caption for trail.png');
	expect(m.gallery_add_photos()).toBe('Add photos');
	expect(m.gallery_upload_help()).toBe('JPEG, PNG, or WebP. Up to 50 photos per gallery.');
	expect(m.gallery_close_viewer()).toBe('Close viewer');
	expect(m.gallery_previous_photo()).toBe('Previous photo');
	expect(m.gallery_next_photo()).toBe('Next photo');
});

test('renders edit controls with catalog labels', () => {
	const { body } = render(Gallery, {
		props: {
			images,
			canEdit: true,
			uploadAction: '?/uploadGalleryImages',
			removeAction: '?/removeGalleryImage',
			moveAction: '?/moveGalleryImage',
			captionAction: '?/setGalleryCaption',
			hiddenFields: { id: 3 }
		}
	});
	expect(body).toContain('title="Move earlier"');
	expect(body).toContain('title="Move later"');
	expect(body).toContain('title="Save caption"');
	expect(body).toContain('placeholder="Caption"');
	expect(body).toContain('aria-label="Move trail.png earlier"');
	expect(body).toContain('aria-label="Move trail.png later"');
	expect(body).toContain('aria-label="Caption for trail.png"');
	expect(body).toContain('aria-label="Save caption for trail.png"');
	expect(body).toContain(m.gallery_add_photos());
	expect(body).toContain(m.gallery_upload_help());
});

test('uses the catalog default for the empty message', () => {
	const { body } = render(Gallery, { props: { images: [] } });
	expect(body).toContain(m.gallery_empty());
});

test('escapes interpolated filenames in accessible labels', () => {
	const { body } = render(Gallery, {
		props: { images: [{ id: 1, url: '/places/3/gallery/1', caption: null, filename: 'a"b.png' }] }
	});
	expect(body).toContain('aria-label="View photo a&quot;b.png"');
});

test('keeps UI strings out of the component source', () => {
	const source = readFileSync(new URL('./Gallery.svelte', import.meta.url), 'utf8');
	expect(source).toContain("from '$lib/paraglide/messages'");
	for (const literal of [
		'No photos yet.',
		'View photo ',
		'Move earlier',
		'Move later',
		'Delete photo',
		'This cannot be undone.',
		'Caption',
		'Save caption',
		'Add photos',
		'Up to 50 photos',
		'Close viewer',
		'Previous photo',
		'Next photo'
	]) {
		expect(source).not.toContain(literal);
	}
});
