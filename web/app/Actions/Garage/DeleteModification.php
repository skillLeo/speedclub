<?php

namespace App\Actions\Garage;

use App\Actions\Media\DeleteMedia;
use App\Models\Media;
use App\Models\Modification;
use App\Models\Vehicle;
use App\Services\BuildScore\BuildScores;
use App\Services\Garage\BuildUpdates;
use App\Services\Notifications\Notifier;
use App\Services\Search\VehicleSearchProjector;
use Illuminate\Support\Facades\DB;

/**
 * Soft delete; history keeps its entry (F3). The photos stop being public right away, like any deleted photo (ADR-123). Locks in
 * the order of an edit, vehicle first, and a second delete that got past the route changes nothing.
 */
class DeleteModification
{
    public function __construct(
        private readonly BuildUpdates $updates,
        private readonly VehicleSearchProjector $search,
        private readonly DeleteMedia $media,
    ) {}

    public function handle(Modification $mod): void
    {
        DB::transaction(function () use ($mod): void {
            $vehicle = $mod->vehicle;
            Vehicle::query()->whereKey($vehicle->id)->lockForUpdate()->firstOrFail();

            $mod->refresh();

            if ($mod->trashed()) {
                return;
            }

            $mod->delete();
            // M5.7: a deleted plan is not asked about any more.
            app(Notifier::class)->forgetPlanDue($mod->id);

            $this->updates->modRemoved($mod);
            $this->search->changed($vehicle);
            app(BuildScores::class)->touch($vehicle->id);
        });

        $mod->media->each(fn (Media $photo) => $this->media->handle($photo));
    }
}
