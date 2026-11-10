<script setup lang="ts">
import { Link } from '@inertiajs/vue3';
import { computed } from 'vue';
import { focusRing } from './styles';
import { formatQrCode } from '../../lib/format';

defineOptions({ name: 'UiQrCodeText' });

/**
 * A QR short code as on the sticker, on every admin surface that shows one (DQ-527): "8TR0 Q3MC" in groups of four, tnum, never
 * broken over lines, at least 96 px wide so a table column keeps it on one line. With `href` it is the link to the code (ADM-19).
 * `size`: `sm` in 40 px table rows (supporting), `md` for lists and meta lines (the `code` style of 03 §4).
 */
const props = withDefaults(defineProps<{ code: string | null; href?: string | null; size?: 'sm' | 'md'; muted?: boolean; testId?: string }>(), {
    href: null,
    size: 'sm',
    muted: false,
    testId: undefined,
});
const text = computed(() => formatQrCode(props.code));
const classes = computed(() => [
    'sc-key inline-flex min-w-96 items-center whitespace-nowrap tabular-nums',
    props.size === 'md' ? 'font-ui text-code' : 'text-supporting',
    props.muted ? 'text-ink-2' : 'text-ink',
]);
</script>

<template>
    <Link v-if="href && code" :href="href" :class="[classes, focusRing, 'h-32 rounded-xs hover:underline']" :data-testid="testId">{{ text }}</Link>
    <span v-else :class="classes" :data-testid="testId">{{ text }}</span>
</template>
