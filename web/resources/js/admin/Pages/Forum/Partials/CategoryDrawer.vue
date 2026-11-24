<script setup lang="ts">
import { router, usePage } from '@inertiajs/vue3';
import { trans } from 'laravel-vue-i18n';
import { computed, reactive, ref, watch } from 'vue';
import { Button, ConfirmDialog, Drawer, Field, Input, Select, Switch, Textarea } from '../../../Components/ui';
import { confirmPasswordFirst, passwordRecentlyConfirmed } from '../../../composables/recentPassword';
import { categoryRecordUrl, categoryUrl, type ForumCategoryRow } from '../shared';

/**
 * ADM-69 "Neue Kategorie" / "Kategorie bearbeiten" (10 §7.1, m5.8-contract §6): names and descriptions in DE + EN (the member's language
 * picks), the address part (slug, a-z, 0-9 and hyphens, from the German name while untouched), a Phosphor icon key for the app's chip,
 * the main category (one level of sub-categories) and whether members see it. An optional note goes into the audit log. ⚿ write; the
 * discard guard asks before changes are lost.
 */
const open = defineModel<boolean>('open', { default: false });
const props = withDefaults(
    defineProps<{
        category: ForumCategoryRow | null;
        /** A new sub-category of this main category. */
        parentId?: number | null;
        /** Main categories that can take sub-categories (standard, top level). */
        parents: { id: number; name: string }[];
        hasChildren?: boolean;
    }>(),
    { parentId: null, hasChildren: false },
);

interface Form {
    name_de: string;
    name_en: string;
    slug: string;
    description_de: string;
    description_en: string;
    icon: string;
    parent: string;
    is_active: boolean;
}
const NONE = 'none';
const blank = (): Form => ({ name_de: '', name_en: '', slug: '', description_de: '', description_en: '', icon: '', parent: NONE, is_active: true });
const form = reactive<Form>(blank());
const baseline = ref('');
const slugTouched = ref(false);
const errors = ref<Record<string, string>>({});
const saving = ref(false);
const guardOpen = ref(false);
const creating = computed(() => props.category === null);
const page = usePage();

watch(
    open,
    (value) => {
        if (!value) return;
        const c = props.category;
        Object.assign(
            form,
            c
                ? {
                      ...blank(),
                      name_de: c.name_de,
                      name_en: c.name_en,
                      slug: c.slug,
                      description_de: c.description_de ?? '',
                      description_en: c.description_en ?? '',
                      icon: c.icon ?? '',
                      parent: props.parentId === null ? NONE : String(props.parentId),
                      is_active: c.is_active,
                  }
                : { ...blank(), parent: props.parentId === null ? NONE : String(props.parentId) },
        );
        slugTouched.value = c !== null;
        errors.value = {};
        baseline.value = JSON.stringify(form);
    },
    { immediate: true },
);

/** "Räder & Reifen" → "raeder-reifen". */
function slugify(text: string): string {
    return text
        .toLowerCase()
        .replaceAll('ä', 'ae')
        .replaceAll('ö', 'oe')
        .replaceAll('ü', 'ue')
        .replaceAll('ß', 'ss')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}
watch(
    () => form.name_de,
    (name) => {
        if (!slugTouched.value) form.slug = slugify(name);
    },
);

const dirty = computed(() => JSON.stringify(form) !== baseline.value);
const parentOptions = computed(() => [{ value: NONE, label: trans('forum.categories.form.parent_none') }, ...props.parents.filter((p) => p.id !== props.category?.id).map((p) => ({ value: String(p.id), label: p.name }))]);

function validate(): Record<string, string> {
    const local: Record<string, string> = {};
    const name = (value: string): boolean => value.trim().length >= 2 && value.trim().length <= 80;
    if (!name(form.name_de)) local.name_de = trans('forum.categories.form.name_error');
    if (!name(form.name_en)) local.name_en = trans('forum.categories.form.name_error');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug) || form.slug.length > 80) local.slug = trans('forum.categories.form.slug_error');
    if (form.icon.trim() !== '' && !/^[A-Za-z]{1,40}$/.test(form.icon.trim())) local.icon = trans('forum.categories.form.icon_error');
    return local;
}

function save(): void {
    const local = validate();
    errors.value = local;
    if (Object.keys(local).length > 0) return;
    const text = (value: string): string | null => (value.trim() === '' ? null : value.trim());
    const data: Record<string, unknown> = {
        name_de: form.name_de.trim(),
        name_en: form.name_en.trim(),
        slug: form.slug,
        description_de: text(form.description_de),
        description_en: text(form.description_en),
        icon: text(form.icon),
        is_active: form.is_active,
        ...(props.hasChildren ? {} : { parent_id: form.parent === NONE ? null : Number(form.parent) }),
    };
    const options = {
        preserveScroll: true,
        preserveState: true,
        onStart: () => (saving.value = true),
        onFinish: () => (saving.value = false),
        onSuccess: (next: { props: { flash?: unknown } }) => {
            if ((next.props.flash as { confirm_password?: true } | undefined)?.confirm_password === true) {
                // Client round 7: the server found the confirmation stale (ADR-215). Repeat this request after the password, not the shell's
                // bare copy of it, so its own callbacks run (close, saved state, field errors) instead of leaving the form as if unsaved.
                confirmPasswordFirst(go);
                return;
            }
            baseline.value = JSON.stringify(form);
            open.value = false;
        },
        onError: (bag: Record<string, string>) => (errors.value = bag),
    };
    const go = (): void => {
        if (props.category === null) router.post(categoryUrl('store'), data as never, options);
        else router.patch(categoryRecordUrl('update', props.category.id), data as never, options);
    };
    if (passwordRecentlyConfirmed(page.props.staff?.password_confirmed_until)) go();
    else confirmPasswordFirst(go);
}

function requestOpen(value: boolean): void {
    if (!value && dirty.value && !saving.value) {
        guardOpen.value = true;
        return;
    }
    open.value = value;
}
function discard(): void {
    guardOpen.value = false;
    open.value = false;
}
const known = ['name_de', 'name_en', 'slug', 'description_de', 'description_en', 'icon', 'parent_id', 'is_active'];
const serverError = computed(() => Object.entries(errors.value).find(([key]) => !known.includes(key))?.[1] ?? null);
</script>

<template>
    <Drawer
        :open="open"
        :title="category ? trans('forum.categories.form.edit_title', { name: category.name_de }) : trans(parentId ? 'forum.categories.form.new_child_title' : 'forum.categories.form.new_title')"
        :description="trans('forum.categories.form.description')"
        size="lg"
        :dismissible="!saving"
        test-id="ADM-69.drawer"
        @update:open="requestOpen"
    >
        <form id="adm69-form" class="flex flex-col gap-20" novalidate data-testid="ADM-69.form" @submit.prevent="save">
            <section class="flex flex-col gap-12" aria-labelledby="adm69-names">
                <h3 id="adm69-names" class="text-admin-base-strong text-ink">{{ trans('forum.categories.form.names') }}</h3>
                <div class="flex flex-wrap gap-12">
                    <div class="min-w-200 grow basis-0">
                        <Field :label="trans('forum.categories.form.name_de')" :error="errors.name_de" required>
                            <Input v-model="form.name_de" maxlength="80" data-testid="ADM-69.name-de" />
                        </Field>
                    </div>
                    <div class="min-w-200 grow basis-0">
                        <Field :label="trans('forum.categories.form.name_en')" :error="errors.name_en" required>
                            <Input v-model="form.name_en" maxlength="80" data-testid="ADM-69.name-en" />
                        </Field>
                    </div>
                </div>
                <Field :label="trans('forum.categories.form.slug')" :hint="trans('forum.categories.form.slug_hint')" :error="errors.slug" required>
                    <Input v-model="form.slug" maxlength="80" autocomplete="off" spellcheck="false" data-testid="ADM-69.slug" @input="slugTouched = true" />
                </Field>
                <Field :label="trans('forum.categories.form.description_de')" :error="errors.description_de" optional>
                    <Textarea v-model="form.description_de" :rows="2" :maxlength="300" show-count data-testid="ADM-69.description-de" />
                </Field>
                <Field :label="trans('forum.categories.form.description_en')" :error="errors.description_en" optional>
                    <Textarea v-model="form.description_en" :rows="2" :maxlength="300" show-count data-testid="ADM-69.description-en" />
                </Field>
            </section>

            <section class="flex flex-col gap-12 border-t border-line-subtle pt-20" aria-labelledby="adm69-place">
                <h3 id="adm69-place" class="text-admin-base-strong text-ink">{{ trans('forum.categories.form.place') }}</h3>
                <div class="w-full max-w-320">
                    <Field :label="trans('forum.categories.form.parent')" :hint="hasChildren ? trans('forum.categories.form.parent_locked') : trans('forum.categories.form.parent_hint')" :error="errors.parent_id">
                        <Select v-model="form.parent" :options="parentOptions" :disabled="hasChildren" data-testid="ADM-69.parent" />
                    </Field>
                </div>
                <div class="w-full max-w-320">
                    <Field :label="trans('forum.categories.form.icon')" :hint="trans('forum.categories.form.icon_hint')" :error="errors.icon" optional>
                        <Input v-model="form.icon" maxlength="40" autocomplete="off" spellcheck="false" data-testid="ADM-69.icon" />
                    </Field>
                </div>
                <Switch v-model="form.is_active" :label="trans('forum.categories.form.active')" data-testid="ADM-69.active" />
                <p class="-mt-8 text-caption text-ink-3">{{ trans('forum.categories.form.active_hint') }}</p>
            </section>

            <p v-if="serverError" class="text-admin-base text-danger" role="alert" data-testid="ADM-69.server-error">{{ serverError }}</p>
        </form>
        <template #footer>
            <Button variant="ghost" :disabled="saving" data-dialog-cancel @click="requestOpen(false)">{{ trans('ui.actions.cancel') }}</Button>
            <Button type="submit" form="adm69-form" variant="primary" :loading="saving" :disabled="!creating && !dirty" data-testid="ADM-69.save">{{ trans(creating ? 'forum.categories.form.create' : 'forum.categories.form.save') }}</Button>
        </template>
    </Drawer>
    <ConfirmDialog
        v-model:open="guardOpen"
        :title="trans('forum.categories.form.discard_title')"
        :body="trans('forum.categories.form.discard_body')"
        :confirm-label="trans('forum.categories.form.discard')"
        tone="neutral"
        test-id="ADM-69.discard"
        @confirm="discard"
    />
</template>
