<?php

namespace App\Actions\Admin\Vehicles;

use App\Enums\AdminMemberEvent;
use App\Models\Staff;
use App\Models\Vehicle;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Garage\VehicleAttributes;
use App\Services\PublicPages\OgImages;
use App\Services\Search\VehicleSearchProjector;
use DomainException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * ADM-12 "Bearbeiten" (`vehicles.edit`, recent password): relinking the catalogue (make, model, generation, or the free text when there
 * is no entry) and the title fields (model year, nickname), through the same VehicleAttributes the garage uses (year fits the
 * generation, slug follows the names). A staff correction is no news of the build: no build update, its dates stay. Search and the share
 * image follow. Audited with before and after.
 *
 * @param  array{make_id?: int|null, model_id?: int|null, generation_id?: int|null, make_text?: string|null, model_text?: string|null, model_year?: int|null, nickname?: string|null}  $changes  validated
 *
 * @throws AuthorizationException|ValidationException|DomainException for a deleted vehicle
 */
class EditVehicle
{
    public const FIELDS = ['make_id', 'model_id', 'generation_id', 'make_text', 'model_text', 'model_year', 'nickname'];

    public function __construct(
        private readonly VehicleAttributes $attributes,
        private readonly VehicleSearchProjector $search,
        private readonly OgImages $og,
    ) {}

    /**
     * @param  array<string, mixed>  $changes
     */
    public function handle(Staff $staff, Vehicle $vehicle, array $changes, string $reason): Vehicle
    {
        StaffAtoms::ensure($staff, 'vehicles.edit');
        $changes = array_intersect_key($changes, array_flip(self::FIELDS));

        $changed = DB::transaction(function () use ($staff, $vehicle, $changes, $reason): bool {
            $locked = Vehicle::query()->whereKey($vehicle->id)->lockForUpdate()->first() ?? throw new DomainException('The vehicle is deleted.');
            $before = array_intersect_key($locked->getAttributes(), array_flip([...self::FIELDS, 'slug']));

            $this->attributes->apply($locked, $changes);

            if (! $locked->isDirty()) {
                return false;
            }

            $after = array_intersect_key($locked->getDirty(), array_flip([...self::FIELDS, 'slug']));
            $locked->timestamps = false;
            $locked->save();

            Audit::record(AdminMemberEvent::VehicleEdited->value, $locked, array_intersect_key($before, $after), $after, trim($reason), $staff);
            $vehicle->setRawAttributes($locked->getAttributes(), true);

            return true;
        });

        if ($changed) {
            $this->search->queue($vehicle);

            try {
                $this->og->purge($vehicle);
                $this->og->queue($vehicle);
            } catch (Throwable $exception) {
                report($exception);
            }
        }

        return $vehicle;
    }
}
