<?php

namespace App\Actions\Crews;

use App\Enums\CrewRole;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\Crew;
use App\Models\CrewMember;
use App\Models\CrewRequest;
use App\Models\User;
use App\Services\Crews\CrewMemberships;
use App\Services\Notifications\Notifier;
use Illuminate\Support\Facades\DB;

/**
 * Founder and admins decide a join request (contract-crews.md §3 #17, #18). approve(): the member joins (409 limit_reached when they are
 * in memberships_max crews meanwhile; the request stays) and hears about it; decline(): the request goes, silently (no guilt
 * notifications). A request of somebody the deciding admin has a block with is theirs to leave (404, C3); every admin's
 * "request_received" row goes once it is decided.
 */
class DecideCrewRequest
{
    public function __construct(private readonly CrewMemberships $memberships, private readonly Notifier $notifier) {}

    public function approve(User $by, Crew $crew, CrewRequest $request): CrewMember
    {
        $this->assertDecidable($by, $crew, $request);
        $applicant = $request->user;

        $member = DB::transaction(function () use ($crew, $request, $applicant): CrewMember {
            $this->memberships->lockMember($applicant);
            CrewFields::assertActive($this->memberships->lockCrew($crew));

            if (! CrewRequest::query()->whereKey($request->id)->exists()) {
                throw new ApiException(ErrorCode::NotFound);
            }

            $existing = CrewMember::query()->where('crew_id', $crew->id)->where('user_id', $applicant->id)->first();

            if ($existing instanceof CrewMember) {
                $this->memberships->endOpenRows($crew, $applicant);

                return $existing;
            }

            $this->memberships->assertMayJoin($applicant);

            return $this->memberships->add($crew, $applicant, CrewRole::Member);
        });

        $this->notifier->crew($applicant, $crew, null, $crew->id, 'request_approved');

        return $member->setRelation('user', $applicant);
    }

    public function decline(User $by, Crew $crew, CrewRequest $request): void
    {
        $this->assertDecidable($by, $crew, $request);

        $deleted = DB::transaction(fn (): int => CrewRequest::query()->whereKey($request->id)->delete());

        if ($deleted > 0) {
            $this->notifier->forgetCrew($request->id, 'request_received');
        }
    }

    private function assertDecidable(User $by, Crew $crew, CrewRequest $request): void
    {
        if ($request->crew_id !== $crew->id || $by->hasBlockWith($request->user)) {
            throw new ApiException(ErrorCode::NotFound);
        }
    }
}
