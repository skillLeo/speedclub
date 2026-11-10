<?php

namespace App\Actions\Admin\Privacy;

use App\Actions\Admin\Members\RequestMemberDeletion;
use App\Enums\PrivacyEvent;
use App\Enums\PrivacyRequestStatus;
use App\Enums\PrivacyRequestType;
use App\Models\ApprovalRequest;
use App\Models\PrivacyRequest;
use App\Models\Staff;
use App\Models\User;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Team\TeamRefused;
use DomainException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ADM-46 for a Löschung of a member (`privacy.process` and `members.delete`; m3.6 §1 "Löschung reuses SET-13"): asks for the four-eyes
 * `members.delete` (RequestMemberDeletion), whose executor runs the SET-13 deletion (DeleteAccount: closed at once, hard-deleted within
 * 30 days). The approval is linked to the request; the team completes the request with its evidence once it executed.
 *
 * @throws AuthorizationException|ValidationException|TeamRefused
 */
class RequestPrivacyErasure
{
    public function __construct(private readonly RequestMemberDeletion $deletion) {}

    public function handle(Staff $by, PrivacyRequest $request, string $reason): ApprovalRequest
    {
        StaffAtoms::ensure($by, 'privacy.process', 'members.delete');

        if ($request->status->isFinal()) {
            throw new TeamRefused('final');
        }

        if ($request->type !== PrivacyRequestType::Erasure) {
            throw new TeamRefused('wrong_type');
        }

        $member = $request->user_id === null ? null : User::query()->find($request->user_id);

        if (! $member instanceof User) {
            throw new TeamRefused('no_member');
        }

        try {
            $approval = $this->deletion->handle($by, $member, $reason);
        } catch (DomainException) {
            throw new TeamRefused('already_deleting');
        }

        DB::transaction(function () use ($by, $request, $approval, $member): void {
            $request->forceFill([
                'approval_request_id' => $approval->getKey(),
                'status' => $request->status === PrivacyRequestStatus::Open ? PrivacyRequestStatus::InProgress : $request->status,
            ])->save();

            Audit::record(PrivacyEvent::ErasureRequested->value, $request, after: ['approval_id' => $approval->getKey(), 'member_id' => $member->id], actor: $by);
        });

        return $approval;
    }
}
