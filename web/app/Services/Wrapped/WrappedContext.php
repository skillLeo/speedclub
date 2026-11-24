<?php

namespace App\Services\Wrapped;

use App\Enums\VehicleStatus;
use App\Models\User;
use App\Models\Vehicle;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Collection;

/**
 * What every card of one member's Wrapped reads (m5.9e contract §3): the member, the season, the member's own cars (not deleted;
 * drafts and private cars included, as they are the member's own data) and whether the member is a sample account. Loaded once per
 * member and shared by the card builders, so a card never reads another member's garage.
 */
final class WrappedContext
{
    /** @var array<string, mixed> values one card computes and a later card reuses (the score card's car for the share card) */
    public array $shared = [];

    /**
     * The car each photo card is about (`share`, `score`, `build_spirit`; ADR-516 a). WrappedPayloadBuilder hands out their photos
     * after every card is built (WrappedPayloadBuilder::assignPhotos), so cards about the same car get different photos.
     *
     * @var array<string, Vehicle>
     */
    public array $photoCars = [];

    /**
     * @param  Collection<int, Vehicle>  $cars
     */
    public function __construct(
        public readonly User $member,
        public readonly Season $season,
        public readonly Collection $cars,
        public readonly CarbonImmutable $now,
    ) {}

    public static function for(User $member, Season $season, ?CarbonImmutable $now = null): self
    {
        $cars = Vehicle::query()
            ->where('owner_id', $member->id)
            ->with(['make', 'vehicleModel', 'generation', 'buildScore'])
            ->orderBy('id')
            ->get();

        return new self($member, $season, $cars, $now ?? CarbonImmutable::now());
    }

    public function isSample(): bool
    {
        return $this->member->getAttribute('is_sample') === true;
    }

    /**
     * @return list<string>
     */
    public function carIds(): array
    {
        return array_values($this->cars->pluck('id')->map(fn (mixed $id): string => (string) $id)->all());
    }

    /**
     * @return Collection<int, Vehicle>
     */
    public function publishedCars(): Collection
    {
        return $this->cars->filter(fn (Vehicle $car): bool => $car->status === VehicleStatus::Published)->values();
    }

    public function car(string $id): ?Vehicle
    {
        return $this->cars->first(fn (Vehicle $car): bool => $car->id === $id);
    }

    /** The end of what may count: the season's end, or now while the season still runs (a December release of the year). */
    public function untilUtc(): CarbonImmutable
    {
        return $this->season->toUtc()->min($this->now->utc());
    }
}
