<script lang="ts">
	let {
		cards,
		name,
		value,
		label = 'Linked card',
		errors
	}: {
		cards: { id: number; nickname: string; network: string; last4: string | null }[];
		name: string;
		value?: number | null;
		label?: string;
		errors?: Record<string, string>;
	} = $props();
</script>

<div class="field sm:col-span-2">
	<label class="label" for={name}>{label}</label>
	<select {name} id={name} class="input {errors?.[name] ? 'input-error' : ''}">
		<option value="" selected={!value}>No card</option>
		{#each cards as c (c.id)}
			<option value={c.id} selected={value === c.id}>
				{c.nickname}
				{#if c.network || c.last4}
					— {c.network}{c.last4 ? ` ····${c.last4}` : ''}
				{/if}
			</option>
		{/each}
	</select>
	{#if errors?.[name]}<p class="field-error">{errors[name]}</p>{/if}
</div>
