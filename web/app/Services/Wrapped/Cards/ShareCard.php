<?php

namespace App\Services\Wrapped\Cards;

use App\Models\Vehicle;
use App\Services\Garage\VehiclePresenter;
use App\Services\Wrapped\WrappedContext;

/**
 * Card 9, the last one: the member's car to share (contract §3): the score card's car, else the published car with the highest Build
 * Score, else the main car, else the oldest published one. Name, Dex number, current score and stage; the photo is stored as an id
 * (WrappedPayloadBuilder::assignPhotos: blurred or declined plates only; the intro card shows the same one) and `qr_url` (the car's page
 * `/v/{slug}`, never the sticker code: ADR-514) is read per request, so a car made private or a deleted photo never shows. Without a
 * published car there is no share card (a member who only spots).
 */
final class ShareCard implements WrappedCard
{
    public function __construct(
        private readonly VehiclePresenter $presenter,
    ) {}

    public function kind(): string
    {
        return 'share';
    }

    public function build(WrappedContext $context): ?array
    {
        $car = $this->car($context);

        if ($car === null) {
            return null;
        }

        $score = $car->buildScore;
        // Its photo (`media_id`, the lead car's first usable photo, the intro's too) is handed out by WrappedPayloadBuilder::assignPhotos.
        $context->photoCars['share'] = $car;

        return [
            'kind' => 'share',
            'vehicle_id' => $car->id,
            'vehicle_name' => $this->presenter->fullTitle($car),
            'dex_number' => $car->dex_number,
            'score' => $score?->total,
            'stage' => $score?->stage,
        ];
    }

    private function car(WrappedContext $context): ?Vehicle
    {
        $published = $context->publishedCars();
        $chosen = $context->shared[ScoreCard::SHARED_CAR] ?? null;

        if (is_string($chosen) && ($car = $published->first(fn (Vehicle $car): bool => $car->id === $chosen)) !== null) {
            return $car;
        }

        return $published->sortBy([
            fn (Vehicle $a, Vehicle $b): int => (int) $b->buildScore?->total <=> (int) $a->buildScore?->total,
            fn (Vehicle $a, Vehicle $b): int => (int) $b->is_main <=> (int) $a->is_main,
            fn (Vehicle $a, Vehicle $b): int => (string) $a->getRawOriginal('published_at') <=> (string) $b->getRawOriginal('published_at'),
            ['id', 'asc'],
        ])->first();
    }
}
