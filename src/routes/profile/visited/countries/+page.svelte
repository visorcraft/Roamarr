<script lang="ts">
	import VisitedPlacePage from '../VisitedPlacePage.svelte';

	let { data, form } = $props();
</script>

<VisitedPlacePage {data} {form} kind="country" />
