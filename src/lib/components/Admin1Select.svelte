<script lang="ts">
	/**
	 * State / province / territory select for countries that have GeoNames admin1 data.
	 * Visible select when options exist; while loading / on fetch error / SSR with a
	 * stored value, emit a hidden input so form posts do not wipe admin1Code.
	 * When the country has no subdivisions (ready + empty options), no field is sent
	 * and the bound value is cleared.
	 */
	let {
		countryCode = '',
		name = 'admin1Code',
		value = $bindable(''),
		errors = {},
		disabled = false,
		id = name,
		label = 'State / province / territory'
	}: {
		countryCode?: string;
		name?: string;
		value?: string;
		errors?: Record<string, string>;
		disabled?: boolean;
		id?: string;
		label?: string;
	} = $props();

	let options = $state<{ code: string; name: string }[]>([]);
	let loadedFor = $state('');
	/** ready = fetch finished for loadedFor; loading/error keep prior value via hidden input */
	let loadState = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');

	$effect(() => {
		const code = (countryCode ?? '').toUpperCase();
		if (!code || code.length !== 2) {
			options = [];
			loadedFor = '';
			loadState = 'idle';
			value = '';
			return;
		}
		if (loadedFor === code && loadState === 'ready') return;
		if (loadedFor === code && loadState === 'loading') return;

		loadState = 'loading';
		let cancelled = false;
		(async () => {
			try {
				const res = await fetch(`/api/admin1?country=${encodeURIComponent(code)}`);
				if (cancelled) return;
				if (!res.ok) {
					loadState = 'error';
					return;
				}
				const data = await res.json();
				if (cancelled) return;
				options = (data.admin1 ?? []) as { code: string; name: string }[];
				loadedFor = code;
				loadState = 'ready';
				// Clear selection only after a successful load for this country
				if (value && (options.length === 0 || !options.some((o) => o.code === value))) {
					value = '';
				}
			} catch {
				if (!cancelled) {
					loadState = 'error';
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	});
</script>

{#if options.length > 0}
	<div class="field">
		<label class="label" for={id}>{label}</label>
		<select
			{id}
			{name}
			class="input {errors[name] ? 'input-error' : ''}"
			bind:value
			{disabled}
		>
			<option value="">Select {label.toLowerCase()}</option>
			{#each options as o (o.code)}
				<option value={o.code}>{o.name}</option>
			{/each}
		</select>
		{#if errors[name]}<p class="field-error">{errors[name]}</p>{/if}
	</div>
{:else if value && countryCode && countryCode.length === 2}
	<!-- SSR, still loading, or fetch error: keep stored subdivision on form submit -->
	<input type="hidden" {name} {value} />
{/if}
