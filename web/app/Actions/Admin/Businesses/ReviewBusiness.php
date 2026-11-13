<?php

namespace App\Actions\Admin\Businesses;

use App\Enums\BusinessAuditEvent;
use App\Enums\BusinessStatus;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\Business;
use App\Models\Staff;
use App\Services\Approvals\FourEyes;
use App\Services\Audit\Audit;
use App\Services\Notifications\Notifier;
use Illuminate\Support\Facades\DB;

/**
 * ADM-55/56 (09 §8.10, ADR-414): staff verify an applied business (checks: name, address, Impressum fields, website/registry
 * plausibility) or reject it with a reason the applicant reads; suspend a verified one (four-eyes `business.suspend`: a second staff
 * member approves, as for a member suspension) and reinstate it; reopen sends a decision back to the queue (the SplitQueue's undo).
 * Every decision is audited with its reason; the owner is told in the app after the commit.
 *
 * Optimistic locking (as ADR-439 for events): every write names the `version` (updated_at) the staff member decided on; a business
 * that changed since answers 409 edit_conflict and nothing happens. A state that no longer allows the action is 409 conflict.
 */
class ReviewBusiness
{
    public function __construct(private readonly Notifier $notifier) {}

    public static function version(Business $business): ?string
    {
        return $business->updated_at?->toIso8601String();
    }

    public function verify(Staff $staff, Business $business, ?string $reason, string $seen): Business
    {
        $decided = $this->transition($staff, $business, $seen, [BusinessStatus::Applied], BusinessStatus::Verified, BusinessAuditEvent::Verified, $reason, [
            'verified_at' => now(), 'verified_by' => $staff->id, 'review_reason' => null, 'suspended_at' => null,
        ]);
        $this->notifier->businessReviewed($decided->owner, $decided, 'verified', null);

        return $decided;
    }

    public function reject(Staff $staff, Business $business, string $reason, string $seen): Business
    {
        $decided = $this->transition($staff, $business, $seen, [BusinessStatus::Applied], BusinessStatus::Rejected, BusinessAuditEvent::Rejected, $reason, [
            'review_reason' => $reason,
        ]);
        $this->notifier->businessReviewed($decided->owner, $decided, 'rejected', $reason);

        return $decided;
    }

    /**
     * Runs only inside the approval of `business.suspend` (FourEyes::executor): $requester asked, $approver approved.
     */
    public function suspend(Staff $requester, Staff $approver, Business $business, string $reason, string $seen): Business
    {
        FourEyes::executor(['business.suspend'], $requester, $approver, 'moderation.decide');

        $decided = $this->transition($requester, $business, $seen, [BusinessStatus::Verified], BusinessStatus::Suspended, BusinessAuditEvent::Suspended, $reason, [
            'suspended_at' => now(), 'review_reason' => $reason,
        ], ['approved_by' => $approver->id]);
        $this->notifier->businessReviewed($decided->owner, $decided, 'suspended', $reason);

        return $decided;
    }

    public function reinstate(Staff $staff, Business $business, string $reason, string $seen): Business
    {
        $decided = $this->transition($staff, $business, $seen, [BusinessStatus::Suspended], BusinessStatus::Verified, BusinessAuditEvent::Reinstated, $reason, [
            'suspended_at' => null, 'review_reason' => null,
        ]);
        $this->notifier->businessReviewed($decided->owner, $decided, 'reinstated', null);

        return $decided;
    }

    /**
     * The SplitQueue's undo: a verified business without portfolio tags yet, or a rejected one, goes back to `applied`.
     */
    public function reopen(Staff $staff, Business $business, ?string $reason, string $seen): Business
    {
        return DB::transaction(function () use ($staff, $business, $reason, $seen): Business {
            $locked = $this->lock($business, $seen);
            $reopenable = ($locked->status === BusinessStatus::Verified && ! $locked->tags()->exists())
                || $locked->status === BusinessStatus::Rejected;

            if (! $reopenable) {
                throw new ApiException(ErrorCode::Conflict);
            }

            $before = $locked->status->value;
            $locked->forceFill([
                'status' => BusinessStatus::Applied, 'verified_at' => null, 'verified_by' => null, 'review_reason' => null,
                'reviewed_by' => null, 'reviewed_at' => null,
            ])->save();
            Audit::record(BusinessAuditEvent::Reopened->value, $locked, ['status' => $before], ['status' => BusinessStatus::Applied->value], $reason, $staff);

            return $locked;
        });
    }

    /**
     * @param  list<BusinessStatus>  $from
     * @param  array<string, mixed>  $columns
     * @param  array<string, mixed>  $extraAfter
     */
    private function transition(Staff $staff, Business $business, string $seen, array $from, BusinessStatus $to, BusinessAuditEvent $event, ?string $reason, array $columns, array $extraAfter = []): Business
    {
        return DB::transaction(function () use ($staff, $business, $seen, $from, $to, $event, $reason, $columns, $extraAfter): Business {
            $locked = $this->lock($business, $seen);

            if (! in_array($locked->status, $from, true)) {
                throw new ApiException(ErrorCode::Conflict);
            }

            $before = $locked->status->value;
            $locked->forceFill([...$columns, 'status' => $to, 'reviewed_by' => $staff->id, 'reviewed_at' => now()])->save();
            Audit::record($event->value, $locked, ['status' => $before], ['status' => $to->value, ...$extraAfter], $reason, $staff);

            return $locked;
        });
    }

    private function lock(Business $business, string $seen): Business
    {
        /** @var Business $locked */
        $locked = Business::query()->whereKey($business->id)->lockForUpdate()->firstOrFail();

        if ($seen !== self::version($locked)) {
            throw new ApiException(ErrorCode::EditConflict);
        }

        return $locked;
    }
}
