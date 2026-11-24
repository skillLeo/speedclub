<?php

namespace App\Services\Dex;

use App\Enums\ModStatus;
use App\Models\Spot;
use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Builds SpotCards for one member with a fixed number of queries, whatever the number of cards.
 */
final class SpotCards
{
    /**
     * What SpotCardResource reads. Top mods: installed ones in the owner's order (the card shows three).
     *
     * @return array<int|string, mixed>
     */
    public static function relations(): array
    {
        return [
            'make', 'vehicleModel', 'generation', 'cover', 'media', 'owner.avatar', 'spotStats',
            'modifications' => fn (HasMany $mods) => $mods->where('status', ModStatus::Installed->value)->orderBy('sort')->orderBy('id')->with('brand'),
        ];
    }

    public function forSpot(User $viewer, Spot $spot): SpotCard
    {
        return $this->forSpots($viewer, [$spot->id])[0] ?? new SpotCard($this->loaded($spot->vehicle), $spot, $spot->is_first_three);
    }

    /**
     * Cards of the viewer's spots, in the order of $spotIds; spots that are gone drop out.
     *
     * @param  list<string>  $spotIds
     * @return list<SpotCard>
     */
    public function forSpots(User $viewer, array $spotIds): array
    {
        if ($spotIds === []) {
            return [];
        }

        $spots = Spot::query()->whereKey($spotIds)->where('spotter_id', $viewer->id)->get()->keyBy('id');
        $vehicleIds = array_values(array_unique($spots->map(fn (Spot $spot): string => $spot->vehicle_id)->all()));
        $vehicles = Vehicle::withTrashed()->whereKey($vehicleIds)->with(self::relations())->get()->keyBy('id');
        $foils = $this->foils($viewer, $vehicleIds);
        $cards = [];

        foreach ($spotIds as $id) {
            $spot = $spots->get($id);
            $vehicle = $spot === null ? null : $vehicles->get($spot->vehicle_id);

            if ($spot instanceof Spot && $vehicle instanceof Vehicle) {
                $spot->setRelation('vehicle', $vehicle);
                $cards[] = new SpotCard($vehicle, $spot, isset($foils[$vehicle->id]));
            }
        }

        return $cards;
    }

    /**
     * The DEX-04 preview of a car the viewer has not spotted: no spot, no foil.
     */
    public function preview(Vehicle $vehicle): SpotCard
    {
        return new SpotCard($this->loaded($vehicle), null, false);
    }

    /**
     * The viewer's first counted spot of the car, or null (a young account's spots are no Dex entry).
     */
    public function firstSpotOf(User $viewer, Vehicle $vehicle): ?Spot
    {
        return Spot::query()->where('spotter_id', $viewer->id)->where('vehicle_id', $vehicle->id)->where('counted', true)
            ->orderBy('id')->first();
    }

    private function loaded(Vehicle $vehicle): Vehicle
    {
        return $vehicle->load(self::relations());
    }

    /**
     * Vehicles of $vehicleIds on which the viewer holds a "First Spotter" foil.
     *
     * @param  list<string>  $vehicleIds
     * @return array<string, true>
     */
    private function foils(User $viewer, array $vehicleIds): array
    {
        return array_fill_keys(Spot::query()->where('spotter_id', $viewer->id)->whereIn('vehicle_id', $vehicleIds)
            ->where('is_first_three', true)->distinct()->pluck('vehicle_id')->map(strval(...))->all(), true);
    }
}
