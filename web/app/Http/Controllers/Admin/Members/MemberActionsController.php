<?php

namespace App\Http\Controllers\Admin\Members;

use App\Actions\Admin\Members\ChangeMemberEmail;
use App\Actions\Admin\Members\EditMemberProfile;
use App\Actions\Admin\Members\ForcePasswordChange;
use App\Actions\Admin\Members\LiftRestriction;
use App\Actions\Admin\Members\RequestMemberDeletion;
use App\Actions\Admin\Members\RequestMemberExport;
use App\Actions\Admin\Members\RequestMemberSuspension;
use App\Actions\Admin\Members\RequestTwoFactorReset;
use App\Actions\Admin\Members\RestrictMember;
use App\Actions\Admin\Members\RevokeMemberSessions;
use App\Actions\Admin\Members\SendMemberResetLink;
use App\Enums\DecisionRestriction;
use App\Enums\RestrictionType;
use App\Http\Controllers\Admin\Members\Requests\ChangeMemberEmailRequest;
use App\Http\Controllers\Admin\Members\Requests\DeleteMemberRequest;
use App\Http\Controllers\Admin\Members\Requests\EditMemberRequest;
use App\Http\Controllers\Admin\Members\Requests\ExportMemberRequest;
use App\Http\Controllers\Admin\Members\Requests\ForcePasswordChangeRequest;
use App\Http\Controllers\Admin\Members\Requests\LiftRestrictionRequest;
use App\Http\Controllers\Admin\Members\Requests\ResetTwoFactorRequest;
use App\Http\Controllers\Admin\Members\Requests\RestrictMemberRequest;
use App\Http\Controllers\Admin\Members\Requests\RevokeSessionsRequest;
use App\Http\Controllers\Admin\Members\Requests\SendResetLinkRequest;
use App\Http\Controllers\Admin\Members\Requests\SuspendMemberRequest;
use App\Http\Controllers\Admin\Support\ApprovalsGateway;
use App\Http\Controllers\Admin\Support\RecordLookup;
use App\Http\Controllers\Controller;
use App\Models\ApprovalRequest;
use App\Services\Moderation\Statement;
use Carbon\CarbonImmutable;
use Closure;
use DomainException;
use Illuminate\Http\RedirectResponse;
use InvalidArgumentException;

/**
 * ADM-10 row actions (m3.2-contract §2). Each method: FormRequest (atom, reason, rules) → the Action → back with a flash key. Four-eyes
 * actions (suspend, 2FA reset, export, delete) only ask for an approval through their Request… Action and answer with the flash
 * `approval`; their executors run in the approval handlers, never here. Recent password sits on the routes (ADR-215).
 */
class MemberActionsController extends Controller
{
    public function update(EditMemberRequest $request, string $member, EditMemberProfile $edit): RedirectResponse
    {
        /** @var array{display_name?: string|null, bio?: string|null, city?: string|null, username?: string} $changes */
        $changes = $request->safe()->only(['display_name', 'bio', 'city', 'username']);

        return $this->run(fn () => $edit->handle($request->staff(), RecordLookup::member($member), $changes, $request->reason()), 'members.flash.edited');
    }

    public function restrict(RestrictMemberRequest $request, string $member, RestrictMember $restrict): RedirectResponse
    {
        return $this->run(fn () => $restrict->handle(
            $request->staff(),
            RecordLookup::member($member),
            RestrictionType::from($request->string('type')->value()),
            self::until($request->input('until')),
            Statement::fromArray($request->validated()),
            $request->reason(),
        ), 'members.flash.restricted');
    }

    public function suspend(SuspendMemberRequest $request, string $member, RequestMemberSuspension $suspend): RedirectResponse
    {
        $user = RecordLookup::member($member);

        return $this->approval(fn () => $suspend->handle($request->staff(), $user, self::until($request->input('until')), Statement::fromArray($request->validated()), $request->reason()));
    }

    public function lift(LiftRestrictionRequest $request, string $member, LiftRestriction $lift): RedirectResponse
    {
        return $this->run(fn () => $lift->handle(
            $request->staff(),
            RecordLookup::member($member),
            DecisionRestriction::from($request->string('type')->value()),
            trim($request->string('facts')->value()),
            $request->reason(),
        ), 'members.flash.lifted');
    }

    public function resetLink(SendResetLinkRequest $request, string $member, SendMemberResetLink $send): RedirectResponse
    {
        return $this->run(fn () => $send->handle($request->staff(), RecordLookup::member($member), $request->reason()), 'members.flash.reset_link_sent');
    }

    public function forcePasswordChange(ForcePasswordChangeRequest $request, string $member, ForcePasswordChange $force): RedirectResponse
    {
        return $this->run(fn () => $force->handle($request->staff(), RecordLookup::member($member), $request->reason()), 'members.flash.password_change_forced');
    }

    public function revokeSessions(RevokeSessionsRequest $request, string $member, RevokeMemberSessions $revoke): RedirectResponse
    {
        return $this->run(fn () => $revoke->handle($request->staff(), RecordLookup::member($member), $request->reason()), 'members.flash.sessions_revoked');
    }

    public function resetTwoFactor(ResetTwoFactorRequest $request, string $member, RequestTwoFactorReset $reset): RedirectResponse
    {
        $user = RecordLookup::member($member);

        return $this->approval(fn () => $reset->handle($request->staff(), $user, $request->reason()));
    }

    public function changeEmail(ChangeMemberEmailRequest $request, string $member, ChangeMemberEmail $change): RedirectResponse
    {
        return $this->run(fn () => $change->handle(
            $request->staff(),
            RecordLookup::member($member),
            $request->string('email')->value(),
            $request->boolean('identity_verified'),
            $request->reason(),
        ), 'members.flash.email_changed');
    }

    public function export(ExportMemberRequest $request, string $member, RequestMemberExport $export): RedirectResponse
    {
        $user = RecordLookup::member($member);

        return $this->approval(fn () => $export->handle($request->staff(), $user, $request->reason()));
    }

    public function destroy(DeleteMemberRequest $request, string $member, RequestMemberDeletion $delete): RedirectResponse
    {
        $user = RecordLookup::member($member);

        return $this->approval(fn () => $delete->handle($request->staff(), $user, $request->reason()));
    }

    /**
     * @param  Closure(): mixed  $action
     */
    private function run(Closure $action, string $flash): RedirectResponse
    {
        try {
            $action();
        } catch (DomainException|InvalidArgumentException) {
            return back(303)->with('error', 'members.flash.not_possible');
        }

        return back(303)->with('success', $flash);
    }

    /**
     * @param  Closure(): ApprovalRequest  $request
     */
    private function approval(Closure $request): RedirectResponse
    {
        try {
            $approval = $request();
        } catch (DomainException|InvalidArgumentException) {
            return back(303)->with('error', 'members.flash.not_possible');
        }

        return back(303)->with('approval', ApprovalsGateway::flash($approval));
    }

    private static function until(mixed $value): ?CarbonImmutable
    {
        return is_string($value) && $value !== '' ? CarbonImmutable::parse($value) : null;
    }
}
