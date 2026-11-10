<?php

use App\Actions\Admin\Members\LiftRestriction;
use App\Actions\Admin\Members\RequestMemberSuspension;
use App\Actions\Admin\Members\RestrictMember;
use App\Actions\Moderation\ReverseDecision;
use App\Enums\ApprovalStatus;
use App\Enums\CaseOrigin;
use App\Enums\CaseStatus;
use App\Enums\DecisionAction;
use App\Enums\DecisionRestriction;
use App\Enums\NotificationType;
use App\Enums\ReportTargetType;
use App\Enums\RestrictionType;
use App\Enums\UserStatus;
use App\Mail\DecisionReversedMail;
use App\Mail\ModerationDecisionMail;
use App\Models\ApprovalRequest;
use App\Models\AuditEvent;
use App\Models\Decision;
use App\Models\ModerationCase;
use App\Models\Notification;
use App\Models\User;
use App\Services\Approvals\Approvals;
use Carbon\CarbonImmutable;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/Helpers.php';

/**
 * M3.2 §1: every staff restriction, suspension and their reversal is a DSA decision through DecideCase, on an own-initiative case when
 * nobody reported the member; lifting is a `reverse` decision the member is told about; a staff suspension is four-eyes and a moderator
 * suspends for at most 30 days.
 */
beforeEach(function () {
    $this->withoutDefer();
    Mail::fake();
    $this->member = User::factory()->create(['username' => 'tobi.quattro', 'locale' => 'de']);
});

function m32Restrict(User $member, ?string $role = 'moderator', ?CarbonImmutable $until = null): Decision
{
    return app(RestrictMember::class)->handle(m31Staff($role), $member, RestrictionType::Messaging, $until, m32Statement(), m32Reason());
}

describe('Einschränken', function () {
    it('decides an own-initiative case: no report, the member restricted and told with the statement of reasons', function () {
        $decision = m32Restrict($this->member, until: CarbonImmutable::now()->addDays(7));
        $case = ModerationCase::query()->findOrFail($decision->case_id);

        expect($case->origin)->toBe(CaseOrigin::Staff)
            ->and($case->status)->toBe(CaseStatus::Decided)
            ->and($case->report_count)->toBe(0)
            ->and($case->target_type)->toBe(ReportTargetType::Member)
            ->and($case->target_label)->toBe('@tobi.quattro')
            ->and($decision->action)->toBe(DecisionAction::Restrict)
            ->and($this->member->refresh()->isRestrictedFrom(RestrictionType::Messaging))->toBeTrue()
            ->and($this->member->restrictions['messaging']['decision_id'])->toBe($decision->id)
            ->and(Notification::query()->where('type', NotificationType::ModerationDecision)->where('notifiable_id', $this->member->id)->exists())->toBeTrue();

        Mail::assertSent(ModerationDecisionMail::class, function (ModerationDecisionMail $mail): bool {
            $html = $mail->render();

            // Nobody reported it: the mail must not say so.
            return $mail->ownInitiative && str_contains($html, 'ohne Meldung') && ! str_contains($html, 'Der Inhalt wurde uns gemeldet');
        });

        $event = AuditEvent::query()->where('action', 'moderation.decided')->sole();
        expect($event->getAttribute('actor_type')->value)->toBe('staff')
            ->and($event->getAttribute('reason'))->toBe(m32Reason())
            ->and($event->after['origin'])->toBe('staff');
    });

    it('answers an open report about the member with the same decision instead of opening a second case', function () {
        $reporter = User::factory()->create();
        $case = modCaseOf(modReport($reporter, ReportTargetType::Member, 'tobi.quattro'));

        $decision = m32Restrict($this->member);

        expect($decision->case_id)->toBe($case->id)
            ->and(ModerationCase::query()->count())->toBe(1)
            ->and(Notification::query()->where('type', NotificationType::ReportDecided)->where('notifiable_id', $reporter->id)->exists())->toBeTrue();
    });

    it('shows the member the decision on SAFE-01 with origin staff and the full statement', function () {
        $decision = m32Restrict($this->member);
        Sanctum::actingAs($this->member, ['member']);

        $this->getJson("/api/v1/decisions/{$decision->id}")->assertOk()
            ->assertJsonPath('data.viewer', 'affected')
            ->assertJsonPath('data.origin', 'staff')
            ->assertJsonPath('data.target.label', '@tobi.quattro')
            ->assertJsonPath('data.statement.facts', m32Statement()->facts)
            ->assertJsonPath('data.can_appeal', true);
    });

    it('refuses a staff member without members.restrict, whoever calls it', function (string $role, bool $allowed) {
        $run = fn () => m32Restrict($this->member, $role);

        $allowed ? expect($run())->toBeInstanceOf(Decision::class) : expect($run)->toThrow(AuthorizationException::class);
        expect(Decision::query()->count())->toBe($allowed ? 1 : 0);
    })->with(m32Matrix('members.restrict'));

    it('refuses a suspended staff member', function () {
        $staff = m31Staff('admin');
        $staff->forceFill(['status' => 'suspended'])->save();

        expect(fn () => app(RestrictMember::class)->handle($staff, $this->member, RestrictionType::Messaging, null, m32Statement(), m32Reason()))
            ->toThrow(AuthorizationException::class);
    });
});

describe('Aufheben (reverse)', function () {
    it('lifts the restriction with a reverse decision that names the decision it lifts, told in the app and by mail', function () {
        $restriction = m32Restrict($this->member);
        Mail::fake();

        $reverse = app(LiftRestriction::class)->handle(m31Staff('moderator'), $this->member->refresh(), DecisionRestriction::Messaging, 'Die Beschwerden haben sich als unbegründet erwiesen.', m32Reason());

        expect($reverse->action)->toBe(DecisionAction::Reverse)
            ->and($reverse->reverses_decision_id)->toBe($restriction->id)
            ->and($reverse->redress())->toBe([])
            ->and($this->member->refresh()->isRestrictedFrom(RestrictionType::Messaging))->toBeFalse()
            ->and($this->member->restrictions)->toBeNull()
            ->and(ModerationCase::query()->findOrFail($reverse->case_id)->open_target)->toBeNull()
            ->and(Notification::query()->where('type', NotificationType::ModerationDecision)->where('notifiable_id', $this->member->id)->count())->toBe(2);

        Mail::assertSent(DecisionReversedMail::class, fn (DecisionReversedMail $mail): bool => str_contains($mail->render(), 'Du kannst wieder Nachrichten schreiben.'));
        Mail::assertNotSent(ModerationDecisionMail::class);
        expect(AuditEvent::query()->where('action', 'moderation.decided')->latest('id')->first()?->after['reverses_decision_id'])->toBe($restriction->id);
    });

    it('shows the reversal on SAFE-01 without an appeal, and refuses an appeal against it', function () {
        m32Restrict($this->member);
        $reverse = app(LiftRestriction::class)->handle(m31Staff('admin'), $this->member->refresh(), DecisionRestriction::Messaging, 'Die Beschwerden haben sich als unbegründet erwiesen.', m32Reason());
        Sanctum::actingAs($this->member, ['member']);

        $this->getJson("/api/v1/decisions/{$reverse->id}")->assertOk()
            ->assertJsonPath('data.action', 'reverse')
            ->assertJsonPath('data.outcome', 'reversed')
            ->assertJsonPath('data.scope', null)
            ->assertJsonPath('data.redress', [])
            ->assertJsonPath('data.appeal_until', null)
            ->assertJsonPath('data.can_appeal', false)
            ->assertJsonPath('data.reverses_decision_id', $reverse->reverses_decision_id);

        $this->postJson("/api/v1/decisions/{$reverse->id}/appeal", ['text' => 'Ich möchte widersprechen, bitte prüft das erneut.'], ['Idempotency-Key' => (string) Str::uuid()])
            ->assertStatus(422)
            ->assertJsonPath('code', 'decision_not_appealable');
    });

    it('reverses a decision only once', function () {
        $restriction = m32Restrict($this->member);
        $staff = m31Staff('admin');
        app(ReverseDecision::class)->handle($restriction, $staff, 'Unbegründet, wir heben das auf.', m32Reason());

        expect(fn () => app(ReverseDecision::class)->handle($restriction, $staff, 'Noch einmal aufheben.', m32Reason()))
            ->toThrow(DomainException::class)
            ->and(Decision::query()->where('action', DecisionAction::Reverse)->count())->toBe(1)
            ->and(ModerationCase::query()->count())->toBe(2);
    });

    it('keeps a later decision that outlasts the reversed one', function () {
        $first = m32Restrict($this->member, until: CarbonImmutable::now()->addDays(3));
        $second = m32Restrict($this->member->refresh(), until: CarbonImmutable::now()->addDays(30));

        app(ReverseDecision::class)->handle($first, m31Staff('admin'), 'Die erste Maßnahme war unbegründet.', m32Reason());

        expect($this->member->refresh()->isRestrictedFrom(RestrictionType::Messaging))->toBeTrue()
            ->and($this->member->restrictions['messaging']['decision_id'])->toBe($second->id);
    });

    it('refuses to lift what the account does not hold, and a staff member without the atom', function () {
        expect(fn () => app(LiftRestriction::class)->handle(m31Staff('admin'), $this->member, DecisionRestriction::Publishing, 'Nichts da.', m32Reason()))
            ->toThrow(DomainException::class);

        m32Restrict($this->member);

        expect(fn () => app(LiftRestriction::class)->handle(m31Staff('support'), $this->member->refresh(), DecisionRestriction::Messaging, 'Aufheben bitte.', m32Reason()))
            ->toThrow(AuthorizationException::class);
    });
});

describe('Sperren (four-eyes)', function () {
    it('never suspends from the request: an approval is created, nothing changes', function () {
        $request = app(RequestMemberSuspension::class)->handle(m31Staff('moderator'), $this->member, CarbonImmutable::now()->addDays(14), m32Statement(), m32Reason());

        expect($request)->toBeInstanceOf(ApprovalRequest::class)
            ->and($request->status)->toBe(ApprovalStatus::Pending)
            ->and($request->action)->toBe('moderation.suspend')
            ->and($request->subject_id)->toBe($this->member->id)
            ->and($request->summary['subject_label'])->toBe('@tobi.quattro')
            ->and($this->member->refresh()->status)->toBe(UserStatus::Active)
            ->and(Decision::query()->count())->toBe(0)
            ->and(ModerationCase::query()->count())->toBe(0);
    });

    it('suspends on approval by a second staff member, on an own-initiative case, naming both', function () {
        $moderator = m31Staff('moderator');
        $approver = m31Staff('admin');
        $request = app(RequestMemberSuspension::class)->handle($moderator, $this->member, CarbonImmutable::now()->addDays(14), m32Statement(), m32Reason());

        $done = m32Approve($request, $approver);
        $decision = Decision::query()->sole();

        expect($done->status)->toBe(ApprovalStatus::Executed)
            ->and($this->member->refresh()->status)->toBe(UserStatus::Suspended)
            ->and($decision->action)->toBe(DecisionAction::Suspend)
            ->and($decision->decided_by)->toBe($moderator->id)
            ->and(ModerationCase::query()->findOrFail($decision->case_id)->origin)->toBe(CaseOrigin::Staff);

        $event = AuditEvent::query()->where('action', 'moderation.decided')->sole();
        expect($event->getAttribute('actor_id'))->toBe((string) $moderator->id)
            ->and($event->after['approved_by'])->toBe($approver->id);
    });

    it('lets nobody approve their own request', function () {
        $admin = m31Staff('admin');
        $request = app(RequestMemberSuspension::class)->handle($admin, $this->member, null, m32Statement(), m32Reason());

        expect(fn () => m32Approve($request, $admin))->toThrow(AuthorizationException::class)
            ->and($this->member->refresh()->status)->toBe(UserStatus::Active);
    });

    it('limits a moderator to 30 days, at the request and again at execution; Owner and Admin have no limit', function () {
        $moderator = m31Staff('moderator');

        expect(fn () => app(RequestMemberSuspension::class)->handle($moderator, $this->member, null, m32Statement(), m32Reason()))->toThrow(ValidationException::class)
            ->and(fn () => app(RequestMemberSuspension::class)->handle($moderator, $this->member, CarbonImmutable::now()->addDays(32), m32Statement(), m32Reason()))->toThrow(ValidationException::class);

        $ok = app(RequestMemberSuspension::class)->handle($moderator, $this->member, CarbonImmutable::now()->addDays(30), m32Statement(), m32Reason());
        expect($ok->status)->toBe(ApprovalStatus::Pending);
        $ok->forceFill(['status' => ApprovalStatus::Cancelled, 'pending_key' => null])->save();

        // A payload that got past the request (written by another caller) still fails at execution, changing nothing.
        $sneaked = app(Approvals::class)->request('moderation.suspend', ['member_id' => $this->member->id, ...m32Statement()->toArray(), 'until' => null], m32Reason(), $moderator, $this->member);
        expect(m32Approve($sneaked)->status)->toBe(ApprovalStatus::Failed)
            ->and($this->member->refresh()->status)->toBe(UserStatus::Active);

        $admin = app(RequestMemberSuspension::class)->handle(m31Staff('admin'), $this->member, null, m32Statement(), m32Reason());
        expect(m32Approve($admin)->status)->toBe(ApprovalStatus::Executed)
            ->and($this->member->refresh()->status)->toBe(UserStatus::Suspended);
    });

    it('refuses a staff member without members.suspend at the request', function (string $role, bool $allowed) {
        $run = fn () => app(RequestMemberSuspension::class)->handle(m31Staff($role), $this->member, CarbonImmutable::now()->addDays(7), m32Statement(), m32Reason());

        $allowed ? expect($run())->toBeInstanceOf(ApprovalRequest::class) : expect($run)->toThrow(AuthorizationException::class);
    })->with(m32Matrix('members.suspend'));

    it('lifts a suspension with a reverse decision: active again', function () {
        $request = app(RequestMemberSuspension::class)->handle(m31Staff('admin'), $this->member, null, m32Statement(), m32Reason());
        m32Approve($request);

        app(LiftRestriction::class)->handle(m31Staff('moderator'), $this->member->refresh(), DecisionRestriction::Suspension, 'Die Sperre war ein Versehen.', m32Reason());

        expect($this->member->refresh()->status)->toBe(UserStatus::Active)
            ->and($this->member->isSuspended())->toBeFalse();
        Mail::assertSent(DecisionReversedMail::class, fn (DecisionReversedMail $mail): bool => str_contains($mail->render(), 'nicht mehr gesperrt'));
    });
});
