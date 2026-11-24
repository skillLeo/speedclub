<?php

namespace App\Services\Wrapped;

use App\Models\Media;
use App\Models\Vehicle;
use App\Models\Wrapped;
use App\Services\Media\MediaService;
use App\Services\Qr\QrRenderer;
use App\Services\Signature\ShareCardCanvas;
use App\Support\BrandFiles;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Facades\Storage;
use Throwable;

/**
 * The server's card images of a Wrapped (m5.9e contract §5, GET me/wrapped/{season}/cards/{n}.png): 1080 × 1920, n = the card's
 * 1-based position in the payload. The member web shares these; the phone draws its own (view-shot). Owner only, so the files live on
 * the private disk under wrapped/{member}/{season}/, named after a keyed hash of everything the card shows (its words in the request's
 * language, photo and the page address of its QR code): the same card is drawn once, a changed one gets a new file. A new payload, a removed Wrapped and the
 * daily prune (members without a Wrapped of that season) delete the files. Photos are the blurred masters' variants only (ADR-509).
 * The intro, score, top mod and Build Spirit cards draw their photo across the upper part with the share card's scrims
 * (WrappedCardCanvas::photo; ADR-516 a), the share card is the VEH-07 story card; spots and Treffen stay typographic.
 *
 * SEC-P5G-09 (nothing unblurred or deleted survives, ADR-509): a file is named `{n}-{locale}-{hash}.png`, and drawing a new one removes
 * the older files of the same card and language; a pixelated, deleted or newly decided photo of the member drops every cached card of
 * the member at once (forgetMember(), from BlurPhoto, DeleteMedia and KeepPlateCheckPhoto).
 */
final class WrappedCardImages
{
    /**
     * Part of the hash: raising it redraws every card after a change to the drawing. 2: the QR shows the page, not the sticker (ADR-514).
     * 3: ADR-516 a: photos on intro, score and Build Spirit (PHOTO_SHORT). 4: R5-2e, the share card's canvas (safe areas, legibility floor).
     * 5: the share card's story scrim (one even ramp).
     */
    private const VERSION = 5;

    private const DIRECTORY = 'wrapped';

    public function __construct(
        private readonly WrappedCardCanvas $canvas,
        private readonly ShareCardCanvas $shareCanvas,
        private readonly WrappedPresenter $presenter,
        private readonly WrappedMedia $media,
        private readonly MediaService $mediaService,
        private readonly QrRenderer $renderer,
    ) {}

    /**
     * The PNG of card $n and its content hash (the ETag), or null when there is no such card.
     *
     * @return array{png: string, hash: string}|null
     */
    public function png(Wrapped $wrapped, int $n): ?array
    {
        $stored = $wrapped->cards()[$n - 1] ?? null;

        if ($stored === null) {
            return null;
        }

        $spec = $this->spec($wrapped, $stored);
        $hash = substr(hash_hmac('sha256', (string) json_encode(['v' => self::VERSION, 'brand' => BrandFiles::logoVersion(), 'locale' => app()->getLocale(), 'n' => $n, ...$this->hashable($spec)]), config()->string('app.key')), 0, 40);
        $prefix = $n.'-'.app()->getLocale().'-';
        $path = $this->directory($wrapped->user_id, $wrapped->season_key).'/'.$prefix.$hash.'.png';

        try {
            $cached = $this->disk()->get($path);

            if (is_string($cached) && $cached !== '') {
                return ['png' => $cached, 'hash' => $hash];
            }
        } catch (Throwable $exception) {
            report($exception);
        }

        $png = $this->draw($spec);

        try {
            $this->disk()->put($path, $png);
            $this->removeSuperseded($wrapped, $prefix, $path);
        } catch (Throwable $exception) {
            report($exception);
        }

        return ['png' => $png, 'hash' => $hash];
    }

    /**
     * Every cached card of the member, all seasons: one of their photos was pixelated, deleted or got its plate decision.
     */
    public function forgetMember(?string $userId): void
    {
        if ($userId === null || $userId === '') {
            return;
        }

        try {
            $this->disk()->deleteDirectory(self::DIRECTORY.'/'.strtolower($userId));
        } catch (Throwable $exception) {
            report($exception);
        }
    }

    public function forget(string $userId, string $seasonKey): void
    {
        try {
            $this->disk()->deleteDirectory($this->directory($userId, $seasonKey));
        } catch (Throwable $exception) {
            report($exception);
        }
    }

    /**
     * Daily: the folders of members or seasons without a Wrapped (deleted accounts, removed rows). Returns the folders removed.
     */
    public function prune(): int
    {
        $removed = 0;

        foreach ($this->disk()->directories(self::DIRECTORY) as $memberDirectory) {
            $userId = basename($memberDirectory);
            $seasons = Wrapped::query()->where('user_id', $userId)->pluck('season_key')->all();

            foreach ($this->disk()->directories($memberDirectory) as $seasonDirectory) {
                if (! in_array(basename($seasonDirectory), $seasons, true)) {
                    $this->disk()->deleteDirectory($seasonDirectory);
                    $removed++;
                }
            }

            if ($seasons === []) {
                $this->disk()->deleteDirectory($memberDirectory);
            }
        }

        return $removed;
    }

    /**
     * @param  array<string, mixed>  $stored
     * @return array{share: bool, logo: bool, eyebrow: string, headline: string, numeral: bool, lines: list<string>, footer: string, photo: Media|null, qr: string|null, score: array{total: int, stage: int}|null, dex: int|null, photo_height: int}
     */
    private function spec(Wrapped $wrapped, array $stored): array
    {
        // N-2: the words only; each photo is read once below.
        $card = $this->presenter->card($stored, $wrapped, media: false);
        $season = Season::from($wrapped->season_key);
        $footer = (string) __('wrapped.season.'.$season->kind, ['year' => $season->year]);
        $base = ['share' => false, 'logo' => false, 'eyebrow' => '', 'headline' => '', 'numeral' => false, 'lines' => [], 'footer' => $footer, 'photo' => null, 'qr' => null, 'score' => null, 'dex' => null, 'photo_height' => 1080];
        // ADR-516 a: the intro, score and Build Spirit photo is shorter than the top mod's, so the numeral, text and footer keep their room.
        $short = WrappedCardCanvas::PHOTO_SHORT;
        $owner = $wrapped->user_id;
        $text = fn (mixed $value): string => is_scalar($value) ? (string) $value : '';

        return match ($card['kind']) {
            'intro' => [...$base, 'logo' => true, 'eyebrow' => $footer, 'headline' => $text($card['title'] ?? ''), 'lines' => [$text($card['subtitle'] ?? '')], 'footer' => '', 'photo' => $this->carPhoto($stored, $owner), 'photo_height' => $short],
            'spots' => [...$base,
                'eyebrow' => (string) __('wrapped.card.spots.eyebrow'),
                'headline' => $this->number($card['count'] ?? 0),
                'numeral' => true,
                'lines' => array_values(array_filter([
                    trans_choice('wrapped.card.spots.cars', (int) ($card['unique_cars'] ?? 0), ['count' => (int) ($card['unique_cars'] ?? 0)]),
                    implode(' · ', is_array($card['cities'] ?? null) ? $card['cities'] : []),
                    is_array($card['rarest'] ?? null) ? __('wrapped.card.spots.rarest').': '.$text($card['rarest']['vehicle_name'] ?? '') : '',
                ])),
            ],
            'scans' => [...$base,
                'eyebrow' => (string) __('wrapped.card.scans.eyebrow'),
                'headline' => $this->number($card['sticker_scans'] ?? 0),
                'numeral' => true,
                'lines' => array_values(array_filter([
                    is_int($card['profile_or_vehicle_views'] ?? null) ? (string) __('wrapped.card.scans.views', ['count' => $this->number($card['profile_or_vehicle_views'])]) : '',
                    is_string($card['top_city'] ?? null) ? (string) __('wrapped.card.scans.top_city', ['city' => $card['top_city']]) : '',
                ])),
            ],
            'score' => [...$base,
                'eyebrow' => (string) __('wrapped.card.score.eyebrow'),
                'headline' => $this->number($card['from'] ?? 0).' – '.$this->number($card['to'] ?? 0),
                'numeral' => true,
                'lines' => [
                    ($card['stage_from'] ?? null) === ($card['stage_to'] ?? null)
                        ? (string) __('wrapped.card.score.same_stage', ['stage' => $text($card['stage_to'] ?? '')])
                        : (string) __('wrapped.card.score.stage', ['from' => $text($card['stage_from'] ?? ''), 'to' => $text($card['stage_to'] ?? '')]),
                    $text($card['vehicle_name'] ?? ''),
                ],
                'photo' => $this->carPhoto($stored, $owner),
                'photo_height' => $short,
            ],
            'top_mod' => [...$base,
                'eyebrow' => (string) __('wrapped.card.top_mod.eyebrow'),
                'headline' => $text($card['name'] ?? ''),
                'lines' => array_values(array_filter([$text($card['brand'] ?? ''), $text($card['vehicle_name'] ?? '')])),
                'photo' => $this->media->usable($stored['after_media_id'] ?? null, $owner) ?? $this->media->usable($stored['before_media_id'] ?? null, $owner),
            ],
            'treffen' => [...$base,
                'eyebrow' => trans_choice('wrapped.card.treffen.eyebrow', (int) ($card['attended'] ?? 0)),
                'headline' => $this->number($card['attended'] ?? 0),
                'numeral' => true,
                'lines' => array_values(array_map($text, is_array($card['names'] ?? null) ? $card['names'] : [])),
            ],
            'build_spirit' => [...$base, 'eyebrow' => (string) __('wrapped.card.build_spirit.eyebrow'), 'headline' => $text($card['title'] ?? ''), 'lines' => [$text($card['explanation'] ?? '')], 'photo' => $this->carPhoto($stored, $owner), 'photo_height' => $short],
            'percentile' => [...$base,
                'eyebrow' => (string) __('wrapped.card.percentile.eyebrow', ['bundesland' => $text($card['bundesland'] ?? '')]),
                'headline' => $text($card['percentile'] ?? ''),
                'numeral' => true,
            ],
            'share' => $this->shareSpec($base, $card, $stored, $owner),
            default => [...$base, 'headline' => $footer],
        };
    }

    /**
     * @param  array{share: bool, logo: bool, eyebrow: string, headline: string, numeral: bool, lines: list<string>, footer: string, photo: Media|null, qr: string|null, score: array{total: int, stage: int}|null, dex: int|null, photo_height: int}  $base
     * @param  array<string, mixed>  $card
     * @param  array<string, mixed>  $stored
     * @return array{share: bool, logo: bool, eyebrow: string, headline: string, numeral: bool, lines: list<string>, footer: string, photo: Media|null, qr: string|null, score: array{total: int, stage: int}|null, dex: int|null, photo_height: int}
     */
    private function shareSpec(array $base, array $card, array $stored, string $owner): array
    {
        $vehicleId = is_string($stored['vehicle_id'] ?? null) ? $stored['vehicle_id'] : null;
        $vehicle = $vehicleId === null ? null : Vehicle::query()->where('owner_id', $owner)->find($vehicleId);
        $score = is_int($card['score'] ?? null) && is_int($card['stage'] ?? null) ? ['total' => $card['score'], 'stage' => $card['stage']] : null;
        $dex = is_int($card['dex_number'] ?? null) ? $card['dex_number'] : null;

        return [...$base,
            'share' => true,
            'logo' => true,
            'eyebrow' => $base['footer'],
            'footer' => '',
            'headline' => is_string($card['vehicle_name'] ?? null) ? $card['vehicle_name'] : '',
            'lines' => array_values(array_filter([
                $dex === null ? '' : (string) __('build_score.card.dex', ['number' => str_pad((string) $dex, 4, '0', STR_PAD_LEFT)]),
                $score === null ? '' : 'Build Score '.$score['total'].' · '.__('build_score.card.stage', ['stage' => $score['stage']]),
            ])),
            'photo' => $vehicle instanceof Vehicle ? $this->media->usable($stored['media_id'] ?? null, $owner) : null,
            // ADR-514: the car's page while anybody with the link may open it, never the sticker code (WrappedPresenter::pageUrl).
            'qr' => $this->presenter->pageUrl($vehicle),
            'score' => $score,
            'dex' => $dex,
        ];
    }

    /**
     * @param  array{share: bool, logo: bool, eyebrow: string, headline: string, numeral: bool, lines: list<string>, footer: string, photo: Media|null, qr: string|null, score: array{total: int, stage: int}|null, dex: int|null, photo_height: int}  $spec
     * @return array<string, mixed>
     */
    private function hashable(array $spec): array
    {
        $photo = $spec['photo'];
        $blurred = $photo?->getAttribute('blurred_at');

        return [
            ...$spec,
            'photo' => $photo === null ? null : [$photo->id, $blurred instanceof \DateTimeInterface ? $blurred->getTimestamp() : null, $photo->getAttribute('focal_x'), $photo->getAttribute('focal_y')],
        ];
    }

    /**
     * @param  array{share: bool, logo: bool, eyebrow: string, headline: string, numeral: bool, lines: list<string>, footer: string, photo: Media|null, qr: string|null, score: array{total: int, stage: int}|null, dex: int|null, photo_height: int}  $spec
     */
    private function draw(array $spec): string
    {
        $photo = $spec['photo'] === null ? null : $this->mediaService->largestVariant($spec['photo']);
        $focal = [
            is_numeric($spec['photo']?->getAttribute('focal_x')) ? (float) $spec['photo']->getAttribute('focal_x') : null,
            is_numeric($spec['photo']?->getAttribute('focal_y')) ? (float) $spec['photo']->getAttribute('focal_y') : null,
        ];
        $qr = $spec['qr'] === null ? null : $this->renderer->png($spec['qr'], 1024);

        // The share card with a photo is the VEH-07 story card: the same drawing, the season as its eyebrow.
        if ($spec['share'] && $photo !== null) {
            return $this->shareCanvas->draw(
                'story',
                $photo,
                $focal[0],
                $focal[1],
                $spec['eyebrow'],
                $spec['headline'],
                '',
                null,
                $qr,
                $spec['score'] === null ? null : [
                    'total' => $spec['score']['total'],
                    'max' => config()->integer('speedclub.build_score.max'),
                    'stage' => (string) __('build_score.card.stage', ['stage' => $spec['score']['stage']]),
                    'label' => (string) __('build_score.card.label'),
                ],
                $spec['dex'] === null ? null : (string) __('build_score.card.dex', ['number' => str_pad((string) $spec['dex'], 4, '0', STR_PAD_LEFT)]),
            );
        }

        return $this->canvas->draw([
            'photo_height' => $spec['photo_height'],
            'logo' => $spec['logo'],
            'eyebrow' => $spec['eyebrow'],
            'headline' => $spec['headline'],
            'numeral' => $spec['numeral'],
            'lines' => $spec['lines'],
            'footer' => $spec['footer'],
            'photo' => $photo,
            'focal' => $focal,
            'qr' => $qr,
        ]);
    }

    /**
     * The intro, score and Build Spirit photo (ADR-516 a), read again exactly as the API reads it (WrappedPresenter::carImage).
     *
     * @param  array<string, mixed>  $stored
     */
    private function carPhoto(array $stored, string $owner): ?Media
    {
        return $this->media->usableCarPhoto($stored['media_id'] ?? null, $owner);
    }

    private function number(mixed $value): string
    {
        return number_format(is_numeric($value) ? (int) $value : 0, 0, ',', app()->getLocale() === 'en' ? ',' : '.');
    }

    /**
     * The older drawings of the same card in the same language (and files from before the prefix), so a card shows one photo state.
     */
    private function removeSuperseded(Wrapped $wrapped, string $prefix, string $current): void
    {
        foreach ($this->disk()->files($this->directory($wrapped->user_id, $wrapped->season_key)) as $file) {
            $name = basename($file);

            if ($file !== $current && (str_starts_with($name, $prefix) || preg_match('/\A\d+-[a-z]{2}-[0-9a-f]{40}\.png\z/', $name) !== 1)) {
                $this->disk()->delete($file);
            }
        }
    }

    private function directory(string $userId, string $seasonKey): string
    {
        return self::DIRECTORY.'/'.strtolower($userId).'/'.$seasonKey;
    }

    private function disk(): Filesystem
    {
        return Storage::disk(config()->string('speedclub.media.private_disk'));
    }
}
