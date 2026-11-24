<?php

namespace App\Services\Signature;

use App\Enums\ModStatus;
use App\Enums\PowerDisplay;
use App\Models\Media;
use App\Models\Modification;
use App\Models\Vehicle;
use App\Services\Garage\VehiclePresenter;
use App\Services\Media\MediaService;
use App\Services\Qr\QrCodes;
use App\Services\Qr\QrRenderer;
use App\Support\BrandFiles;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Throwable;

/**
 * VEH-07 share cards [SIG sig.share_cards] (m2.7-contract §1): a PNG per vehicle and format, on the public disk under share/{vehicle}/, named
 * after a keyed hash of everything it shows (photo and its pixelation, focal point, titles, specs, @username, the page address in the QR code). A changed build
 * therefore gets new files by itself and the URL can be cached forever; an old name cannot be derived from the id.
 *
 * Stored only for a build anybody with the link may see (public or unlisted, owner public), as its file is public; the owner of a private
 * build gets the card drawn per request and never stored. Drawn in the queue after a change (DrawShareCards, queued with the OG image);
 * the .png route draws a missing one at once. Taking down cannot wait: OgImages::purge() removes the cards with the OG image, and og:prune
 * sweeps both daily.
 *
 * CF-6: the member may choose the photo, what the card shows and the square band's theme (ShareCardOptions). Only the default card is
 * stored publicly and offered as share_card_url. A card with other options never gets a URL: for a build that may have a stored card it is
 * cached on the private disk under share-cards/{vehicle}/ by the same kind of hash (options included), at most CUSTOM_LIMIT per build
 * (the oldest go), each for CUSTOM_TTL_HOURS (og:prune) and all of them with the build's cards (purge); a private build's is drawn per
 * request, as its default card.
 *
 * R5-2e VEH-07 2.0: the options also carry the template, the crop (zoom and centre), the `mods` element and the own text line; all of
 * them are part of the hash, and the defaults (written out or not) give the stored card's name.
 */
class ShareCards
{
    /**
     * Part of the hash: raising it redraws every card after a change to the drawing. 4: the QR shows the page, not the sticker (ADR-514).
     * 5: CF-6, the square card's band and the options. 6: R5-2e, the templates, the crop, the own line and the layout rules (the square
     * card's long names wrap instead of losing letters). 7: design QA R5DQ-05/13, the specs shrink last and the mods line is the same on
     * every card. 8: R5DQ-20, the mods line at its display size (fewer parts rather than a smaller line). 9: the story band's scrim is one
     * even scrim.photo ramp again (the photo stays visible behind the data).
     */
    private const VERSION = 9;

    private const DIRECTORY = 'share';

    /** CF-6: the private cache of customised cards. */
    private const CUSTOM_DIRECTORY = 'share-cards';

    public const CUSTOM_LIMIT = 6;

    public const CUSTOM_TTL_HOURS = 24;

    /** What the drawing reads. */
    public const RELATIONS = ['owner', 'make', 'vehicleModel', 'generation', 'specs', 'cover', 'media', 'activeQrCode', 'buildScore', 'modifications.brand'];

    /** R5-2e: the mods the card may name on the `mods` line, in the build's order; the canvas keeps the ones that fit, at most two. */
    private const MOD_CANDIDATES = 6;

    public function __construct(
        private readonly ShareCardCanvas $canvas,
        private readonly VehiclePresenter $presenter,
        private readonly MediaService $media,
        private readonly QrCodes $codes,
        private readonly QrRenderer $renderer,
    ) {}

    /**
     * @return list<string>
     */
    public static function formats(): array
    {
        return array_keys(ShareCardCanvas::FORMATS);
    }

    /**
     * The URL of each format while its stored file shows the current state; null for a format still to be drawn (then queued) and for a
     * build that gets no stored card. Never draws.
     *
     * @return array{story: string|null, square: string|null}
     */
    public function urls(Vehicle $vehicle): array
    {
        $urls = ['story' => null, 'square' => null];

        try {
            if (! $this->storable($vehicle)) {
                return $urls;
            }

            $missing = false;

            foreach (['story', 'square'] as $format) {
                $path = $this->path($vehicle, $format);

                if ($path !== null && $this->disk()->exists($path)) {
                    $urls[$format] = $this->url($path);
                } else {
                    $missing = $missing || $path !== null;
                }
            }

            if ($missing) {
                $id = (string) $vehicle->getKey();
                DB::afterCommit(fn () => DrawShareCards::dispatch($id));
            }
        } catch (Throwable $exception) {
            report($exception);
        }

        return $urls;
    }

    /**
     * The PNG for the route: the stored file, or drawn now (and stored when the build may have one). A customised card comes from the
     * private cache or is drawn now (and cached when the build may have a stored card). Null when the build has no usable photo.
     */
    public function png(Vehicle $vehicle, string $format, ?ShareCardOptions $options = null): ?string
    {
        $options ??= ShareCardOptions::defaults();
        $path = $this->path($vehicle, $format, $options);

        if ($path === null) {
            return null;
        }

        if (! $this->storable($vehicle)) {
            return $this->drawCard($vehicle, $format, $options);
        }

        if ($path === $this->path($vehicle, $format)) {
            return $this->disk()->get($path) ?? $this->store($vehicle, $format, $path);
        }

        $cached = $this->customPath($vehicle, $path);

        return $this->cache()->get($cached) ?? $this->storeCustom($vehicle, $format, $options, $cached);
    }

    /**
     * The photo a card draws: the one the options name when it is one of the build's photos everybody may see, else (none named) the
     * cover. Null when there is none: a named photo that is not such a photo, or a build without a usable photo.
     */
    public function photo(Vehicle $vehicle, ?ShareCardOptions $options = null): ?Media
    {
        $id = $options?->photo;

        if ($id === null) {
            return $this->presenter->cover($vehicle, false);
        }

        return $vehicle->media->first(fn (Media $media): bool => strtoupper((string) $media->getKey()) === strtoupper($id)
            && $media->getAttribute('variants') !== null
            && $this->presenter->photoVisibleTo($media, false));
    }

    /**
     * The queue's work: every format that is missing, and the outdated files go. A build that may have none loses them.
     */
    public function drawAll(Vehicle $vehicle): void
    {
        if (! $this->storable($vehicle)) {
            $this->purge($vehicle);

            return;
        }

        $current = [];

        foreach (self::formats() as $format) {
            $path = $this->path($vehicle, $format);

            if ($path === null) {
                continue;
            }

            $current[] = $path;

            if (! $this->disk()->exists($path)) {
                $this->store($vehicle, $format, $path);
            }
        }

        $this->removeExcept($vehicle, $current);
    }

    public function purge(Vehicle $vehicle): void
    {
        try {
            $this->disk()->deleteDirectory($this->directory($vehicle));
            $this->cache()->deleteDirectory(self::CUSTOM_DIRECTORY.'/'.strtolower((string) $vehicle->getKey()));
        } catch (Throwable $exception) {
            report($exception);
        }
    }

    /**
     * Daily with og:prune: directories of builds that are gone or may have no card, and outdated files of the others.
     */
    public function prune(): int
    {
        $removed = 0;

        foreach ($this->disk()->directories(self::DIRECTORY) as $directory) {
            $vehicle = Vehicle::withTrashed()->with(self::RELATIONS)->find(strtoupper(basename($directory)));

            if ($vehicle === null || ! $this->storable($vehicle)) {
                $removed += count($this->disk()->files($directory));
                $this->disk()->deleteDirectory($directory);

                continue;
            }

            $current = array_values(array_filter(array_map(fn (string $format): ?string => $this->path($vehicle, $format), self::formats())));
            $removed += $this->removeExcept($vehicle, $current);
        }

        return $removed + $this->pruneCustom();
    }

    /**
     * CF-6: customised cards older than CUSTOM_TTL_HOURS, and every one of a build that is gone or may have no stored card.
     */
    private function pruneCustom(): int
    {
        $removed = 0;
        $before = now()->subHours(self::CUSTOM_TTL_HOURS)->getTimestamp();

        foreach ($this->cache()->directories(self::CUSTOM_DIRECTORY) as $directory) {
            $vehicle = Vehicle::withTrashed()->with(self::RELATIONS)->find(strtoupper(basename($directory)));
            $files = $this->cache()->files($directory);

            if ($vehicle === null || ! $this->storable($vehicle)) {
                $removed += count($files);
                $this->cache()->deleteDirectory($directory);

                continue;
            }

            foreach ($files as $file) {
                if ($this->cache()->lastModified($file) < $before) {
                    $this->cache()->delete($file);
                    $removed++;
                }
            }
        }

        return $removed;
    }

    /**
     * share/{id}/{hash}-{format}.png, or null without a usable photo. The hash covers what the card shows, the options included, so the
     * default options give the stored card's name.
     */
    public function path(Vehicle $vehicle, string $format, ?ShareCardOptions $options = null): ?string
    {
        $options ??= ShareCardOptions::defaults();
        $photo = $this->photo($vehicle, $options);

        if ($photo === null) {
            return null;
        }

        $hash = hash_hmac('sha256', (string) json_encode(['v' => self::VERSION, 'brand' => BrandFiles::logoVersion(), ...$this->spec($vehicle, $photo, $format, $options)]), config()->string('app.key'));

        return $this->directory($vehicle).'/'.substr($hash, 0, 40).'-'.$format.'.png';
    }

    private function store(Vehicle $vehicle, string $format, string $path): string
    {
        $png = $this->drawCard($vehicle, $format, ShareCardOptions::defaults());
        $this->disk()->put($path, $png, ['visibility' => 'public', 'CacheControl' => 'public, max-age=31536000, immutable']);

        // Hidden while this was drawing: nothing may stay public behind the owner's back.
        if (! $this->storable($vehicle->fresh(self::RELATIONS) ?? $vehicle)) {
            $this->purge($vehicle);
        }

        return $png;
    }

    /**
     * CF-6: a customised card into the private cache, keeping at most CUSTOM_LIMIT per build (the oldest go).
     */
    private function storeCustom(Vehicle $vehicle, string $format, ShareCardOptions $options, string $path): string
    {
        $png = $this->drawCard($vehicle, $format, $options);

        try {
            $this->cache()->put($path, $png);
            $files = collect($this->cache()->files(dirname($path)))->sortByDesc(fn (string $file): int => $this->cache()->lastModified($file))->values();

            foreach ($files->slice(self::CUSTOM_LIMIT) as $file) {
                $this->cache()->delete($file);
            }

            if (! $this->storable($vehicle->fresh(self::RELATIONS) ?? $vehicle)) {
                $this->purge($vehicle);
            }
        } catch (Throwable $exception) {
            report($exception);
        }

        return $png;
    }

    private function customPath(Vehicle $vehicle, string $path): string
    {
        return self::CUSTOM_DIRECTORY.'/'.strtolower((string) $vehicle->getKey()).'/'.basename($path);
    }

    /**
     * @param  list<string>  $keep
     */
    private function removeExcept(Vehicle $vehicle, array $keep): int
    {
        $removed = 0;

        foreach ($this->disk()->files($this->directory($vehicle)) as $file) {
            if (! in_array($file, $keep, true)) {
                $this->disk()->delete($file);
                $removed++;
            }
        }

        return $removed;
    }

    private function drawCard(Vehicle $vehicle, string $format, ShareCardOptions $options): string
    {
        $photo = $this->photo($vehicle, $options) ?? throw new \RuntimeException('A share card needs a photo.');
        $spec = $this->spec($vehicle, $photo, $format, $options);

        return $this->canvas->draw(
            $format,
            $this->media->largestVariant($photo) ?? throw new \RuntimeException('A ready photo has no variant.'),
            $spec['crop'][1],
            $spec['crop'][2],
            $spec['eyebrow'],
            $spec['title'],
            $spec['specs'],
            $spec['handle'],
            $spec['qr'] === null ? null : $this->renderer->png($spec['qr'], 1024),
            $spec['score'] === null ? null : [
                'total' => $spec['score'][0],
                'max' => config()->integer('speedclub.build_score.max'),
                'stage' => (string) __('build_score.card.stage', ['stage' => $spec['score'][1]], 'de'),
                'label' => (string) __('build_score.card.label', [], 'de'),
            ],
            $spec['dex'] === null ? null : (string) __('build_score.card.dex', ['number' => str_pad((string) $spec['dex'], 4, '0', STR_PAD_LEFT)], 'de'),
            $spec['theme'] ?? 'dark',
            $spec['template'],
            $spec['crop'][0],
            $spec['text'],
            $spec['mods'],
        );
    }

    /**
     * Everything the card shows. German and PS, as the OG image: a share card is made for strangers, and no viewer is known when the queue
     * draws it.
     *
     * CF-6: what the options hide is left out here, so it changes the hash; the theme counts only where the template takes it.
     * R5-2e: the template, the crop (resolved: the focal point when the member names no centre, so the defaults written out give the
     * stored card's name), the own line and the mods line.
     *
     * @return array{photo: mixed, blurred: int|null, focal: list<mixed>, eyebrow: string|null, title: string, specs: string, handle: string|null, qr: string|null, format: string, score: array{0: int, 1: int}|null, dex: int|null, theme: string|null, template: string, crop: array{0: float, 1: float, 2: float}, text: string|null, mods: array{label: string, items: list<string>}|null}
     */
    private function spec(Vehicle $vehicle, Media $photo, string $format, ShareCardOptions $options): array
    {
        $owner = $vehicle->owner;
        $blurred = $photo->getAttribute('blurred_at');

        return [
            'photo' => $photo->getKey(),
            'blurred' => $blurred instanceof \DateTimeInterface ? $blurred->getTimestamp() : null,
            'focal' => [$photo->getAttribute('focal_x'), $photo->getAttribute('focal_y')],
            'eyebrow' => $this->presenter->eyebrow($vehicle),
            'title' => $this->presenter->title($vehicle) !== '' ? $this->presenter->title($vehicle) : $this->presenter->fullTitle($vehicle),
            'specs' => $options->shows('specs') ? $this->specLine($vehicle) : '',
            // ADR-148 a: only when the owner shows themselves on the pages a code leads to.
            'handle' => $options->shows('username') && $owner !== null && $owner->getAttribute('show_owner_on_qr') !== false && is_string($owner->username) ? '@'.$owner->username : null,
            // ADR-514: the page address, never the sticker code. A guest may download this card, and a sticker code proves standing at the
            // car for STREET DEX.
            'qr' => $options->shows('qr') ? $this->codes->pageUrl($vehicle) : null,
            'format' => $format,
            // M5.9c: the Build Score gauge and stage; M5.9b: the Dex number. Part of the hash, so a new score draws a new card.
            'score' => $vehicle->buildScore === null || ! $options->shows('score') ? null : [$vehicle->buildScore->total, $vehicle->buildScore->stage],
            'dex' => $options->shows('dex') ? $vehicle->dex_number : null,
            'theme' => $options->templateCase()->takesTheme($format) ? $options->themeFor($format) : null,
            'template' => $options->templateCase()->value,
            'crop' => [
                round(max(ShareCardOptions::ZOOM_MIN, min(ShareCardOptions::ZOOM_MAX, $options->zoom)), 2),
                $this->centre($options->x, $photo->getAttribute('focal_x')),
                $this->centre($options->y, $photo->getAttribute('focal_y')),
            ],
            'text' => $options->text === null || trim($options->text) === '' ? null : trim($options->text),
            'mods' => $options->shows('mods') ? $this->modsLine($vehicle) : null,
        ];
    }

    /** R5-2e: the crop centre on one axis, the member's, else the photo's focal point, else the middle; 0 to 1, four decimals. */
    private function centre(?float $chosen, mixed $focal): float
    {
        $value = $chosen ?? (is_numeric($focal) ? (float) $focal : 0.5);

        return round(max(0.0, min(1.0, $value)), 4);
    }

    /**
     * R5-2e: "12 Mods" and the names of the first installed mods, brand and short name ("KW V3"); the canvas keeps the ones that fit on
     * the line, at most two, whole. Null for a build without an installed mod.
     *
     * @return array{label: string, items: list<string>}|null
     */
    private function modsLine(Vehicle $vehicle): ?array
    {
        $installed = $vehicle->modifications
            ->filter(fn (Modification $mod): bool => $mod->getAttribute('status') === ModStatus::Installed)
            ->sortBy([['sort', 'asc'], ['id', 'asc']])
            ->values();

        if ($installed->isEmpty()) {
            return null;
        }

        $items = [];

        foreach ($installed as $mod) {
            $name = $this->modName($mod);

            if ($name !== '' && ! in_array($name, $items, true)) {
                $items[] = $name;
            }

            if (count($items) >= self::MOD_CANDIDATES) {
                break;
            }
        }

        return [
            'label' => trans_choice('signature.share_card.mods', $installed->count(), ['count' => $installed->count()], 'de'),
            'items' => $items,
        ];
    }

    private function modName(Modification $mod): string
    {
        $brand = trim((string) ($mod->brand?->getAttribute('name') ?? $mod->getAttribute('brand_text')));
        $part = trim((string) $mod->getAttribute('part_name'));
        $title = trim((string) $mod->getAttribute('title'));

        if ($brand !== '' && $part !== '') {
            return $brand.' '.$part;
        }

        if ($brand !== '' && $title !== '' && ! str_starts_with(mb_strtolower($title), mb_strtolower($brand))) {
            return $brand.' '.$title;
        }

        return $title;
    }

    /**
     * Three specs: "510 PS · 650 Nm · 2022", the first three of the strip that are entered.
     */
    private function specLine(Vehicle $vehicle): string
    {
        $parts = [];

        foreach ($this->presenter->specStrip($vehicle, PowerDisplay::PsKw, 'de') as $entry) {
            if ($entry['value'] !== null && count($parts) < 3) {
                $parts[] = trim($entry['value'].' '.($entry['key'] === 'power' || $entry['key'] === 'torque' ? $entry['unit'] : ''));
            }
        }

        return implode(' · ', $parts);
    }

    private function storable(Vehicle $vehicle): bool
    {
        return ! $vehicle->trashed() && $vehicle->isReachable() && $vehicle->owner?->isPubliclyVisible() === true;
    }

    private function directory(Vehicle $vehicle): string
    {
        return self::DIRECTORY.'/'.strtolower((string) $vehicle->getKey());
    }

    private function url(string $path): string
    {
        $disk = config()->string('speedclub.media.disk');

        return config('filesystems.disks.'.$disk.'.driver') === 'local' ? url('storage/'.$path) : Storage::disk($disk)->url($path);
    }

    private function disk(): Filesystem
    {
        return Storage::disk(config()->string('speedclub.media.disk'));
    }

    private function cache(): Filesystem
    {
        return Storage::disk(config()->string('speedclub.media.private_disk'));
    }
}
