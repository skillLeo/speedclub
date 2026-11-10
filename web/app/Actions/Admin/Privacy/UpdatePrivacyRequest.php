<?php

namespace App\Actions\Admin\Privacy;

use App\Enums\PrivacyEvent;
use App\Enums\PrivacyRequestStatus;
use App\Models\PrivacyRequest;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Catalog\Reason;
use App\Services\Privacy\PrivacyDeadlines;
use App\Services\Team\TeamRefused;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ADM-46 steps on an open request (`privacy.process`): assign (to an active staff member holding privacy.process, or nobody), move between
 * open / in progress / waiting, and the one Art. 12(3) extension by two months with a reason, only before the first due date (the
 * requester must hear of it within the first month: send the `extension` reply). A completed or rejected request is final.
 *
 * @throws AuthorizationException|ValidationException|TeamRefused
 */
class UpdatePrivacyRequest
{
    public function assign(Staff $by, PrivacyRequest $request, ?Staff $assignee): void
    {
        StaffAtoms::ensure($by, 'privacy.process');
        $this->ensureOpen($request);

        if ($assignee !== null && (! $assignee->isActive() || ! $assignee->can('privacy.process'))) {
            throw ValidationException::withMessages(['assigned_to' => [(string) __('privacy.validation.assignee')]]);
        }

        DB::transaction(function () use ($by, $request, $assignee): void {
            $before = $request->assigned_to;
            $request->forceFill(['assigned_to' => $assignee?->getKey()])->save();
            Audit::record(PrivacyEvent::RequestAssigned->value, $request, before: ['assigned_to' => $before], after: ['assigned_to' => $request->assigned_to], actor: $by);
        });
    }

    public function status(Staff $by, PrivacyRequest $request, PrivacyRequestStatus $status): void
    {
        StaffAtoms::ensure($by, 'privacy.process');
        $this->ensureOpen($request);

        if ($status->isFinal()) {
            throw ValidationException::withMessages(['status' => [(string) __('privacy.validation.final_via_complete')]]);
        }

        if ($status === $request->status) {
            return;
        }

        DB::transaction(function () use ($by, $request, $status): void {
            $before = $request->status;
            $request->forceFill(['status' => $status])->save();
            Audit::record(PrivacyEvent::RequestStatusChanged->value, $request, before: ['status' => $before->value], after: ['status' => $status->value], actor: $by);
        });
    }

    public function extend(Staff $by, PrivacyRequest $request, string $reason): void
    {
        StaffAtoms::ensure($by, 'privacy.process');
        $reason = Reason::required($reason);
        $this->ensureOpen($request);

        DB::transaction(function () use ($by, $request, $reason): void {
            $locked = PrivacyRequest::query()->whereKey($request->getKey())->lockForUpdate()->firstOrFail();

            if ($locked->extended_at !== null) {
                throw new TeamRefused('already_extended');
            }

            if ($locked->due_at->isPast()) {
                throw new TeamRefused('past_due');
            }

            $before = $locked->due_at->toIso8601String();
            $locked->forceFill(['due_at' => PrivacyDeadlines::extended($locked->due_at), 'extended_at' => now(), 'extension_reason' => $reason])->save();
            $request->setRawAttributes($locked->getAttributes(), true);

            Audit::record(PrivacyEvent::RequestExtended->value, $locked, before: ['due_at' => $before], after: ['due_at' => $locked->due_at->toIso8601String()], reason: $reason, actor: $by);
        });
    }

    /**
     * @throws TeamRefused
     */
    private function ensureOpen(PrivacyRequest $request): void
    {
        if ($request->status->isFinal()) {
            throw new TeamRefused('final');
        }
    }
}
