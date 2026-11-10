<?php

use App\Enums\ApprovalStatus;
use App\Models\ApprovalRequest;
use App\Models\AuditEvent;
use App\Services\Approvals\Approvals;
use App\Services\Audit\Audit;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/Support/helpers.php';

/*
 * ADM-44 audit log: matrix, filters, event drawer (audited), chain status, export as four-eyes request only.
 */

describe('authorisation matrix', function () {
    it('lets only audit.view open the log', function () {
        assertAdminMatrix('GET', '/admin/audit', ['owner', 'admin'], fn (TestResponse $r) => $r->assertOk()->assertInertia(fn (AssertableInertia $p) => $p->component('Audit/Index')));
    });

    it('lets only audit.export ask for an export', function () {
        assertAdminMatrix(
            'POST',
            '/admin/audit/export',
            ['owner', 'admin'],
            fn (TestResponse $r) => $r->assertStatus(303),
            ['format' => 'csv', 'reason' => 'Anfrage der Datenschutzbehörde vom 03.11.'],
        );
    });
});

describe('the log', function () {
    beforeEach(function () {
        seedStaffRoles();
        $this->owner = staffWithRole('owner');
        $this->other = staffWithRole('support');
    });

    it('lists events newest first with actor names and table props', function () {
        Audit::record('staff.login', $this->other, actor: $this->other);
        Audit::record('member.restricted', null, ['messaging' => null], ['messaging' => '2026-06-21'], 'Spam an neue Mitglieder', $this->owner);

        actingAsStaff($this->owner)->get('/admin/audit')
            ->assertInertia(fn (AssertableInertia $page) => $page
                ->where('rows.data.0.action', 'member.restricted')
                ->where('rows.data.0.actor.type', 'staff')
                ->where('rows.data.0.actor.label', $this->owner->name)
                ->where('rows.data.0.reason', 'Spam an neue Mitglieder')
                ->where('rows.data.0.has_diff', true)
                ->where('rows.data.1.target.type', 'staff')
                ->where('rows.meta.per_page', 25)
                ->where('query.sort', '-occurred_at')
                ->where('views', [])
                ->where('canExport', true)
                ->has('actors')
                ->has('targetTypes')
                ->missing('rows.data.0.before'));
    });

    it('never shows staff IP addresses or user agents', function () {
        Audit::record('staff.login', $this->owner, actor: $this->owner);

        $response = actingAsStaff($this->owner)->get('/admin/audit');

        expect($response->getContent())->not->toContain('user_agent')->not->toContain('127.0.0.1');
    });

    it('filters by action prefix, actor and date range (Berlin days)', function () {
        $this->travelTo(Carbon::parse('2026-06-14 10:00', 'Europe/Berlin'));
        Audit::record('approval.requested', actor: $this->owner);
        Audit::record('staff.login', $this->other, actor: $this->other);
        $this->travelTo(Carbon::parse('2026-06-15 00:30', 'Europe/Berlin'));
        Audit::record('approval.approved', actor: $this->other);

        actingAsStaff($this->owner)->get('/admin/audit?filter[action]=approval.')
            ->assertInertia(fn (AssertableInertia $page) => $page->has('rows.data', 2)->where('query.filter.action', 'approval.'));

        actingAsStaff($this->owner)->get('/admin/audit?filter[actor]=staff:'.$this->other->id)
            ->assertInertia(fn (AssertableInertia $page) => $page->has('rows.data', 2));

        actingAsStaff($this->owner)->get('/admin/audit?filter[from]=2026-06-14&filter[to]=2026-06-14')
            ->assertInertia(fn (AssertableInertia $page) => $page->has('rows.data', 2));

        actingAsStaff($this->owner)->get('/admin/audit?filter[actor]=system')
            ->assertInertia(fn (AssertableInertia $page) => $page->has('rows.data', 0));
    });

    it('sorts by whitelisted columns only', function () {
        Audit::record('b.second', actor: $this->owner);
        Audit::record('a.first', actor: $this->owner);

        actingAsStaff($this->owner)->get('/admin/audit?sort=action')
            ->assertInertia(fn (AssertableInertia $page) => $page->where('rows.data.0.action', 'a.first'));

        assertAdminErrorPage(actingAsStaff($this->owner)->get('/admin/audit?sort=hash'), 400);
    });

    it('pages with 25, 50 or 100 rows and nothing else', function () {
        actingAsStaff($this->owner)->get('/admin/audit?per_page=50')->assertInertia(fn (AssertableInertia $page) => $page->where('rows.meta.per_page', 50));
        actingAsStaff($this->owner)->get('/admin/audit?per_page=5000')->assertInertia(fn (AssertableInertia $page) => $page->where('rows.meta.per_page', 25));
    });

    it('opens an event with its diff and audits the view', function () {
        Audit::record('member.edited', $this->other, ['bio' => 'alt'], ['bio' => 'neu'], 'Tippfehler', $this->owner);
        $event = AuditEvent::query()->latest('id')->firstOrFail();

        actingAsStaff($this->owner)->get('/admin/audit?event='.$event->id)
            ->assertInertia(fn (AssertableInertia $page) => $page
                ->where('selected.id', $event->id)
                ->where('selected.before', ['bio' => 'alt'])
                ->where('selected.after', ['bio' => 'neu'])
                ->where('selected.missing', false)
                ->has('selected.hash'));

        $viewed = AuditEvent::query()->where('action', 'audit.event_viewed')->sole();
        expect($viewed->target_id)->toBe((string) $event->id)
            ->and($viewed->actor_id)->toBe((string) $this->owner->id);
    });

    it('does not audit a page load without an opened event', function () {
        actingAsStaff($this->owner)->get('/admin/audit');

        expect(AuditEvent::query()->where('action', 'audit.event_viewed')->exists())->toBeFalse();
    });

    it('answers a missing event inside the drawer', function () {
        actingAsStaff($this->owner)->get('/admin/audit?event=999999')
            ->assertInertia(fn (AssertableInertia $page) => $page->where('selected', ['id' => 999999, 'missing' => true]));
    });

    it('shows the result of the last audit:verify', function () {
        actingAsStaff($this->owner)->get('/admin/audit')->assertInertia(fn (AssertableInertia $page) => $page->where('chain', null));

        $this->artisan('audit:verify')->assertSuccessful();

        actingAsStaff($this->owner)->get('/admin/audit')
            ->assertInertia(fn (AssertableInertia $page) => $page->where('chain.intact', true)->has('chain.verified_at'));
    });
});

describe('export is four-eyes', function () {
    beforeEach(function () {
        seedStaffRoles();
        Storage::fake('local');
        $this->owner = staffWithRole('owner');
        // ADR-215: the export needs a password confirmed within the last five minutes.
        $this->withSession(['auth.password_confirmed_at' => time()]);
    });

    it('refuses a stale password confirmation: nothing is requested, the page asks for the password', function () {
        $this->withSession(['auth.password_confirmed_at' => time() - 301]);

        actingAsStaff($this->owner)
            ->from('/admin/audit')
            ->post('/admin/audit/export', ['format' => 'csv', 'reason' => 'Prüfung durch den Datenschutzbeauftragten'])
            ->assertRedirect('/admin/audit')
            ->assertSessionHas('confirm_password', true)
            ->assertSessionMissing('approval');

        expect(ApprovalRequest::query()->exists())->toBeFalse();
    });

    it('refuses without any password confirmation in the session', function () {
        session()->forget('auth.password_confirmed_at');

        actingAsStaff($this->owner)->from('/admin/audit')
            ->post('/admin/audit/export', ['format' => 'csv', 'reason' => 'Prüfung durch den Datenschutzbeauftragten'])
            ->assertSessionHas('confirm_password', true);

        expect(ApprovalRequest::query()->exists())->toBeFalse();
    });

    it('never exports from the endpoint itself', function () {
        $before = AuditEvent::query()->count();

        actingAsStaff($this->owner)
            ->from('/admin/audit')
            ->post('/admin/audit/export', ['format' => 'jsonl', 'reason' => 'Prüfung durch den Datenschutzbeauftragten', 'filter' => ['action' => 'approval.']])
            ->assertRedirect('/admin/audit');

        expect(Storage::disk('local')->allFiles())->toBe([])
            ->and(AuditEvent::query()->where('action', 'like', 'audit.export%')->where('action', '!=', 'audit.export.requested')->exists())->toBeFalse()
            ->and(AuditEvent::query()->count() - $before)->toBeLessThanOrEqual(1);
    });

    it('answers with the pending approval request and executes nothing', function () {
        actingAsStaff($this->owner)
            ->from('/admin/audit?filter[action]=approval.')
            ->post('/admin/audit/export', ['format' => 'csv', 'reason' => 'Prüfung durch den Datenschutzbeauftragten', 'filter' => ['actor' => 'staff:'.$this->owner->id, 'from' => '2026-06-01']])
            ->assertStatus(303)
            ->assertSessionHas('approval', fn (array $approval): bool => $approval['title'] === 'approvals.audit_export.title' && isset($approval['id'], $approval['expires_at']));

        $request = ApprovalRequest::query()->sole();
        expect($request->action)->toBe('audit.export')
            ->and($request->status)->toBe(ApprovalStatus::Pending)
            ->and($request->requested_by)->toBe($this->owner->id)
            ->and($request->payload)->toBe(['format' => 'csv', 'filter' => ['from' => '2026-06-01', 'actor_type' => 'staff', 'actor_id' => (string) $this->owner->id]])
            ->and($request->executed_at)->toBeNull()
            ->and(Storage::disk('local')->allFiles())->toBe([]);
    });

    it('shows the pending request to another owner on ADM-08, not to the requester', function () {
        $second = staffWithRole('owner');

        actingAsStaff($this->owner)->post('/admin/audit/export', ['format' => 'jsonl', 'reason' => 'Prüfung durch den Datenschutzbeauftragten']);

        actingAsStaff($this->owner)->get('/admin/alerts')->assertInertia(fn (AssertableInertia $page) => $page->where('approvals', [])->where('nav_counts.approvals_for_me', 0));
        actingAsStaff($second)->get('/admin/alerts')
            ->assertInertia(fn (AssertableInertia $page) => $page
                ->has('approvals', 1)
                ->where('approvals.0.action', 'audit.export')
                ->where('approvals.0.requested_by', $this->owner->name)
                ->where('nav_counts.approvals_for_me', 1));
    });

    it('runs only after a second owner approves, then offers the file to the requester on ADM-08', function () {
        $second = staffWithRole('owner');
        actingAsStaff($this->owner)->post('/admin/audit/export', ['format' => 'csv', 'reason' => 'Prüfung durch den Datenschutzbeauftragten']);
        $request = ApprovalRequest::query()->sole();

        app(Approvals::class)->approve($request, $second);

        actingAsStaff($this->owner)->get('/admin/alerts')
            ->assertInertia(fn (AssertableInertia $page) => $page
                ->has('downloads', 1)
                ->where('downloads.0.id', $request->id)
                ->where('downloads.0.title', 'approvals.audit_export.title')
                ->where('downloads.0.url', fn (string $url) => str_contains($url, 'signature=')));

        actingAsStaff($second)->get('/admin/alerts')->assertInertia(fn (AssertableInertia $page) => $page->where('downloads', []));
    });

    it('requires a reason of 10 to 1000 characters and a known format', function (array $data, string $field) {
        actingAsStaff($this->owner)->from('/admin/audit')->post('/admin/audit/export', $data)->assertSessionHasErrors($field);
    })->with([
        'no reason' => [['format' => 'csv'], 'reason'],
        'short reason' => [['format' => 'csv', 'reason' => 'kurz'], 'reason'],
        'long reason' => [['format' => 'csv', 'reason' => str_repeat('x', 1001)], 'reason'],
        'bad format' => [['format' => 'xlsx', 'reason' => 'Prüfung durch den Datenschutzbeauftragten'], 'format'],
        'unknown filter' => [['format' => 'csv', 'reason' => 'Prüfung durch den Datenschutzbeauftragten', 'filter' => ['hash' => 'x']], 'filter'],
        'bad date' => [['format' => 'csv', 'reason' => 'Prüfung durch den Datenschutzbeauftragten', 'filter' => ['from' => '14.06.2026']], 'filter.from'],
    ]);

    it('is refused to a role without audit.export even with a valid request', function () {
        actingAsStaff(staffWithRole('analyst'))
            ->post('/admin/audit/export', ['format' => 'csv', 'reason' => 'Prüfung durch den Datenschutzbeauftragten'])
            ->assertStatus(403);
        expect(Storage::disk('local')->allFiles())->toBe([]);
    });
});
