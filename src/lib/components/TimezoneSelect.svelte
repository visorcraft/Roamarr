<script lang="ts">
	import { Info } from 'luxon';

	interface Props {
		id?: string;
		name: string;
		value?: string;
		required?: boolean;
		class?: string;
	}

	let { id, name, value = $bindable('UTC'), required = false, class: className = '' }: Props = $props();

	const zones = $derived.by(() => {
		try {
			const values = (
				Intl as typeof Intl & { supportedValuesOf?: (calendar: string) => string[] }
			).supportedValuesOf?.('timeZone');
			const list = values?.filter((z) => Info.isValidIANAZone(z)) ?? [];
			return list.includes('UTC') ? list : ['UTC', ...list];
		} catch {
			return ['UTC'];
		}
	});

	function onChange(e: Event) {
		value = (e.currentTarget as HTMLSelectElement).value;
	}
</script>

<select {id} {name} {required} class={className} {value} onchange={onChange}>
	{#each zones as zone (zone)}
		<option value={zone}>{zone}</option>
	{/each}
</select>
