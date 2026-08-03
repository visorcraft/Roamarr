import { render } from 'svelte/server';
import { test, expect } from 'vitest';
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
