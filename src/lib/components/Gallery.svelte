<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';

	export interface GalleryImageItem {
		id: number;
		url: string;
		caption: string | null;
		filename: string;
	}

	let {
		images,
		canEdit = false,
		uploadAction,
		removeAction,
		moveAction,
		captionAction,
		hiddenFields = {},
		emptyMessage = 'No photos yet.'
	}: {
		images: GalleryImageItem[];
		canEdit?: boolean;
		uploadAction?: string;
		removeAction?: string;
		moveAction?: string;
		captionAction?: string;
		/** Extra hidden inputs submitted with every mutation form (e.g. { id: placeId }). */
		hiddenFields?: Record<string, string | number>;
		emptyMessage?: string;
	} = $props();

	let lightboxIndex = $state<number | null>(null);
	const lightboxImage = $derived(lightboxIndex != null ? images[lightboxIndex] : null);

	function openLightbox(index: number) {
		lightboxIndex = index;
	}

	function closeLightbox() {
		lightboxIndex = null;
	}

	function stepLightbox(delta: number) {
		if (lightboxIndex == null || images.length === 0) return;
		lightboxIndex = (lightboxIndex + delta + images.length) % images.length;
	}

	function onLightboxKeydown(event: KeyboardEvent) {
		if (lightboxIndex == null) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			closeLightbox();
		} else if (event.key === 'ArrowLeft') {
			event.preventDefault();
			stepLightbox(-1);
		} else if (event.key === 'ArrowRight') {
			event.preventDefault();
			stepLightbox(1);
		}
	}
</script>

<svelte:window onkeydown={onLightboxKeydown} />

<div class="gallery">
	{#if images.length === 0}
		<p class="text-sm opacity-75">{emptyMessage}</p>
	{:else}
		<ul class="gallery-grid" role="list">
			{#each images as image, index (image.id)}
				<li class="gallery-item">
					<button
						type="button"
						class="gallery-thumb"
						onclick={() => openLightbox(index)}
						aria-label={`View photo ${image.caption || image.filename}`}
					>
						<img src={image.url} alt={image.caption || image.filename} loading="lazy" />
					</button>
					{#if image.caption}<p class="gallery-caption" title={image.caption}>{image.caption}</p>{/if}
					{#if canEdit}
						<div class="gallery-controls">
							{#if moveAction}
								<form method="POST" action={moveAction}>
									{#each Object.entries(hiddenFields) as [name, value] (name)}
										<input type="hidden" {name} {value} />
									{/each}
									<input type="hidden" name="imageId" value={image.id} />
									<input type="hidden" name="direction" value="earlier" />
									<button
										type="submit"
										class="btn btn-ghost btn-sm"
										title="Move earlier"
										aria-label={`Move ${image.filename} earlier`}
										disabled={index === 0}
									>
										<Icon name="back" class="h-3.5 w-3.5" />
									</button>
								</form>
								<form method="POST" action={moveAction}>
									{#each Object.entries(hiddenFields) as [name, value] (name)}
										<input type="hidden" {name} {value} />
									{/each}
									<input type="hidden" name="imageId" value={image.id} />
									<input type="hidden" name="direction" value="later" />
									<button
										type="submit"
										class="btn btn-ghost btn-sm"
										title="Move later"
										aria-label={`Move ${image.filename} later`}
										disabled={index === images.length - 1}
									>
										<Icon name="arrow-right" class="h-3.5 w-3.5" />
									</button>
								</form>
							{/if}
							{#if removeAction}
								<form method="POST" action={removeAction}>
									{#each Object.entries(hiddenFields) as [name, value] (name)}
										<input type="hidden" {name} {value} />
									{/each}
									<input type="hidden" name="imageId" value={image.id} />
									<ConfirmButton
										class="btn btn-ghost btn-sm"
										title="Delete photo"
										message={`Delete ${image.caption || image.filename}? This cannot be undone.`}
										confirmLabel="Delete"
									>
										<Icon name="close" class="h-3.5 w-3.5" />
									</ConfirmButton>
								</form>
							{/if}
						</div>
						{#if captionAction}
							<form method="POST" action={captionAction} class="gallery-caption-form">
								{#each Object.entries(hiddenFields) as [name, value] (name)}
									<input type="hidden" {name} {value} />
								{/each}
								<input type="hidden" name="imageId" value={image.id} />
								<input
									type="text"
									name="caption"
									class="input text-xs"
									value={image.caption ?? ''}
									placeholder="Caption"
									maxlength="200"
									aria-label={`Caption for ${image.filename}`}
								/>
								<button type="submit" class="btn btn-ghost btn-sm" title="Save caption" aria-label={`Save caption for ${image.filename}`}>
									<Icon name="check" class="h-3.5 w-3.5" />
								</button>
							</form>
						{/if}
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if canEdit && uploadAction}
		<form method="POST" action={uploadAction} enctype="multipart/form-data" class="mt-3">
			{#each Object.entries(hiddenFields) as [name, value] (name)}
				<input type="hidden" {name} {value} />
			{/each}
			<label class="btn btn-secondary btn-sm cursor-pointer">
				<Icon name="upload" class="h-4 w-4" />Add photos
				<input
					type="file"
					name="images"
					accept="image/jpeg,image/png,image/webp"
					multiple
					class="sr-only"
					onchange={(e) => e.currentTarget.form?.requestSubmit()}
				/>
			</label>
			<p class="field-help mt-1">JPEG, PNG, or WebP. Up to 10 MB each, 50 photos per gallery.</p>
		</form>
	{/if}
</div>

{#if lightboxImage}
	<div
		class="gallery-lightbox"
		role="dialog"
		aria-modal="true"
		aria-label={lightboxImage.caption || lightboxImage.filename}
	>
		<button type="button" class="gallery-lightbox-backdrop" onclick={closeLightbox} aria-label="Close viewer"></button>
		<figure class="gallery-lightbox-figure">
			<img src={lightboxImage.url} alt={lightboxImage.caption || lightboxImage.filename} />
			{#if lightboxImage.caption}
				<figcaption class="gallery-lightbox-caption">{lightboxImage.caption}</figcaption>
			{/if}
		</figure>
		<button
			type="button"
			class="gallery-lightbox-nav gallery-lightbox-prev"
			onclick={() => stepLightbox(-1)}
			aria-label="Previous photo"
			disabled={images.length < 2}
		>
			<Icon name="back" class="h-6 w-6" />
		</button>
		<button
			type="button"
			class="gallery-lightbox-nav gallery-lightbox-next"
			onclick={() => stepLightbox(1)}
			aria-label="Next photo"
			disabled={images.length < 2}
		>
			<Icon name="arrow-right" class="h-6 w-6" />
		</button>
		<button type="button" class="gallery-lightbox-close" onclick={closeLightbox} aria-label="Close viewer">
			<Icon name="close" class="h-6 w-6" />
		</button>
	</div>
{/if}

<style>
	.gallery-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
		gap: 0.75rem;
	}

	.gallery-item {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}

	.gallery-thumb {
		display: block;
		width: 100%;
		aspect-ratio: 1;
		overflow: hidden;
		border-radius: var(--radius-md, 0.5rem);
		border: 1px solid var(--theme-line);
		background: var(--theme-surface-muted, transparent);
		cursor: zoom-in;
		padding: 0;
	}

	.gallery-thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.gallery-caption {
		font-size: 0.75rem;
		opacity: 0.75;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.gallery-controls {
		display: flex;
		align-items: center;
		gap: 0.125rem;
	}

	.gallery-caption-form {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.gallery-lightbox {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.gallery-lightbox-backdrop {
		position: absolute;
		inset: 0;
		background: rgb(0 0 0 / 0.8);
		border: none;
		cursor: zoom-out;
	}

	.gallery-lightbox-figure {
		position: relative;
		z-index: 1;
		max-width: min(90vw, 72rem);
		max-height: 85vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		pointer-events: none;
	}

	.gallery-lightbox-figure img {
		max-width: 100%;
		max-height: 78vh;
		object-fit: contain;
		border-radius: var(--radius-md, 0.5rem);
	}

	.gallery-lightbox-caption {
		color: #fff;
		font-size: 0.875rem;
		text-align: center;
	}

	.gallery-lightbox-nav,
	.gallery-lightbox-close {
		position: absolute;
		z-index: 2;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 9999px;
		border: none;
		background: rgb(0 0 0 / 0.55);
		color: #fff;
		cursor: pointer;
	}

	.gallery-lightbox-nav:hover,
	.gallery-lightbox-close:hover {
		background: rgb(0 0 0 / 0.8);
	}

	.gallery-lightbox-prev {
		left: 1rem;
		top: 50%;
		transform: translateY(-50%);
	}

	.gallery-lightbox-next {
		right: 1rem;
		top: 50%;
		transform: translateY(-50%);
	}

	.gallery-lightbox-close {
		top: 1rem;
		right: 1rem;
	}
</style>
