<?php

namespace App\Actions\Businesses;

use App\Enums\BusinessStatus;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\Business;
use Illuminate\Support\Facades\DB;

/**
 * BIZ-02 status screen "Erneut einreichen": a rejected business goes back to staff (applied) after the owner changed it.
 */
class ResubmitBusiness
{
    public function handle(Business $business): Business
    {
        return DB::transaction(function () use ($business): Business {
            /** @var Business $locked */
            $locked = Business::query()->whereKey($business->id)->lockForUpdate()->firstOrFail();

            if ($locked->status !== BusinessStatus::Rejected || $locked->removed_at !== null) {
                throw new ApiException(ErrorCode::Conflict);
            }

            $locked->forceFill(['status' => BusinessStatus::Applied, 'submitted_at' => now(), 'review_reason' => null, 'reviewed_by' => null, 'reviewed_at' => null])->save();

            return $locked;
        });
    }
}
