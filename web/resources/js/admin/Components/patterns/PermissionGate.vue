<script setup lang="ts">
import { computed } from 'vue';
import { usePermissions } from '../../lib/permissions';

/**
 * Shows the default slot when the staff member holds `atom` (or any of `any`). Otherwise the `denied` slot, or nothing.
 * UI only (06 §1.3): the server refuses the action anyway.
 */
const props = withDefaults(defineProps<{ atom?: string; any?: string[] }>(), { atom: undefined, any: undefined });
const { can, canAny } = usePermissions();
const allowed = computed(() => (props.any !== undefined ? canAny(props.any) : can(props.atom)));
</script>

<template>
    <slot v-if="allowed" />
    <slot v-else name="denied" />
</template>
