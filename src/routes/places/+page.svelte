<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import MarkdownText from '$lib/components/MarkdownText.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import ConfirmButton from '$lib/components/ConfirmButton.svelte';
	import TextField from '$lib/components/TextField.svelte';
	import TextAreaField from '$lib/components/TextAreaField.svelte';
	import SelectField from '$lib/components/SelectField.svelte';
	import CityAutocomplete from '$lib/components/segments/CityAutocomplete.svelte';
	import PlacesMap from '$lib/components/PlacesMap.svelte';
	import Gallery from '$lib/components/Gallery.svelte';
	import { COUNTRIES } from '$lib/countries';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form?: ActionData } = $props();

	interface SearchResult {
		name: string;
		displayName: string;
		lat: number;
		lng: number;
	}

	interface PlaceFormState {
		id: number | null;
		name: string;
		categoryId: string;
		address: string;
		countryCode: string;
		cityName: string;
		cityLat: number | null;
		cityLng: number | null;
		lat: string;
		lng: string;
		durationMin: string;
		price: string;
		description: string;
		status: 'planned' | 'visited';
		favorite: boolean;
	}

	function emptyForm(): PlaceFormState {
		return {
			id: null,
			name: '',
			categoryId: '',
			address: '',
			countryCode: '',
			cityName: '',
			cityLat: null,
			cityLng: null,
			lat: '',
			lng: '',
			durationMin: '',
			price: '',
			description: '',
			status: 'planned',
			favorite: false
		};
	}

	let dialogOpen = $state(false);
	let formState = $state<PlaceFormState>(emptyForm());
	let galleryOpenFor = $state<number | null>(null);
	let linksOpenFor = $state<number | null>(null);
	let editingLink = $state<{
		placeId: number;
		linkId: number;
		label: string;
		url: string;
		notes: string;
	} | null>(null);

	function toggleGallery(placeId: number) {
		galleryOpenFor = galleryOpenFor === placeId ? null : placeId;
	}

	function toggleLinks(placeId: number) {
		linksOpenFor = linksOpenFor === placeId ? null : placeId;
		editingLink = null;
	}

	type PlaceLinkItem = PageData['linksByPlace'][number][number];

	function startEditLink(placeId: number, link: PlaceLinkItem) {
		editingLink = {
			placeId,
			linkId: link.id,
			label: link.label,
			url: link.url,
			notes: link.notes ?? ''
		};
	}

	/** Group a place's links by URL hostname (TripIt-style domain groups). */
	function groupLinksByDomain(links: PlaceLinkItem[] | undefined): [string, PlaceLinkItem[]][] {
		const groups = new Map<string, PlaceLinkItem[]>();
		for (const link of links ?? []) {
			let host = link.url;
			try {
				host = new URL(link.url).hostname;
			} catch {
				// URLs are validated server-side; fall back to the raw value.
			}
			const list = groups.get(host) ?? [];
			list.push(link);
			groups.set(host, list);
		}
		return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
	}

	function openCreate() {
		formState = emptyForm();
		searchResults = [];
		searchError = '';
		searchWarning = '';
		searchQuery = '';
		dialogOpen = true;
	}

	function openEdit(place: PageData['places'][number]) {
		formState = {
			id: place.id,
			name: place.name,
			categoryId: place.categoryId != null ? String(place.categoryId) : '',
			address: place.address ?? '',
			countryCode: '',
			cityName: '',
			cityLat: null,
			cityLng: null,
			lat: place.lat != null ? String(place.lat) : '',
			lng: place.lng != null ? String(place.lng) : '',
			durationMin: place.durationMin != null ? String(place.durationMin) : '',
			price: place.priceCents != null ? (place.priceCents / 100).toString() : '',
			description: place.description ?? '',
			status: place.status,
			favorite: place.favorite
		};
		searchResults = [];
		searchError = '';
		searchWarning = '';
		searchQuery = '';
		dialogOpen = true;
	}

	let searchQuery = $state('');
	let searchResults = $state<SearchResult[]>([]);
	let searchError = $state('');
	let searchWarning = $state('');
	let searching = $state(false);

	async function runSearch() {
		const q = searchQuery.trim();
		if (q.length < 2) return;
		searching = true;
		searchError = '';
		searchWarning = '';
		try {
			const res = await fetch(`/api/places/search?q=${encodeURIComponent(q)}`);
			const body = (await res.json()) as { results: SearchResult[]; error?: string; warning?: string | null };
			searchResults = body.results ?? [];
			searchError = body.error ?? '';
			searchWarning = body.warning ?? '';
		} catch {
			searchResults = [];
			searchError = 'Place search is unavailable';
		} finally {
			searching = false;
		}
	}

	function applyResult(r: SearchResult) {
		formState.name = formState.name || r.name;
		formState.address = r.displayName;
		formState.lat = String(r.lat);
		formState.lng = String(r.lng);
		searchResults = [];
	}

	const categoryById = $derived(new Map(data.categories.map((c) => [c.id, c])));

	function filterHref(extra: Record<string, string>): string {
		const params = new URLSearchParams();
		if (data.filters.categoryId != null) params.set('category', String(data.filters.categoryId));
		if (data.filters.status) params.set('status', data.filters.status);
		if (data.filters.favorite) params.set('favorite', '1');
		if (data.filters.q) params.set('q', data.filters.q);
		for (const [k, v] of Object.entries(extra)) {
			if (v) params.set(k, v);
			else params.delete(k);
		}
		const qs = params.toString();
		return qs ? `/places?${qs}` : '/places';
	}
</script>

<header class="page-header">
	<div>
		<h1 class="page-title">Places</h1>
		<p class="page-subtitle">Your saved places library — reuse them on trips later.</p>
	</div>
	<div class="flex items-center gap-2">
		<a href="/places/import" class="btn btn-secondary">
			<Icon name="import" class="h-4 w-4" />Import
		</a>
		<button type="button" class="btn btn-primary" onclick={openCreate}>
			<Icon name="plus" class="h-4 w-4" />Add place
		</button>
	</div>
</header>

<section class="card mt-6 p-4 sm:p-5">
	<form method="GET" action="/places" class="flex flex-wrap items-end gap-3">
		<div class="field min-w-48 flex-1">
			<label class="label" for="places-q">Search</label>
			<input id="places-q" name="q" class="input" type="search" value={data.filters.q} placeholder="Name, address, or notes" />
		</div>
		<div class="field">
			<label class="label" for="places-status">Status</label>
			<select id="places-status" name="status" class="input" value={data.filters.status ?? ''}>
				<option value="">All</option>
				<option value="planned">Planned</option>
				<option value="visited">Visited</option>
			</select>
		</div>
		<label class="flex items-center gap-2 pb-2 text-sm">
			<input type="checkbox" name="favorite" value="1" checked={data.filters.favorite} />
			Favorites only
		</label>
		{#if data.filters.categoryId != null}
			<input type="hidden" name="category" value={data.filters.categoryId} />
		{/if}
		<button type="submit" class="btn btn-secondary btn-sm"><Icon name="search" class="h-4 w-4" />Filter</button>
	</form>
	<div class="mt-3 flex flex-wrap gap-2">
		<a
			href={filterHref({ category: '' })}
			class="badge badge-compact {data.filters.categoryId == null ? 'badge-green' : 'badge-slate'}"
		>All categories</a>
		{#each data.categories as c (c.id)}
			<a
				href={filterHref({ category: String(c.id) })}
				class="badge badge-compact {data.filters.categoryId === c.id ? 'badge-green' : 'badge-slate'}"
			>
				<span class="inline-block h-2 w-2 rounded-full" style:background-color={c.color}></span>
				{c.name}
			</a>
		{/each}
	</div>
</section>

{#if data.map && (data.markers.length > 0 || data.gpxTracks.length > 0)}
	<section class="mt-6">
		<PlacesMap markers={data.markers} tileUrls={data.map.tileUrls} attribution={data.map.attribution} tracks={data.gpxTracks} />
	</section>
{/if}

<section class="card mt-6 p-4 sm:p-5">
	{#if form?.error}
		<div class="notice notice-error mb-4">{form.error}</div>
	{/if}
	{#if data.places.length === 0}
		<div class="empty-state">
			<p>No saved places yet.</p>
			<p class="text-sm">Add your first place to build a reusable library.</p>
		</div>
	{:else}
		<ul class="divide-y divide-(--theme-line)">
			{#each data.places as place (place.id)}
				{@const category = place.categoryId != null ? categoryById.get(place.categoryId) : undefined}
				<li class="flex flex-wrap items-center gap-3 py-3">
					<span
						class="inline-block h-3 w-3 shrink-0 rounded-full"
						style:background-color={category?.color ?? '#64748b'}
						title={category?.name ?? 'Uncategorized'}
					></span>
					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-center gap-2">
							<span class="font-medium">{place.name}</span>
							{#if place.favorite}<Icon name="star" class="h-4 w-4 text-amber-500" />{/if}
							<span class="badge badge-compact {place.status === 'visited' ? 'badge-green' : 'badge-slate'}">
								{place.status}
							</span>
							{#if category}<span class="badge badge-compact badge-slate">{category.name}</span>{/if}
						</div>
						{#if place.address}<p class="truncate text-sm opacity-75">{place.address}</p>{/if}
						{#if place.description}<MarkdownText text={place.description} class="mt-1 text-sm opacity-75" />{/if}
					</div>
					<div class="flex items-center gap-2">
						<button
							type="button"
							class="btn btn-ghost btn-sm"
							onclick={() => toggleGallery(place.id)}
							title="Photos"
							aria-expanded={galleryOpenFor === place.id}
						>
							<Icon name="image" class="h-4 w-4" />
							<span class="text-xs">{data.galleries[place.id]?.length ?? 0}</span>
						</button>
						<button
							type="button"
							class="btn btn-ghost btn-sm"
							onclick={() => toggleLinks(place.id)}
							title="Links"
							aria-expanded={linksOpenFor === place.id}
						>
							<Icon name="link" class="h-4 w-4" />
							<span class="text-xs">{data.linksByPlace[place.id]?.length ?? 0}</span>
						</button>
						{#if place.gpxAttachmentId != null}
							<a
								href={`/places/${place.id}/gpx`}
								class="btn btn-ghost btn-sm"
								title="Download GPX track"
								download
							>
								<Icon name="download" class="h-4 w-4" />
							</a>
							<form method="POST" action="?/removeGpx">
								<input type="hidden" name="id" value={place.id} />
								<ConfirmButton
									class="btn btn-ghost btn-sm"
									title="Remove GPX track"
									message={`Remove the GPX track from ${place.name}?`}
									confirmLabel="Remove"
								>
									<Icon name="close" class="h-4 w-4" />
								</ConfirmButton>
							</form>
						{:else}
							<form method="POST" action="?/uploadGpx" enctype="multipart/form-data">
								<input type="hidden" name="id" value={place.id} />
								<label class="btn btn-ghost btn-sm cursor-pointer" title="Attach GPX track">
									<Icon name="upload" class="h-4 w-4" />
									<input
										type="file"
										name="file"
										accept=".gpx,application/gpx+xml"
										class="sr-only"
										onchange={(e) => e.currentTarget.form?.requestSubmit()}
									/>
								</label>
							</form>
						{/if}
						<form method="POST" action="?/toggleFavorite">
							<input type="hidden" name="id" value={place.id} />
							<button type="submit" class="btn btn-ghost btn-sm" title={place.favorite ? 'Remove from favorites' : 'Add to favorites'}>
								<Icon name="star" class="h-4 w-4" />
							</button>
						</form>
						<form method="POST" action="?/toggleVisited">
							<input type="hidden" name="id" value={place.id} />
							<button type="submit" class="btn btn-ghost btn-sm" title={place.status === 'visited' ? 'Mark as planned' : 'Mark as visited'}>
								<Icon name="check" class="h-4 w-4" />
							</button>
						</form>
						<button type="button" class="btn btn-ghost btn-sm" onclick={() => openEdit(place)} title="Edit">
							<Icon name="edit" class="h-4 w-4" />
						</button>
						<form method="POST" action="?/deletePlace">
							<input type="hidden" name="id" value={place.id} />
							<ConfirmButton
								class="btn btn-ghost btn-sm"
								title="Delete place"
								message={`Delete ${place.name}? This cannot be undone.`}
								confirmLabel="Delete"
							>
								<Icon name="close" class="h-4 w-4" />
							</ConfirmButton>
						</form>
					</div>
					{#if galleryOpenFor === place.id}
						<div class="w-full border-t border-(--theme-line) pt-3">
							<Gallery
								images={data.galleries[place.id] ?? []}
								canEdit={true}
								uploadAction="?/uploadGalleryImages"
								removeAction="?/removeGalleryImage"
								moveAction="?/moveGalleryImage"
								captionAction="?/setGalleryCaption"
								hiddenFields={{ id: place.id }}
								emptyMessage="No photos yet. Add the first one below."
							/>
						</div>
					{/if}
					{#if linksOpenFor === place.id}
						{@const editing = editingLink?.placeId === place.id ? editingLink : null}
						<div class="w-full border-t border-(--theme-line) pt-3">
							{#if (data.linksByPlace[place.id]?.length ?? 0) > 0}
								<div class="mb-3 space-y-2">
									{#each groupLinksByDomain(data.linksByPlace[place.id]) as [domain, links] (domain)}
										<div>
											<p class="text-xs font-semibold uppercase tracking-wide opacity-60">{domain}</p>
											<ul class="mt-1 space-y-1">
												{#each links as link (link.id)}
													<li class="flex flex-wrap items-center gap-2 text-sm">
														<a href={link.url} target="_blank" rel="noopener noreferrer" class="link">{link.label}</a>
														{#if link.notes}<span class="opacity-60">— {link.notes}</span>{/if}
														<span class="flex items-center gap-1">
															<button
																type="button"
																class="btn btn-ghost btn-sm"
																title="Edit link"
																onclick={() => startEditLink(place.id, link)}
															>
																<Icon name="edit" class="h-3 w-3" />
															</button>
															<form method="POST" action="?/deleteLink">
																<input type="hidden" name="id" value={place.id} />
																<input type="hidden" name="linkId" value={link.id} />
																<ConfirmButton
																	class="btn btn-ghost btn-sm"
																	title="Delete link"
																	message={`Delete link ${link.label}?`}
																	confirmLabel="Delete"
																>
																	<Icon name="close" class="h-3 w-3" />
																</ConfirmButton>
															</form>
														</span>
													</li>
												{/each}
											</ul>
										</div>
									{/each}
								</div>
							{:else}
								<p class="mb-3 text-sm opacity-60">No links yet.</p>
							{/if}
							{#key editing?.linkId}
								<form method="POST" action="?/saveLink" class="flex flex-wrap items-end gap-2">
									<input type="hidden" name="id" value={place.id} />
									{#if editing}<input type="hidden" name="linkId" value={editing.linkId} />{/if}
									<div class="field">
										<label class="label" for={`link-label-${place.id}`}>Label</label>
										<input
											id={`link-label-${place.id}`}
											name="label"
											class="input text-sm"
											required
											maxlength="200"
											placeholder="Official site"
											value={editing?.label ?? ''}
										/>
									</div>
									<div class="field min-w-48">
										<label class="label" for={`link-url-${place.id}`}>URL</label>
										<input
											id={`link-url-${place.id}`}
											name="url"
											type="url"
											class="input text-sm"
											required
											maxlength="2000"
											placeholder="https://…"
											value={editing?.url ?? ''}
										/>
									</div>
									<div class="field">
										<label class="label" for={`link-notes-${place.id}`}>Notes</label>
										<input
											id={`link-notes-${place.id}`}
											name="notes"
											class="input text-sm"
											maxlength="2000"
											value={editing?.notes ?? ''}
										/>
									</div>
									{#if editing}
										<button type="button" class="btn btn-ghost btn-sm" onclick={() => (editingLink = null)}>Cancel</button>
									{/if}
									<button type="submit" class="btn btn-secondary btn-sm">
										<Icon name="plus" class="h-4 w-4" />{editing ? 'Save link' : 'Add link'}
									</button>
								</form>
							{/key}
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section class="card mt-6 p-4 sm:p-5">
	<h2 class="mb-3 text-base font-semibold">Categories</h2>
	<ul class="mb-4 flex flex-wrap gap-2">
		{#each data.categories as c (c.id)}
			<li class="badge badge-compact badge-slate flex items-center gap-1.5">
				<span class="inline-block h-2 w-2 rounded-full" style:background-color={c.color}></span>
				{c.name}
				<form method="POST" action="?/deleteCategory" class="inline-flex">
					<input type="hidden" name="id" value={c.id} />
					<ConfirmButton
						class="btn btn-ghost btn-sm"
						title="Delete category"
						message={`Delete category ${c.name}? Places in it are kept but unlinked.`}
						confirmLabel="Delete"
					>
						<Icon name="close" class="h-3 w-3" />
					</ConfirmButton>
				</form>
			</li>
		{/each}
	</ul>
	<form method="POST" action="?/createCategory" class="flex flex-wrap items-end gap-3">
		<div class="field">
			<label class="label" for="category-name">New category</label>
			<input id="category-name" name="name" class="input" maxlength="100" required placeholder="Category name" />
		</div>
		<div class="field">
			<label class="label" for="category-color">Color</label>
			<input id="category-color" name="color" type="color" class="input h-9 w-16 p-1" value="#2f9e44" />
		</div>
		<button type="submit" class="btn btn-secondary btn-sm"><Icon name="plus" class="h-4 w-4" />Add category</button>
	</form>
</section>

<Modal bind:open={dialogOpen} title={formState.id ? 'Edit place' : 'Add place'}>
	{#key formState.id}
		<form method="POST" action="?/savePlace" class="grid gap-4 sm:grid-cols-2">
			{#if formState.id}<input type="hidden" name="id" value={formState.id} />{/if}

			<div class="field sm:col-span-2">
				<label class="label" for="place-search">Find on OpenStreetMap (optional prefill)</label>
				<div class="flex gap-2">
					<input
						id="place-search"
						class="input flex-1"
						type="search"
						placeholder="e.g. Eiffel Tower"
						bind:value={searchQuery}
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								runSearch();
							}
						}}
					/>
					<button type="button" class="btn btn-secondary btn-sm" onclick={runSearch} disabled={searching}>
						{searching ? 'Searching…' : 'Search'}
					</button>
				</div>
				{#if searchError}<p class="field-error">{searchError}</p>{/if}
			{#if searchWarning}<p class="field-help">{searchWarning}</p>{/if}
				{#if searchResults.length > 0}
					<ul class="mt-2 max-h-40 overflow-y-auto rounded-md border border-(--theme-line)">
						{#each searchResults as r (r.displayName)}
							<li>
								<button
									type="button"
									class="block w-full px-3 py-2 text-left text-sm hover:bg-muted/40"
									onclick={() => applyResult(r)}
								>
									<span class="font-medium">{r.name}</span>
									<span class="block truncate opacity-75">{r.displayName}</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			<TextField name="name" label="Name" placeholder="Eiffel Tower" required value={formState.name} errors={form?.errors ?? {}} class="sm:col-span-2" />

			<SelectField name="categoryId" label="Category" value={formState.categoryId} errors={form?.errors ?? {}}>
				<option value="">Uncategorized</option>
				{#each data.categories as c (c.id)}
					<option value={c.id}>{c.name}</option>
				{/each}
			</SelectField>

			<SelectField name="status" label="Status" value={formState.status} errors={form?.errors ?? {}}>
				<option value="planned">Planned</option>
				<option value="visited">Visited</option>
			</SelectField>

			<TextField name="address" label="Address" placeholder="Street, area, or landmark" value={formState.address} maxlength="300" errors={form?.errors ?? {}} class="sm:col-span-2" />

			<div class="field">
				<label class="label" for="place-country">Country (for city lookup)</label>
				<select id="place-country" name="countryCode" class="input" bind:value={formState.countryCode}>
					<option value="">None</option>
					{#each COUNTRIES as c (c.code)}
						<option value={c.code}>{c.name}</option>
					{/each}
				</select>
			</div>

			<CityAutocomplete
				countryCode={formState.countryCode || undefined}
				name="cityName"
				value={formState.cityName}
				lat={formState.cityLat}
				lng={formState.cityLng}
				latName="cityLat"
				lngName="cityLng"
				errors={form?.errors ?? {}}
			/>

			<TextField name="lat" label="Latitude" placeholder="48.8583" value={formState.lat} errors={form?.errors ?? {}} />
			<TextField name="lng" label="Longitude" placeholder="2.2945" value={formState.lng} errors={form?.errors ?? {}} />

			<TextField name="durationMin" label="Typical visit (minutes)" placeholder="90" value={formState.durationMin} errors={form?.errors ?? {}} />
			<TextField name="price" label="Price (e.g. 12.50)" placeholder="0.00" value={formState.price} errors={form?.errors ?? {}} />

			<TextAreaField name="description" label="Notes" rows={3} placeholder="Opening hours, tips, booking links…" hint="Markdown supported" value={formState.description} errors={form?.errors ?? {}} class="sm:col-span-2" />

			<label class="flex items-center gap-2 text-sm sm:col-span-2">
				<input type="checkbox" name="favorite" checked={formState.favorite} />
				Favorite
			</label>

			<div class="flex justify-end gap-2 sm:col-span-2">
				<button type="button" class="btn btn-ghost" onclick={() => (dialogOpen = false)}>Cancel</button>
				<button type="submit" class="btn btn-primary">{formState.id ? 'Save changes' : 'Add place'}</button>
			</div>
		</form>
	{/key}
</Modal>
