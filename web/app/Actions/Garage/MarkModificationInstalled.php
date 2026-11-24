<?php

namespace App\Actions\Garage;

use App\Enums\ErrorCode;
use App\Enums\ModStatus;
use App\Exceptions\ApiException;
use App\Models\Modification;
use App\Models\Vehicle;
use App\Support\Garage\SavedModification;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * M5.3 "Als verbaut markieren" (10 §5.9, m5.3-contract §4.2): a plan becomes an installed mod, by default in the current month in
 * Germany. The edit itself is SaveModification's, so Verlauf tells "Geplant: KW V3" → "KW V3", search and the Build Score follow, and
 * the plan fields go; the private budget stays with the owner. A mod that is not planned (any more) answers 409 mod_not_planned.
 */
class MarkModificationInstalled
{
    public function __construct(private readonly SaveModification $save) {}

    /**
     * @param  array{installed_on?: string|null, cost_cents?: int|null}  $attributes  validated
     */
    public function handle(Modification $mod, array $attributes): SavedModification
    {
        return DB::transaction(function () use ($mod, $attributes): SavedModification {
            Vehicle::query()->whereKey($mod->vehicle_id)->lockForUpdate()->firstOrFail();

            // What the route read may be older than the lock: a delete or another "Verbaut" in between wins.
            $mod->refresh();

            if ($mod->trashed()) {
                throw new ApiException(ErrorCode::NotFound);
            }

            if ($mod->getAttribute('status') !== ModStatus::Planned) {
                throw new ApiException(ErrorCode::ModNotPlanned);
            }

            $month = $attributes['installed_on'] ?? null;
            $changes = [
                'status' => ModStatus::Installed,
                'installed_on' => is_string($month) ? $month : Carbon::now(config()->string('speedclub.display_timezone'))->format('Y-m'),
            ];

            if (array_key_exists('cost_cents', $attributes)) {
                $changes['cost_cents'] = $attributes['cost_cents'];
            }

            return $this->save->change($mod->load('category.fields'), $changes);
        });
    }
}
