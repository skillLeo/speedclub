<?php

use App\Actions\Admin\Businesses\ReviewBusiness;
use App\Enums\BusinessStatus;
use App\Enums\NotificationType;
use App\Models\ApprovalRequest;
use App\Models\AuditEvent;
use App\Models\Business;
use App\Models\Notification;
use App\Models\User;
use App\Services\Approvals\Approvals;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/../Support/helpers.php';
require_once __DIR__.'/../../Businesses/BusinessTestHelpers.php';

/**
 * ADM-55/56 (09 §8.10, §10.3; M4.14 backend): the queue and record props with the role matrix (moderation atoms, as ADM-53), verify /
 * reject / reinstate / reopen with audit, the owner's notice and optimistic locking, and the four-eyes suspension (business.suspend).
 * The Vue pages come with the admin-builder round, so the Inertia components are not required on disk here.
 */
const BIZ_ADMIN_VIEW = ['owner', 'admin', 'moderator', 'analyst'];
const BIZ_ADMIN_DECIDE = ['owner', 'admin', 'moderator'];

beforeEach(function () {
    bizFlags();
    $this->owner = User::factory()->create(['username' => 'jana.werkstatt']);
    $this->applied = bizBusiness($this->owner, ['status' => BusinessStatus::Applied, 'verified_at' => null, 'submitted_at' => now()->subHours(2)]);
});

function bizAdminAs(string $role): mixed
{
    seedStaffRoles();
    $staff = staffWithRole($role);
    actingAsStaff($staff);
    test()->withSession(['auth.password_confirmed_at' => time()]);

    return $staff;
}

function bizVersion(Business $business): ?string
{
    return ReviewBusiness::version($business->fresh() ?? $business);
}

it('guards the queue and the record by moderation.view', function (string $uri, string $component) {
    $uri = str_replace('{business}', $this->applied->id, $uri);

    assertAdminMatrix('GET', $uri, BIZ_ADMIN_VIEW, fn (TestResponse $r) => $r->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->component($component, false)));
})->with([
    'ADM-55' => ['/admin/businesses', 'Businesses/Queue'],
    'ADM-55 verified' => ['/admin/businesses?tab=verified', 'Businesses/Queue'],
    'ADM-55 with the pane' => ['/admin/businesses?business={business}', 'Businesses/Queue'],
    'ADM-56' => ['/admin/businesses/{business}', 'Businesses/Show'],
]);

it('guards the decisions by moderation.decide', function (string $action, array $data) {
    assertAdminMatrix('POST', "/admin/businesses/{$this->applied->id}/$action", BIZ_ADMIN_DECIDE, function (TestResponse $r): void {
        expect($r->status())->toBeIn([302, 303, 423]);
    }, $data);
    expect(AuditEvent::query()->where('action', 'like', 'business.%')->count())->toBe(0);
})->with([
    'verify' => ['verify', ['version' => '2026-01-01T00:00:00+00:00']],
    'reject' => ['reject', ['reason' => 'Die Registernummer ließ sich nicht finden.', 'version' => '2026-01-01T00:00:00+00:00']],
    'suspend' => ['suspend', ['reason' => 'Impressum gehört zu einem anderen Betrieb.', 'version' => '2026-01-01T00:00:00+00:00']],
    'reinstate' => ['reinstate', ['reason' => 'Nach Klärung wieder freigeschaltet.', 'version' => '2026-01-01T00:00:00+00:00']],
    'reopen' => ['reopen', ['version' => '2026-01-01T00:00:00+00:00']],
]);

it('lists applications oldest first with the record staff check, never the owner e-mail', function () {
    $older = bizBusiness(null, ['status' => BusinessStatus::Applied, 'verified_at' => null, 'submitted_at' => now()->subHours(5), 'document_note' => 'Handelsregisterauszug liegt vor.']);
    bizAdminAs('moderator');

    $this->get('/admin/businesses')->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->component('Businesses/Queue', false)
        ->where('tab', 'applied')->where('counts.applied', 2)
        ->where('rows.data.0.id', $older->id)->where('rows.data.0.waiting_minutes', 300)
        ->where('rows.data.1.owner.username', 'jana.werkstatt')->where('canDecide', true));

    $this->getJson("/admin/businesses/{$older->id}/preview")->assertOk()->assertJsonPath('business.document_note', 'Handelsregisterauszug liegt vor.')
        ->assertJsonPath('business.impressum.register_number', 'HRB 00000')->assertJsonPath('business.needs_register', true)->assertJsonPath('business.can.verify', true)
        ->assertJsonMissingPath('business.owner.email');
    $this->get('/admin/businesses/01JAAAAAAAAAAAAAAAAAAAAAAA')->assertNotFound();
});

it('verifies: public at once, audited with the reason, the owner told; a second decision is not possible', function () {
    bizAdminAs('moderator');

    $this->post("/admin/businesses/{$this->applied->id}/verify", ['version' => bizVersion($this->applied), 'reason' => 'Impressum und Register geprüft.'])
        ->assertSessionHas('success', 'businesses.flash.verified');
    $business = $this->applied->fresh();
    expect($business?->status)->toBe(BusinessStatus::Verified)->and($business?->verified_at)->not->toBeNull()
        ->and(AuditEvent::query()->where('action', 'business.verified')->where('target_id', $business?->id)->value('reason'))->toBe('Impressum und Register geprüft.')
        ->and(Notification::query()->where('notifiable_id', $this->owner->id)->where('type', NotificationType::BusinessReview->value)->value('data'))->toMatchArray(['outcome' => 'verified']);

    $this->getJson("/api/v1/businesses/{$this->applied->slug}")->assertOk();
    $this->post("/admin/businesses/{$this->applied->id}/verify", ['version' => bizVersion($this->applied)])->assertSessionHas('error', 'businesses.flash.not_possible');
    $this->post("/admin/businesses/{$this->applied->id}/reject", ['reason' => 'Zu spät, schon verifiziert.', 'version' => '2020-01-01T00:00:00+00:00'])->assertSessionHasErrors('version');
});

it('rejects with a reason the owner reads, and reopens a decision', function () {
    bizAdminAs('admin');

    $this->post("/admin/businesses/{$this->applied->id}/reject", ['reason' => 'kurz', 'version' => bizVersion($this->applied)])->assertSessionHasErrors('reason');
    $this->post("/admin/businesses/{$this->applied->id}/reject", ['reason' => 'Die Registernummer ließ sich nicht finden.', 'version' => bizVersion($this->applied)])
        ->assertSessionHas('success', 'businesses.flash.rejected');
    expect($this->applied->fresh()?->status)->toBe(BusinessStatus::Rejected)
        ->and(Notification::query()->where('notifiable_id', $this->owner->id)->where('type', NotificationType::BusinessReview->value)->value('data'))
        ->toMatchArray(['outcome' => 'rejected', 'reason' => 'Die Registernummer ließ sich nicht finden.']);

    $this->post("/admin/businesses/{$this->applied->id}/reopen", ['version' => bizVersion($this->applied)])->assertSessionHas('success', 'businesses.flash.reopened');
    expect($this->applied->fresh()?->status)->toBe(BusinessStatus::Applied)
        ->and(AuditEvent::query()->where('action', 'business.reopened')->count())->toBe(1);
});

it('suspends only with four eyes: the request waits, a second moderator approves, the owner is told; then reinstates', function () {
    $verified = bizBusiness(null, ['slug' => 'tuning-nord']);
    $requester = bizAdminAs('moderator');

    $this->post("/admin/businesses/{$verified->id}/suspend", ['reason' => 'Impressum gehört zu einem anderen Betrieb.', 'version' => bizVersion($verified)])
        ->assertSessionHas('approval', fn (array $approval): bool => $approval['title'] === 'approvals.business_suspend.title' && $approval['existing'] === false);
    expect($verified->fresh()?->status)->toBe(BusinessStatus::Verified);

    $request = ApprovalRequest::query()->where('action', 'business.suspend')->firstOrFail();
    expect(fn () => app(Approvals::class)->approve($request, $requester))->toThrow(AuthorizationException::class);

    $approver = staffWithRole('admin');
    app(Approvals::class)->approve($request, $approver);
    $verified->refresh();
    expect($verified->status)->toBe(BusinessStatus::Suspended)
        ->and(AuditEvent::query()->where('action', 'business.suspended')->value('after'))->toMatchArray(['status' => 'suspended', 'approved_by' => $approver->id]);
    $this->getJson('/api/v1/businesses/tuning-nord')->assertNotFound();

    // Suspending directly is impossible outside the approval.
    expect(fn () => app(ReviewBusiness::class)->suspend($requester, $approver, $verified, 'Ohne Freigabe versucht.', (string) bizVersion($verified)))->toThrow(AuthorizationException::class);

    bizAdminAs('moderator');
    $this->post("/admin/businesses/{$verified->id}/reinstate", ['reason' => 'Nach Klärung wieder freigeschaltet.', 'version' => bizVersion($verified)])
        ->assertSessionHas('success', 'businesses.flash.reinstated');
    expect($verified->fresh()?->status)->toBe(BusinessStatus::Verified);
});

it('refuses a suspension request for a changed business', function () {
    $verified = bizBusiness();
    bizAdminAs('moderator');

    $this->post("/admin/businesses/{$verified->id}/suspend", ['reason' => 'Impressum gehört zu einem anderen Betrieb.', 'version' => '2020-01-01T00:00:00+00:00'])
        ->assertSessionHasErrors('version');
    expect(ApprovalRequest::query()->where('action', 'business.suspend')->exists())->toBeFalse();
});
