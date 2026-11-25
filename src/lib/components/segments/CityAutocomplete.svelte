<script lang="ts">
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
	let timer: ReturnType<typeof setTimeout> | null = null;
	let blurTimer: ReturnType<typeof setTimeout> | null = null;
	let requestSeq = 0;

	const listboxId = $derived(`${name}-listbox`);
	function optionId(i: number): string {
		return `${name}-option-${i}`;
	}

	// Keep the keyboard-highlighted option visible inside the capped, scrollable listbox.
	$effect(() => {
		if (!open || activeIndex < 0) return;
		document.getElementById(optionId(activeIndex))?.scrollIntoView?.({ block: 'nearest' });
	});

	$effect(() => {
		// reset active option when the suggestion set or visibility changes
		activeIndex = open && suggestions.length > 0 ? 0 : -1;
	});

	function cancelBlurClose() {
		if (blurTimer) {
			clearTimeout(blurTimer);
			blurTimer = null;
		}
	}

	/** Drop the queued debounce and invalidate any in-flight lookup so it cannot repopulate the list. */
	function cancelPendingLookup() {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		requestSeq++;
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

	async function fetchSuggestions(query: string, seq: number) {
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
			if (seq !== requestSeq) return;
			suggestions = (data.cities ?? []) as CitySuggestion[];
			open = suggestions.length > 0;
		} catch {
			if (seq !== requestSeq) return;
			suggestions = [];
			open = false;
		}
	}

	function onInput(next: string) {
		overrideName = next;
		// Typing invalidates a prior picker selection; backend can re-resolve exact matches.
		overrideLat = '';
		overrideLng = '';
		if (timer) clearTimeout(timer);
		const seq = ++requestSeq;
		timer = setTimeout(() => fetchSuggestions(next, seq), 150);
	}

	function onKeydown(event: KeyboardEvent) {
		// Enter/arrows that belong to an IME composition must not move or pick an option.
		// Safari reports isComposing === false with keyCode 229 for the Enter that commits.
		if (event.isComposing || event.keyCode === 229) return;
		if (suggestions.length === 0) {
			if (event.key === 'Escape' && open) {
				open = false;
			}
			return;
		}
		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				if (!open) {
					open = true;
					activeIndex = 0;
				} else {
					activeIndex = (activeIndex + 1) % suggestions.length;
				}
				break;
			case 'ArrowUp':
				event.preventDefault();
				if (!open) {
					open = true;
					activeIndex = suggestions.length - 1;
				} else {
					activeIndex = (activeIndex - 1 + suggestions.length) % suggestions.length;
				}
				break;
			case 'Home':
				if (open) {
					event.preventDefault();
					activeIndex = 0;
				}
				break;
			case 'End':
				if (open) {
					event.preventDefault();
					activeIndex = suggestions.length - 1;
				}
				break;
			case 'Enter':
				if (open && activeIndex >= 0) {
					event.preventDefault();
					selectCity(suggestions[activeIndex]);
				}
				break;
			case 'Escape':
				if (open) {
					event.preventDefault();
					open = false;
					activeIndex = -1;
				}
				break;
		}
	}

	function onBlur() {
		cancelPendingLookup();
		cancelBlurClose();
		blurTimer = setTimeout(() => {
			blurTimer = null;
			open = false;
		}, 150);
	}

	function onFocus() {
		cancelBlurClose();
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
		aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
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
					id={optionId(i)}
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
