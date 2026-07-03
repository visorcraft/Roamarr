<script lang="ts">
	interface CitySuggestion {
		name: string;
		lat: number;
		lng: number;
	}

	let {
		countryCode,
		name,
		value,
		latName,
		lngName,
		errors = {},
		disabled = false
	}: {
		countryCode: string | undefined;
		name: string;
		value: string;
		latName: string;
		lngName: string;
		errors?: Record<string, string>;
		disabled?: boolean;
	} = $props();

	let inputValue = $state('');
	$effect(() => {
		inputValue = value;
	});
	let suggestions: CitySuggestion[] = $state([]);
	let open = $state(false);
	let activeIndex = $state(-1);
	let latValue = $state('');
	let lngValue = $state('');
	let timer: ReturnType<typeof setTimeout> | null = null;

	const listboxId = $derived(`${name}-listbox`);
	function optionId(i: number): string {
		return `${name}-option-${i}`;
	}

	$effect(() => {
		// reset active option when the suggestion set or visibility changes
		activeIndex = open && suggestions.length > 0 ? 0 : -1;
	});

	function selectCity(city: CitySuggestion) {
		inputValue = city.name;
		latValue = String(city.lat);
		lngValue = String(city.lng);
		suggestions = [];
		open = false;
		activeIndex = -1;
	}

	async function fetchSuggestions(query: string) {
		if (typeof window === 'undefined') return;
		if (!countryCode || query.length < 2) {
			suggestions = [];
			open = false;
			return;
		}
		try {
			const res = await fetch(`/api/cities?country=${encodeURIComponent(countryCode)}&q=${encodeURIComponent(query)}`);
			if (!res.ok) return;
			const data = await res.json();
			suggestions = (data.cities ?? []) as CitySuggestion[];
			open = suggestions.length > 0;
		} catch {
			suggestions = [];
			open = false;
		}
	}

	function onInput(value: string) {
		inputValue = value;
		latValue = '';
		lngValue = '';
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => fetchSuggestions(value), 150);
	}

	function onKeydown(event: KeyboardEvent) {
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
		setTimeout(() => {
			open = false;
		}, 150);
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
		{disabled}
		value={inputValue}
		oninput={(e) => onInput(e.currentTarget.value)}
		onkeydown={onKeydown}
		onblur={onBlur}
	/>
	<input type="hidden" name={latName} value={latValue} />
	<input type="hidden" name={lngName} value={lngValue} />
	{#if errors[name]}<p class="field-error" id={`${name}-error`}>{errors[name]}</p>{/if}
	{#if open}
		<ul
			id={listboxId}
			role="listbox"
			aria-label="City suggestions"
			class="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-md bg-surface shadow-lg ring-1 ring-white/10"
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
						onclick={() => selectCity(city)}
					>
						{city.name}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
