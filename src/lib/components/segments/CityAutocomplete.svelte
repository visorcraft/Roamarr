<script lang="ts">
	import {
		comboboxOptionId,
		createBlurCloseTimer,
		createDebouncedLookup,
		resolveComboboxKeydown
	} from '$lib/combobox';

	interface CitySuggestion {
		name: string;
		lat: number;
		lng: number;
	}

	let {
		countryCode,
		admin1Code = '',
		name,
		value,
		lat = null as number | null,
		lng = null as number | null,
		latName,
		lngName,
		errors = {},
		disabled = false
	}: {
		countryCode: string | undefined;
		/** Optional state/province/territory (GeoNames admin1) to scope suggestions. */
		admin1Code?: string;
		name: string;
		value: string;
		/** Seeded from an existing trip/segment so Save works without re-picking. */
		lat?: number | null;
		lng?: number | null;
		latName: string;
		lngName: string;
		errors?: Record<string, string>;
		disabled?: boolean;
	} = $props();

	// Local overrides after the user types or picks a suggestion. undefined = use props
	// (correct for SSR and for re-opening an edit form with stored coords).
	let overrideName = $state<string | undefined>(undefined);
	let overrideLat = $state<string | undefined>(undefined);
	let overrideLng = $state<string | undefined>(undefined);

	const inputValue = $derived(overrideName ?? value);
	const latValue = $derived(overrideLat ?? (lat != null ? String(lat) : ''));
	const lngValue = $derived(overrideLng ?? (lng != null ? String(lng) : ''));

	// Parent data changed (navigation / reload) — drop local edits.
	$effect(() => {
		value;
		lat;
		lng;
		overrideName = undefined;
		overrideLat = undefined;
		overrideLng = undefined;
	});

	let suggestions: CitySuggestion[] = $state([]);
	let open = $state(false);
	let activeIndex = $state(-1);

	const listboxId = $derived(`${name}-listbox`);

	const blurClose = createBlurCloseTimer(() => {
		open = false;
	});

	const lookup = createDebouncedLookup<string>(async (query, isCurrent) => {
		if (typeof window === 'undefined') return;
		if (!countryCode || query.length < 2) {
			suggestions = [];
			open = false;
			return;
		}
		try {
			const params = new URLSearchParams({
				country: countryCode,
				q: query
			});
			if (admin1Code?.trim()) params.set('admin1', admin1Code.trim());
			const res = await fetch(`/api/cities?${params}`);
			if (!res.ok) return;
			const data = await res.json();
			if (!isCurrent()) return;
			suggestions = (data.cities ?? []) as CitySuggestion[];
			open = suggestions.length > 0;
		} catch {
			if (!isCurrent()) return;
			suggestions = [];
			open = false;
		}
	});

	// Keep the keyboard-highlighted option visible inside the capped, scrollable listbox.
	$effect(() => {
		if (!open || activeIndex < 0) return;
		document.getElementById(comboboxOptionId(name, activeIndex))?.scrollIntoView?.({ block: 'nearest' });
	});

	$effect(() => {
		// reset active option when the suggestion set or visibility changes
		activeIndex = open && suggestions.length > 0 ? 0 : -1;
	});

	/** Drop the queued debounce and invalidate any in-flight lookup so it cannot repopulate the list. */
	function cancelPendingLookup() {
		lookup.cancel();
	}

	function selectCity(city: CitySuggestion) {
		cancelPendingLookup();
		overrideName = city.name;
		overrideLat = String(city.lat);
		overrideLng = String(city.lng);
		suggestions = [];
		open = false;
		activeIndex = -1;
	}

	function onInput(next: string) {
		overrideName = next;
		// Typing invalidates a prior picker selection; backend can re-resolve exact matches.
		overrideLat = '';
		overrideLng = '';
		lookup.schedule(next);
	}

	function onKeydown(event: KeyboardEvent) {
		const result = resolveComboboxKeydown(event, { open, activeIndex, count: suggestions.length });
		if (result.kind === 'ignore') return;
		if (result.preventDefault) event.preventDefault();
		if (result.kind === 'select') {
			selectCity(suggestions[result.index]);
			return;
		}
		open = result.open;
		activeIndex = result.activeIndex;
	}

	function onBlur() {
		cancelPendingLookup();
		blurClose.schedule();
	}

	function onFocus() {
		blurClose.cancel();
	}
</script>

<div class="field relative">
	<label class="label" for={name}>City</label>
	<input
		id={name}
		{name}
		type="text"
		role="combobox"
		class="input {errors[name] ? 'input-error' : ''}"
		autocomplete="off"
		aria-autocomplete="list"
		aria-expanded={open ? 'true' : 'false'}
		aria-controls={listboxId}
		aria-activedescendant={open && activeIndex >= 0 ? comboboxOptionId(name, activeIndex) : undefined}
		aria-invalid={errors[name] ? 'true' : undefined}
		aria-describedby={errors[name] ? `${name}-error` : undefined}
		{disabled}
		value={inputValue}
		oninput={(e) => onInput(e.currentTarget.value)}
		onkeydown={onKeydown}
		onblur={onBlur}
		onfocus={onFocus}
	/>
	<input type="hidden" id={latName} name={latName} value={latValue} />
	<input type="hidden" id={lngName} name={lngName} value={lngValue} />
	{#if errors[name]}<p class="field-error" id={`${name}-error`}>{errors[name]}</p>{/if}
	{#if open}
		<ul
			id={listboxId}
			role="listbox"
			aria-label="City suggestions"
			class="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-md bg-surface shadow-lg ring-1 ring-[var(--theme-line)]"
		>
			{#each suggestions as city, i (city.name + city.lat + city.lng)}
				<li
					id={comboboxOptionId(name, i)}
					role="option"
					aria-selected={i === activeIndex ? 'true' : 'false'}
				>
					<button
						type="button"
						tabindex="-1"
						class="w-full px-3 py-2 text-left text-ink hover:bg-surface2 {i === activeIndex
							? 'bg-surface2'
							: ''}"
						onmouseenter={() => (activeIndex = i)}
						onmousedown={(e) => e.preventDefault()}
						onclick={() => selectCity(city)}
					>
						{city.name}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
