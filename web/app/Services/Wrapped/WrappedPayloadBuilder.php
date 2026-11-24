<?php

namespace App\Services\Wrapped;

use App\Models\User;
use App\Services\Wrapped\Cards\BuildSpiritCard;
use App\Services\Wrapped\Cards\IntroCard;
use App\Services\Wrapped\Cards\PercentileCard;
use App\Services\Wrapped\Cards\ScansCard;
use App\Services\Wrapped\Cards\ScoreCard;
use App\Services\Wrapped\Cards\ShareCard;
use App\Services\Wrapped\Cards\SpotsCard;
use App\Services\Wrapped\Cards\TopModCard;
use App\Services\Wrapped\Cards\TreffenCard;
use App\Services\Wrapped\Cards\WrappedCard;
use Carbon\CarbonImmutable;

/**
 * The stored payload of one member's Wrapped (m5.9e contract §3, version 1): `{v, season_key, window: {from, to}, cards: [...]}` with the
 * cards in the owner's order (intro · spots · scans · score · top_mod · treffen · build_spirit · percentile · share). A card without data
 * is left out. Null when the member had no activity in the season: none of spots, scans, score, top mod or meets, and no Build Spirit
 * from the season itself. The intro is always there and the share card closes the story whenever the member has a published car.
 *
 * Photos of the member's own cars (ADR-516 a) are handed out after every card is built (assignPhotos): the intro and the share card
 * show the lead car's first usable photo (the cover when it may be shown); the score card and then the Build Spirit card take the next
 * usable photo of their car (WrappedMedia::carPhotos: gallery, then its mods' photos) that no earlier card and not the top mod card
 * took, so cards about the same car show different photos; only a car without a further usable photo repeats the last one it gave.
 * Only media ids are stored (read again per request by WrappedPresenter).
 */
final class WrappedPayloadBuilder
{
    public const VERSION = 1;

    /** Cards that prove activity in the season. */
    private const ACTIVITY = ['spots', 'scans', 'score', 'top_mod', 'treffen'];

    /** @var list<WrappedCard> */
    private array $cards;

    public function __construct(
        private readonly WrappedMedia $media,
        IntroCard $intro,
        SpotsCard $spots,
        ScansCard $scans,
        ScoreCard $score,
        TopModCard $topMod,
        TreffenCard $treffen,
        BuildSpiritCard $spirit,
        PercentileCard $percentile,
        ShareCard $share,
    ) {
        $this->cards = [$intro, $spots, $scans, $score, $topMod, $treffen, $spirit, $percentile, $share];
    }

    /**
     * @return array{v: int, season_key: string, window: array{from: string, to: string}, cards: list<array<string, mixed>>}|null
     */
    public function build(User $member, Season $season, ?CarbonImmutable $now = null): ?array
    {
        $context = WrappedContext::for($member, $season, $now);
        $cards = [];

        foreach ($this->cards as $card) {
            $built = $card->build($context);

            if ($built !== null) {
                $cards[] = $built;
            }
        }

        if (! $this->hasActivity($cards)) {
            return null;
        }

        // After the activity check: a member without a Wrapped costs no photo queries (hasActivity never reads media_id).
        $cards = $this->assignPhotos($cards, $context);

        return [
            'v' => self::VERSION,
            'season_key' => $season->key,
            'window' => ['from' => $season->fromDate(), 'to' => $season->toDate()],
            'cards' => $cards,
        ];
    }

    /**
     * Writes `media_id` on the intro, score, Build Spirit and share cards (see the class comment). The intro is about the share card's
     * car; spots and Treffen never get one.
     *
     * @param  list<array<string, mixed>>  $cards
     * @return list<array<string, mixed>>
     */
    private function assignPhotos(array $cards, WrappedContext $context): array
    {
        $owner = $context->member->id;
        /** @var array<string, list<string>> $available per car id */
        $available = [];
        /** @var array<string, list<string>> $taken per car id */
        $taken = [];
        $chosen = [];
        $topMod = array_values(array_filter($cards, fn (array $card): bool => ($card['kind'] ?? null) === 'top_mod'))[0] ?? [];
        $avoid = array_values(array_filter([$topMod['before_media_id'] ?? null, $topMod['after_media_id'] ?? null], is_string(...)));

        foreach (['intro' => $context->photoCars['share'] ?? null, 'score' => $context->photoCars['score'] ?? null, 'build_spirit' => $context->photoCars['build_spirit'] ?? null] as $kind => $car) {
            if ($car === null) {
                $chosen[$kind] = null;

                continue;
            }

            $photos = $available[$car->id] ??= $this->media->carPhotos($car, $owner);
            $free = array_values(array_diff($photos, $taken[$car->id] ?? [], $avoid));
            $last = array_slice($taken[$car->id] ?? [], -1)[0] ?? ($photos[0] ?? null);
            $chosen[$kind] = $free[0] ?? $last;

            if ($chosen[$kind] !== null) {
                $taken[$car->id][] = $chosen[$kind];
            }
        }

        $chosen['share'] = $chosen['intro'];

        return array_map(
            fn (array $card): array => array_key_exists((string) ($card['kind'] ?? ''), $chosen) ? [...$card, 'media_id' => $chosen[(string) $card['kind']]] : $card,
            $cards,
        );
    }

    /**
     * @param  list<array<string, mixed>>  $cards
     */
    private function hasActivity(array $cards): bool
    {
        foreach ($cards as $card) {
            if (in_array($card['kind'] ?? null, self::ACTIVITY, true) || (($card['kind'] ?? null) === 'build_spirit' && ($card['basis'] ?? null) === 'season')) {
                return true;
            }
        }

        return false;
    }
}
