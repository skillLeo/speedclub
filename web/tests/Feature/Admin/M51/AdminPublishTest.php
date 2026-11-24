<?php

use App\Actions\Admin\Content\PublishLegalDocument;
use App\Actions\Admin\Content\SaveLegalDraft;
use App\Enums\ApprovalStatus;
use App\Enums\ApproverChangeCause;
use App\Enums\ConfigKey;
use App\Enums\ConfigVersionStatus;
use App\Enums\LegalDocumentKey;
use App\Enums\StaffAlertKind;
use App\Enums\StaffStatus;
use App\Jobs\Admin\DeliverStaffAlert;
use App\Mail\DraftTakenOverMail;
use App\Mail\OwnerOverrideMail;
use App\Mail\OwnerOverrideSwitchMail;
use App\Models\ApprovalRequest;
use App\Models\ApproverChange;
use App\Models\AuditEvent;
use App\Models\ConfigVersion;
use App\Models\FeatureFlag;
use App\Models\LegalDocument;
use App\Models\Role;
use App\Models\Staff;
use App\Models\StaffAlert;
use App\Services\AppConfig\AppConfig;
use App\Services\Approvals\ApprovalExecution;
use App\Services\Approvals\Approvals;
use App\Services\Approvals\FourEyes;
use App\Services\Approvals\OwnerOverride;
use App\Services\Approvals\OwnerOverrideRefused;
use App\Services\Config\ConfigRefused;
use App\Services\Config\ConfigVersions;
use Database\Seeders\StaffSeeder;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;

require_once __DIR__.'/../M35/Helpers.php';

/*
 * M5.1 "Admin publish bug" (10_CLIENT_ROUND_1 §9, ADR-507) and its fix round (security SEC-P5-01…07, review SF-1…6): a four-eyes request
 * names who can approve it; when nobody else can (now, and when it was asked), no approval rights were taken from anyone within the
 * cool-down and the governance switch is on, the requesting Owner may execute it with a reason (Owner-Override: audited as its own event,
 * alerted through the queue to Owners, Admins and recent approvers). Everything else about the override is refused on the server: 403 for
 * anyone but the requesting Owner of a publishing request, a message inside the dialog for a refusal of the moment. Also: taking over
 * another staff member's draft (its author is told), the flash of a change to another environment's flag column, and a write with a
 * stale form token going back to its page.
 */
beforeEach(function () {
    Mail::fake();
    m35FakeDisks();
});

/**
 * The seeded Owner of StaffSeeder (no TOTP in testing, so an approver since SF-2: accepted staff count before they enrol) out of the
 * team, directly on the row (no approver change is recorded): the signed-in Owner is then alone.
 */
function m51Alone(): void
{
    Staff::query()->where('email', config('speedclub.staff.owner_email'))->update(['status' => StaffStatus::Deactivated->value]);
}

/** The signed-in Owner's maintenance-on publish: answers the pending maintenance.enable request (the engine never executes it here). */
function m51MaintenanceRequest(Staff $owner): ApprovalRequest
{
    adm35Publish($owner, ConfigKey::RemoteConfig, m35Remote());
    $draft = adm35Draft($owner, ConfigKey::RemoteConfig, m35Remote(['maintenance' => ['enabled' => true, 'message' => ['de' => 'Wir sind gleich wieder da.', 'en' => null]]]));

    test()->post('/admin/config/remote/publish', ['reason' => adm32Reason(), 'revision' => $draft->revision])->assertStatus(303)->assertSessionHas('approval');

    return ApprovalRequest::query()->where('action', 'maintenance.enable')->where('status', ApprovalStatus::Pending)->sole();
}

/** What GET app-config answers now, through its cache (never flushed here: a publish must bust it itself). */
function m51AppConfig(): array
{
    $response = test()->getJson('/api/v1/app-config')->assertOk();

    return ['etag' => $response->headers->get('ETag'), 'maintenance' => (bool) $response->json('data.maintenance.enabled')];
}

/** Whether maintenance is stored on, read past the cache (for the checks that nothing went live). */
function m51MaintenanceStored(): bool
{
    app(AppConfig::class)->flush();

    return (bool) test()->getJson('/api/v1/app-config')->json('data.maintenance.enabled');
}

/** A critical flag's change asked by $owner, straight through the engine (its endpoint asks only in production). */
function m51FlagRequest(Staff $owner, array $changes = ['enabled' => true]): ApprovalRequest
{
    $flag = FeatureFlag::factory()->create(['key' => 'sig.m51_'.strtolower(Str::random(6)), 'enabled' => false, 'rules' => ['critical' => true]]);

    return app(Approvals::class)->request('flags.critical_change', [
        'flag_id' => (int) $flag->getKey(),
        'changes' => $changes,
        'updated_at' => $flag->updated_at?->toIso8601ZuluString() ?? '',
    ], adm32Reason(), $owner, $flag);
}

/** An AGB version 2 with re-consent asked by $owner (the legal.publish_reconsent request). */
function m51LegalRequest(Staff $owner): ApprovalRequest
{
    LegalDocument::factory()->published()->create(['key' => LegalDocumentKey::Terms, 'locale' => 'de', 'version' => '1', 'published_at' => now()->subMonth()]);
    $draft = app(SaveLegalDraft::class)->handle($owner, LegalDocumentKey::Terms, 'de', [
        'version' => '2',
        'body_md' => "# AGB\n\n§ 1 Geltungsbereich. Diese Fassung ersetzt Version 1.",
        'requires_reconsent' => true,
        'summary' => 'Neue Regeln zu Fotos und Moderation.',
    ]);

    $outcome = app(PublishLegalDocument::class)->handle($owner, $draft, adm32Reason(), PublishLegalDocument::revision($draft));

    return $outcome->approval ?? throw new LogicException('AGB with re-consent waits for its approval.');
}

/**
 * A staff member C with a custom role `m51-lead` of $atoms (standing in for an earlier, approved grant).
 *
 * @param  list<string>  $atoms
 */
function m51Lead(array $atoms): Staff
{
    $role = Role::findOrCreate('m51-lead', StaffSeeder::GUARD);
    $role->syncPermissions($atoms);
    $lead = staffWithRole(null);
    $lead->forceFill(['name' => 'Carla Lead'])->save();
    $lead->assignRole($role);

    return $lead->fresh() ?? $lead;
}

function m51Override(ApprovalRequest $request, string $reason = 'Server-Umzug heute Abend, niemand sonst im Team erreichbar.'): TestResponse
{
    return test()->post("/admin/team/approvals/{$request->id}/override", ['reason' => $reason]);
}

/**
 * The `approval` of one flag row on ADM-36 (by key: migrations seed flags of their own).
 *
 * @return array<string, mixed>|null
 */
function m51FlagApproval(string $key): ?array
{
    $flags = test()->get('/admin/config/flags')->assertOk()->viewData('page')['props']['flags'];

    return collect($flags)->firstWhere('key', $key)['approval'] ?? null;
}

function m51Announcement(Staff $author): ConfigVersion
{
    return adm35Draft($author, ConfigKey::Announcements, ['items' => [['title' => ['de' => 'Saisonstart', 'en' => null], 'body' => ['de' => 'Am Samstag geht es los.', 'en' => null], 'audience' => 'all']]]);
}

describe('the pending state names who can approve (no silent waiting)', function () {
    it('flashes the approvers and no override when a second eligible approver exists', function () {
        $owner = adm32SignedIn('owner');
        m51Alone();
        $second = staffWithRole('owner');
        $second->forceFill(['name' => 'Mara Second'])->save();

        adm35Publish($owner, ConfigKey::RemoteConfig, m35Remote());
        $draft = adm35Draft($owner, ConfigKey::RemoteConfig, m35Remote(['maintenance' => ['enabled' => true, 'message' => ['de' => 'Kurze Wartung.', 'en' => null]]]));

        $this->post('/admin/config/remote/publish', ['reason' => adm32Reason(), 'revision' => $draft->revision])
            ->assertStatus(303)
            ->assertSessionHas('approval', fn (array $flash) => $flash['approvers'] === ['Mara Second'] && $flash['approvers_total'] === 1 && $flash['override'] === false);

        $this->get('/admin/config/remote')->assertInertia(fn ($page) => $page
            ->where('editor.approval.approvers', ['Mara Second'])
            ->where('editor.approval.override', false));
        expect(ApprovalRequest::query()->where('action', 'maintenance.enable')->sole()->eligible_at_request)->toBe([$second->id]);
    });

    it('counts accepted staff without a second factor yet (SF-2), never deactivated, invited or atom-less staff', function () {
        $owner = adm32SignedIn('owner');
        m51Alone();
        staffWithRole('owner')->forceFill(['status' => StaffStatus::Deactivated])->save();
        staffWithRole('owner')->forceFill(['password_proof_required' => true])->save();
        staffWithRole('content_editor');
        staffWithRole('analyst');

        $alone = m51MaintenanceRequest($owner);
        expect(app(Approvals::class)->eligibleApprovers($alone))->toHaveCount(0)
            ->and($alone->eligible_at_request)->toBe([])
            ->and(app(OwnerOverride::class)->availableFor($alone, $owner))->toBeTrue();

        // An Owner who accepted the invitation and will enrol at the next sign-in can approve minutes later: the override closes.
        $enrolling = staffWithRole('owner', totp: false);
        expect(app(Approvals::class)->eligibleApprovers($alone)->modelKeys())->toBe([$enrolling->id])
            ->and(app(OwnerOverride::class)->availableFor($alone, $owner))->toBeFalse();
    });

    it('shows the waiting request of an own critical flag on ADM-36 with the override when nobody else can approve', function () {
        $flag = FeatureFlag::factory()->create(['key' => 'sig.m51_critical', 'enabled' => false, 'rules' => ['critical' => true]]);
        adm32SignedIn('owner');
        m51Alone();
        $this->withoutMiddleware(PreventRequestForgery::class);
        app()->detectEnvironment(fn () => 'production');

        try {
            $this->patch("/admin/config/flags/{$flag->id}", ['changes' => ['enabled' => true], 'reason' => adm32Reason()])
                ->assertSessionHas('approval', fn (array $flash) => $flash['approvers'] === [] && $flash['override'] === true);
            expect(m51FlagApproval('sig.m51_critical'))->toMatchArray(['mine' => true, 'approvers' => [], 'override' => true]);
        } finally {
            app()->detectEnvironment(fn () => 'testing');
        }

        expect($flag->refresh()->enabled)->toBeFalse();
    });

    it('computes the flash for the staff member who sees it, never for the original requester (SF-3)', function () {
        // Owner A asked first and is alone: A could override. B (flags.manage, no approvals.decide) asks the same change again and gets
        // A's pending request back: B's notice must not offer B an override the server refuses.
        seedStaffRoles();
        m51Alone();
        $a = staffWithRole('owner');
        $request = m51FlagRequest($a);
        expect(app(OwnerOverride::class)->availableFor($request, $a))->toBeTrue();

        $b = m35StaffWith('flags.manage', 'content.view');
        actingAsStaff($b)->withSession(['auth.password_confirmed_at' => time()]);
        $this->withoutMiddleware(PreventRequestForgery::class);
        app()->detectEnvironment(fn () => 'production');

        try {
            $this->patch("/admin/config/flags/{$request->subject_id}", ['changes' => ['enabled' => true], 'reason' => adm32Reason()])
                ->assertStatus(303)
                ->assertSessionHas('approval', fn (array $flash) => $flash['id'] === $request->id && $flash['existing'] === true && $flash['override'] === false);
        } finally {
            app()->detectEnvironment(fn () => 'testing');
        }
    });

    it('names the approvers only to the requester and to staff who decide approvals; everyone else sees the count (SEC-P5-06)', function () {
        seedStaffRoles();
        m51Alone();
        $a = staffWithRole('owner');
        m51Lead(['approvals.decide', 'flags.manage', 'content.view']);
        $key = (string) FeatureFlag::query()->findOrFail((int) m51FlagRequest($a)->subject_id)->getAttribute('key');

        actingAsStaff(m35StaffWith('flags.manage', 'content.view'));
        expect(m51FlagApproval($key))->toMatchArray(['approvers' => [], 'approvers_total' => 1, 'override' => false]);

        app('auth')->forgetGuards();
        actingAsStaff($a);
        expect(m51FlagApproval($key))->toMatchArray(['approvers' => ['Carla Lead'], 'approvers_total' => 1, 'mine' => true]);
    });
});

describe('Owner-Override (ADR-507)', function () {
    it('lets the only Owner execute their maintenance request with a reason: live at once (cache busted), one audit event, alerted through the queue', function () {
        $owner = adm32SignedIn('owner');
        m51Alone();
        // Invited, not through the invitation yet: no approver, but an active Owner who hears of it.
        $invited = staffWithRole('owner');
        $invited->forceFill(['password_proof_required' => true])->save();
        $request = m51MaintenanceRequest($owner);
        $before = m51AppConfig();
        expect($before['maintenance'])->toBeFalse();

        m51Override($request)->assertStatus(303)->assertSessionHas('success', 'approvals.flash.overridden');

        $request->refresh();
        $event = AuditEvent::query()->where('action', 'approval.owner_override')->sole();
        $after = m51AppConfig();

        expect($request->status)->toBe(ApprovalStatus::Executed)
            ->and($request->decided_by)->toBe($owner->id)
            ->and($request->decision_comment)->toBe('Server-Umzug heute Abend, niemand sonst im Team erreichbar.')
            ->and($request->result['owner_override'])->toBeTrue()
            ->and($event->reason)->toBe('Server-Umzug heute Abend, niemand sonst im Team erreichbar.')
            ->and($event->after['requested_by'])->toBe($owner->id)
            ->and($event->after['decided_by'])->toBe($owner->id)
            ->and($event->after['eligible_at_request'])->toBe(0)
            ->and($event->after['eligible_now'])->toBe(0)
            ->and($event->after['not_counted'])->toContain(['id' => $invited->id, 'why' => 'not_through_invitation'])
            // SEC-P5-04 / SF-1: never also an ordinary approval with requester = approver.
            ->and(AuditEvent::query()->where('action', 'approval.approved')->count())->toBe(0)
            ->and(AuditEvent::query()->where('action', 'config.published')->latest('id')->firstOrFail()->after['approved_by'])->toBe($owner->id)
            // The app-config cache and its ETag changed by the publish itself: nothing here flushed it.
            ->and($after['maintenance'])->toBeTrue()
            ->and($after['etag'])->not->toBe($before['etag']);

        // Every active Owner (the invited one too), the actor included; no Admin and no recent approver exist here.
        Mail::assertSent(OwnerOverrideMail::class, 2);
        Mail::assertSent(OwnerOverrideMail::class, fn (OwnerOverrideMail $mail) => $mail->hasTo($invited->email) && $mail->action === 'maintenance.enable');
        Mail::assertSent(OwnerOverrideMail::class, fn (OwnerOverrideMail $mail) => $mail->hasTo($owner->email));
        expect(StaffAlert::query()->where('kind', StaffAlertKind::OwnerOverride)->whereNotNull('sent_at')->count())->toBe(2)
            ->and(AuditEvent::query()->where('action', 'staff_alert.sent')->count())->toBe(2);
    });

    it('alerts Admins and everyone who approved in the last 90 days too, also when deactivated since (SEC-P5-01 c)', function () {
        $owner = adm32SignedIn('owner');
        m51Alone();
        $admin = staffWithRole('admin');
        $admin->forceFill(['password_proof_required' => true])->save();
        $formerApprover = staffWithRole('content_editor');
        ApprovalRequest::factory()->create(['requested_by' => $owner->id, 'decided_by' => $formerApprover->id, 'decided_at' => now()->subDays(30), 'status' => ApprovalStatus::Executed, 'pending_key' => null]);
        $formerApprover->forceFill(['status' => StaffStatus::Deactivated])->save();
        $request = m51MaintenanceRequest($owner);

        m51Override($request)->assertSessionHas('success', 'approvals.flash.overridden');

        Mail::assertSent(OwnerOverrideMail::class, fn (OwnerOverrideMail $mail) => $mail->hasTo($admin->email));
        Mail::assertSent(OwnerOverrideMail::class, fn (OwnerOverrideMail $mail) => $mail->hasTo($formerApprover->email));
    });

    it('queues each alert with retries, sends it once, and records a send that gave up (SF-5)', function () {
        Queue::fake();
        $owner = adm32SignedIn('owner');
        m51Alone();
        $request = m51MaintenanceRequest($owner);

        m51Override($request)->assertSessionHas('success', 'approvals.flash.overridden');

        Queue::assertPushed(DeliverStaffAlert::class, 1);
        $alert = StaffAlert::query()->sole();
        $job = new DeliverStaffAlert($alert->id);
        expect($job->tries)->toBeGreaterThan(1)->and($job->backoff())->not->toBeEmpty()->and($job->timeout)->toBeLessThanOrEqual(50);

        app()->call([$job, 'handle']);
        app()->call([$job, 'handle']);
        Mail::assertSent(OwnerOverrideMail::class, 1);
        expect($alert->refresh()->sent_at)->not->toBeNull();

        $lost = new StaffAlert;
        $lost->forceFill(['kind' => StaffAlertKind::OwnerOverride, 'dedupe_key' => 'test:lost', 'staff_id' => $owner->id, 'payload' => ['actor' => 'X']])->save();
        (new DeliverStaffAlert($lost->id))->failed(new RuntimeException('smtp down'));
        expect($lost->refresh()->failed_at)->not->toBeNull()
            ->and(AuditEvent::query()->where('action', 'staff_alert.failed')->sole()->after)->toMatchArray(['kind' => 'owner_override', 'error' => RuntimeException::class]);
    });

    it('executes a critical flag change in production through the override', function () {
        $flag = FeatureFlag::factory()->create(['key' => 'sig.m51_override', 'enabled' => false, 'rules' => ['critical' => true]]);
        adm32SignedIn('owner');
        m51Alone();
        $this->withoutMiddleware(PreventRequestForgery::class);
        app()->detectEnvironment(fn () => 'production');

        try {
            $this->patch("/admin/config/flags/{$flag->id}", ['changes' => ['enabled' => true], 'reason' => adm32Reason()]);
            $request = ApprovalRequest::query()->where('action', 'flags.critical_change')->sole();
            m51Override($request, 'Freischaltung für den Launch, kein zweiter Owner da.')->assertSessionHas('success', 'approvals.flash.overridden');
        } finally {
            app()->detectEnvironment(fn () => 'testing');
        }

        expect($flag->refresh()->enabled)->toBeTrue()
            ->and(AuditEvent::query()->where('action', 'flag.changed')->count())->toBe(1)
            ->and(AuditEvent::query()->where('action', 'approval.approved')->count())->toBe(0);
    });

    it('publishes a legal text with re-consent through the override (legal.publish_reconsent)', function () {
        $owner = adm32SignedIn('owner');
        m51Alone();
        $request = m51LegalRequest($owner);
        expect($request->action)->toBe('legal.publish_reconsent')->and($request->eligible_at_request)->toBe([]);

        m51Override($request, 'Die neue AGB muss vor dem Launch gelten, kein zweiter Owner da.')->assertSessionHas('success', 'approvals.flash.overridden');

        expect($request->refresh()->status)->toBe(ApprovalStatus::Executed)
            ->and(LegalDocument::query()->where('key', LegalDocumentKey::Terms)->where('version', '2')->sole()->published_at)->not->toBeNull()
            ->and(AuditEvent::query()->where('action', 'approval.owner_override')->sole()->after['action'])->toBe('legal.publish_reconsent');
        $this->getJson('/api/v1/app-config')->assertJsonPath('data.legal_versions.terms', '2')->assertJsonPath('data.legal_reconsent.terms', '2');
    });

    it('says inside the dialog why it is closed when a second eligible approver exists (four-eyes intact, SF-4)', function () {
        $owner = adm32SignedIn('owner');
        $request = m51MaintenanceRequest($owner);
        staffWithRole('admin');

        m51Override($request, 'Ich will nicht auf die zweite Person warten.')
            ->assertStatus(303)->assertSessionHasErrors(['override' => __('team.refused.override_approvers')]);

        expect($request->refresh()->status)->toBe(ApprovalStatus::Pending)
            ->and(m51MaintenanceStored())->toBeFalse()
            ->and(AuditEvent::query()->where('action', 'approval.owner_override')->count())->toBe(0);
        Mail::assertNothingSent();
    });

    it('takes an optional reason of at most 1000 characters (ADR-540)', function (?string $reason) {
        $owner = adm32SignedIn('owner');
        m51Alone();
        $request = m51MaintenanceRequest($owner);

        $this->post("/admin/team/approvals/{$request->id}/override", $reason === null ? [] : ['reason' => $reason])->assertSessionHasErrors('reason');
        expect($request->refresh()->status)->toBe(ApprovalStatus::Pending);
    })->with([str_repeat('x', 1001)]);

    it('is refused when the governance switch is off', function () {
        $owner = adm32SignedIn('owner');
        m51Alone();
        $this->patch('/admin/settings/governance', ['owner_override' => false, 'reason' => 'Wir arbeiten nur noch mit vier Augen.'])->assertSessionHas('success', 'settings.flash.governance_saved');
        $request = m51MaintenanceRequest($owner);

        expect(app(OwnerOverride::class)->enabled())->toBeFalse();
        m51Override($request, 'Bitte trotzdem jetzt ausführen.')->assertSessionHasErrors(['override' => __('team.refused.override_off')]);
        expect($request->refresh()->status)->toBe(ApprovalStatus::Pending);
    });

    it('never makes a critical flag non-critical (SEC-P5-02)', function () {
        $owner = adm32SignedIn('owner');
        m51Alone();
        $request = m51FlagRequest($owner, ['critical' => false]);
        $flag = FeatureFlag::query()->findOrFail((int) $request->subject_id);

        m51Override($request, 'Das Flag soll künftig ohne Freigabe schaltbar sein.')
            ->assertStatus(303)->assertSessionHasErrors(['override' => __('team.refused.override_lowers_protection')]);

        expect($request->refresh()->status)->toBe(ApprovalStatus::Pending)
            ->and($flag->refresh()->rules['critical'])->toBeTrue();
    });

    it('is only for the requester: another Owner cannot override it, and they could approve it instead', function () {
        $owner = adm32SignedIn('owner');
        $request = m51MaintenanceRequest($owner);
        $second = staffWithRole('owner');
        app('auth')->forgetGuards();
        actingAsStaff($second);

        m51Override($request, 'Ich übernehme das für die Kollegin.')->assertStatus(403);
        expect(app(Approvals::class)->mayDecide($request, $second))->toBeTrue();
    });

    it('is only for the requester even when the other Owner could not approve it either', function () {
        $owner = adm32SignedIn('owner');
        m51Alone();
        $request = m51MaintenanceRequest($owner);
        // Another Owner whose second factor was reset (new password pending): not an approver, still an active Owner.
        $other = staffWithRole('owner');
        $other->forceFill(['password_proof_required' => true])->save();

        expect(app(Approvals::class)->eligibleApprovers($request))->toHaveCount(0)
            ->and(fn () => app(OwnerOverride::class)->ensureAllowed($request, $other))
            ->toThrow(fn (AuthorizationException $e) => expect($e)->not->toBeInstanceOf(OwnerOverrideRefused::class));
    });

    it('never covers actions outside publishing', function () {
        $owner = adm32SignedIn('owner');
        m51Alone();
        $member = adm32Member();
        $request = app(Approvals::class)->request('members.delete', ['member_id' => $member->id], adm32Reason(), $owner, $member);

        m51Override($request, 'Niemand sonst da, bitte löschen.')->assertStatus(403);
        expect($request->refresh()->status)->toBe(ApprovalStatus::Pending);
    });

    it('answers an expired request with the expired flash and executes nothing', function () {
        $owner = adm32SignedIn('owner');
        m51Alone();
        $request = m51MaintenanceRequest($owner);
        $request->forceFill(['expires_at' => now()->subMinute()])->save();

        m51Override($request)->assertSessionHas('error', 'approvals.flash.expired');
        expect($request->refresh()->status)->toBe(ApprovalStatus::Expired)->and(m51MaintenanceStored())->toBeFalse();
    });

    it('asks for a recent password first (⚿)', function () {
        $owner = adm32SignedIn('owner');
        m51Alone();
        $request = m51MaintenanceRequest($owner);
        $this->withSession(['auth.password_confirmed_at' => time() - 3600]);

        m51Override($request)->assertSessionHas('confirm_password', true);
        expect($request->refresh()->status)->toBe(ApprovalStatus::Pending);
    });

    it('keeps the executors closed outside approve() and the override', function () {
        seedStaffRoles();
        $owner = staffWithRole('owner');

        expect(fn () => FourEyes::executor(['maintenance.enable'], $owner, $owner, 'maintenance.toggle'))->toThrow(AuthorizationException::class);
    });

    it('never lets an override execution reach an action outside publishing, even when it is marked as one (FourEyes)', function () {
        seedStaffRoles();
        $owner = staffWithRole('owner');
        $member = adm32Member();
        $request = app(Approvals::class)->request('members.delete', ['member_id' => $member->id], adm32Reason(), $owner, $member);
        $executing = new ReflectionProperty(Approvals::class, 'executing');
        $executing->setValue(null, new ApprovalExecution($request, $owner, ownerOverride: true));

        try {
            expect(fn () => FourEyes::executor(['members.delete'], $owner, $owner, 'members.delete'))->toThrow(AuthorizationException::class)
                ->and(fn () => FourEyes::handler($request, $owner, 'members.delete'))->toThrow(AuthorizationException::class);
        } finally {
            $executing->setValue(null, null);
        }
    });

    it('lets only Owners call it (authorisation matrix)', function (string $role, int $status) {
        $requester = adm32SignedIn('owner');
        m51Alone();
        $request = m51MaintenanceRequest($requester);
        app('auth')->forgetGuards();
        actingAsStaff(staffWithRole($role));
        $this->withSession(['auth.password_confirmed_at' => time()]);

        expect(m51Override($request)->status())->toBe($status);
        expect($request->refresh()->status)->toBe(ApprovalStatus::Pending);
    })->with([
        'admin' => ['admin', 403],
        'content editor' => ['content_editor', 403],
        'analyst' => ['analyst', 403],
        'moderator' => ['moderator', 403],
        'support' => ['support', 403],
    ]);

    it('sends a guest to the sign-in', function () {
        $owner = adm32SignedIn('owner');
        $request = m51MaintenanceRequest($owner);
        auth('staff')->logout();

        $response = m51Override($request);
        expect($response->status())->toBeIn([302, 303])->and((string) $response->headers->get('Location'))->toEndWith('/admin/login');
    });

    it('lists the override on ADM-43 for the requester, and afterwards as "Selbst freigegeben", not as an approval (SF-1)', function () {
        $owner = adm32SignedIn('owner');
        m51Alone();
        $request = m51MaintenanceRequest($owner);

        $this->get('/admin/team/approvals?tab=mine')->assertInertia(fn ($page) => $page
            ->where('requests.0.waiting.override', true)
            ->where('requests.0.waiting.approvers_total', 0)
            ->where('requests.0.owner_override', false));

        m51Override($request)->assertSessionHas('success', 'approvals.flash.overridden');

        $this->get('/admin/team/approvals?tab=mine')->assertInertia(fn ($page) => $page
            ->where('requests.0.status', 'executed')
            ->where('requests.0.owner_override', true));
    });
});

describe('the approver list cannot be emptied for an override (SEC-P5-01)', function () {
    $ask = function (string $kind, Staff $owner): ApprovalRequest {
        return match ($kind) {
            'flag' => m51FlagRequest($owner),
            'maintenance' => m51MaintenanceRequest($owner),
            'legal' => m51LegalRequest($owner),
        };
    };

    it('refuses an override of a request someone could approve when it was asked, also after the cool-down (snapshot)', function (string $kind, array $atoms, string $strip) use ($ask) {
        $owner = adm32SignedIn('owner');
        m51Alone();
        $lead = m51Lead($atoms);
        $request = $ask($kind, $owner);
        expect($request->eligible_at_request)->toBe([$lead->id]);

        // Strip: the only other approver's atom, applied at once by the Owner alone.
        $this->patch('/admin/team/permissions', ['matrix' => ['m51-lead' => array_values(array_diff($atoms, [$strip]))]])->assertStatus(303);
        expect(app(Approvals::class)->eligibleApprovers($request))->toHaveCount(0)
            ->and(ApproverChange::query()->sole()->cause)->toBe(ApproverChangeCause::AtomsRemoved);

        // Even once the cool-down has passed, the request asked while Carla could approve it stays four-eyes.
        ApproverChange::query()->update(['created_at' => now()->subHours(25)]);
        m51Override($request)->assertStatus(303)->assertSessionHasErrors(['override' => __('team.refused.override_snapshot')]);

        // Restore: the atom back, nothing executed, nobody mailed.
        // (Giving approvals.decide back is itself four-eyes, roles.sensitive_atoms: it waits, with its reason.)
        $this->patch('/admin/team/permissions', ['matrix' => ['m51-lead' => $atoms], 'reason' => 'Carla bekommt ihre Rechte zurück.'])->assertStatus(303);
        expect($request->refresh()->status)->toBe(ApprovalStatus::Pending)
            ->and(AuditEvent::query()->where('action', 'approval.owner_override')->count())->toBe(0);
        Mail::assertNotSent(OwnerOverrideMail::class);
    })->with([
        'flag: flags.manage' => ['flag', ['approvals.decide', 'content.view', 'flags.manage'], 'flags.manage'],
        'flag: approvals.decide' => ['flag', ['approvals.decide', 'content.view', 'flags.manage'], 'approvals.decide'],
        'maintenance: remote_config.manage' => ['maintenance', ['approvals.decide', 'content.view', 'maintenance.toggle', 'remote_config.manage'], 'remote_config.manage'],
        'legal: legal.publish' => ['legal', ['approvals.decide', 'content.view', 'legal.publish'], 'legal.publish'],
    ]);

    it('waits the cool-down after an approver lost an atom before a new request can be overridden (strip → ask → override)', function () {
        $owner = adm32SignedIn('owner');
        m51Alone();
        $atoms = ['approvals.decide', 'content.view', 'maintenance.toggle', 'remote_config.manage'];
        m51Lead($atoms);

        $this->patch('/admin/team/permissions', ['matrix' => ['m51-lead' => ['approvals.decide', 'content.view']]])->assertStatus(303);
        $request = m51MaintenanceRequest($owner);
        expect($request->eligible_at_request)->toBe([]);

        m51Override($request)->assertStatus(303)->assertSessionHasErrors('override');
        expect(session('errors')->first('override'))->toStartWith(Str::before(__('team.refused.override_cooldown'), ':until'))
            ->and($request->refresh()->status)->toBe(ApprovalStatus::Pending)
            ->and(m51MaintenanceStored())->toBeFalse();

        // After the cool-down the override opens: it was the cool-down that closed it.
        ApproverChange::query()->update(['created_at' => now()->subHours(25)]);
        m51Override($request)->assertSessionHas('success', 'approvals.flash.overridden');
    });

    it('starts the cool-down when an approver is deactivated, loses a role or has their second factor reset', function (string $change) {
        $owner = adm32SignedIn('owner');
        m51Alone();
        $lead = m51Lead(['approvals.decide', 'content.view', 'maintenance.toggle', 'remote_config.manage']);

        match ($change) {
            'deactivate' => $this->post("/admin/team/{$lead->id}/deactivate", ['reason' => 'Hat das Team verlassen, Zugang beenden.'])->assertStatus(303),
            'roles' => $this->patch("/admin/team/{$lead->id}/roles", ['roles' => []])->assertStatus(303),
            'two_factor' => (function () use ($owner, $lead): void {
                $second = staffWithRole('owner');
                $reset = app(Approvals::class)->request('staff.reset_two_factor', ['staff_id' => $lead->id], adm32Reason(), $owner, $lead);
                app(Approvals::class)->approve($reset, $second);
                $second->forceFill(['status' => StaffStatus::Deactivated])->save();
            })(),
        };

        expect(ApproverChange::query()->where('staff_id', $lead->id)->count())->toBe(1);
        $request = m51MaintenanceRequest($owner);
        expect(app(Approvals::class)->eligibleApprovers($request))->toHaveCount(0);
        m51Override($request)->assertSessionHasErrors('override');
        expect($request->refresh()->status)->toBe(ApprovalStatus::Pending);
    })->with(['deactivate', 'roles', 'two_factor']);

    it('records nothing when no approver lost anything (a grant, or atoms of someone without approvals.decide)', function () {
        adm32SignedIn('owner');
        m51Lead(['content.view', 'flags.manage']);

        $this->patch('/admin/team/permissions', ['matrix' => ['m51-lead' => ['content.view']]])->assertStatus(303);
        $this->patch('/admin/team/permissions', ['matrix' => ['m51-lead' => ['content.view', 'flags.manage']]])->assertStatus(303);

        expect(ApproverChange::query()->count())->toBe(0);
    });
});

describe('ADM-52 Governance', function () {
    it('shows the switch on by default and who can approve', function () {
        $owner = adm32SignedIn('owner');
        m51Alone();
        $owner->forceFill(['name' => 'Lena Owner'])->save();

        $this->get('/admin/settings')->assertInertia(fn ($page) => $page
            ->where('governance.owner_override', true)
            ->where('governance.approvers', [['id' => $owner->id, 'name' => 'Lena Owner', 'owner' => true]]));
    });

    it('is changed only by an Owner, as a versioned config key (ADR-540: without a reason; the other switches keep their value)', function () {
        adm32SignedIn('owner');
        $this->patch('/admin/settings/governance', ['owner_override' => false])->assertSessionHas('success');

        expect(ConfigVersion::query()->where('key', ConfigKey::Governance->value)->where('status', ConfigVersionStatus::Published)->sole()->payload)->toEqual(['owner_override' => false, 'four_eyes' => true, 'staff_two_factor' => 'required'])
            ->and(AuditEvent::query()->where('action', 'config.published')->latest('id')->firstOrFail()->reason)->toBeNull();
    });

    it('audits every change of the switch and mails every Owner and Admin (SEC-P5-03)', function () {
        $owner = adm32SignedIn('owner');
        m51Alone();
        $coOwner = staffWithRole('owner');
        $admin = staffWithRole('admin');
        staffWithRole('content_editor');

        $this->patch('/admin/settings/governance', ['owner_override' => false, 'reason' => 'Vier Augen ohne Ausnahme.'])->assertSessionHas('success');
        $this->patch('/admin/settings/governance', ['owner_override' => true, 'reason' => 'Wieder erlaubt, Team ist zu klein.'])->assertSessionHas('success');
        // The same value again: no switch and no alert (whatever the config engine answers to an unchanged payload).
        $this->patch('/admin/settings/governance', ['owner_override' => true, 'reason' => 'Nur die Begründung präzisiert.'])->assertStatus(303);

        $switches = AuditEvent::query()->where('action', 'approval.owner_override_switched')->orderBy('id')->get();
        expect($switches)->toHaveCount(2)
            ->and($switches[0]->before)->toBe(['owner_override' => true])
            ->and($switches[0]->after['owner_override'])->toBeFalse()
            ->and($switches[1]->after['owner_override'])->toBeTrue();

        foreach ([$owner, $coOwner, $admin] as $recipient) {
            Mail::assertSent(OwnerOverrideSwitchMail::class, fn (OwnerOverrideSwitchMail $mail) => $mail->hasTo($recipient->email) && $mail->enabled === false);
            Mail::assertSent(OwnerOverrideSwitchMail::class, fn (OwnerOverrideSwitchMail $mail) => $mail->hasTo($recipient->email) && $mail->enabled === true);
        }

        Mail::assertSent(OwnerOverrideSwitchMail::class, 6);
    });

    it('reads a published value that is not a boolean true as off, and no published value as the default on', function () {
        // A fresh install: no governance version (the directory's strict fixture removed).
        ConfigVersion::query()->where('key', ConfigKey::Governance->value)->delete();
        $owner = adm32SignedIn('owner');
        expect(app(OwnerOverride::class)->enabled())->toBeTrue();

        $this->patch('/admin/settings/governance', ['owner_override' => true, 'reason' => 'Erste Fassung der Governance.'])->assertSessionHas('success');
        expect(app(OwnerOverride::class)->enabled())->toBeTrue();

        foreach ([[], ['owner_override' => 'yes'], ['owner_override' => 1], 'kaputt'] as $malformed) {
            ConfigVersion::query()->where('key', ConfigKey::Governance->value)->where('status', ConfigVersionStatus::Published)->update(['payload' => json_encode($malformed)]);
            expect(app(OwnerOverride::class)->enabled())->toBeFalse();
        }

        // And the override says so.
        m51Alone();
        $request = m51MaintenanceRequest($owner);
        m51Override($request)->assertSessionHasErrors(['override' => __('team.refused.override_off')]);
    });

    it('refuses everyone else', function (string $role) {
        adm32SignedIn($role);

        $before = ConfigVersion::query()->where('key', ConfigKey::Governance->value)->count();

        expect($this->patch('/admin/settings/governance', ['owner_override' => false, 'reason' => 'Vier Augen ohne Ausnahme.'])->status())->toBe(403);
        expect(ConfigVersion::query()->where('key', ConfigKey::Governance->value)->count())->toBe($before);
    })->with(['admin', 'content_editor', 'analyst', 'moderator', 'support']);
});

describe('taking over another staff member\'s draft', function () {
    it('lets a second Owner take over and publish a draft the first one left behind; its author is told (SEC-P5-07)', function () {
        seedStaffRoles();
        $first = staffWithRole('owner');
        $draft = m51Announcement($first);
        $oldRevision = $draft->revision;
        $second = adm32SignedIn('owner');

        $this->get('/admin/content/announcements')->assertInertia(fn ($page) => $page->where('editor.draft.mine', false));
        $this->post('/admin/content/announcements/draft/take-over', ['reason' => 'Kollege im Urlaub, Ankündigung muss raus.', 'revision' => $draft->revision])
            ->assertSessionHas('success', 'config.flash.draft_taken_over');

        $draft->refresh();
        expect($draft->created_by)->toBe($second->id)
            ->and(AuditEvent::query()->where('action', 'config.draft_taken_over')->sole()->reason)->toBe('Kollege im Urlaub, Ankündigung muss raus.');
        Mail::assertSent(DraftTakenOverMail::class, 1);
        Mail::assertSent(DraftTakenOverMail::class, fn (DraftTakenOverMail $mail) => $mail->hasTo($first->email) && $mail->key === 'announcements' && $mail->reason === 'Kollege im Urlaub, Ankündigung muss raus.');
        expect(StaffAlert::query()->where('kind', StaffAlertKind::DraftTakenOver)->sole()->staff_id)->toBe($first->id);

        // The former author's open editor can no longer overwrite it.
        expect(fn () => app(ConfigVersions::class)->saveDraft($first, ConfigKey::Announcements, ['items' => []], $oldRevision))
            ->toThrow(fn (ConfigRefused $e) => expect($e->reason)->toBe('draft_taken'));

        $this->post('/admin/content/announcements/publish', ['reason' => adm32Reason(), 'revision' => $draft->revision])->assertSessionHas('success', 'config.flash.published');
        expect(ConfigVersion::query()->where('key', 'announcements')->where('status', ConfigVersionStatus::Published)->count())->toBe(1);
    });

    it('lets only holders of the edit and publish atoms take over (authorisation matrix)', function (string $role, int $status) {
        seedStaffRoles();
        $first = staffWithRole('content_editor');
        $draft = m51Announcement($first);
        adm32SignedIn($role);

        $response = $this->post('/admin/content/announcements/draft/take-over', ['reason' => 'Übernahme für die Saison.', 'revision' => $draft->revision]);

        expect($response->status())->toBe($status)
            ->and($draft->refresh()->created_by === $first->id)->toBe($status !== 303);
    })->with([
        'owner' => ['owner', 303],
        'admin' => ['admin', 303],
        'content editor (edit + publish)' => ['content_editor', 303],
        'moderator' => ['moderator', 403],
        'support' => ['support', 403],
        'analyst' => ['analyst', 403],
    ]);

    it('refuses a content editor on a key whose atoms they do not hold (remote config)', function () {
        seedStaffRoles();
        $first = staffWithRole('admin');
        $draft = adm35Draft($first, ConfigKey::RemoteConfig, m35Remote(['latest_version' => ['android' => '0.4.0']]));
        adm32SignedIn('content_editor');

        expect($this->post('/admin/config/remote/draft/take-over', ['reason' => 'Übernahme für die Saison.', 'revision' => $draft->revision])->status())->toBe(403);
        expect($draft->refresh()->created_by)->toBe($first->id);
    });

    it('sends a guest to the sign-in and asks for a recent password (⚿)', function () {
        seedStaffRoles();
        $draft = m51Announcement(staffWithRole('content_editor'));

        $guest = $this->post('/admin/content/announcements/draft/take-over', ['reason' => 'Übernahme für die Saison.', 'revision' => $draft->revision]);
        expect($guest->status())->toBeIn([302, 303])->and((string) $guest->headers->get('Location'))->toEndWith('/admin/login');

        adm32SignedIn('owner');
        $revision = $draft->revision;
        $this->withSession(['auth.password_confirmed_at' => time() - 3600]);
        $this->post('/admin/content/announcements/draft/take-over', ['reason' => 'Übernahme für die Saison.', 'revision' => $revision])->assertSessionHas('confirm_password', true);
        expect($draft->refresh()->revision)->toBe($revision);
        Mail::assertNotSent(DraftTakenOverMail::class);
    });

    it('refuses a stale revision, a reason over 1000 characters (ADR-540: none is needed) and roles without the publish atom', function () {
        seedStaffRoles();
        $first = staffWithRole('content_editor');
        $draft = adm35Draft($first, ConfigKey::Branding, m35Branding());

        adm32SignedIn('owner');
        $this->post('/admin/brand/draft/take-over', ['reason' => 'Übernahme für den Relaunch.', 'revision' => $draft->revision + 5])->assertSessionHasErrors('refused');
        $this->post('/admin/brand/draft/take-over', ['reason' => str_repeat('x', 1001), 'revision' => $draft->revision])->assertSessionHasErrors('reason'); // ADR-540: optional, at most 1000
        app('auth')->forgetGuards();
        adm32SignedIn('analyst');
        expect($this->post('/admin/brand/draft/take-over', ['reason' => 'Übernahme für den Relaunch.', 'revision' => $draft->revision])->status())->toBe(403);
        expect($draft->refresh()->created_by)->toBe($first->id);
    });

    it('does not take over a draft that waits for its approval', function () {
        seedStaffRoles();
        $first = staffWithRole('admin');
        adm35Publish($first, ConfigKey::RemoteConfig, m35Remote());
        $draft = adm35Draft($first, ConfigKey::RemoteConfig, m35Remote(['maintenance' => ['enabled' => true, 'message' => ['de' => 'Kurze Wartung.', 'en' => null]]]));
        app(Approvals::class)->request('maintenance.enable', ['key' => 'remote_config', 'mode' => 'publish', 'draft_id' => $draft->id, 'revision' => $draft->revision], adm32Reason(), $first, $draft);

        $owner = staffWithRole('owner');
        expect(fn () => app(ConfigVersions::class)->takeOverDraft($owner, ConfigKey::RemoteConfig, 'Übernahme der Wartung.', $draft->revision))
            ->toThrow(ConfigRefused::class, 'config.refused.draft_pending_approval');
    });
});

describe('ADM-36 environments and ADM-37 answers', function () {
    it('says that a change only to another environment\'s column changes nothing here', function () {
        $flag = FeatureFlag::factory()->create(['key' => 'sig.m51_elsewhere', 'enabled' => false, 'rules' => []]);
        adm32SignedIn('owner');

        $this->patch("/admin/config/flags/{$flag->id}", ['changes' => ['environments' => ['local' => false, 'staging' => false, 'production' => true]], 'reason' => adm32Reason()])
            ->assertSessionHas('success', 'config.flash.flag_planned');
        expect($flag->refresh()->enabled)->toBeFalse();

        $this->patch("/admin/config/flags/{$flag->id}", ['changes' => ['environments' => ['local' => true, 'staging' => false, 'production' => true]], 'reason' => adm32Reason()])
            ->assertSessionHas('success', 'config.flash.flag_changed');
        expect($flag->refresh()->enabled)->toBeTrue();
    });

    it('flushes app-config on publish, so the next request carries the change and a new ETag', function () {
        $owner = adm32SignedIn('owner');
        adm35Publish($owner, ConfigKey::RemoteConfig, m35Remote());
        $before = $this->getJson('/api/v1/app-config')->headers->get('ETag');
        $draft = adm35Draft($owner, ConfigKey::RemoteConfig, m35Remote(['latest_version' => ['android' => '0.3.0']]));

        $this->post('/admin/config/remote/publish', ['reason' => adm32Reason(), 'revision' => $draft->revision])->assertSessionHas('success', 'config.flash.published');

        $after = $this->getJson('/api/v1/app-config');
        expect($after->headers->get('ETag'))->not->toBe($before)
            ->and($after->json('data.latest_version.android'))->toBe('0.3.0');
    });

    it('sends a write with a stale form token back to its page with a message instead of the error page', function () {
        adm32SignedIn('owner');
        app()->detectEnvironment(fn () => 'staging');

        try {
            $response = $this->withHeaders(['X-Inertia' => 'true', 'X-Requested-With' => 'XMLHttpRequest', 'Referer' => url('/admin/config/remote')])
                ->post('/admin/config/remote/draft', ['payload' => m35Remote(), 'revision' => null, '_token' => 'stale']);
        } finally {
            app()->detectEnvironment(fn () => 'testing');
        }

        $response->assertStatus(303)->assertSessionHas('error', 'errors.419_write');
        expect(ConfigVersion::query()->where('key', 'remote_config')->count())->toBe(0);
    });
});
