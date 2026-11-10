<?php

use App\Actions\Admin\Moderation\DecideAppeal;
use App\Actions\Admin\Moderation\DecideCaseAsStaff;
use App\Actions\Moderation\FileAppeal;
use App\Enums\AppealStatus;
use App\Enums\DecisionAction;
use App\Enums\DecisionViewer;
use App\Models\Appeal;
use App\Models\ApprovalRequest;
use App\Models\Decision;
use App\Models\Staff;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\Queue;

require_once __DIR__.'/Helpers.php';

/**
 * SF-4 and SF-5 of the M3.4-batch review (DecideAppeal, Art. 20(6) DSA): the staff member who approved a suspension cannot decide the
 * appeal against it, and an appeal on a message decision needs moderation.messages.
 */
beforeEach(fn () => Queue::fake());

function m3qDecide(DecideAppeal $decide, Staff $staff, Appeal $appeal): Appeal
{
    return $decide->handle($staff, $appeal, AppealStatus::Upheld, 'Die Entscheidung bleibt bestehen, die Belege sind eindeutig.', m32Reason());
}

describe('SF-4: the second pair of eyes of a suspension', function () {
    beforeEach(function () {
        $this->requester = m31Staff('moderator');
        $this->approver = m31Staff('admin');
        $case = adm34VehicleCase();
        $request = app(DecideCaseAsStaff::class)->handle($this->requester, $case, DecisionAction::Suspend, null, now()->addDays(10)->toImmutable(), m32Statement(), m32Reason());
        expect($request)->toBeInstanceOf(ApprovalRequest::class);
        m32Approve($request, $this->approver);
        $this->decision = Decision::query()->where('case_id', $case->id)->sole();
        $member = User::query()->findOrFail($this->decision->subject_id);
        $this->appeal = app(FileAppeal::class)->handle($member, $this->decision, DecisionViewer::Affected, 'Ich habe niemanden beleidigt, bitte prüft das noch einmal.');
    });

    it('refuses the approver of the suspension, like its decider', function (string $who) {
        expect($this->decision->action)->toBe(DecisionAction::Suspend);

        expect(fn () => m3qDecide(app(DecideAppeal::class), $this->{$who}, $this->appeal))->toThrow(AuthorizationException::class, 'appeal_same_staff');
        expect($this->appeal->refresh()->status)->toBe(AppealStatus::Open);
    })->with(['decider' => 'requester', 'approver' => 'approver']);

    it('lets a third staff member decide it', function () {
        $decided = m3qDecide(app(DecideAppeal::class), m31Staff('owner'), $this->appeal);

        expect($decided->status)->toBe(AppealStatus::Upheld);
    });

    it('also finds the approver of an operator-command suspension in the audit chain', function () {
        $operator = m31Staff('moderator', attributes: ['email' => 'op.m3q@speedclub.test']);
        $second = m31Staff('admin', attributes: ['email' => 'second.m3q@speedclub.test']);
        $case = adm34VehicleCase();

        $this->artisan('speedclub:moderation:decide', [
            'case' => $case->id, '--action' => 'suspend', '--facts' => 'Wiederholt beleidigende Nachrichten an andere Mitglieder.',
            '--ground' => 'Community-Richtlinien §2 (Respekt)', '--operator' => 'op.m3q@speedclub.test', '--approved-by' => 'second.m3q@speedclub.test',
            '--until' => now()->addDays(10)->toIso8601String(), '--reason' => m32Reason(),
        ])->assertExitCode(0);

        $decision = Decision::query()->where('case_id', $case->id)->sole();
        $appeal = app(FileAppeal::class)->handle(User::query()->findOrFail($decision->subject_id), $decision, DecisionViewer::Affected, 'Das war ein Missverständnis, bitte prüft das.');

        expect(fn () => m3qDecide(app(DecideAppeal::class), $second, $appeal))->toThrow(AuthorizationException::class, 'appeal_same_staff')
            ->and(m3qDecide(app(DecideAppeal::class), m31Staff('owner'), $appeal)->status)->toBe(AppealStatus::Upheld)
            ->and($operator->id)->not->toBe($second->id);
    });

    it('does not count an approver of another suspension', function () {
        $other = adm34VehicleCase();
        $request = app(DecideCaseAsStaff::class)->handle(m31Staff('moderator'), $other, DecisionAction::Suspend, null, now()->addDays(5)->toImmutable(), m32Statement(), m32Reason());
        $thirdApprover = m31Staff('admin');
        m32Approve($request, $thirdApprover);

        expect(m3qDecide(app(DecideAppeal::class), $thirdApprover, $this->appeal)->status)->toBe(AppealStatus::Upheld);
    });
});

describe('SF-5: appeals on message decisions', function () {
    beforeEach(function () {
        [$case, $sender] = adm34MessageCase();
        $this->decider = m31Staff('moderator');
        $this->decision = app(DecideCaseAsStaff::class)->handle($this->decider, $case, DecisionAction::RemoveContent, null, null, m32Statement(), m32Reason());
        $this->appeal = app(FileAppeal::class)->handle($sender, $this->decision, DecisionViewer::Affected, 'Das war ironisch gemeint, wir kennen uns gut.');
    });

    it('needs moderation.messages besides moderation.appeals', function () {
        $appealsOnly = m3qStaffWith('moderation.view', 'moderation.appeals');

        expect(fn () => m3qDecide(app(DecideAppeal::class), $appealsOnly, $this->appeal))->toThrow(AuthorizationException::class)
            ->and($this->appeal->refresh()->status)->toBe(AppealStatus::Open);
    });

    it('lets a staff member with both atoms decide it', function () {
        $both = m3qStaffWith('moderation.view', 'moderation.appeals', 'moderation.messages');

        expect(m3qDecide(app(DecideAppeal::class), $both, $this->appeal)->status)->toBe(AppealStatus::Upheld);
    });

    it('keeps moderation.appeals enough for a vehicle decision', function () {
        $case = adm34VehicleCase();
        $decision = app(DecideCaseAsStaff::class)->handle($this->decider, $case, DecisionAction::RemoveContent, null, null, m32Statement(), m32Reason());
        $appeal = app(FileAppeal::class)->handle(User::query()->findOrFail($decision->subject_id), $decision, DecisionViewer::Affected, 'Die Fotos sind von mir, ich habe die Originale.');

        expect(m3qDecide(app(DecideAppeal::class), m3qStaffWith('moderation.view', 'moderation.appeals'), $appeal)->status)->toBe(AppealStatus::Upheld);
    });
});
