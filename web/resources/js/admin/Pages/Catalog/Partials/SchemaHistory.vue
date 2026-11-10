<script setup lang="ts">
import { trans, transChoice } from 'laravel-vue-i18n';
import { computed, ref, watch } from 'vue';
import DiffViewer from '../../../Components/patterns/DiffViewer.vue';
import { EmptyQueue } from '../../../Components/ui';
import { focusRing } from '../../../Components/ui/styles';
import { formatDateTime } from '../../../lib/format';
import { schemaDiff, type SchemaVersion } from './schema';

/**
 * ADM-15 schema versions (m3.3 §1): every change to the category's fields is a version with who, when and why; the chosen version shows
 * what changed against the one before it (DiffViewer, only the properties that differ). Version 1 is the state before any admin change.
 */
const props = defineProps<{ versions: SchemaVersion[]; testId: string }>();

const selected = ref<number | null>(props.versions[0]?.version ?? null);
watch(
    () => props.versions,
    (versions) => {
        if (!versions.some((v) => v.version === selected.value)) selected.value = versions[0]?.version ?? null;
    },
);
const current = computed(() => props.versions.find((v) => v.version === selected.value) ?? null);
const previous = computed(() => (current.value === null ? null : (props.versions.find((v) => v.version === (current.value?.version ?? 0) - 1) ?? null)));
const diff = computed(() => (current.value === null ? null : schemaDiff(previous.value?.schema ?? null, current.value.schema)));
</script>

<template>
    <div :data-testid="testId">
        <EmptyQueue v-if="versions.length === 0" variant="quiet" :title="trans('catalog.history.empty_title')" :body="trans('catalog.history.empty_body')" :data-testid="`${testId}.empty`" />
        <div v-else class="flex flex-col gap-24 desktop:flex-row">
            <ol class="flex shrink-0 flex-col desktop:w-280" :aria-label="trans('catalog.history.list')">
                <li v-for="v in versions" :key="v.id" class="border-b border-line-subtle last:border-b-0">
                    <button
                        type="button"
                        :class="[focusRing, 'flex w-full flex-col gap-2 rounded-xs px-12 py-8 text-left hover:bg-hover', v.version === selected ? 'bg-raised' : '']"
                        :aria-current="v.version === selected ? 'true' : undefined"
                        :data-testid="`${testId}.version`"
                        @click="selected = v.version"
                    >
                        <span class="flex items-center gap-8 text-label-s text-ink tabular-nums">
                            {{ trans('catalog.history.version', { n: String(v.version) }) }}
                            <span v-if="v === versions[0]" class="text-caption text-ink-3">{{ trans('catalog.history.current') }}</span>
                        </span>
                        <span class="text-caption text-ink-3 tabular-nums">{{ [formatDateTime(v.created_at), v.staff ?? trans('catalog.history.initial')].join(' · ') }}</span>
                    </button>
                </li>
            </ol>
            <section v-if="current" class="flex min-w-0 grow flex-col gap-12" :aria-label="trans('catalog.history.version', { n: String(current.version) })">
                <h3 class="text-title-s text-ink">{{ trans('catalog.history.version', { n: String(current.version) }) }}</h3>
                <p class="text-supporting text-ink-2">{{ current.reason ?? trans('catalog.history.initial_body') }}</p>
                <DiffViewer v-if="previous && diff" :before="diff.before" :after="diff.after" :test-id="`${testId}.diff`" />
                <p v-else class="text-supporting text-ink-3">{{ transChoice('catalog.history.first', current.schema.length, { count: String(current.schema.length) }) }}</p>
            </section>
        </div>
    </div>
</template>
