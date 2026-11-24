<?php

namespace App\Actions\Garage;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\BuildScore\BuildScores;
use App\Services\Garage\VehicleAttributes;
use App\Services\Maintenance\MaintenanceItems;
use App\Services\PublicPages\OgImages;
use App\Services\PublicPages\SitemapWriter;
use App\Services\Rules\ContentScreen;
use App\Services\Search\VehicleSearchProjector;
use Illuminate\Support\Facades\DB;

/**
 * GAR-05 and every step of the wizard. A published vehicle has no wizard any more, so its step stays null, and it keeps what
 * publishing asked of it: make, model and year can change but not go (02_PRODUCT_SPEC §3.2). The stored slug follows the names;
 * the old URL keeps working through its public_id and answers with a 301.
 */
class UpdateVehicle
{
    private const BASICS = ['make_id', 'make_text', 'model_id', 'model_text', 'model_year'];

    /** M5.7: the optional milestone goal "Ziel: Saison 2027" (UpdateVehicleRequest). */
    public const GOAL = 'build_goal_season';

    /** M5.9b: the owner's STREET DEX switches (UpdateVehicleRequest). */
    public const SPOT_SWITCHES = ['ghost_mode', 'spotting_paused', 'hide_spot_cities'];

    /**
     * M5.9b part 2: whether a PATCH only takes exposure away, so a member under a publishing restriction may send it: nothing but the
     * STREET DEX switches, each one switched on (ghost mode, spotting paused, cities hidden) or left as it is. Switching one off shows
     * the car again and stays restricted, like every other change.
     *
     * @param  array<string, mixed>  $attributes  validated
     */
    public static function onlyReducesExposure(Vehicle $vehicle, array $attributes): bool
    {
        if ($attributes === [] || array_diff_key($attributes, array_flip(self::SPOT_SWITCHES)) !== []) {
            return false;
        }

        foreach ($attributes as $key => $value) {
            if ($value !== true && $value !== ($vehicle->getAttribute($key) === true)) {
                return false;
            }
        }

        return true;
    }

    public function __construct(
        private readonly VehicleAttributes $attributes,
        private readonly VehicleSearchProjector $search,
        private readonly OgImages $og,
        private readonly ContentScreen $screen,
    ) {}

    /**
     * @param  array<string, mixed>  $attributes  validated
     */
    public function handle(User $user, Vehicle $vehicle, array $attributes): Vehicle
    {
        if (! $vehicle->isDraft()) {
            unset($attributes['wizard_step']);
        }

        // M5.9b (m5.9b contract §5): the owner's STREET DEX switches are not attributes of the catalogue or the wizard.
        $switches = array_intersect_key($attributes, array_flip(self::SPOT_SWITCHES));
        $attributes = array_diff_key($attributes, $switches);

        // M5.7 (m5.7-contract §4.1): the milestone goal is no build news: no Verlauf entry, no updated_at, no search or OG refresh.
        if (array_key_exists(self::GOAL, $attributes)) {
            $this->setGoal($vehicle, $attributes[self::GOAL]);
            unset($attributes[self::GOAL]);

            if ($attributes === [] && $switches === []) {
                return $vehicle;
            }
        }

        // M3.4 (ADM-23): keyword rules on the description, before anything is written.
        $flags = $this->screen->screen(CreateVehicleDraft::screened($attributes));

        DB::transaction(function () use ($user, $vehicle, $attributes, $flags, $switches): void {
            $vehicle->forceFill($switches);
            $this->attributes->apply($vehicle, $attributes);
            $this->assertKeepsBasics($vehicle, $attributes);
            $vehicle->save();
            // M4.13 (09 §8.8): the HU/AU month and the HU/AU maintenance item stay one.
            if (array_key_exists('hu_au_due', $attributes)) {
                app(MaintenanceItems::class)->huAuMonthChanged($vehicle, $vehicle->getAttribute('hu_au_due')?->format('Y-m-d'));
            }
            $this->attributes->fileCatalogRequest($user, $vehicle, $attributes);

            // Ghost mode reaches search and every list within this request (vehicle_search.is_public), like a visibility change.
            if ($vehicle->wasChanged('ghost_mode')) {
                $this->search->rebuild($vehicle->id);
            }

            $this->search->queue($vehicle);
            $this->og->queue($vehicle);
            $this->screen->flagAfterCommit($flags, $vehicle);

            // M5.9c: the description, the cover, the generation and the colour count for the Build Score.
            if ($vehicle->wasChanged(['description', 'cover_media_id', 'generation_id', 'color'])) {
                app(BuildScores::class)->touch($vehicle->id);
            }
        });

        // A ghost car leaves the sitemap now, not with the night.
        if ($vehicle->wasChanged('ghost_mode') && $vehicle->ghost_mode) {
            app(SitemapWriter::class)->forget();
        }

        return $vehicle;
    }

    private function setGoal(Vehicle $vehicle, mixed $season): void
    {
        // Review NH: "2027" as text passes `integer` and is the same season.
        $season = is_int($season) || (is_string($season) && ctype_digit($season)) ? (int) $season : null;

        Vehicle::withTrashed()->whereKey($vehicle->id)->toBase()->update([self::GOAL => $season]);
        $vehicle->setAttribute(self::GOAL, $season)->syncOriginalAttribute(self::GOAL);
    }

    /**
     * Only when one of these is being set: an edit of the colour must not fail on an older entry.
     *
     * @param  array<string, mixed>  $attributes
     *
     * @throws ApiException 422 validation_failed
     */
    private function assertKeepsBasics(Vehicle $vehicle, array $attributes): void
    {
        if ($vehicle->isDraft() || array_intersect_key($attributes, array_flip(self::BASICS)) === []) {
            return;
        }

        $missing = $vehicle->missingBasics();

        if ($missing !== []) {
            throw new ApiException(ErrorCode::ValidationFailed, errors: array_combine($missing, array_map(fn (string $key): array => [(string) __('garage.publish_missing.'.$key)], $missing)));
        }
    }
}
