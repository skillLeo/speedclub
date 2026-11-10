<script setup lang="ts">
import { Skeleton } from '../../../Components/ui';

/**
 * The loading rows of a catalogue table (DQ-593): they go in the real table under its real `<thead>` and `<colgroup>`, one bar per
 * column, so no header moves when the rows arrive. `bars` holds the bar classes per column (e.g. `w-3/4`, `ml-auto w-48`, `size-24`).
 */
withDefaults(defineProps<{ bars: string[]; rows?: number; testId?: string }>(), { rows: 6, testId: undefined });
</script>

<template>
    <tbody aria-hidden="true" :data-testid="testId">
        <tr v-for="n in rows" :key="n" class="h-40 border-b border-line-subtle last:border-b-0">
            <td v-for="(bar, index) in bars" :key="index" class="px-12">
                <Skeleton :shape="bar.includes('size-') ? 'block' : 'text'" :class="bar" />
            </td>
        </tr>
    </tbody>
</template>
