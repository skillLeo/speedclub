<?php

namespace App\Services\Wrapped;

use App\Enums\Bundesland;
use App\Http\Resources\V1\SpotCardResource;
use App\Models\Vehicle;
use App\Models\Wrapped;
use App\Services\Qr\QrCodes;
use App\Services\Qr\QrRenderer;

/**
 * The stored payload as the app reads it (m5.9e contract §3, mobile/src/api/queries/wrapped.ts): words in the request's language
 * (intro, Build Spirit, percentile, the Bundesland's short name), photos as media objects of their public variants (WrappedMedia,
 * checked again now) and the share card's page address `/v/{slug}` of the car now (ADR-514: never the sticker code, the card is
 * made for strangers). The intro, score and Build Spirit cards carry a photo of the member's own car the card is about (`image`,
 * ADR-516 a); spots and Treffen never do (other members' cars and covers). The cards keep their stored order and count, so
 * `cards/{n}.png` names the same card as position n here.
 */
final class WrappedPresenter
{
    public function __construct(
        private readonly WrappedMedia $media,
        private readonly QrCodes $codes,
        private readonly QrRenderer $renderer,
    ) {}

    /**
     * The share card's QR (ADR-514, SEC-P5G-01): the car's public page while anybody with the link may open it (published, not
     * private, owner visible), else null. Never the sticker code: a share card is posted where strangers read it, and a sticker code
     * proves standing at the car for STREET DEX.
     */
    public function pageUrl(?Vehicle $vehicle): ?string
    {
        if ($vehicle === null || ! $vehicle->isReachable() || $vehicle->owner?->isPubliclyVisible() !== true) {
            return null;
        }

        return $this->codes->pageUrl($vehicle);
    }

    /**
     * @return array{v: int, season_key: string, window: array{from: string, to: string}, member: array{display_name: string|null, username: string|null, avatar: array{url: string, thumbhash: string|null}|null}, cards: list<array<string, mixed>>, is_sample?: true}
     */
    public function present(Wrapped $wrapped): array
    {
        $payload = $wrapped->payload;
        $member = $wrapped->user;
        $window = is_array($payload['window'] ?? null) ? $payload['window'] : [];
        $displayName = $member->getAttribute('display_name');

        return [
            'v' => (int) ($payload['v'] ?? WrappedPayloadBuilder::VERSION),
            'season_key' => $wrapped->season_key,
            'window' => ['from' => (string) ($window['from'] ?? ''), 'to' => (string) ($window['to'] ?? '')],
            'member' => [
                'display_name' => is_string($displayName) && $displayName !== '' ? $displayName : null,
                'username' => $member->username,
                'avatar' => SpotCardResource::avatar($member->avatar),
            ],
            'cards' => array_map(fn (array $card): array => $this->card($card, $wrapped), $wrapped->cards()),
            ...($wrapped->is_sample ? ['is_sample' => true] : []),
        ];
    }

    /**
     * One card in the request's language. Without $media (the PNG path, which resolves its photo itself) the photos and the share
     * card's QR SVG are left null, so nothing is read twice.
     *
     * @param  array<string, mixed>  $card
     * @return array<string, mixed>
     */
    public function card(array $card, Wrapped $wrapped, bool $media = true): array
    {
        $owner = $wrapped->user_id;
        $kind = (string) ($card['kind'] ?? '');

        return match ($kind) {
            'intro' => [...$this->intro($card), 'image' => $media ? $this->carImage($card, $owner) : null],
            'spots' => [
                'kind' => 'spots',
                'count' => (int) ($card['count'] ?? 0),
                'unique_cars' => (int) ($card['unique_cars'] ?? 0),
                'cities' => array_values(array_map(strval(...), is_array($card['cities'] ?? null) ? $card['cities'] : [])),
                'rarest' => is_array($card['rarest'] ?? null) ? [
                    'dex_number' => is_numeric($card['rarest']['dex_number'] ?? null) ? (int) $card['rarest']['dex_number'] : null,
                    'rarity' => (string) ($card['rarest']['rarity'] ?? 'street'),
                    'vehicle_name' => (string) ($card['rarest']['vehicle_name'] ?? ''),
                    'make' => $this->text($card['rarest']['make'] ?? null),
                    'generation' => $this->text($card['rarest']['generation'] ?? null),
                ] : null,
            ],
            'scans' => [
                'kind' => 'scans',
                'sticker_scans' => (int) ($card['sticker_scans'] ?? 0),
                'profile_or_vehicle_views' => is_numeric($card['profile_or_vehicle_views'] ?? null) ? (int) $card['profile_or_vehicle_views'] : null,
                'top_city' => $this->text($card['top_city'] ?? null),
            ],
            'score' => [
                'kind' => 'score',
                'from' => (int) ($card['from'] ?? 0),
                'to' => (int) ($card['to'] ?? 0),
                'stage_from' => (int) ($card['stage_from'] ?? 1),
                'stage_to' => (int) ($card['stage_to'] ?? 1),
                'vehicle_name' => (string) ($card['vehicle_name'] ?? ''),
                'image' => $media ? $this->carImage($card, $owner) : null,
            ],
            'top_mod' => [
                'kind' => 'top_mod',
                'name' => (string) ($card['name'] ?? ''),
                'brand' => $this->text($card['brand'] ?? null),
                'before_media' => $media ? $this->media->present($this->media->usable($card['before_media_id'] ?? null, $owner)) : null,
                'after_media' => $media ? $this->media->present($this->media->usable($card['after_media_id'] ?? null, $owner)) : null,
                'vehicle_name' => (string) ($card['vehicle_name'] ?? ''),
            ],
            'treffen' => [
                'kind' => 'treffen',
                'attended' => (int) ($card['attended'] ?? 0),
                'names' => array_values(array_map(strval(...), is_array($card['names'] ?? null) ? $card['names'] : [])),
            ],
            'build_spirit' => [...$this->spirit($card), 'image' => $media ? $this->carImage($card, $owner) : null],
            'percentile' => [
                'kind' => 'percentile',
                'bundesland' => $this->bundesland($card['bundesland'] ?? null),
                'percentile' => (string) __('wrapped.percentile', ['value' => (int) ($card['top'] ?? 0)]),
                'metric' => 'build_score',
            ],
            'share' => $this->share($card, $owner, $media),
            default => ['kind' => $kind],
        };
    }

    /**
     * @param  array<string, mixed>  $card
     * @return array{kind: string, title: string, subtitle: string}
     */
    private function intro(array $card): array
    {
        $kind = ($card['season'] ?? null) === 'jahr' ? 'jahr' : 'saison';
        $year = (int) ($card['year'] ?? 0);

        return [
            'kind' => 'intro',
            'title' => (string) __("wrapped.intro.$kind.title", ['year' => $year]),
            'subtitle' => (string) __("wrapped.intro.$kind.subtitle", ['year' => $year]),
        ];
    }

    /**
     * @param  array<string, mixed>  $card
     * @return array{kind: string, key: string, title: string, explanation: string}
     */
    private function spirit(array $card): array
    {
        $key = (string) ($card['key'] ?? '');
        /** @var array<string, int|string> $params */
        $params = is_array($card['params'] ?? null) ? $card['params'] : [];
        $count = (int) ($params['count'] ?? 0);
        $explanation = $key === 'track_day_tactician'
            ? trans_choice('wrapped.spirit.track_day_tactician.explanation', $count, ['count' => $count])
            : __("wrapped.spirit.$key.explanation", array_map(strval(...), $params));

        return [
            'kind' => 'build_spirit',
            'key' => $key,
            'title' => (string) __("wrapped.spirit.$key.title"),
            'explanation' => (string) $explanation,
        ];
    }

    /**
     * @param  array<string, mixed>  $card
     * @return array<string, mixed>
     */
    private function share(array $card, string $owner, bool $media = true): array
    {
        $vehicleId = is_string($card['vehicle_id'] ?? null) ? $card['vehicle_id'] : null;
        $vehicle = $vehicleId === null ? null : Vehicle::query()->where('owner_id', $owner)->find($vehicleId);
        $qr = $this->pageUrl($vehicle);

        return [
            'kind' => 'share',
            'vehicle_name' => (string) ($card['vehicle_name'] ?? ''),
            'dex_number' => is_numeric($card['dex_number'] ?? null) ? (int) $card['dex_number'] : null,
            'score' => is_numeric($card['score'] ?? null) ? (int) $card['score'] : null,
            'stage' => is_numeric($card['stage'] ?? null) ? (int) $card['stage'] : null,
            'qr_url' => $qr,
            // The same address drawn as a QR (black on white SVG, QrRenderer), so the phone's own share card needs no sticker code.
            'qr_svg' => $qr === null || ! $media ? null : $this->renderer->svg($qr),
            'image' => $vehicle instanceof Vehicle && $media ? $this->media->present($this->media->usable($card['media_id'] ?? null, $owner)) : null,
        ];
    }

    /**
     * The photo of the member's own car on the intro, score and Build Spirit cards (ADR-516 a): the stored `media_id` read again now
     * (WrappedMedia::usableCarPhoto: own, ready, not rejected, plate decision made, car not deleted), else null. A row stored before
     * ADR-516 has no `media_id` and answers null until it is generated again. Spots and Treffen cards never carry one.
     *
     * @param  array<string, mixed>  $card
     * @return array{url: string, variants: list<array{width: int, url: string}>, blurhash: string|null, thumbhash: string|null, focal_x: float|null, focal_y: float|null}|null
     */
    public function carImage(array $card, string $owner): ?array
    {
        return $this->media->present($this->media->usableCarPhoto($card['media_id'] ?? null, $owner));
    }

    private function bundesland(mixed $code): string
    {
        $state = Bundesland::tryFrom((string) $code);

        return $state === null ? '' : (string) __('build_score.bundesland.'.$state->value);
    }

    private function text(mixed $value): ?string
    {
        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }
}
