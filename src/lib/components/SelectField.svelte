<script lang="ts">
	export let name: string;
	export let label: string;
	export let value: string | number = '';
	export let options: Array<{ value: string | number; label: string }> = [];
	export let error: string | undefined = undefined;
	export let disabled = false;
	export let required = false;
	export let placeholder: string | undefined = undefined;

	$: selectClass = `select ${error ? 'input-error' : ''}`.trim();
</script>

<div class="field">
	<label class="label" for={name}>
		{label}{#if required}<span aria-label="required"> *</span>{/if}
	</label>
	<select id={name} {name} {value} {disabled} {required} class={selectClass} on:change>
		{#if placeholder}<option value="" disabled selected>{placeholder}</option>{/if}
		{#each options as opt}
			<option value={opt.value}>{opt.label}</option>
		{/each}
	</select>
	{#if error}<p class="field-error" id="{name}-error">{error}</p>{/if}
</div>
