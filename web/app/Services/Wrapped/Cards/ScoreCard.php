<?php

namespace App\Services\Wrapped\Cards;

use App\Models\Vehicle;
use App\Services\BuildScore\BuildScoreCalculator;
use App\Services\Garage\VehiclePresenter;
use App\Services\Wrapped\WrappedContext;
use Illuminate\Support\Facades\DB;

/**
 * Card 4: Build Score progress of the member's best car over the season (contract §3), from build_score_history (M5.9c: one row per
 * Berlin day with a change). `from` = the car's total before the season (0 for a car that started in it), `to` = its last total in the
 * season; the stages follow `build_score.stages`. Only a published car whose score rose in the season: no change, or a drop, leaves
 * the card out (never a card that shames). Among several cars the one with the highest `to` (then the larger rise, the main car,
 * the older id) is the best car, and the share card shows it too. Its photo (ADR-516 a) is one of that car's, handed out by
 * WrappedPayloadBuilder::assignPhotos as `media_id` and read again per request.
 */
final class ScoreCard implements WrappedCard
{
    public const SHARED_CAR = 'score_car';

    public function __construct(
        private readonly BuildScoreCalculator $calculator,
        private readonly VehiclePresenter $presenter,
    ) {}

    public function kind(): string
    {
        return 'score';
    }

    public function build(WrappedContext $context): ?array
    {
        $best = null;

        foreach ($context->publishedCars() as $car) {
            $progress = $this->progress($car, $context);

            if ($progress === null) {
                continue;
            }

            $key = [$progress['to'], $progress['to'] - $progress['from'], $car->is_main ? 1 : 0];

            if ($best === null || $key > $best['key']) {
                $best = ['key' => $key, 'car' => $car, ...$progress];
            }
        }

        if ($best === null) {
            return null;
        }

        /** @var Vehicle $car */
        $car = $best['car'];
        $context->shared[self::SHARED_CAR] = $car->id;
        $context->photoCars['score'] = $car;

        return [
            'kind' => 'score',
            'vehicle_id' => $car->id,
            'vehicle_name' => $this->presenter->fullTitle($car),
            'from' => $best['from'],
            'to' => $best['to'],
            'stage_from' => $this->calculator->stage($best['from']),
            'stage_to' => $this->calculator->stage($best['to']),
        ];
    }

    /**
     * @return array{from: int, to: int}|null
     */
    private function progress(Vehicle $car, WrappedContext $context): ?array
    {
        $history = DB::table('build_score_history')->where('vehicle_id', $car->id);
        $to = (clone $history)
            ->where('day', '>=', $context->season->fromDate())
            ->where('day', '<=', $context->season->toDate())
            ->orderByDesc('day')
            ->value('total');

        if (! is_numeric($to)) {
            return null;
        }

        $from = (clone $history)->where('day', '<', $context->season->fromDate())->orderByDesc('day')->value('total');
        $from = is_numeric($from) ? (int) $from : 0;

        return (int) $to > $from ? ['from' => $from, 'to' => (int) $to] : null;
    }
}
