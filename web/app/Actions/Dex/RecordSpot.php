<?php

namespace App\Actions\Dex;

use App\Enums\Bundesland;
use App\Enums\ErrorCode;
use App\Enums\QrScanState;
use App\Enums\SpotSource;
use App\Exceptions\ApiException;
use App\Models\DeCity;
use App\Models\Spot;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\BuildScore\BuildScores;
use App\Services\Dex\CityMatcher;
use App\Services\Dex\DexNumbers;
use App\Services\Dex\DexSets;
use App\Services\Dex\RarityRules;
use App\Services\Dex\SpotClock;
use App\Services\Dex\SpotOutcome;
use App\Services\Dex\SpotStats;
use App\Services\Progress\XpHooks;
use App\Services\Qr\QrResolver;
use Illuminate\Support\Facades\DB;

/**
 * POST spots (10 §16.2, m5.9b contract §2): one in-app scan of another member's sticker.
 *
 * The code resolves like /c/{code} (case-insensitive Crockford): unknown → 404 qr_not_found; a revoked or inactive code, a draft, a
 * deleted, private or hidden car and a block either way → 409 spot_unavailable (one answer for all, ADR-141); the member's own car → 409
 * spot_own_car; a car whose owner paused spotting → 409 spotting_paused. Ghost cars can be spotted: that is the in-person reveal.
 *
 * Under the car's row lock: the same car by the same member within 24 h answers with that spot (200, meta.duplicate); an account
 * younger than 24 h gets a spot that does not count (no Dex entry, no stats, no set progress, no foil), and so does a real member's spot
 * of a sample car or a sample owner's car (CR-P5G-07, "samples never earn": the scan still opens the card, `reason` "sample_car"); the
 * first three unique counted
 * spotters keep the "First Spotter" foil; a spot from 22:00 to 06:00 Europe/Berlin is a night spot. A counted spot updates the car's
 * stats and the member's set progress at once and gives the car its Dex number and first rarity when it has none yet.
 *
 * Location: a city id (its Bundesland wins) or a city name matched to de_cities; never a coordinate and never free text.
 */
class RecordSpot
{
    /** A backstop against a deadlock: the closure starts with a fresh read, and a rollback undoes all it wrote. */
    private const ATTEMPTS = 3;

    public function __construct(
        private readonly QrResolver $resolver,
        private readonly CityMatcher $cities,
        private readonly DexNumbers $numbers,
        private readonly RarityRules $rarity,
        private readonly SpotStats $stats,
        private readonly DexSets $sets,
    ) {}

    /**
     * @param  array{code: string, city_id?: int|null, city?: string|null, bundesland?: string|null}  $input  validated
     */
    public function handle(User $spotter, array $input): SpotOutcome
    {
        $vehicle = $this->spottable($spotter, $input['code']);
        [$city, $bundesland] = $this->place($input);

        // The Dex counter row exists before the locking transaction (DexNumbers::prepare).
        $this->numbers->prepare();

        return DB::transaction(function () use ($spotter, $vehicle, $city, $bundesland): SpotOutcome {
            /** @var Vehicle|null $locked */
            $locked = Vehicle::query()->whereKey($vehicle->id)->lockForUpdate()->first();

            // A delete or a pause that committed while this request waited for the lock.
            if ($locked === null) {
                throw new ApiException(ErrorCode::SpotUnavailable);
            }

            if ($locked->spotting_paused) {
                throw new ApiException(ErrorCode::SpottingPaused);
            }

            $duplicate = Spot::query()
                ->where('vehicle_id', $locked->id)
                ->where('spotter_id', $spotter->id)
                ->where('created_at', '>=', now()->subHours(config()->integer('speedclub.dex.duplicate_hours')))
                ->orderByDesc('id')
                ->first();

            $sample = self::sampleCar($locked, $spotter);

            if ($duplicate instanceof Spot) {
                return new SpotOutcome($duplicate, false, true, $duplicate->is_first_three, [], $duplicate->counted ? null : ($sample ? 'sample_car' : 'account_too_new'));
            }

            $counted = ! $sample && $spotter->created_at !== null && $spotter->created_at->lte(now()->subHours(config()->integer('speedclub.dex.young_account_hours')));
            $before = Spot::query()->where('vehicle_id', $locked->id)->where('spotter_id', $spotter->id)->where('counted', true)->exists();
            $firstThree = $counted && ! $before
                && Spot::query()->where('vehicle_id', $locked->id)->where('counted', true)->distinct()->count('spotter_id') < config()->integer('speedclub.dex.first_spotters');

            $spot = new Spot;
            $spot->forceFill([
                'vehicle_id' => $locked->id,
                'spotter_id' => $spotter->id,
                'city_id' => $city?->id,
                'bundesland' => $city->bundesland ?? $bundesland,
                'is_first_three' => $firstThree,
                'counted' => $counted,
                'is_night' => SpotClock::isNight(now()),
                'source' => SpotSource::Scanner,
                'created_at' => now(),
            ])->save();

            if (! $counted) {
                return new SpotOutcome($spot, false, false, false, [], $sample ? 'sample_car' : 'account_too_new');
            }

            $this->numbers->ensure($locked);

            if ($locked->getAttribute('rarity_computed_at') === null) {
                $this->rarity->refresh($locked);
            }

            $this->stats->recompute($locked->id);
            // M5.9c: a counted spotter counts for the car's Build Score (each member once).
            app(BuildScores::class)->touch($locked->id);
            $moved = $this->sets->refresh($spotter, $locked);
            // M5.9d: 10 XP for the member's first counted spot of this car; the owner's Street Famous badges.
            app(XpHooks::class)->spotCounted($spotter, $spot, $locked);

            return new SpotOutcome($spot, ! $before, false, $firstThree, $moved);
        }, self::ATTEMPTS);
    }

    /**
     * CR-P5G-07: whether $vehicle is a sample (the car or its owner) that $spotter, a real member, may scan but never earn from. A sample
     * spotter (the staging demo) keeps counting among samples.
     */
    public static function sampleCar(Vehicle $vehicle, User $spotter): bool
    {
        if ($spotter->getAttribute('is_sample') === true) {
            return false;
        }

        return $vehicle->getAttribute('is_sample') === true
            || User::query()->whereKey($vehicle->owner_id)->where('is_sample', true)->exists();
    }

    /**
     * @throws ApiException 404 qr_not_found, 409 spot_unavailable / spot_own_car / spotting_paused
     */
    private function spottable(User $spotter, string $code): Vehicle
    {
        $resolution = $this->resolver->resolve($code, $spotter);

        if ($resolution->state === QrScanState::NotFound && $resolution->qr === null) {
            throw new ApiException(ErrorCode::QrNotFound);
        }

        $vehicle = $resolution->vehicle;

        if ($resolution->state !== QrScanState::Active || ! $vehicle instanceof Vehicle) {
            throw new ApiException(ErrorCode::SpotUnavailable);
        }

        if ($vehicle->isOwnedBy($spotter)) {
            throw new ApiException(ErrorCode::SpotOwnCar);
        }

        if ($vehicle->spotting_paused) {
            throw new ApiException(ErrorCode::SpottingPaused);
        }

        return $vehicle;
    }

    /**
     * @param  array{city_id?: int|null, city?: string|null, bundesland?: string|null}  $input
     * @return array{0: DeCity|null, 1: Bundesland|null}
     */
    private function place(array $input): array
    {
        $bundesland = isset($input['bundesland']) ? Bundesland::tryFrom($input['bundesland']) : null;

        if (isset($input['city_id'])) {
            return [$this->cities->byId((int) $input['city_id']), $bundesland];
        }

        if (isset($input['city']) && trim($input['city']) !== '') {
            return [$this->cities->byName($input['city'], $bundesland), $bundesland];
        }

        return [null, $bundesland];
    }
}
