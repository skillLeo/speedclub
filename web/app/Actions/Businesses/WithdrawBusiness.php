<?php

namespace App\Actions\Businesses;

use App\Enums\BusinessStatus;
use App\Enums\CollectionItemType;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\Business;
use App\Models\Media;
use App\Models\Modification;
use App\Services\Media\MediaService;
use App\Services\Social\Collections;
use Illuminate\Support\Facades\DB;

/**
 * "Bewerbung zurückziehen": the owner deletes an applied or rejected business with its team, tags and photos. A verified or suspended
 * business is not deleted from the app (409 business_exists with a support hint): its portfolio and the audit trail of staff decisions
 * stay until support closes it. Account deletion removes it with the owner (cascade).
 */
class WithdrawBusiness
{
    public function __construct(private readonly MediaService $media) {}

    public function handle(Business $business): void
    {
        $media = DB::transaction(function () use ($business): array {
            /** @var Business $locked */
            $locked = Business::query()->whereKey($business->id)->lockForUpdate()->firstOrFail();

            if (! in_array($locked->status, [BusinessStatus::Applied, BusinessStatus::Rejected], true)) {
                throw new ApiException(ErrorCode::BusinessExists, (string) __('parts.not_withdrawable'));
            }

            $media = Media::query()->where('mediable_type', $locked->getMorphClass())->where('mediable_id', $locked->id)->get()->all();
            Modification::query()->where('installed_by_business_id', $locked->id)->update(['installed_by_business_id' => null]);
            Collections::forgetItem(CollectionItemType::Business, $locked->id);
            $locked->delete();

            return $media;
        });

        foreach ($media as $photo) {
            $this->media->purge($photo);
        }
    }
}
