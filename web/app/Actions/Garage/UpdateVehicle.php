<?php

namespace App\Actions\Garage;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Garage\VehicleAttributes;
use App\Services\Maintenance\MaintenanceItems;
use App\Services\PublicPages\OgImages;
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

        // M3.4 (ADM-23): keyword rules on the description, before anything is written.
        $flags = $this->screen->screen(CreateVehicleDraft::screened($attributes));

        DB::transaction(function () use ($user, $vehicle, $attributes, $flags): void {
            $this->attributes->apply($vehicle, $attributes);
            $this->assertKeepsBasics($vehicle, $attributes);
            $vehicle->save();
            // M4.13 (09 §8.8): the HU/AU month and the HU/AU maintenance item stay one.
            if (array_key_exists('hu_au_due', $attributes)) {
                app(MaintenanceItems::class)->huAuMonthChanged($vehicle, $vehicle->getAttribute('hu_au_due')?->format('Y-m-d'));
            }
            $this->attributes->fileCatalogRequest($user, $vehicle, $attributes);
            $this->search->queue($vehicle);
            $this->og->queue($vehicle);
            $this->screen->flagAfterCommit($flags, $vehicle);
        });

        return $vehicle;
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
