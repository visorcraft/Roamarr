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
	let latValue = $state('');
	let lngValue = $state('');
	let timer: ReturnType<typeof setTimeout> | null = null;

	function selectCity(city: CitySuggestion) {
		inputValue = city.name;
		latValue = String(city.lat);
		lngValue = String(city.lng);
		suggestions = [];
		open = false;
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
		class="input {errors[name] ? 'input-error' : ''}"
		autocomplete="off"
		{disabled}
		value={inputValue}
		oninput={(e) => onInput(e.currentTarget.value)}
		onblur={onBlur}
	/>
	<input type="hidden" name={latName} value={latValue} />
	<input type="hidden" name={lngName} value={lngValue} />
	{#if errors[name]}<p class="field-error">{errors[name]}</p>{/if}
	{#if open}
		<ul
			class="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-md bg-surface shadow-lg ring-1 ring-white/10"
		>
			{#each suggestions as city (city.name + city.lat + city.lng)}
				<li>
					<button
						type="button"
						class="w-full px-3 py-2 text-left text-ink hover:bg-surface2"
						onclick={() => selectCity(city)}
					>
						{city.name}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
