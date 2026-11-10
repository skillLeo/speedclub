<?php

namespace App\Actions\Garage;

use App\Enums\Visibility;
use App\Models\Vehicle;
use App\Services\PublicPages\OgImages;
use App\Services\PublicPages\SitemapWriter;
use App\Services\Search\VehicleSearchProjector;
use Illuminate\Support\Facades\DB;

/**
 * A privacy change reaches search within this request, not with the next cron minute. It is no change of the build: only specs,
 * mods or photos move a build in "Neue Builds" (SEC-M18-03), so this writes past the model and leaves updated_at alone, as
 * SetMainVehicle does.
 */
class ChangeVehicleVisibility
{
    public function __construct(
        private readonly VehicleSearchProjector $search,
        private readonly OgImages $og,
        private readonly SitemapWriter $sitemap,
    ) {}

    public function handle(Vehicle $vehicle, Visibility $visibility): Vehicle
    {
        $wasPrivate = $vehicle->visibility === Visibility::Private;

        DB::transaction(function () use ($vehicle, $visibility): void {
            Vehicle::query()->whereKey($vehicle->id)->toBase()->update(['visibility' => $visibility->value]);
            $vehicle->refresh();
            $this->search->rebuild($vehicle->id);
        });

        // After the commit: a rollback can bring rows back, but not files. Private never has a public OG file; back from private
        // the vehicle needs it again, while between public and unlisted the file stays as it is.
        if ($visibility === Visibility::Private) {
            $this->og->purge($vehicle);
        } elseif ($wasPrivate) {
            $this->og->queue($vehicle);
        }

        // The sitemap lists public vehicles only, and one that left it must not stay listed until the night. Decided on the new
        // value alone, which costs one render when a vehicle that was not listed changes, but trusts no attribute the caller loaded.
        if ($visibility !== Visibility::Public) {
            $this->sitemap->forget();
        }

        return $vehicle;
    }
}
