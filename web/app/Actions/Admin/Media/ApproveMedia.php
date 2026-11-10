<?php

namespace App\Actions\Admin\Media;

use App\Enums\AdminMemberEvent;
use App\Enums\ModerationStatus;
use App\Models\Media;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use DomainException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * ADM-13 "Freigeben" (`media.review`, keyboard A): the photo leaves the "Neu" queue (media.reviewed_at/by) and a pending or flagged
 * moderation status becomes approved. A photo a decision removed stays removed: only a reversal (UnhideMedia) brings it back. Audited
 * `media.reviewed`; the reason is optional, as the queue is worked one key at a time.
 *
 * @throws AuthorizationException|DomainException
 */
class ApproveMedia
{
    public function handle(Staff $staff, Media $photo, ?string $reason = null): Media
    {
        StaffAtoms::ensure($staff, 'media.review');

        return DB::transaction(function () use ($staff, $photo, $reason): Media {
            $locked = Media::query()->whereKey($photo->id)->lockForUpdate()->first() ?? throw new DomainException('The photo is deleted.');

            if ($locked->moderation_status === ModerationStatus::Rejected) {
                throw new DomainException('A removed photo comes back only through a reversal.');
            }

            $before = ['moderation_status' => $locked->moderation_status->value, 'reviewed_at' => $locked->reviewed_at?->toIso8601String()];
            $locked->forceFill(['moderation_status' => ModerationStatus::Approved, 'reviewed_at' => now(), 'reviewed_by' => $staff->getKey()])->save();

            Audit::record(AdminMemberEvent::MediaReviewed->value, $locked, $before, ['moderation_status' => ModerationStatus::Approved->value], $reason === null ? null : trim($reason), $staff);
            $photo->setRawAttributes($locked->getAttributes(), true);

            return $photo;
        });
    }
}
