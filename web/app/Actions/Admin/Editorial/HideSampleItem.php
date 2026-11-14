<?php

namespace App\Actions\Admin\Editorial;

use App\Actions\Garage\ChangeVehicleVisibility;
use App\Enums\SampleItemType;
use App\Enums\Visibility;
use App\Models\Business;
use App\Models\Event;
use App\Models\Staff;
use App\Models\Vehicle;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Catalog\Reason;
use DomainException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * ADM-58 "Ausblenden" (`content.edit`, recent password, reason): takes one sample item out of every member-facing and public read while
 * the editorial_samples flag stays on. It uses the item's own withdrawal, which every read path honours already: a build goes private
 * (ChangeVehicleVisibility: search, share image and sitemap follow), a meet or a business gets removed_at. Nobody is notified: the
 * item belongs to the SPEED CLUB Editorial account (09 §8.19), not to a member. Not on the four-eyes list (06 §2). Audited
 * `editorial.sample_hidden` with what was before.
 *
 * @throws AuthorizationException|DomainException|ValidationException
 */
final class HideSampleItem
{
    public function __construct(private readonly ChangeVehicleVisibility $visibility) {}

    public function handle(Staff $staff, SampleItemType $type, string $id, string $reason): string
    {
        StaffAtoms::ensure($staff, 'content.edit');
        $reason = Reason::required($reason);

        return DB::transaction(function () use ($staff, $type, $id, $reason): string {
            $item = SampleItemLocator::lock($type, $id);

            if (SampleItemLocator::openRecord($type, $item->getKey()) !== null) {
                throw new DomainException('already_hidden');
            }

            $previous = match (true) {
                $item instanceof Vehicle => $this->vehicle($item),
                $item instanceof Event, $item instanceof Business => $this->removable($item),
            };

            $record = strtolower((string) Str::ulid());
            DB::table('sample_hidden_items')->insert([
                'id' => $record,
                'subject_type' => $type->value,
                'subject_id' => (string) $item->getKey(),
                'previous' => json_encode($previous, JSON_THROW_ON_ERROR),
                'reason' => $reason,
                'hidden_by' => $staff->id,
                'hidden_at' => now(),
            ]);

            Audit::record('editorial.sample_hidden', $item, $previous, ['hidden' => true, 'record' => $record], $reason, $staff);

            return $record;
        });
    }

    /**
     * @return array{visibility: string}
     */
    private function vehicle(Vehicle $vehicle): array
    {
        if ($vehicle->trashed() || $vehicle->visibility === Visibility::Private) {
            throw new DomainException('not_visible');
        }

        $previous = ['visibility' => $vehicle->visibility->value];
        $this->visibility->handle($vehicle, Visibility::Private);

        return $previous;
    }

    /**
     * @return array{removed_at: null}
     */
    private function removable(Event|Business $item): array
    {
        if ($item->getAttribute('removed_at') !== null) {
            throw new DomainException('not_visible');
        }

        $item->forceFill(['removed_at' => now()])->save();

        return ['removed_at' => null];
    }
}
