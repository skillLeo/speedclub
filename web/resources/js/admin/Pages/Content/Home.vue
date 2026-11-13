<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import { PhArrowDown, PhArrowUp, PhPencilSimple, PhPlus, PhStar, PhTrash } from '@phosphor-icons/vue';
import { trans, transChoice } from 'laravel-vue-i18n';
import { computed, reactive, ref } from 'vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import VehicleThumb from '../../Components/patterns/VehicleThumb.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Badge, Button, DateRangeField, Drawer, EmptyQueue, Field, IconButton, Input, RadioGroup, Select, Skeleton, StatusPill, Switch, type Tone } from '../../Components/ui';
import { qaDialogFailed, usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { formatNumber } from '../../lib/format';
import { routeOr } from '../../lib/routes';
import DraftBar from './Partials/DraftBar.vue';
import VehiclePicker from './Partials/VehiclePicker.vue';
import { useConfigDraft, type EditorProps } from './Partials/configDraft';
import { dayToInstant, instantToDay, peakLive, scheduleOf, type Schedule } from './Partials/dates';
import { filterChips, filtersText, parseFilters, type Collection, type HomeCuration, type VehicleSummary } from './Partials/home';

/**
 * ADM-29 Startseite kuratieren (06 §3, m3.5 §2): the featured builds of Start (FS-2) in order, each with an optional date range, at most
 * `limits.live` live at any moment; the Discover collections (a filter like Discover's address, or hand-picked builds) in order. As the
 * home_curation draft: save → preview → publish with a reason ⚿. Without a published version Start uses the configured list.
 */
const props = defineProps<{
    editor: EditorProps<HomeCuration>;
    vehicles: Record<string, VehicleSummary>;
    limits: { live: number; featured: number; collections: number; collection_vehicles: number };
    sorts: string[];
}>();

const state = usePageState();
const failedDialog = qaDialogFailed();
const pageState = computed(() => (failedDialog ? 'ready' : state.value));

const draft = useConfigDraft(() => props.editor, {
    save: routeOr('admin.content.home.draft.save', '/admin/content/home/draft'),
    discard: routeOr('admin.content.home.draft.discard', '/admin/content/home/draft'),
    publish: routeOr('admin.content.home.publish', '/admin/content/home/publish'),
});
const form = draft.form;
const known = reactive<Record<string, VehicleSummary>>({ ...props.vehicles });
const featured = computed(() => (pageState.value === 'empty' ? [] : form.value.featured));
const collections = computed(() => (pageState.value === 'empty' ? [] : form.value.collections));
const peak = computed(() => peakLive(featured.value));
const tooMany = computed(() => peak.value > props.limits.live);

const scheduleTones: Record<Schedule, Tone> = { live: 'success', scheduled: 'info', ended: 'neutral' };
function move<T>(list: T[], index: number, by: number): void {
    const target = index + by;
    if (target < 0 || target >= list.length) return;
    const [item] = list.splice(index, 1);
    if (item !== undefined) list.splice(target, 0, item);
}
function setRange(index: number, which: 'from' | 'to', day: string): void {
    const entry = form.value.featured[index];
    if (!entry) return;
    if (which === 'from') entry.starts_at = dayToInstant(day);
    else entry.ends_at = dayToInstant(day, true);
}

// The build picker: featured (`featured`) or a collection's hand-picked list (`collection`).
const pickerOpen = ref(qaDialog() === 'picker');
const pickerFor = ref<'featured' | 'collection' | 'cover'>('featured');
function openPicker(target: 'featured' | 'collection' | 'cover'): void {
    pickerFor.value = target;
    pickerOpen.value = true;
}
function chosen(vehicle: VehicleSummary): void {
    known[vehicle.id] = vehicle;
    if (pickerFor.value === 'featured') form.value.featured.push({ vehicle_id: vehicle.id, starts_at: null, ends_at: null });
    else if (pickerFor.value === 'collection') editing.vehicle_ids.push(vehicle.id);
    else editing.cover_vehicle_id = vehicle.id;
}
const pickerExclude = computed(() => (pickerFor.value === 'featured' ? form.value.featured.map((entry) => entry.vehicle_id) : pickerFor.value === 'collection' ? editing.vehicle_ids : []));

// The collection drawer edits a copy; "Übernehmen" puts it into the draft form.
const blank = (): Collection => ({ key: '', title: { de: '', en: null }, subtitle: null, mode: 'filter', filters: {}, sort: 'newest', vehicle_ids: [], cover_vehicle_id: null, active: true });
const editing = reactive<Collection>(blank());
const editingIndex = ref<number | null>(null);
const filterText = ref('');
const chips = computed(() => filterChips(parseFilters(filterText.value), (key, params) => trans(key, params)));
const subtitleDe = ref('');
const subtitleEn = ref('');
const titleEn = ref('');
const drawerOpen = ref(false);
const drawerErrors = ref<Record<string, string>>({});
function openCollection(index: number | null): void {
    const source = index === null ? blank() : (JSON.parse(JSON.stringify(form.value.collections[index])) as Collection);
    Object.assign(editing, source);
    editingIndex.value = index;
    filterText.value = filtersText(source.filters);
    titleEn.value = source.title.en ?? '';
    subtitleDe.value = source.subtitle?.de ?? '';
    subtitleEn.value = source.subtitle?.en ?? '';
    drawerErrors.value = {};
    drawerOpen.value = true;
}
if (qaDialog() === 'collection') openCollection(props.editor.payload.collections.length > 0 ? 0 : null);
function applyCollection(): void {
    const next: Record<string, string> = {};
    if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(editing.key)) next.key = trans('content.home.collection.key_hint');
    else if (form.value.collections.some((c, i) => c.key === editing.key && i !== editingIndex.value)) next.key = trans('content.home.collection.key_taken');
    if (editing.title.de.trim() === '') next.title = trans('content.home.collection.title_required');
    const filters = parseFilters(filterText.value);
    if (editing.mode === 'filter' && Object.keys(filters).length === 0) next.filters = trans('content.home.collection.filters_required');
    if (editing.mode === 'vehicles' && editing.vehicle_ids.length === 0) next.vehicles = trans('content.home.collection.vehicles_required');
    drawerErrors.value = next;
    if (Object.keys(next).length > 0) return;
    const value: Collection = {
        ...JSON.parse(JSON.stringify(editing)) as Collection,
        title: { de: editing.title.de.trim(), en: titleEn.value.trim() === '' ? null : titleEn.value.trim() },
        subtitle: subtitleDe.value.trim() === '' ? null : { de: subtitleDe.value.trim(), en: subtitleEn.value.trim() === '' ? null : subtitleEn.value.trim() },
        filters: editing.mode === 'filter' ? filters : {},
        vehicle_ids: editing.mode === 'vehicles' ? editing.vehicle_ids : [],
    };
    if (editingIndex.value === null) form.value.collections.push(value);
    else form.value.collections[editingIndex.value] = value;
    drawerOpen.value = false;
}
const modeOptions = computed(() => [
    { value: 'filter', label: trans('content.home.collection.mode_filter'), hint: trans('content.home.collection.mode_filter_hint') },
    { value: 'vehicles', label: trans('content.home.collection.mode_vehicles'), hint: trans('content.home.collection.mode_vehicles_hint') },
]);
const modeModel = computed({ get: () => editing.mode, set: (value: string | undefined) => (editing.mode = value === 'vehicles' ? 'vehicles' : 'filter') });
const sortOptions = computed(() => props.sorts.map((value) => ({ value, label: trans(`content.home.sorts.${value}`) })));
const sortModel = computed({ get: () => editing.sort ?? undefined, set: (value: string | undefined) => (editing.sort = value ?? null) });
const vehicleTitle = (id: string | null): string => (id === null ? '' : (known[id]?.title ?? trans('content.home.vehicle_unknown')));
</script>

<template>
    <Head :title="trans('content.home.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-29" :data-qa-state="pageState">
        <PageHeader :title="trans('content.home.title')" :crumbs="[{ label: trans('shell.groups.brand_content') }]" :description="trans('content.home.intro')" />

        <StateBlock v-if="pageState === 'error'" kind="error" :title="trans('content.home.error')" :body="trans('ui.state.error_body')" test-id="ADM-29.error" @retry="router.reload()" />
        <template v-else-if="pageState === 'loading'">
            <Skeleton class="h-64 w-full rounded-sm" />
            <div v-for="n in 2" :key="n" class="flex flex-col gap-12" aria-hidden="true">
                <Skeleton shape="text" class="w-200" />
                <div class="rounded-sm border border-line">
                    <div v-for="r in 4" :key="r" class="flex h-56 items-center gap-12 border-b border-line-subtle px-12 last:border-b-0"><Skeleton class="h-24 w-32 rounded-xs" /><Skeleton shape="text" class="w-240" /><Skeleton shape="text" class="ml-auto w-200" /></div>
                </div>
            </div>
        </template>

        <template v-else>
            <DraftBar :editor="editor" :draft="draft" test-id="ADM-29" />

            <section class="flex flex-col gap-12" aria-labelledby="adm29-featured" data-testid="ADM-29.featured">
                <div class="flex flex-wrap items-end justify-between gap-12">
                    <div class="flex min-w-0 flex-col gap-4">
                        <h2 id="adm29-featured" class="text-headline text-ink">{{ trans('content.home.featured_title') }}</h2>
                        <p class="max-w-720 text-admin-base text-ink-2">{{ trans('content.home.featured_intro', { max: formatNumber(limits.live) }) }}</p>
                    </div>
                    <div class="flex items-center gap-12">
                        <Badge :tone="tooMany ? 'danger' : 'neutral'" tnum data-testid="ADM-29.peak">{{ trans('content.home.peak', { count: formatNumber(peak), max: formatNumber(limits.live) }) }}</Badge>
                        <Button v-if="!draft.readOnly.value" size="sm" variant="secondary" :icon="PhPlus" :disabled="form.featured.length >= limits.featured" data-testid="ADM-29.add-featured" @click="openPicker('featured')">{{ trans('content.home.add_featured') }}</Button>
                    </div>
                </div>
                <p v-if="draft.errorAt('featured') && !draft.errors.value['featured.0.vehicle_id']" class="text-admin-base text-danger" role="alert">{{ draft.errors.value.featured ?? draft.errorAt('featured') }}</p>

                <EmptyQueue v-if="featured.length === 0" variant="first" :icon="PhStar" :title="trans('content.home.featured_empty')" :body="trans('content.home.featured_empty_body')" data-testid="ADM-29.featured-empty" />
                <ol v-else class="flex flex-col rounded-sm border border-line" :aria-label="trans('content.home.featured_title')">
                    <li v-for="(entry, index) in featured" :key="entry.vehicle_id" class="flex flex-wrap items-center gap-x-16 gap-y-8 border-b border-line-subtle px-12 py-8 last:border-b-0" data-testid="ADM-29.featured-row">
                        <span class="w-24 text-right text-admin-base tabular-nums text-ink-3">{{ index + 1 }}</span>
                        <VehicleThumb :src="known[entry.vehicle_id]?.thumb ?? null" />
                        <div class="flex min-w-200 flex-1 flex-col">
                            <span class="text-admin-base text-ink">{{ vehicleTitle(entry.vehicle_id) }}</span>
                            <span class="text-admin-base text-ink-3">
                                {{ known[entry.vehicle_id]?.owner ? `@${known[entry.vehicle_id]?.owner}` : trans('content.home.no_owner') }}
                                <template v-if="known[entry.vehicle_id] && !known[entry.vehicle_id]?.reachable"> · <span class="text-danger">{{ trans('content.home.not_public') }}</span></template>
                            </span>
                            <span v-if="draft.errorAt(`featured.${index}`)" class="text-admin-base text-danger" role="alert">{{ draft.errorAt(`featured.${index}`) }}</span>
                        </div>
                        <StatusPill :tone="scheduleTones[scheduleOf(entry.starts_at, entry.ends_at)]" :label="trans(`content.schedule.${scheduleOf(entry.starts_at, entry.ends_at)}`)" />
                        <div class="w-264">
                            <Field :label="trans('content.home.range', { title: vehicleTitle(entry.vehicle_id) })" hide-label>
                                <DateRangeField
                                    :from="instantToDay(entry.starts_at)"
                                    :to="instantToDay(entry.ends_at, true)"
                                    size="sm"
                                    :disabled="draft.readOnly.value"
                                    test-id="ADM-29.range"
                                    @update:from="(day: string) => setRange(index, 'from', day)"
                                    @update:to="(day: string) => setRange(index, 'to', day)"
                                />
                            </Field>
                        </div>
                        <span v-if="!draft.readOnly.value" class="flex items-center gap-4">
                            <IconButton :icon="PhArrowUp" size="sm" :label="trans('content.move_up')" :disabled="index === 0" @click="move(form.featured, index, -1)" />
                            <IconButton :icon="PhArrowDown" size="sm" :label="trans('content.move_down')" :disabled="index === featured.length - 1" @click="move(form.featured, index, 1)" />
                            <IconButton :icon="PhTrash" size="sm" variant="ghost" class="hover:text-danger" :label="trans('content.home.remove_featured', { title: vehicleTitle(entry.vehicle_id) })" @click="form.featured.splice(index, 1)" />
                        </span>
                    </li>
                </ol>
            </section>

            <section class="flex flex-col gap-12" aria-labelledby="adm29-collections" data-testid="ADM-29.collections">
                <div class="flex flex-wrap items-end justify-between gap-12">
                    <div class="flex min-w-0 flex-col gap-4">
                        <h2 id="adm29-collections" class="text-headline text-ink">{{ trans('content.home.collections_title') }}</h2>
                        <p class="max-w-720 text-admin-base text-ink-2">{{ trans('content.home.collections_intro') }}</p>
                    </div>
                    <Button v-if="!draft.readOnly.value" size="sm" variant="secondary" :icon="PhPlus" :disabled="form.collections.length >= limits.collections" data-testid="ADM-29.add-collection" @click="openCollection(null)">{{ trans('content.home.add_collection') }}</Button>
                </div>
                <EmptyQueue v-if="collections.length === 0" variant="first" :title="trans('content.home.collections_empty')" :body="trans('content.home.collections_empty_body')" data-testid="ADM-29.collections-empty" />
                <ol v-else class="flex flex-col rounded-sm border border-line" :aria-label="trans('content.home.collections_title')">
                    <li v-for="(collection, index) in collections" :key="collection.key" class="flex flex-wrap items-center gap-x-16 gap-y-8 border-b border-line-subtle px-12 py-8 last:border-b-0" data-testid="ADM-29.collection-row">
                        <span class="w-24 text-right text-admin-base tabular-nums text-ink-3">{{ index + 1 }}</span>
                        <div class="flex min-w-240 flex-1 flex-col">
                            <span class="text-admin-base text-ink">{{ collection.title.de }}</span>
                            <span class="break-all text-admin-base text-ink-3">{{ collection.mode === 'filter' ? filtersText(collection.filters) : transChoice('content.home.picked', collection.vehicle_ids.length, { count: formatNumber(collection.vehicle_ids.length) }) }}</span>
                            <span v-if="draft.errorAt(`collections.${index}`)" class="text-admin-base text-danger" role="alert">{{ draft.errorAt(`collections.${index}`) }}</span>
                        </div>
                        <Badge tone="neutral">{{ trans(`content.home.collection.mode_${collection.mode}`) }}</Badge>
                        <Switch v-model="collection.active" :aria-label="trans('content.home.collection.active_for', { title: collection.title.de })" :disabled="draft.readOnly.value" />
                        <span v-if="!draft.readOnly.value" class="flex items-center gap-4">
                            <IconButton :icon="PhArrowUp" size="sm" :label="trans('content.move_up')" :disabled="index === 0" @click="move(form.collections, index, -1)" />
                            <IconButton :icon="PhArrowDown" size="sm" :label="trans('content.move_down')" :disabled="index === collections.length - 1" @click="move(form.collections, index, 1)" />
                            <IconButton :icon="PhPencilSimple" size="sm" :label="trans('content.home.edit_collection', { title: collection.title.de })" data-testid="ADM-29.edit-collection" @click="openCollection(index)" />
                            <IconButton :icon="PhTrash" size="sm" variant="ghost" class="hover:text-danger" :label="trans('content.home.remove_collection', { title: collection.title.de })" @click="form.collections.splice(index, 1)" />
                        </span>
                    </li>
                </ol>
                <p class="text-admin-base text-ink-3">{{ trans('content.home.picked_note') }}</p>
            </section>
        </template>

        <VehiclePicker v-model:open="pickerOpen" :title="pickerFor === 'featured' ? trans('content.home.add_featured') : pickerFor === 'cover' ? trans('content.home.collection.cover') : trans('content.home.collection.add_vehicle')" :exclude="pickerExclude" :failed="failedDialog" @choose="chosen" />

        <Drawer v-model:open="drawerOpen" :title="editingIndex === null ? trans('content.home.add_collection') : trans('content.home.collection.edit_title')" size="lg" test-id="ADM-29.collection-drawer">
            <form id="adm29-collection" class="flex flex-col gap-16" novalidate @submit.prevent="applyCollection">
                <Field :label="trans('content.home.collection.key')" :hint="trans('content.home.collection.key_hint')" :error="drawerErrors.key" required>
                    <Input v-model="editing.key" maxlength="60" :disabled="editingIndex !== null" data-testid="ADM-29.collection.key" />
                </Field>
                <div class="grid grid-cols-2 gap-12">
                    <Field :label="trans('content.fields.title_de')" :error="drawerErrors.title" required><Input v-model="editing.title.de" maxlength="60" data-testid="ADM-29.collection.title" /></Field>
                    <Field :label="trans('content.fields.title_en')" optional><Input v-model="titleEn" maxlength="60" /></Field>
                    <Field :label="trans('content.fields.subtitle_de')" optional><Input v-model="subtitleDe" maxlength="120" /></Field>
                    <Field :label="trans('content.fields.subtitle_en')" optional><Input v-model="subtitleEn" maxlength="120" /></Field>
                </div>
                <RadioGroup v-model="modeModel" :options="modeOptions" :legend="trans('content.home.collection.mode')" />
                <Field v-if="editing.mode === 'filter'" :label="trans('content.home.collection.filters')" :hint="trans('content.home.collection.filters_hint')" :error="drawerErrors.filters" required>
                    <Input v-model="filterText" maxlength="500" spellcheck="false" data-testid="ADM-29.collection.filters" />
                </Field>
                <ul v-if="editing.mode === 'filter' && chips.length > 0" class="-mt-8 flex flex-wrap gap-4" :aria-label="trans('content.home.collection.filters_read')" data-testid="ADM-29.collection.chips">
                    <li v-for="chip in chips" :key="chip"><Badge tone="neutral">{{ chip }}</Badge></li>
                </ul>
                <div v-else class="flex flex-col gap-8">
                    <div class="flex items-center justify-between gap-8">
                        <p class="text-admin-base-strong text-ink">{{ trans('content.home.collection.vehicles') }}</p>
                        <Button size="sm" variant="secondary" :icon="PhPlus" :disabled="editing.vehicle_ids.length >= limits.collection_vehicles" @click="openPicker('collection')">{{ trans('content.home.collection.add_vehicle') }}</Button>
                    </div>
                    <ul v-if="editing.vehicle_ids.length > 0" class="flex flex-col rounded-sm border border-line">
                        <li v-for="(id, i) in editing.vehicle_ids" :key="id" class="flex h-40 items-center gap-12 border-b border-line-subtle px-12 last:border-b-0">
                            <VehicleThumb :src="known[id]?.thumb ?? null" />
                            <span class="min-w-0 flex-1 truncate text-admin-base text-ink">{{ vehicleTitle(id) }}</span>
                            <IconButton :icon="PhTrash" size="sm" variant="ghost" class="hover:text-danger" :label="trans('content.home.remove_featured', { title: vehicleTitle(id) })" @click="editing.vehicle_ids.splice(i, 1)" />
                        </li>
                    </ul>
                    <p v-if="drawerErrors.vehicles" class="text-admin-base text-danger" role="alert">{{ drawerErrors.vehicles }}</p>
                    <p class="text-admin-base text-ink-3">{{ trans('content.home.picked_note') }}</p>
                </div>
                <div class="w-240"><Field :label="trans('content.home.collection.sort')"><Select v-model="sortModel" :options="sortOptions" /></Field></div>
                <!-- DQ-621: the cover on its own row, its text wraps instead of being cut. -->
                <div>
                    <Field :label="trans('content.home.collection.cover')" optional>
                        <div class="flex flex-wrap items-center gap-8">
                            <span class="min-w-0 flex-1 text-admin-base" :class="editing.cover_vehicle_id ? 'text-ink' : 'text-ink-3'">{{ editing.cover_vehicle_id ? vehicleTitle(editing.cover_vehicle_id) : trans('content.home.collection.cover_auto') }}</span>
                            <Button size="sm" variant="secondary" @click="openPicker('cover')">{{ trans('brand.choose') }}</Button>
                            <Button v-if="editing.cover_vehicle_id" size="sm" variant="ghost" @click="editing.cover_vehicle_id = null">{{ trans('brand.remove') }}</Button>
                        </div>
                    </Field>
                </div>
                <Switch v-model="editing.active" :label="trans('content.home.collection.active')" />
            </form>
            <template #footer>
                <Button variant="ghost" @click="drawerOpen = false">{{ trans('ui.actions.cancel') }}</Button>
                <Button type="submit" form="adm29-collection" variant="primary" data-testid="ADM-29.collection.apply">{{ trans('content.apply') }}</Button>
            </template>
        </Drawer>
    </div>
</template>
