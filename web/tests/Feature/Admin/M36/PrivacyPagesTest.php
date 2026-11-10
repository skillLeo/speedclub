<?php

use App\Enums\PrivacyRequestStatus;
use App\Enums\PrivacyRequestType;
use App\Mail\PrivacyReplyMail;
use App\Models\AuditEvent;
use App\Models\ConfigVersion;
use App\Models\DataExport;
use App\Models\PrivacyRequest;
use App\Models\User;
use App\Services\Privacy\RetentionPolicy;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/Helpers.php';

/**
 * ADM-45…47 (m3.6-contract §1/§3, ADR-239), lane a: pages by privacy.view, steps by privacy.process (and members.delete for the erasure,
 * which only asks for the four-eyes approval), the due dates and the one extension, evidence, the template replies, the audited opening,
 * retention bounds with reason and recent password, the dashboard tile.
 */
beforeEach(function () {
    Mail::fake();
    Queue::fake();
    Storage::fake(config()->string('speedclub.media.private_disk'));
});

function adm36Request(array $attributes = []): PrivacyRequest
{
    return PrivacyRequest::factory()->create($attributes);
}

describe('authorisation matrix', function () {
    it('guards the privacy pages by privacy.view', function (string $uri, string $component) {
        $request = adm36Request();
        assertAdminMatrix('GET', str_replace('{request}', $request->id, $uri), ADM36_PRIVACY_VIEW, fn (TestResponse $r) => $r->assertOk()->assertInertia(fn (AssertableInertia $p) => $p->component($component)));
    })->with([
        'ADM-45' => ['/admin/privacy/requests', 'Privacy/Requests'],
        'ADM-46' => ['/admin/privacy/requests/{request}', 'Privacy/Request'],
        'ADM-47' => ['/admin/privacy/retention', 'Privacy/Retention'],
    ]);

    it('guards every step by privacy.process (Support only reads)', function (string $method, string $uri, array $data) {
        $request = adm36Request(['user_id' => User::factory()->create()->id, 'type' => PrivacyRequestType::Erasure]);
        adm32WriteMatrix($method, str_replace('{request}', $request->id, $uri), ADM36_OWNER_ADMIN, $data);
    })->with([
        'create' => ['POST', '/admin/privacy/requests', ['type' => 'access', 'source' => 'email', 'requester_email' => 'anfrage@beispiel.test']],
        'assign' => ['PATCH', '/admin/privacy/requests/{request}', ['status' => 'in_progress']],
        'extend' => ['POST', '/admin/privacy/requests/{request}/extend', ['reason' => 'Identität noch nicht nachgewiesen.']],
        'reply' => ['POST', '/admin/privacy/requests/{request}/reply', ['template' => 'received']],
        'export' => ['POST', '/admin/privacy/requests/{request}/export', []],
        'erasure' => ['POST', '/admin/privacy/requests/{request}/erasure', ['reason' => 'Löschung wurde schriftlich verlangt.']],
        'complete' => ['POST', '/admin/privacy/requests/{request}/complete', ['status' => 'completed', 'note' => 'Am 08.11. per E‑Mail beantwortet.']],
        'retention' => ['PATCH', '/admin/privacy/retention', ['periods' => ['support_tickets_months' => 12], 'reason' => 'Kürzere Frist laut Rechtsberatung.']],
    ]);

    it('asks for a recent password before a step and changes nothing without it', function () {
        $request = adm36Request();
        adm36As('admin');
        adm36StalePassword();

        $this->patch("/admin/privacy/requests/{$request->id}", ['status' => 'in_progress'])->assertSessionHas('confirm_password', true);
        $this->patch('/admin/privacy/retention', ['periods' => ['support_tickets_months' => 12], 'reason' => adm36Reason()])->assertSessionHas('confirm_password', true);

        expect($request->fresh()->status)->toBe(PrivacyRequestStatus::Open)
            ->and(ConfigVersion::query()->where('key', 'retention')->exists())->toBeFalse();
    });
});

describe('ADM-45 requests', function () {
    it('lists by due date with masked addresses, the counts and the self-service rows', function () {
        adm36As('support');
        adm36Request(['requester_name' => 'Thomas Berger', 'requester_email' => 'thomas.berger@beispiel.test', 'received_at' => now()->subDays(25), 'due_at' => now()->addDays(5)]);
        adm36Request(['received_at' => now()->subMonths(2), 'due_at' => now()->subDay()]);
        adm36Request(['status' => PrivacyRequestStatus::Completed, 'completed_at' => now()]);

        $response = $this->get('/admin/privacy/requests')->assertOk();
        $response->assertInertia(fn (AssertableInertia $p) => $p->component('Privacy/Requests')
            ->where('counts.open', 2)->where('counts.due_soon', 1)->where('counts.overdue', 1)
            ->where('dueSoonDays', 7)
            ->where('assignees', [])
            ->has('selfService')
            ->where('rows.data.0.reference', fn ($ref) => str_starts_with((string) $ref, 'DS-')));

        expect(adm36PropsJson($response))->not->toContain('thomas.berger@beispiel.test')->toContain('Thomas Berger');

        $this->get('/admin/privacy/requests?filter[due]=soon')->assertInertia(fn (AssertableInertia $p) => $p->where('rows.meta.total', 2));
        $this->get('/admin/privacy/requests?filter[due]=overdue')->assertInertia(fn (AssertableInertia $p) => $p->where('rows.meta.total', 1));
    });

    it('records a request for a member by username or for an external requester', function () {
        $member = User::factory()->create(['username' => 'lukas.adm36']);
        adm36As('admin');

        $this->post('/admin/privacy/requests', ['type' => 'access', 'source' => 'email', 'member' => '@lukas.adm36', 'details' => 'Bitte alle Daten.'])->assertRedirect();
        $this->post('/admin/privacy/requests', ['type' => 'objection', 'source' => 'post', 'requester_name' => 'Thomas Berger', 'requester_email' => 'thomas@beispiel.test'])->assertRedirect();
        $this->post('/admin/privacy/requests', ['type' => 'access', 'source' => 'email', 'member' => '@gibtsnicht'])->assertSessionHasErrors('member');

        expect(PrivacyRequest::query()->where('user_id', $member->id)->sole()->due_at->isSameDay(now()->addMonthNoOverflow()))->toBeTrue()
            ->and(PrivacyRequest::query()->count())->toBe(2);
    });
});

describe('ADM-46 request', function () {
    it('audits the opening and shows the steps the viewer may take', function () {
        $request = adm36Request(['type' => PrivacyRequestType::Export, 'user_id' => User::factory()->create()->id]);
        adm36As('admin');

        $this->get("/admin/privacy/requests/{$request->id}")->assertInertia(fn (AssertableInertia $p) => $p->component('Privacy/Request')
            ->where('can.process', true)->where('can.extend', true)->where('can.export', true)->where('can.erasure', false)
            ->has('templates', 5)->where('request.evidence', null));

        expect(AuditEvent::query()->where('action', 'privacy.request_viewed')->where('target_id', $request->id)->exists())->toBeTrue();

        adm36As('support');
        $this->get("/admin/privacy/requests/{$request->id}")->assertInertia(fn (AssertableInertia $p) => $p->where('can.process', false)->where('can.reply', false));
    });

    it('extends the deadline once by two months with a reason', function () {
        $request = adm36Request();
        $due = $request->due_at->copy();
        adm36As('admin');

        $this->post("/admin/privacy/requests/{$request->id}/extend", ['reason' => 'kurz'])->assertSessionHasErrors();
        $this->post("/admin/privacy/requests/{$request->id}/extend", ['reason' => 'Identität noch nicht nachgewiesen.'])->assertSessionHas('success', 'privacy.flash.extended');
        $this->post("/admin/privacy/requests/{$request->id}/extend", ['reason' => 'Identität noch nicht nachgewiesen.'])->assertSessionHas('error', __('team.refused.already_extended'));

        expect($request->fresh()->due_at->isSameDay($due->addMonthsNoOverflow(2)))->toBeTrue();
    });

    it('assigns and moves the status, but closes only with evidence', function () {
        $request = adm36Request();
        $admin = adm36As('admin');

        $this->patch("/admin/privacy/requests/{$request->id}", ['assigned_to' => $admin->id, 'status' => 'waiting'])->assertSessionHas('success', 'privacy.flash.updated');
        expect($request->fresh()->assigned_to)->toBe($admin->id)->and($request->fresh()->status)->toBe(PrivacyRequestStatus::Waiting);

        $this->post("/admin/privacy/requests/{$request->id}/complete", ['status' => 'completed'])->assertSessionHas('error', __('team.refused.evidence_required'));
        $this->post("/admin/privacy/requests/{$request->id}/complete", ['status' => 'rejected', 'note' => ''])->assertSessionHasErrors();

        $this->post("/admin/privacy/requests/{$request->id}/complete", ['status' => 'completed', 'evidence' => UploadedFile::fake()->create('antwort.pdf', 20, 'application/pdf')])
            ->assertSessionHas('success', 'privacy.flash.completed');
        expect($request->fresh()->status)->toBe(PrivacyRequestStatus::Completed);

        $this->get("/admin/privacy/requests/{$request->id}")->assertInertia(fn (AssertableInertia $p) => $p->where('request.evidence.file', 'antwort.pdf')
            ->where('request.evidence.download', fn ($url) => str_ends_with((string) $url, "/admin/privacy/requests/{$request->id}/evidence")));
        $this->get("/admin/privacy/requests/{$request->id}/evidence")->assertOk()->assertHeader('Cache-Control', 'no-store, private');
        expect(AuditEvent::query()->where('action', 'privacy.evidence_viewed')->exists())->toBeTrue();
    });

    it('sends a template reply to the request address', function () {
        $request = adm36Request(['requester_email' => 'antwort@beispiel.test']);
        adm36As('admin');

        $this->post("/admin/privacy/requests/{$request->id}/reply", ['template' => 'extension'])->assertSessionHas('error', __('team.refused.not_extended'));
        $this->post("/admin/privacy/requests/{$request->id}/reply", ['template' => 'received', 'locale' => 'en', 'detail' => 'We will answer within a month.'])->assertSessionHas('success', 'privacy.flash.replied');

        Mail::assertSent(PrivacyReplyMail::class, fn (PrivacyReplyMail $mail) => $mail->hasTo('antwort@beispiel.test'));
    });

    it('sends a member their own export and only asks for the erasure (four-eyes members.delete)', function () {
        $member = User::factory()->create();
        $access = adm36Request(['type' => PrivacyRequestType::Access, 'user_id' => $member->id]);
        $erasure = adm36Request(['type' => PrivacyRequestType::Erasure, 'user_id' => $member->id]);
        adm36As('admin');

        $this->post("/admin/privacy/requests/{$access->id}/export")->assertSessionHas('success', 'privacy.flash.export_sent');
        expect(DataExport::query()->where('user_id', $member->id)->count())->toBe(1);

        $this->post("/admin/privacy/requests/{$erasure->id}/erasure", ['reason' => 'Löschung wurde schriftlich verlangt.'])->assertSessionHas('approval');
        expect(adm36Pending('members.delete'))->not->toBeNull()
            ->and($member->fresh()->trashed())->toBeFalse()
            ->and($erasure->fresh()->approval_request_id)->not->toBeNull();
    });
});

describe('ADM-47 retention', function () {
    it('shows every period with bounds, the fixed ones read-only', function () {
        adm36As('support');

        $this->get('/admin/privacy/retention')->assertInertia(fn (AssertableInertia $p) => $p->component('Privacy/Retention')
            ->where('canEdit', false)
            ->where('periods', fn ($rows) => count($rows) === count(RetentionPolicy::EDITABLE) + count(RetentionPolicy::FIXED)
                && collect($rows)->contains(fn ($r) => $r['key'] === 'privacy_requests_months' && $r['min'] === 36 && $r['editable'] === true)
                && collect($rows)->contains(fn ($r) => $r['key'] === 'moderation_cases' && $r['editable'] === false)));
    });

    it('saves within the bounds with a reason, refuses outside them', function () {
        adm36As('admin');

        $this->patch('/admin/privacy/retention', ['periods' => ['privacy_requests_months' => 12], 'reason' => adm36Reason()])->assertSessionHasErrors();
        $this->patch('/admin/privacy/retention', ['periods' => ['support_tickets_months' => 12]])->assertSessionHasErrors('reason');
        $this->patch('/admin/privacy/retention', ['periods' => ['support_tickets_months' => 12], 'reason' => adm36Reason()])->assertSessionHas('success', 'privacy.flash.retention_saved');

        expect(app(RetentionPolicy::class)->value('support_tickets_months'))->toBe(12);
    });
});

describe('dashboard', function () {
    it('feeds the GDPR tile, which links to ADM-45 due soon', function () {
        adm36Request(['due_at' => now()->addDays(3)]);
        adm36As('support');

        $this->get('/admin')->assertInertia(fn (AssertableInertia $p) => $p->where('queues.privacy_due.count', 1));
        $this->get('/admin/privacy/requests?filter[due]=soon')->assertOk()->assertInertia(fn (AssertableInertia $p) => $p->where('rows.meta.total', 1));
    });
});
