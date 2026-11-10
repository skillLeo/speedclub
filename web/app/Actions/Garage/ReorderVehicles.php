<?php

namespace App\Actions\Garage;

use App\Enums\ErrorCode;
use App\Enums\VehicleStatus;
use App\Exceptions\ApiException;
use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Support\Facades\DB;

/**
 * FS-4 "Sortieren". Drafts have their own section and stay out of the list. The order is housekeeping: only a change to specs, mods or
 * photos moves a build in "Neue Builds", so this writes past the model and leaves updated_at alone.
 */
class ReorderVehicles
{
    /** A backstop against a deadlock with what does not take the member's lock first. The closure starts with a fresh read, and a rollback undoes all it wrote. */
    private const ATTEMPTS = 3;

    /**
     * @param  list<string>  $ids  every vehicle that is not a draft, in the new order
     */
    public function handle(User $user, array $ids): void
    {
        DB::transaction(function () use ($user, $ids): void {
            User::query()->whereKey($user->id)->lockForUpdate()->value('id');

            $existing = $user->vehicles()->where('status', '!=', VehicleStatus::Draft)->pluck('id')->map(fn (mixed $id): string => (string) $id)->all();

            if (array_diff($ids, $existing) !== [] || array_diff($existing, $ids) !== []) {
                $reason = (string) __('garage.order_mismatch');

                throw new ApiException(ErrorCode::ValidationFailed, $reason, errors: ['ids' => [$reason]]);
            }

            foreach ($ids as $sort => $id) {
                Vehicle::query()->whereKey($id)->toBase()->update(['sort' => $sort]);
            }
        }, self::ATTEMPTS);
    }
}
