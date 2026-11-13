<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import { PhArrowCounterClockwise, PhEyes, PhListChecks } from '@phosphor-icons/vue';
import { trans, transChoice } from 'laravel-vue-i18n';
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useAdminAction } from '../../Components/decisions/action';
import ApprovalNotice from '../../Components/patterns/ApprovalNotice.vue';
import DialogError from '../../Components/patterns/DialogError.vue';
import ScrollRegion from '../../Components/patterns/ScrollRegion.vue';
import StateBlock from '../../Components/patterns/StateBlock.vue';
import PageHeader from '../../Components/shell/PageHeader.vue';
import { Button, Checkbox, Dialog, Field, Skeleton, Textarea } from '../../Components/ui';
import { qaDialogFailed, usePageState } from '../../composables/pageState';
import { qaDialog } from '../../composables/qaDialog';
import { formatNumber } from '../../lib/format';
import { JsonError, requestJson } from '../../lib/http';
import { usePermissions } from '../../lib/permissions';
import { routeOr } from '../../lib/routes';
import { atomGroupLabel, atomLabel, groupAtoms, roleLabel } from './shared';

/**
 * ADM-42 permission matrix (role × atom, m3.6 §1). Owner and Admin keep every atom (shown, not editable). Changes are collected here;
 * "Änderungen prüfen" asks the server for the diff (added and removed per role, staff affected, the sensitive grants) and shows it before
 * saving. Saving removals and plain grants applies at once; a grant of a sensitive atom asks for the four-eyes `roles.sensitive_atoms`
 * (with reason), which nobody holding one of the changed roles may approve.
 */
interface MatrixRole {
    name: string;
    description: string | null;
    locked: boolean;
    system: boolean;
    atoms: string[];
    staff: number;
}
interface DiffRow {
    added: string[];
    removed: string[];
    before: string[];
    staff: number;
}
const props = defineProps<{ matrix: { atoms: string[]; sensitive: string[]; roles: MatrixRole[] } }>();

const { can } = usePermissions();
const failedDialog = qaDialogFailed();
const state = usePageState();
const pageState = computed(() => (failedDialog ? 'ready' : state.value));
const manage = computed(() => can('roles.manage'));
const groups = computed(() => groupAtoms(props.matrix.atoms));
// The loading picture has one column per role, like the matrix (DQ-622).
const skeletonRoles = computed(() => Math.max(1, props.matrix.roles.length));

// ---- the draft --------------------------------------------------------------------------------------------------------------
const draft = reactive<Record<string, string[]>>({});
function resetDraft(): void {
    for (const role of props.matrix.roles) draft[role.name] = [...role.atoms];
}
watch(() => props.matrix, resetDraft, { immediate: true });
const has = (role: MatrixRole, atom: string) => role.locked || (draft[role.name] ?? []).includes(atom);
function toggle(role: MatrixRole, atom: string, on: boolean | 'indeterminate'): void {
    const current = draft[role.name] ?? [];
    draft[role.name] = on === true ? [...new Set([...current, atom])].sort() : current.filter((a) => a !== atom);
}
const changedRoles = computed(() => props.matrix.roles.filter((r) => !r.locked && [...(draft[r.name] ?? [])].sort().join('|') !== [...r.atoms].sort().join('|')));
const changeCount = computed(() =>
    changedRoles.value.reduce((sum, role) => {
        const next = draft[role.name] ?? [];
        return sum + next.filter((a) => !role.atoms.includes(a)).length + role.atoms.filter((a) => !next.includes(a)).length;
    }, 0),
);
const changedCell = (role: MatrixRole, atom: string) => !role.locked && role.atoms.includes(atom) !== (draft[role.name] ?? []).includes(atom);

// ---- diff dialog ------------------------------------------------------------------------------------------------------------
const action = useAdminAction();
const diffOpen = ref(false);
const diffLoading = ref(false);
const diffError = ref<string | null>(null);
const diff = ref<Record<string, DiffRow>>({});
const sensitive = ref<string[]>([]);
const affected = ref(0);
const reason = ref('');
const reasonError = ref<string | null>(null);
const fourEyes = computed(() => sensitive.value.length > 0);
const proposal = () => Object.fromEntries(changedRoles.value.map((r) => [r.name, draft[r.name] ?? []]));
async function review(): Promise<void> {
    diffLoading.value = true;
    diffError.value = null;
    action.reset();
    reason.value = '';
    reasonError.value = null;
    try {
        const answer = await requestJson<{ diff: Record<string, DiffRow>; sensitive: string[]; staff: number }>('post', routeOr('admin.team.permissions.diff', '/admin/team/permissions/diff'), { matrix: proposal() });
        diff.value = answer.diff;
        sensitive.value = answer.sensitive;
        affected.value = answer.staff;
        diffOpen.value = true;
    } catch (error) {
        diffError.value = error instanceof JsonError && typeof error.body.message === 'string' ? error.body.message : trans('team.matrix.diff_failed');
    } finally {
        diffLoading.value = false;
    }
}
function save(): void {
    const text = reason.value.trim();
    reasonError.value = fourEyes.value && (text.length < 10 || text.length > 1000) ? trans('team.role_form.errors.reason') : null;
    if (reasonError.value) return;
    action.run('patch', routeOr('admin.team.permissions.update', '/admin/team/permissions'), { matrix: proposal(), reason: text === '' ? null : text }, { sensitive: true, onSuccess: () => (diffOpen.value = false) });
}

// ---- QA overlay (?dialog=diff): a sensitive grant to Support, a removal from Analyse -------------------------------------------
onMounted(async () => {
    if (qaDialog() !== 'diff') return;
    const support = props.matrix.roles.find((r) => r.name === 'support');
    const analyst = props.matrix.roles.find((r) => r.name === 'analyst');
    if (support) toggle(support, 'approvals.decide', true);
    if (analyst) toggle(analyst, 'moderation.view', false);
    await review();
    reason.value = 'Support entscheidet ab sofort mit über Vier-Augen-Anfragen; Analyse braucht die Meldungen nicht mehr.';
    await nextTick();
    if (failedDialog) action.error.value = trans('ui.state.server_error');
});
</script>

<template>
    <Head :title="trans('team.matrix.title')" />
    <div class="flex flex-col gap-24" data-testid="ADM-42" :data-qa-state="pageState">
        <PageHeader :title="trans('team.matrix.title')" :crumbs="[{ label: trans('shell.groups.team') }]" :description="trans('team.matrix.intro')">
            <template v-if="manage && pageState === 'ready'" #actions>
                <span class="text-admin-base text-ink-2 tabular-nums" aria-live="polite" data-testid="ADM-42.changes">{{ transChoice('team.matrix.changes', changeCount, { count: formatNumber(changeCount) }) }}</span>
                <Button size="sm" variant="ghost" :icon="PhArrowCounterClockwise" :disabled="changeCount === 0" data-testid="ADM-42.discard" @click="resetDraft()">{{ trans('team.matrix.discard') }}</Button>
                <Button size="sm" variant="primary" :icon="PhListChecks" :disabled="changeCount === 0" :loading="diffLoading" data-testid="ADM-42.review" @click="review()">{{ trans('team.matrix.review') }}</Button>
            </template>
        </PageHeader>

        <p v-if="!manage" class="text-admin-base text-ink-2" data-testid="ADM-42.view-only">{{ trans('team.matrix.view_only') }}</p>
        <DialogError v-if="diffError" :message="diffError" test-id="ADM-42.diff-error" />

        <StateBlock v-if="pageState === 'error'" kind="error" :title="trans('team.matrix.error')" :body="trans('ui.state.error_body')" test-id="ADM-42.error" @retry="router.reload()" />
        <div v-else-if="pageState === 'loading'" class="flex flex-col rounded-sm border border-line-subtle" aria-busy="true" data-testid="ADM-42.loading">
            <div class="flex h-56 items-center gap-16 border-b border-line-subtle px-12"><Skeleton shape="text" class="w-240" /><Skeleton v-for="n in skeletonRoles" :key="n" shape="text" class="w-80" /></div>
            <div v-for="n in 10" :key="n" class="flex h-40 items-center gap-16 border-b border-line-subtle px-12 last:border-b-0"><Skeleton shape="text" class="w-240" /><Skeleton v-for="m in skeletonRoles" :key="m" class="size-16" /></div>
        </div>
        <!-- DQ-615: the header stays in view over the 57 rows; it sticks under the top bar while the matrix fits its column. -->
        <ScrollRegion v-else v-slot="{ contained }" :label="trans('team.matrix.scroll')" sticky-header test-id="ADM-42.matrix">
            <table class="w-full border-collapse text-admin-base">
                <caption class="sr-only">{{ trans('team.matrix.caption') }}</caption>
                <thead class="sticky z-10 bg-surface" :class="contained ? 'top-0' : 'top-56'" data-testid="ADM-42.matrix.head">
                    <tr class="border-b border-line">
                        <th scope="col" class="sticky left-0 z-10 min-w-240 bg-surface px-12 py-8 text-left text-admin-base-strong text-ink-2">{{ trans('team.matrix.atom') }}</th>
                        <th v-for="role in matrix.roles" :key="role.name" scope="col" class="min-w-96 px-8 py-8 text-center align-bottom" :data-testid="`ADM-42.role.${role.name}`">
                            <span class="block text-admin-base-strong text-ink">{{ roleLabel(role.name) }}</span>
                            <span class="block whitespace-nowrap text-caption text-ink-3 tabular-nums">{{ transChoice('team.matrix.staff', role.staff, { count: formatNumber(role.staff) }) }}</span>
                        </th>
                    </tr>
                </thead>
                <tbody v-for="group in groups" :key="group.group">
                    <tr class="border-b border-line-subtle">
                        <th scope="colgroup" :colspan="matrix.roles.length + 1" class="sticky left-0 bg-surface px-12 pb-4 pt-12 text-left text-caption text-ink-3">{{ atomGroupLabel(group.group) }}</th>
                    </tr>
                    <tr v-for="atom in group.atoms" :key="atom" class="h-40 border-b border-line-subtle" :data-testid="`ADM-42.atom.${atom}`">
                        <th scope="row" class="sticky left-0 z-0 bg-surface px-12 text-left font-normal text-ink">
                            <span class="flex items-center gap-8">
                                <span class="min-w-0">{{ atomLabel(atom) }}</span>
                                <PhEyes v-if="matrix.sensitive.includes(atom)" :size="16" class="shrink-0 text-ink-3" role="img" :aria-label="trans('team.matrix.sensitive')" />
                            </span>
                        </th>
                        <td v-for="role in matrix.roles" :key="role.name" class="px-8 text-center" :class="changedCell(role, atom) ? 'bg-selected' : ''">
                            <Checkbox
                                :model-value="has(role, atom)"
                                :aria-label="trans('team.matrix.cell', { atom: atomLabel(atom), role: roleLabel(role.name) })"
                                :disabled="role.locked || !manage"
                                :data-testid="`ADM-42.cell.${role.name}.${atom}`"
                                @update:model-value="(on: boolean | 'indeterminate') => toggle(role, atom, on)"
                            />
                        </td>
                    </tr>
                </tbody>
            </table>
        </ScrollRegion>

        <Dialog v-model:open="diffOpen" :title="trans('team.matrix.diff_title')" :description="trans('team.matrix.diff_body')" size="lg" :dismissible="!action.processing.value" test-id="ADM-42.diff-dialog">
            <div class="flex flex-col gap-16">
                <p class="text-admin-base-strong text-ink tabular-nums" data-testid="ADM-42.diff.total">{{ transChoice('team.matrix.diff_total', affected, { count: formatNumber(affected) }) }}</p>
                <section v-for="(row, role) in diff" :key="role" class="flex flex-col gap-8 rounded-sm border border-line-subtle px-16 py-12" :data-testid="`ADM-42.diff.${role}`">
                    <h3 class="text-headline text-ink">{{ trans('team.matrix.diff_role', { role: roleLabel(String(role)), staff: transChoice('team.matrix.staff', row.staff, { count: formatNumber(row.staff) }) }) }}</h3>
                    <dl class="grid grid-cols-1 gap-12 tablet:grid-cols-2">
                        <div class="flex flex-col gap-2">
                            <dt class="text-caption text-ink-3">{{ trans('team.matrix.diff_added') }}</dt>
                            <dd v-if="row.added.length === 0" class="text-admin-base text-ink-3">–</dd>
                            <dd v-for="a in row.added" :key="a" class="flex items-center gap-4 text-admin-base text-ink">{{ `+ ${atomLabel(a)}` }}<PhEyes v-if="matrix.sensitive.includes(a)" :size="16" class="text-ink-3" role="img" :aria-label="trans('team.matrix.sensitive')" /></dd>
                        </div>
                        <div class="flex flex-col gap-2">
                            <dt class="text-caption text-ink-3">{{ trans('team.matrix.diff_removed') }}</dt>
                            <dd v-if="row.removed.length === 0" class="text-admin-base text-ink-3">–</dd>
                            <dd v-for="a in row.removed" :key="a" class="text-admin-base text-ink-2">{{ `− ${atomLabel(a)}` }}</dd>
                        </div>
                    </dl>
                </section>
                <template v-if="fourEyes">
                    <ApprovalNotice test-id="ADM-42.diff.four-eyes" />
                    <p class="text-admin-base text-ink-2">{{ trans('team.matrix.diff_four_eyes', { atoms: sensitive.map(atomLabel).join(', ') }) }}</p>
                </template>
                <Field :label="trans('ui.confirm.reason')" :hint="fourEyes ? trans('team.invite.reason_hint') : trans('team.matrix.reason_optional')" :error="reasonError" :required="fourEyes" :optional="!fourEyes">
                    <Textarea v-model="reason" :rows="2" :maxlength="1000" show-count data-testid="ADM-42.diff.reason" />
                </Field>
            </div>
            <template #footer>
                <DialogError :message="action.error.value" test-id="ADM-42.diff.error" />
                <Button variant="ghost" :disabled="action.processing.value" data-dialog-cancel @click="diffOpen = false">{{ trans('ui.actions.cancel') }}</Button>
                <Button variant="primary" :loading="action.processing.value" data-testid="ADM-42.diff.submit" @click="save()">{{ fourEyes ? trans('team.matrix.save_four_eyes') : trans('team.matrix.save') }}</Button>
            </template>
        </Dialog>
    </div>
</template>
