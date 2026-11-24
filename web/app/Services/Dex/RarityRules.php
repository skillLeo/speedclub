<?php

namespace App\Services\Dex;

use App\Enums\Rarity;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Models\Vehicle;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Rarity tiers (10 §16.2, m5.9b contract §6): Street by default; Rare at most `rare.max_same_generation` public cars of the same
 * generation; Legend the only public car of its generation; Tuned a Build Score ≥ 500 and Legend ≥ 850, read from M5.9c's build_scores
 * once that table exists (until then no car reaches them by score). Ghost is the owner's opt-in and overrides the computed tier when
 * shown (shown()); the stored tier stays the computed one, so it is back when ghost mode goes off. The nightly recompute
 * (App\Services\Dex\DexNightly) sets every published car's tier in bulk with tier(); a car spotted before its first run is computed at
 * the spot (refresh()).
 */
final class RarityRules
{
    private ?bool $hasScores = null;

    /**
     * The thresholds as the app's "So funktioniert Seltenheit" shows them (GET rarity-rules).
     *
     * @return array{tuned: array{min_build_score: int}, rare: array{max_same_generation: int}, legend: array{min_build_score: int, unique_generation: bool}, ghost: array{opt_in: bool}}
     */
    public function thresholds(): array
    {
        return [
            'tuned' => ['min_build_score' => config()->integer('speedclub.dex.rarity.tuned.min_build_score')],
            'rare' => ['max_same_generation' => config()->integer('speedclub.dex.rarity.rare.max_same_generation')],
            'legend' => [
                'min_build_score' => config()->integer('speedclub.dex.rarity.legend.min_build_score'),
                'unique_generation' => config()->boolean('speedclub.dex.rarity.legend.unique_generation'),
            ],
            'ghost' => ['opt_in' => config()->boolean('speedclub.dex.rarity.ghost.opt_in')],
        ];
    }

    /**
     * The computed tier, ghost aside.
     */
    public function compute(Vehicle $vehicle): Rarity
    {
        $generation = $vehicle->getAttribute('generation_id');
        $count = null;

        if ($generation !== null) {
            // Public cars of the generation, this one included when it is public (an unlisted car counts as one more).
            $others = Vehicle::query()
                ->where('generation_id', $generation)
                ->where('status', VehicleStatus::Published)
                ->where('visibility', Visibility::Public)
                ->whereKeyNot($vehicle->id)
                ->count();
            $count = $others + 1;
        }

        return $this->tier($count, $this->scores([$vehicle->id])[$vehicle->id] ?? null);
    }

    /**
     * The tier of a car from the number of public cars of its generation (itself counted once; null without a generation) and its Build
     * Score (null without one). Highest applicable wins: legend > rare > tuned > street.
     */
    public function tier(?int $sameGeneration, ?int $buildScore): Rarity
    {
        $rules = $this->thresholds();

        return match (true) {
            $rules['legend']['unique_generation'] && $sameGeneration === 1,
            $buildScore !== null && $buildScore >= $rules['legend']['min_build_score'] => Rarity::Legend,
            $sameGeneration !== null && $sameGeneration <= $rules['rare']['max_same_generation'] => Rarity::Rare,
            $buildScore !== null && $buildScore >= $rules['tuned']['min_build_score'] => Rarity::Tuned,
            default => Rarity::Street,
        };
    }

    /**
     * Build Scores (M5.9c's build_scores.total) by vehicle id. Until M5.9c creates that table this reads nothing, so no car reaches
     * Tuned or Legend by score; the table check runs once per instance (the nightly run makes one).
     *
     * @param  list<string>  $vehicleIds
     * @return array<string, int>
     */
    public function scores(array $vehicleIds): array
    {
        $this->hasScores ??= Schema::hasTable('build_scores');

        if (! $this->hasScores || $vehicleIds === []) {
            return [];
        }

        return array_map(intval(...), DB::table('build_scores')->whereIn('vehicle_id', $vehicleIds)->pluck('total', 'vehicle_id')->all());
    }

    public function refresh(Vehicle $vehicle): Rarity
    {
        $rarity = $this->compute($vehicle);
        Vehicle::withTrashed()->whereKey($vehicle->id)->toBase()->update(['rarity' => $rarity->value, 'rarity_computed_at' => now()]);
        $vehicle->forceFill(['rarity' => $rarity, 'rarity_computed_at' => now()]);
        $vehicle->syncOriginalAttributes(['rarity', 'rarity_computed_at']);

        return $rarity;
    }

    /**
     * The tier a card shows: ghost for a ghost car, else the computed one (street until the first computation).
     */
    public static function shown(Vehicle $vehicle): Rarity
    {
        if ($vehicle->ghost_mode === true) {
            return Rarity::Ghost;
        }

        $rarity = $vehicle->getAttribute('rarity');

        return $rarity instanceof Rarity ? $rarity : Rarity::Street;
    }
}
