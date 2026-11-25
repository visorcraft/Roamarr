<script lang="ts">
	import Icon from './Icon.svelte';
	import { m } from '$lib/paraglide/messages';

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
		textName,
		onselect,
		id = name,
		noResultsText = m.autocomplete_no_results()
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
		textName?: string;
		onselect?: (suggestion: AutocompleteSuggestion | null) => void;
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
	let blurTimer: ReturnType<typeof setTimeout> | null = null;
	let requestSeq = 0;

	const listboxId = $derived(`${name}-listbox`);
	const listboxVisible = $derived(open && suggestions.length > 0);
	const noResults = $derived(open && suggestions.length === 0);
	function optionId(i: number): string {
		return `${name}-option-${i}`;
	}

	$effect(() => {
		activeIndex = open && suggestions.length > 0 ? 0 : -1;
	});

	// Keep the keyboard-highlighted option visible inside the capped, scrollable listbox.
	$effect(() => {
		if (!open || activeIndex < 0) return;
		document.getElementById(optionId(activeIndex))?.scrollIntoView?.({ block: 'nearest' });
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

	function selectOption(s: AutocompleteSuggestion) {
		cancelPendingLookup();
		inputValue = s.label;
		selectedId = String(s.id);
		selectedLabel = s.label;
		suggestions = [];
		open = false;
		activeIndex = -1;
		onselect?.(s);
	}

	function clearSelection() {
		cancelPendingLookup();
		inputValue = '';
		selectedId = '';
		selectedLabel = '';
		suggestions = [];
		open = false;
		onselect?.(null);
	}

	async function runFetch(query: string, seq: number) {
		if (typeof window === 'undefined') return;
		if (query.trim().length < 1) {
			suggestions = [];
			open = false;
			return;
		}
		try {
			const rows = await fetchSuggestions(query);
			if (seq !== requestSeq) return;
			suggestions = rows;
			open = true;
		} catch {
			if (seq !== requestSeq) return;
			suggestions = [];
			open = false;
		}
	}

	function onInput(next: string) {
		inputValue = next;
		selectedId = '';
		selectedLabel = '';
		onselect?.(null);
		if (timer) clearTimeout(timer);
		const seq = ++requestSeq;
		timer = setTimeout(() => runFetch(next, seq), 150);
	}

	function onKeydown(event: KeyboardEvent) {
		// Enter/arrows that belong to an IME composition must not move or pick an option.
		// Safari reports isComposing === false with keyCode 229 for the Enter that commits.
		if (event.isComposing || event.keyCode === 229) return;
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
	<label class="label" for={id}>{label}</label>
	<input
		type="hidden"
		name={name}
		value={selectedId}
	/>
	<input
		{id}
		name={textName}
		type="text"
		role="combobox"
		class="input {errors[name] ? 'input-error' : ''}"
		autocomplete="off"
		aria-autocomplete="list"
		aria-expanded={open ? 'true' : 'false'}
		aria-controls={listboxVisible ? listboxId : undefined}
		aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
		aria-invalid={errors[name] ? 'true' : undefined}
		aria-describedby={errors[name] ? `${name}-error` : undefined}
		{disabled}
		{required}
		{placeholder}
		value={inputValue}
		oninput={(e) => onInput(e.currentTarget.value)}
		onkeydown={onKeydown}
		onblur={onBlur}
		onfocus={onFocus}
	/>
	{#if selectedLabel && !required}
		<button
			type="button"
			class="absolute right-2 top-9 text-sm text-muted hover:text-ink"
			onclick={clearSelection}
			aria-label={m.autocomplete_clear()}
			tabindex="-1"
		><Icon name="close" class="h-4 w-4" /></button>
	{/if}
	{#if errors[name]}<p class="field-error" id={`${name}-error`}>{errors[name]}</p>{/if}
	{#if listboxVisible}
		<ul
			id={listboxId}
			role="listbox"
			aria-label={label}
			class="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md bg-surface shadow-lg ring-1 ring-[var(--theme-line)]"
		>
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
						onmousedown={(e) => e.preventDefault()}
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
	{#if noResults}
		<p
			aria-hidden="true"
			class="absolute z-20 mt-1 w-full rounded-md bg-surface px-3 py-2 text-sm text-muted shadow-lg ring-1 ring-[var(--theme-line)]"
		>{noResultsText}</p>
	{/if}
	<span class="sr-only" role="status">{noResults ? noResultsText : ''}</span>
</div>
