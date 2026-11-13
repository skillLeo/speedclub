<?php

use App\Http\Middleware\EnsureRecentStaffPassword;
use Illuminate\Routing\Route as RoutingRoute;
use Illuminate\Support\Facades\Route;

/*
 * SF-5 of the M3.2 review (ADR-215, 06 §1): every admin write route needs a password confirmed within 5 minutes (staff.recent-password)
 * and a permission atom on the route (can:…), unless it is on an allow-list below with the reason. The walk reads the router, so a new
 * write route that forgets either fails here. Adding an exception is one line: '<route name>' => '<why>'.
 */

/** Admin write routes without staff.recent-password, each with the reason. */
const ADMIN_WRITES_WITHOUT_RECENT_PASSWORD = [
    // Fortify's own sign-in, password and two-factor steps: they are the password check, or come before any session exists.
    'login.store' => 'the sign-in itself',
    'logout' => 'signing out never needs a password',
    'password.email' => 'the forgot-password mail, signed out',
    'password.update' => 'the reset with the mailed token, signed out',
    'user-password.update' => 'asks for the current password itself',
    'password.confirm.store' => 'this is the confirmation',
    'two-factor.login.store' => 'the code step of the sign-in',
    'two-factor.enable' => 'Fortify confirms the password itself (password.confirm on the route)',
    'two-factor.confirm' => 'enrolment: confirms the new key with a code',
    'admin.two-factor.skip' => 'ADR-427: enrolment step before any code exists; marks only this session, audited, rate-limited',
    'two-factor.disable' => 'Fortify confirms the password itself (password.confirm on the route)',
    'two-factor.regenerate-recovery-codes' => 'Fortify confirms the password itself (password.confirm on the route)',
    // Shell and personal settings: nothing of a member or the platform changes.
    'admin.session.keep-alive' => 'idle timer only (ADR-217)',
    'admin.saved-views.store' => 'the staff member\'s own table view',
    'admin.saved-views.destroy' => 'the staff member\'s own table view',
    // Low-risk or own actions.
    'admin.team.approvals.cancel' => 'the requester withdraws an own request, nothing executes',
    'admin.media.approve' => 'marks a photo reviewed; nothing is removed or sent (keyboard A)',
    'admin.media.original' => 'an audited view of a removed photo, like the PII reveal',
    'admin.members.reset-link' => 'sends the member the normal reset-code mail; staff never see or set a password',
    'admin.members.pii' => 'an audited reveal of the address (members.view_pii)',
    'admin.members.view-as.end' => 'ending a view-as only takes rights away',
    // Four-eyes requests: they only create an approval request; the approval itself needs the recent password (approvals.approve).
    'admin.members.export-data' => 'four-eyes request (members.export)',
    'admin.members.delete' => 'four-eyes request (members.delete)',
    // M3.4 moderation and support: no member account changes; decisions, appeals, bulk and rules keep the guard.
    'admin.moderation.cases.assign' => 'takes or hands over a case; nothing is decided',
    'admin.moderation.cases.preview' => 'renders the statement of reasons; nothing is stored',
    'admin.moderation.cases.evidence' => 'an audited view of the evidence, like the PII reveal',
    'admin.moderation.cases.live' => 'an audited view of the message context, like the PII reveal',
    'admin.moderation.templates.store' => 'wording only; every decision is reviewed in the composer before it is sent',
    'admin.moderation.templates.update' => 'wording only; every decision is reviewed in the composer before it is sent',
    'admin.moderation.templates.destroy' => 'wording only; decisions keep the text they were sent with',
    'admin.support.tickets.reply' => 'a support answer; nothing of the member account changes',
    'admin.support.tickets.note' => 'an internal note, never sent',
    'admin.support.tickets.update' => 'one ticket\'s status (also gelöst) and assignment, as a reply can set them; audited and reversible (staff reopen it, a member reply reopens it as offen); the bulk change keeps the guard',
    'admin.support.macros.store' => 'reply wording only; every reply is reviewed before it is sent',
    'admin.support.macros.update' => 'reply wording only; every reply is reviewed before it is sent',
    'admin.support.macros.destroy' => 'reply wording only; sent replies keep their text',
    'admin.moderation.cases.reports.contact' => 'an audited view of a web notifier\'s address that changes nothing; it needs members.view_pii and moderation.view and counts in the daily reveal cap, as the ticket contact reveal does',
    'admin.support.tickets.contact' => 'an audited view of a web contact\'s address that changes nothing; it needs members.view_pii, as the member PII reveal does',
    // M3.3 catalogue: merges, deletes and the import apply keep the guard; these change no member account and nothing is lost.
    'admin.catalog.entries.store' => 'adds a catalogue entry; audited, deletable while nothing points at it',
    'admin.catalog.entries.update' => 'renames an entry; audited, the slug locks once anything points at it',
    'admin.catalog.entries.active' => 'deactivate / activate with a reason: reversible, builds keep the entry',
    'admin.catalog.vehicles.requests.accept' => 'links a member\'s car to the catalogue; audited, the member is told',
    'admin.catalog.vehicles.requests.reject' => 'closes a catalogue request with a reason; the car keeps its free text',
    'admin.catalog.categories.store' => 'a new, empty mod category; audited',
    'admin.catalog.categories.update' => 'category wording and order with a reason; audited',
    'admin.catalog.fields.store' => 'adds a field with a reason; a new schema version, the old one is kept',
    'admin.catalog.fields.update' => 'edits a field with a reason; a new schema version, refused where stored data would break',
    'admin.catalog.fields.reorder' => 'field order with a reason; a new schema version',
    'admin.catalog.fields.archive' => 'archive / restore with a reason: reversible, data stays',
    'admin.catalog.import.store' => 'the dry run: the file is analysed, nothing in the catalogue changes',
    // M4.14 ADM-57: reversible, audited product edits (the merge needs the password).
    'admin.catalog.products.store' => 'adds a product; audited, archivable',
    'admin.catalog.products.update' => 'edits a product; audited with before and after',
    'admin.catalog.products.archive' => 'archive with a reason: reversible, mods keep the product',
    'admin.catalog.products.restore' => 'restore with a reason: reversible',
    // M3.6
    'admin.team.permissions.diff' => 'a read-only preview of a matrix change; saving it needs the recent password',
    'admin.invite.store' => 'signed out: the invited person sets the password here',
    'admin.system.health.run' => 'runs the read-only health checks and stores their results',
    'admin.system.integrations.test' => 'a test message to the staff member themselves; nothing of the platform changes',
    'admin.account.rotation.cancel' => 'drops the staff member\'s own pending key; the confirmed one keeps working',
    'admin.account.sessions.destroy' => 'ends one of the staff member\'s own sessions: only takes access away',
    'admin.account.sessions.others' => 'ends the staff member\'s own other sessions: only takes access away',
    // M3.5
    'admin.brand.assets.store' => 'uploads an image to choose from; nothing changes live until the branding draft is published',
    'admin.brand.draft.save' => 'the staff member\'s own draft; publishing keeps the guard',
    'admin.brand.draft.discard' => 'removes an unpublished draft (another\'s only with the publish atom and a reason); nothing live changes',
    'admin.content.home.draft.save' => 'the staff member\'s own draft; publishing keeps the guard',
    'admin.content.home.draft.discard' => 'removes an unpublished draft; nothing live changes',
    'admin.content.announcements.draft.save' => 'the staff member\'s own draft; publishing keeps the guard',
    'admin.content.announcements.draft.discard' => 'removes an unpublished draft; nothing live changes',
    'admin.content.legal.preview' => 'renders Markdown for the editor; nothing is stored',
    'admin.content.legal.draft.save' => 'an unpublished legal draft; publishing (legal.publish) keeps the guard',
    'admin.content.legal.draft.discard' => 'deletes an unpublished draft; published versions are never touched',
    'admin.content.help.store' => 'a new help article starts unpublished; audited',
    'admin.content.help.update' => 'help wording, audited with before/after; editing a published article also needs content.publish',
    'admin.content.help.published' => 'publish/unpublish a help article: reversible, audited',
    'admin.content.templates.save' => 'template wording only, placeholders checked, fixed texts refused; audited, reset any time',
    'admin.content.templates.reset' => 'back to the default text; audited',
    'admin.content.templates.preview' => 'renders the template with sample data; nothing is stored or sent',
    'admin.config.releases.store' => 'a register entry; no runtime effect, audited',
    'admin.config.releases.update' => 'corrects a register entry; no runtime effect, audited',
    'admin.config.releases.sync' => 'reads docs/RELEASES.md idempotently; no runtime effect, audited',
];

/** Admin write routes without a can:<atom> on the route, each with the reason. */
const ADMIN_WRITES_WITHOUT_ATOM = [
    'login.store' => 'signed out',
    'logout' => 'every staff member may sign out',
    'password.email' => 'signed out',
    'password.update' => 'signed out',
    'user-password.update' => 'the staff member\'s own password',
    'password.confirm.store' => 'the staff member\'s own password',
    'two-factor.login.store' => 'signed out (code step)',
    'two-factor.enable' => 'the staff member\'s own second factor',
    'two-factor.confirm' => 'the staff member\'s own second factor',
    'admin.two-factor.skip' => 'the staff member\'s own enrolment (ADR-427)',
    'two-factor.disable' => 'the staff member\'s own second factor',
    'two-factor.regenerate-recovery-codes' => 'the staff member\'s own second factor',
    'admin.session.keep-alive' => 'every signed-in staff member',
    'admin.saved-views.store' => 'own views, scoped to the staff member in the Action',
    'admin.saved-views.destroy' => 'own views, scoped to the staff member in the Action',
    'admin.team.approvals.cancel' => 'the engine lets only the requester cancel (Approvals::cancel)',
    // M3.6: signed out, or the staff member's own account (ADM-51)
    'admin.invite.store' => 'signed out: the invite token is the authority',
    'admin.account.rotation.start' => 'the staff member\'s own second factor (current code required)',
    'admin.account.rotation.confirm' => 'the staff member\'s own second factor',
    'admin.account.rotation.cancel' => 'the staff member\'s own second factor',
    'admin.account.recovery-codes.show' => 'the staff member\'s own recovery codes (current code required)',
    'admin.account.recovery-codes.regenerate' => 'the staff member\'s own recovery codes (current code required)',
    'admin.account.sessions.destroy' => 'the staff member\'s own sessions',
    'admin.account.sessions.others' => 'the staff member\'s own sessions',
];

/**
 * @return list<RoutingRoute>
 */
function adminWriteRoutes(): array
{
    return array_values(array_filter(
        Route::getRoutes()->getRoutes(),
        fn (RoutingRoute $route): bool => str_starts_with($route->uri(), 'admin') && array_diff($route->methods(), ['GET', 'HEAD']) !== [],
    ));
}

function routeLabel(RoutingRoute $route): string
{
    return ($route->getName() ?? '(unnamed)').' '.implode('|', array_diff($route->methods(), ['HEAD'])).' /'.$route->uri();
}

it('finds the admin write routes', function () {
    expect(count(adminWriteRoutes()))->toBeGreaterThan(30);
});

it('puts staff.recent-password on every admin write route outside the allow-list', function () {
    $missing = [];
    foreach (adminWriteRoutes() as $route) {
        $middleware = $route->gatherMiddleware();
        $guarded = in_array('staff.recent-password', $middleware, true) || in_array(EnsureRecentStaffPassword::class, $middleware, true);
        $allowed = array_key_exists((string) $route->getName(), ADMIN_WRITES_WITHOUT_RECENT_PASSWORD);
        if (! $guarded && ! $allowed) {
            $missing[] = routeLabel($route);
        }
    }

    expect($missing)->toBe([], "Admin write routes without staff.recent-password (add it, or allow-list the route with a reason):\n".implode("\n", $missing));
});

it('puts a can:<atom> on every admin write route outside the allow-list', function () {
    $missing = [];
    foreach (adminWriteRoutes() as $route) {
        $atoms = array_filter($route->gatherMiddleware(), fn (mixed $m): bool => is_string($m) && str_starts_with($m, 'can:'));
        if ($atoms === [] && ! array_key_exists((string) $route->getName(), ADMIN_WRITES_WITHOUT_ATOM)) {
            $missing[] = routeLabel($route);
        }
    }

    expect($missing)->toBe([], "Admin write routes without a can:<atom> (add it, or allow-list the route with a reason):\n".implode("\n", $missing));
});

it('keeps the allow-lists free of routes that no longer exist', function () {
    $names = array_map(fn (RoutingRoute $route): string => (string) $route->getName(), adminWriteRoutes());

    expect(array_diff(array_keys(ADMIN_WRITES_WITHOUT_RECENT_PASSWORD), $names))->toBe([])
        ->and(array_diff(array_keys(ADMIN_WRITES_WITHOUT_ATOM), $names))->toBe([]);
});
