<script setup lang="ts">
import { PhInfo, PhPlus, PhTrash } from '@phosphor-icons/vue';
import { trans } from 'laravel-vue-i18n';
import { computed, ref, watch } from 'vue';
import { Button, DateRangeField, Field, IconButton, Select, StatusPill, TimeField } from '../../../Components/ui';
import EmptyQueue from '../../../Components/ui/EmptyQueue.vue';
import { now } from '../../../lib/qa';
import { berlinOffset, berlinToIso, isoToBerlin, seasonOptions, sortReleases, type Releases } from './wrappedReleases';

/**
 * ADM-37 "Season Wrapped: Freigaben" (m5.9e contract §1): one row per season with its release moment as a Berlin day and time. The
 * model is the payload's `wrapped.releases`, always sorted like the server's; each row's season is unique (the picker hides the
 * seasons other rows use). A row whose day or time is missing is sent as '' so the server answers its field error
 * (`wrapped.releases.<season>`, content.remote.wrapped_release) next to it. A row nobody touched keeps its stored value exactly.
 */
const model = defineModel<Releases>({ required: true });
const props = defineProps<{ readOnly: boolean; errorAt: (path: string) => string | null }>();

interface Row {
    id: number;
    season: string;
    day: string;
    time: string;
    /** The stored value and its Berlin parts: unchanged parts send the stored string back as it was. */
    original: string | null;
    originalDay: string;
    originalTime: string;
}

let nextId = 1;
function rowsOf(releases: Releases): Row[] {
    return Object.entries(releases).map(([season, at]) => {
        const { day, time } = isoToBerlin(at);
        return { id: nextId++, season, day, time, original: at, originalDay: day, originalTime: time };
    });
}
function valueOf(row: Row): string {
    if (row.original !== null && row.day === row.originalDay && row.time === row.originalTime) return row.original;
    return berlinToIso(row.day, row.time);
}
function recordOf(list: Row[]): Releases {
    return sortReleases(Object.fromEntries(list.map((row) => [row.season, valueOf(row)])));
}

const rows = ref<Row[]>(rowsOf(model.value));
// The model changed from outside (a saved draft came back, "Verwerfen", a reload): rebuild the rows from it.
watch(model, (releases) => {
    if (JSON.stringify(sortReleases(releases)) !== JSON.stringify(recordOf(rows.value))) rows.value = rowsOf(releases);
});
// The rows changed here: write the model, only when it differs (a rebuild must not mark the form dirty).
watch(
    rows,
    (list) => {
        const next = recordOf(list);
        if (JSON.stringify(next) !== JSON.stringify(sortReleases(model.value))) model.value = next;
    },
    { deep: true },
);

const year = now().getFullYear();
const allSeasons = computed(() => seasonOptions(year, rows.value.map((row) => row.season)));
function seasonLabel(key: string): string {
    const [y, kind] = key.split('-');
    return trans(`config.remote.wrapped_seasons.${kind === 'jahr' ? 'jahr' : 'saison'}`, { year: y ?? '' });
}
function optionsFor(row: Row) {
    const used = new Set(rows.value.filter((other) => other.id !== row.id).map((other) => other.season));
    return allSeasons.value.filter((key) => !used.has(key)).map((key) => ({ value: key, label: seasonLabel(key) }));
}
const free = computed(() => allSeasons.value.filter((key) => !rows.value.some((row) => row.season === key)));

function add(): void {
    // The first free season from this year on (the next release to plan), else the first free one at all.
    const season = free.value.find((key) => Number(key.slice(0, 4)) >= year) ?? free.value[0];
    if (season === undefined) return;
    rows.value = [...rows.value, { id: nextId++, season, day: '', time: '10:00', original: null, originalDay: '', originalTime: '' }];
}
function remove(row: Row): void {
    rows.value = rows.value.filter((other) => other.id !== row.id);
}

function released(row: Row): boolean {
    const iso = valueOf(row);
    return iso !== '' && Date.parse(iso) <= now().getTime();
}
/** "Winterzeit (UTC+01:00)" / "Sommerzeit (UTC+02:00)" for a complete row (DQ-P5G-46: the rule itself is the one line below the list). */
function zoneOf(row: Row): string | null {
    const offset = berlinOffset(row.day, row.time);
    if (offset === null) return null;
    return trans(offset === '+02:00' ? 'config.remote.wrapped_zone_summer' : 'config.remote.wrapped_zone_winter', { offset: `UTC${offset}` });
}
const errorOf = (row: Row): string | null => props.errorAt(`wrapped.releases.${row.season}`);
const listError = computed(() => props.errorAt('wrapped.releases') !== null && rows.value.every((row) => errorOf(row) === null) ? props.errorAt('wrapped.releases') : null);
</script>

<template>
    <section class="flex flex-col gap-16 rounded-sm border border-line bg-surface p-16" aria-labelledby="adm37-wrapped" data-testid="ADM-37.wrapped">
        <div class="flex flex-col gap-4">
            <h2 id="adm37-wrapped" class="text-headline text-ink">{{ trans('config.remote.wrapped_title') }}</h2>
            <p class="max-w-720 text-admin-base text-ink-2">{{ trans('config.remote.wrapped_intro') }}</p>
            <!-- The server's rule (RemoteConfigSchema, CR-P5G-06): a new date is refused before it is a day away or before the season ended. -->
            <p class="flex max-w-720 items-start gap-8 text-admin-base text-ink-2" data-testid="ADM-37.wrapped.rule"><PhInfo :size="16" class="mt-2 shrink-0 text-ink-3" aria-hidden="true" />{{ trans('config.remote.wrapped_rule') }}</p>
        </div>

        <EmptyQueue v-if="rows.length === 0" variant="quiet" compact :title="trans('config.remote.wrapped_empty')" data-testid="ADM-37.wrapped.empty" />
        <ul v-else class="flex flex-col" :aria-label="trans('config.remote.wrapped_caption')" data-testid="ADM-37.wrapped.rows">
            <li v-for="row in rows" :key="row.id" class="flex flex-col gap-8 border-b border-line-subtle py-12 first:pt-0 last:border-b-0 last:pb-0" data-testid="ADM-37.wrapped.row">
                <div class="flex flex-wrap items-end gap-12">
                    <div class="w-320">
                        <Field :label="trans('config.remote.wrapped_season')">
                            <Select v-model="row.season" :options="optionsFor(row)" :disabled="readOnly" />
                        </Field>
                    </div>
                    <div class="w-160">
                        <Field :label="trans('config.remote.wrapped_day')" :error="errorOf(row)" required>
                            <DateRangeField v-model:from="row.day" single :disabled="readOnly" test-id="ADM-37.wrapped.day" />
                        </Field>
                    </div>
                    <div class="w-120">
                        <Field :label="trans('config.remote.wrapped_time')" required>
                            <TimeField v-model="row.time" :disabled="readOnly" test-id="ADM-37.wrapped.time" />
                        </Field>
                    </div>
                    <div class="flex min-h-40 items-center gap-12">
                        <StatusPill v-if="valueOf(row) !== ''" :tone="released(row) ? 'success' : 'info'" :label="trans(released(row) ? 'config.remote.wrapped_released' : 'config.remote.wrapped_planned')" />
                        <IconButton v-if="!readOnly" :icon="PhTrash" :label="trans('config.remote.wrapped_remove', { season: seasonLabel(row.season) })" data-testid="ADM-37.wrapped.remove" @click="remove(row)" />
                    </div>
                </div>
                <p v-if="zoneOf(row)" class="text-caption text-ink-3 tabular-nums" data-testid="ADM-37.wrapped.zone">{{ zoneOf(row) }}</p>
            </li>
        </ul>
        <p v-if="listError" class="text-admin-base text-danger" role="alert">{{ listError }}</p>

        <div v-if="!readOnly" class="flex flex-wrap items-center gap-12">
            <Button variant="secondary" size="sm" :icon="PhPlus" :disabled="free.length === 0" data-testid="ADM-37.wrapped.add" @click="add">{{ trans('config.remote.wrapped_add') }}</Button>
            <span v-if="free.length === 0" class="text-caption text-ink-3">{{ trans('config.remote.wrapped_all_used') }}</span>
        </div>
        <p class="text-caption text-ink-3">{{ trans('config.remote.wrapped_zone_hint') }}</p>
    </section>
</template>
