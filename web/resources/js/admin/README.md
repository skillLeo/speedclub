# Admin portal (Inertia v3 · Vue 3 · Tailwind v4 · Reka UI)

How the admin is put together and how a module (M3.2–M3.6) adds to it **without editing a shared file**. Specs: `docs/06_ADMIN_SPEC.md`,
`docs/04_SCREEN_REGISTER.md` §5, `docs/03_DESIGN_SYSTEM.md` §14/§15, conventions in `docs/reports/phase-3/m3.1-contract.md` §0.

## Layout of this folder
| Path | What | Who edits |
|---|---|---|
| `app.ts` | Inertia app, i18n resolver, layouts by page name | lead only |
| `Layouts/` | `AdminLayout` (shell), `AuthLayout` (sign-in, errors without session) | lead only |
| `Components/ui/` | Primitives (Reka UI wrapped, tokens only). Import from `Components/ui` (index.ts) | **frozen** after M3.1, ask the lead |
| `Components/data-table/` | `DataTable`, `SavedViews`, `TableColumn` | frozen |
| `Components/record/` | `RecordLayout`, `ActivityTimeline` | frozen |
| `Components/patterns/` | `ChartCard`, `KpiTile`, `Sparkline`, `DiffViewer`, `StateBlock`, `ApprovalNotice`, `BulkResultPanel`, `PermissionGate`, `CommandPalette`, `ThemeFrame` | frozen |
| `Components/shell/` | Sidebar, top bar, `PageHeader`, flash/idle/password dialogs | frozen |
| `modules/<module>.ts` | **One file per module**: nav entries, palette entries, dashboard queue tiles | the module's builder |
| `Pages/<Module>/<Page>.vue` | Inertia pages | the module's builder |
| `lib/` `composables/` `types/` | helpers (format, routes, http, qa, theme, permissions), page state, shared types | frozen |

Strings live in `web/lang/admin/{de,en}/<module>.json` (nested JSON, key = `<module>.<path>`), see "Strings" below.

## Add a page
1. Route in `web/routes/admin/<module>.php` (auto-loaded, prefix `admin`, name `admin.`):
   `Route::middleware(AdminRoutes::signedIn())->group(fn () => Route::get('members', MembersIndexController::class)->middleware('can:members.view')->name('members.index'));`
   `AdminRoutes::signedIn()` = `auth:staff` + `EnsureStaffTwoFactor`; `staff.active` and the IP/domain fence come with the `staff` group.
2. Thin controller in `App\Http\Controllers\Admin\<Module>\…` → `Inertia::render('<Module>/<Page>', [...])`, only the props the page needs.
   Props are **camelCase** at the top level (`canExport`, not `can_export`); nested data may stay snake_case.
3. Page: `Pages/<Module>/<Page>.vue`, root element `data-testid="ADM-NN"` and `:data-qa-state="state"` with
   `const state = usePageState(() => …)` (honours `?qaState=loading|empty|error`). Start with
   `<PageHeader :title :crumbs :description>` (slots `badge`, `meta`, `actions`).
4. Every page ships loading (skeleton with the real geometry), empty (`EmptyQueue`), no results, error + retry (`StateBlock kind="error"`),
   403/view-only (`StateBlock kind="forbidden"` or hide the control), partial failure (`StateBlock kind="partial"`, `BulkResultPanel`).
5. A 403/404/500 inside an admin route renders the `Error` page automatically (`AdminErrorPage`); nothing to do in the page.

## Add a nav entry, palette entry or dashboard queue
Create or extend `modules/<module>.ts`:
```ts
import { PhUsers } from '@phosphor-icons/vue';
import { defineModule } from './registry';
export default defineModule({
    key: 'members',
    nav: [{ group: 'members', items: [{ route: 'admin.members.index', match: 'admin.members.*', label: 'shell.nav.members', icon: PhUsers, atom: 'members.view', order: 1, testId: 'members' }] }],
    palette: [{ key: 'members-new-week', label: 'members.presets.new_week', route: 'admin.members.index', params: { view: 'new' }, atom: 'members.view' }],
    queues: [/* { key, label, empty, atom, route, order, testId } — the server sends {count, status, since} under `key` from DashboardData::queues */],
});
```
Groups and their order are fixed in `modules/registry.ts` (13 groups of 03 §14). An entry shows only if its route exists (Ziggy) and the
staff member holds the atom; groups without entries disappear. Nav labels for new modules go in **your** module's JSON (e.g. `members.nav.title`),
not in `shell.json`.

## Add a table (`DataTable`)
Server (`TableProps::make()` in `App\Http\Controllers\Admin\Support`): spatie QueryBuilder with whitelisted `allowedFilters`/`allowedSorts`
→ props `{rows: {data, meta}, query: {filter, sort, per_page}, views}`; the table key you pass to `TableProps::make()` is the DataTable `id`
(saved views are stored per staff member and key, no registration needed). Client:
```vue
<DataTable id="members" :columns :rows :query :views :presets :caption :empty-title test-id="ADM-09.table"
  selectable :bulk-actions export-url="/admin/members/export.csv" export-atom="members.view" @bulk="onBulk">
  <template #filters="{ apply, loading }"> … call apply({ status: 'restricted' }) … </template>
  <template #cell-status="{ row }"><StatusPill :tone :label /></template>
</DataTable>
```
Columns: `{ key, label, sort?, numeric?, width?: xs|sm|md|lg|xl|auto, hideable?, defaultHidden? }` — keep one `auto` column. 40 px rows,
sticky header, column chooser (localStorage), saved views, selection + bulk bar (shows the >100 four-eyes hint), CSV export
(`exportRequest` emits `export` instead, for four-eyes exports), states built in. Bulk answers `{id, ok, code}[]` → `BulkResultPanel`.

## Add a record page
`<RecordLayout v-model:tab :title :crumbs :status :tabs :tabs-label :activity test-id="ADM-10">` with one slot per tab value, `#actions`,
`#meta`; the right column is the `ActivityTimeline` (map the record's audit events to `{id, occurred_at, label, actor, reason}`) or `#aside`.
Edit forms go in a `Drawer` (`#footer` for the buttons), destructive actions in `ConfirmDialog` (`typed` for irreversible, `reason` where
06 says "with reason", `four-eyes` for the four-eyes list).

## Add a four-eyes action
Server: never execute. FormRequest (atom + `reason` 10–1000) → `app(ApprovalsGateway::class)->request('<handler key>', $payload, $reason, $staff)`
→ `back(303)->with('approval', $flash)`. The handler lives in `app/Services/Approvals/Handlers/` (server lane). Its `describe()` title and
line labels are admin i18n keys under `approvals.*` (`lang/admin/{de,en}/approvals.json`). Pest: a direct POST creates a pending
`approval_requests` row and changes nothing.
Client: `ConfirmDialog four-eyes reason` → `router.post(...)`; the shell shows the `ApprovalNotice` from the flash by itself.

## Sensitive writes (recent password, ADR-215)
Put `staff.recent-password` on the route. The shell catches the flash `confirm_password`, asks for the password and repeats the last write.
To ask before the first attempt: `confirmPasswordFirst(() => router.post(...))` from `composables/recentPassword` when
`passwordRecentlyConfirmed(page.props.staff?.password_confirmed_until)` is false.

## Strings
`lang/admin/{de,en}/<module>.json`, nested, German first, du-form. Use `trans('<module>.<path>')` from `laravel-vue-i18n`; never literal text in
templates (`vue/no-bare-strings-in-template`). Server flashes send keys (`->with('success', 'members.flash.restricted')`); the shell translates
them. `npm --prefix web run i18n:admin` fails on a key missing in one locale, a used key that does not exist, or differing `:placeholders`.

## Design rules (03 §14/§15)
Tokens only (`bg-surface`, `text-ink-2`, `border-line-subtle` …; spacing utilities in px from the scale 2/4/8/12/16/20/24/32/40/48/64), radii
`rounded-xs` 4 / `-sm` 8 / `-search` 10 / `-md` 12. No arbitrary values, no gradients, no icons in coloured circles. Phosphor icons 16/20/24.
Numbers `tabular-nums`, right-aligned in tables; dates through `lib/format` (`14.06.2026, 18:42`, Europe/Berlin). Primary button = inverse;
red only for destructive actions, the active-nav marker and counts. Controls 32 px (`size="sm"`), 24 px inside 40 px rows (ADR-212).

## QA hooks (non-production)
`?qaState=loading|empty|error` · `?qaTheme=carbon|light` · `?qaLocale=de|en` · `?qaNow=<ISO>` · `?qaMotion=off`. The gallery
`/admin/dev/gallery` (local/testing) shows every component × state in Carbon and Hell; `?dialog=dialog|drawer|confirm|bulk|palette` opens an
overlay for a capture. Test IDs: `data-testid="ADM-NN.<element>"`, shell controls `shell.*`.
