<script lang="ts">
	export interface AutocompleteSuggestion {
		id: number;
		label: string;
		secondary?: string | null;
	}

	let {
		name,
		label,
		value,
		valueId,
		placeholder = '',
		errors = {},
		disabled = false,
		required = false,
		fetchSuggestions,
		id = name,
		noResultsText = 'No matches'
	}: {
		name: string;
		label: string;
		value: string;
		valueId: string | number | null | undefined;
		placeholder?: string;
		errors?: Record<string, string>;
		disabled?: boolean;
		required?: boolean;
		fetchSuggestions: (query: string) => Promise<AutocompleteSuggestion[]>;
		id?: string;
		noResultsText?: string;
	} = $props();

	let inputValue = $state('');
	let selectedId = $state<string>('');
	let selectedLabel = $state('');
	$effect(() => {
		inputValue = value;
		selectedId = valueId == null ? '' : String(valueId);
		selectedLabel = value;
	});
	let suggestions: AutocompleteSuggestion[] = $state([]);
	let open = $state(false);
	let activeIndex = $state(-1);
	let timer: ReturnType<typeof setTimeout> | null = null;

	const listboxId = $derived(`${name}-listbox`);
	function optionId(i: number): string {
		return `${name}-option-${i}`;
	}

	$effect(() => {
		activeIndex = open && suggestions.length > 0 ? 0 : -1;
	});

	function selectOption(s: AutocompleteSuggestion) {
		inputValue = s.label;
		selectedId = String(s.id);
		selectedLabel = s.label;
		suggestions = [];
		open = false;
		activeIndex = -1;
	}

	function clearSelection() {
		inputValue = '';
		selectedId = '';
		selectedLabel = '';
		suggestions = [];
		open = false;
	}

	async function runFetch(query: string) {
		if (typeof window === 'undefined') return;
		if (query.trim().length < 1) {
			suggestions = [];
			open = false;
			return;
		}
		try {
			const rows = await fetchSuggestions(query);
			suggestions = rows;
			open = rows.length > 0;
		} catch {
			suggestions = [];
			open = false;
		}
	}

	function onInput(next: string) {
		inputValue = next;
		selectedId = '';
		selectedLabel = '';
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => runFetch(next), 150);
	}

	function onKeydown(event: KeyboardEvent) {
		if (suggestions.length === 0) {
			if (event.key === 'Escape' && open) open = false;
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
					selectOption(suggestions[activeIndex]);
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
	<label class="label" for={id}>{label}</label>
	<input
		type="hidden"
		name={name}
		value={selectedId}
	/>
	<input
		{id}
		type="text"
		role="combobox"
		class="input {errors[name] ? 'input-error' : ''}"
		autocomplete="off"
		aria-autocomplete="list"
		aria-expanded={open ? 'true' : 'false'}
		aria-controls={listboxId}
		aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
		{disabled}
		{required}
		{placeholder}
		value={inputValue}
		oninput={(e) => onInput(e.currentTarget.value)}
		onkeydown={onKeydown}
		onblur={onBlur}
	/>
	{#if selectedLabel && !required}
		<button
			type="button"
			class="absolute right-2 top-9 text-sm text-muted hover:text-ink"
			onclick={clearSelection}
			aria-label="Clear selection"
			tabindex="-1"
		>×</button>
	{/if}
	{#if errors[name]}<p class="field-error" id={`${name}-error`}>{errors[name]}</p>{/if}
	{#if open}
		<ul
			id={listboxId}
			role="listbox"
			aria-label={label}
			class="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md bg-surface shadow-lg ring-1 ring-white/10"
		>
			{#if suggestions.length === 0}
				<li class="px-3 py-2 text-sm text-muted">{noResultsText}</li>
			{/if}
			{#each suggestions as s, i (s.id)}
				<li
					id={optionId(i)}
					role="option"
					aria-selected={i === activeIndex ? 'true' : 'false'}
				>
					<button
						type="button"
						tabindex="-1"
						class="flex w-full flex-col px-3 py-2 text-left hover:bg-surface2 {i === activeIndex
							? 'bg-surface2'
							: ''}"
						onmouseenter={() => (activeIndex = i)}
						onclick={() => selectOption(s)}
					>
						<span class="text-ink">{s.label}</span>
						{#if s.secondary}
							<span class="text-xs text-muted">{s.secondary}</span>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
