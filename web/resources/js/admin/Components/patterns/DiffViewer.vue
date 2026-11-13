<script setup lang="ts">
import { trans, transChoice } from 'laravel-vue-i18n';
import { computed, ref } from 'vue';
import Button from '../ui/Button.vue';

/**
 * Before/after of a change (audit events, config versions, permission diffs). JSON objects are compared per key path; plain text
 * line by line. Changed values carry a text marker as well as colour (never colour alone). `changedOnly` (config versions, DQ-668) lists
 * only what changed and offers "Alle Felder anzeigen" for the rest.
 */
const props = withDefaults(defineProps<{ before: unknown; after: unknown; mode?: 'json' | 'text'; testId?: string; changedOnly?: boolean }>(), {
    mode: 'json',
    testId: undefined,
    changedOnly: false,
});

type Change = { path: string; kind: 'added' | 'removed' | 'changed' | 'same'; before?: string; after?: string };

function flatten(value: unknown, prefix: string, into: Map<string, string>): void {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const entries = Object.entries(value as Record<string, unknown>);
        if (entries.length === 0 && prefix !== '') into.set(prefix, '{}');
        for (const [key, inner] of entries) flatten(inner, prefix === '' ? key : `${prefix}.${key}`, into);
        return;
    }
    if (prefix === '') {
        if (value !== null && value !== undefined) into.set('(value)', JSON.stringify(value));
        return;
    }
    into.set(prefix, typeof value === 'string' ? value : JSON.stringify(value));
}

const changes = computed<Change[]>(() => {
    if (props.mode === 'text') {
        const a = typeof props.before === 'string' ? props.before.split('\n') : [];
        const b = typeof props.after === 'string' ? props.after.split('\n') : [];
        const length = Math.max(a.length, b.length);
        return Array.from({ length }, (_, i) => {
            const before = a[i];
            const after = b[i];
            const kind: Change['kind'] = before === after ? 'same' : before === undefined ? 'added' : after === undefined ? 'removed' : 'changed';
            return { path: String(i + 1), kind, before, after };
        });
    }
    const before = new Map<string, string>();
    const after = new Map<string, string>();
    flatten(props.before, '', before);
    flatten(props.after, '', after);
    const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
    return keys.map((path) => {
        const b = before.get(path);
        const a = after.get(path);
        const kind: Change['kind'] = b === a ? 'same' : b === undefined ? 'added' : a === undefined ? 'removed' : 'changed';
        return { path, kind, before: b, after: a };
    });
});

const showAll = ref(false);
const unchanged = computed(() => changes.value.filter((change) => change.kind === 'same').length);
const rows = computed(() => (props.changedOnly && !showAll.value ? changes.value.filter((change) => change.kind !== 'same') : changes.value));

const markers = { added: '+', removed: '−', changed: '~', same: '' } as const;
</script>

<template>
    <div :data-testid="testId">
        <p v-if="changes.length === 0" class="text-admin-base text-ink-3">{{ trans('ui.diff.empty') }}</p>
        <p v-else-if="rows.length === 0" class="text-admin-base text-ink-3" :data-testid="testId ? `${testId}.none` : undefined">{{ trans('ui.diff.none_changed') }}</p>
        <table v-if="rows.length > 0" class="w-full border-collapse text-admin-base">
            <thead>
                <tr class="h-32 border-b border-line text-caption text-ink-2">
                    <th scope="col" class="w-24"><span class="sr-only">{{ trans('ui.diff.change') }}</span></th>
                    <th scope="col" class="pr-12 text-left">{{ mode === 'text' ? trans('ui.diff.line') : trans('ui.diff.field') }}</th>
                    <th scope="col" class="pr-12 text-left">{{ trans('ui.diff.before') }}</th>
                    <th scope="col" class="text-left">{{ trans('ui.diff.after') }}</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="change in rows" :key="change.path" class="border-b border-line-subtle align-top" :data-diff="change.kind">
                    <td class="py-8 text-center font-ui text-admin-base-strong" :class="change.kind === 'added' ? 'text-success' : change.kind === 'removed' ? 'text-danger' : 'text-warning'">
                        <span aria-hidden="true">{{ markers[change.kind] }}</span>
                        <span class="sr-only">{{ change.kind === 'same' ? '' : trans(`ui.diff.kind_${change.kind}`) }}</span>
                    </td>
                    <td class="py-8 pr-12 break-words text-ink-2">{{ change.path }}</td>
                    <td class="py-8 pr-12 break-words" :class="change.kind === 'removed' || change.kind === 'changed' ? 'text-ink line-through decoration-danger' : 'text-ink-3'">
                        {{ change.before ?? '–' }}
                    </td>
                    <td class="py-8 break-words" :class="change.kind === 'added' || change.kind === 'changed' ? 'text-ink' : 'text-ink-3'">{{ change.after ?? '–' }}</td>
                </tr>
            </tbody>
        </table>
        <div v-if="changedOnly && unchanged > 0" class="mt-8 flex flex-wrap items-center gap-8">
            <p class="text-admin-base text-ink-3">{{ transChoice(showAll ? 'ui.diff.unchanged_shown' : 'ui.diff.unchanged_hidden', unchanged, { count: String(unchanged) }) }}</p>
            <Button size="sm" variant="ghost" :aria-expanded="showAll" :data-testid="testId ? `${testId}.toggle` : undefined" @click="showAll = !showAll">
                {{ showAll ? trans('ui.diff.show_changed') : trans('ui.diff.show_all') }}
            </Button>
        </div>
    </div>
</template>
