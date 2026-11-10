<?php

namespace App\Services\Signature;

use App\Enums\PowerDisplay;
use App\Models\Media;
use App\Models\Vehicle;
use App\Services\Garage\VehiclePresenter;
use App\Services\Media\MediaService;
use App\Services\Qr\QrCodes;
use App\Services\Qr\QrRenderer;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Throwable;

/**
 * VEH-07 share cards [SIG sig.share_cards] (m2.7-contract §1): a PNG per vehicle and format, on the public disk under share/{vehicle}/, named
 * after a keyed hash of everything it shows (photo and its pixelation, focal point, titles, specs, @username, QR code). A changed build
 * therefore gets new files by itself and the URL can be cached forever; an old name cannot be derived from the id.
 *
 * Stored only for a build anybody with the link may see (public or unlisted, owner public), as its file is public; the owner of a private
 * build gets the card drawn per request and never stored. Drawn in the queue after a change (DrawShareCards, queued with the OG image);
 * the .png route draws a missing one at once. Taking down cannot wait: OgImages::purge() removes the cards with the OG image, and og:prune
 * sweeps both daily.
 */
class ShareCards
{
    /** Part of the hash: raising it redraws every card after a change to the drawing. */
    private const VERSION = 1;

    private const DIRECTORY = 'share';

    /** What the drawing reads. */
    public const RELATIONS = ['owner', 'make', 'vehicleModel', 'generation', 'specs', 'cover', 'media', 'activeQrCode'];

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
     * The PNG for the route: the stored file, or drawn now (and stored when the build may have one). Null when the build has no usable
     * photo.
     */
    public function png(Vehicle $vehicle, string $format): ?string
    {
        $path = $this->path($vehicle, $format);

        if ($path === null) {
            return null;
        }

        if ($this->storable($vehicle)) {
            $stored = $this->disk()->get($path);

            return $stored ?? $this->store($vehicle, $format, $path);
        }

        return $this->drawCard($vehicle, $format);
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

        return $removed;
    }

    /**
     * share/{id}/{hash}-{format}.png, or null without a usable photo.
     */
    public function path(Vehicle $vehicle, string $format): ?string
    {
        $photo = $this->photo($vehicle);

        if ($photo === null) {
            return null;
        }

        $hash = hash_hmac('sha256', (string) json_encode(['v' => self::VERSION, ...$this->spec($vehicle, $photo, $format)]), config()->string('app.key'));

        return $this->directory($vehicle).'/'.substr($hash, 0, 40).'-'.$format.'.png';
    }

    private function store(Vehicle $vehicle, string $format, string $path): string
    {
        $png = $this->drawCard($vehicle, $format);
        $this->disk()->put($path, $png, ['visibility' => 'public', 'CacheControl' => 'public, max-age=31536000, immutable']);

        // Hidden while this was drawing: nothing may stay public behind the owner's back.
        if (! $this->storable($vehicle->fresh(self::RELATIONS) ?? $vehicle)) {
            $this->purge($vehicle);
        }

        return $png;
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

    private function drawCard(Vehicle $vehicle, string $format): string
    {
        $photo = $this->photo($vehicle) ?? throw new \RuntimeException('A share card needs a photo.');
        $spec = $this->spec($vehicle, $photo, $format);
        $qr = $vehicle->activeQrCode;

        return $this->canvas->draw(
            $format,
            $this->media->largestVariant($photo) ?? throw new \RuntimeException('A ready photo has no variant.'),
            is_numeric($photo->getAttribute('focal_x')) ? (float) $photo->getAttribute('focal_x') : null,
            is_numeric($photo->getAttribute('focal_y')) ? (float) $photo->getAttribute('focal_y') : null,
            $spec['eyebrow'],
            $spec['title'],
            $spec['specs'],
            $spec['handle'],
            $qr === null ? null : $this->renderer->png($this->codes->payload($qr), 1024),
        );
    }

    /**
     * Everything the card shows. German and PS, as the OG image: a share card is made for strangers, and no viewer is known when the queue
     * draws it.
     *
     * @return array{photo: mixed, blurred: int|null, focal: list<mixed>, eyebrow: string|null, title: string, specs: string, handle: string|null, qr: string|null, format: string}
     */
    private function spec(Vehicle $vehicle, Media $photo, string $format): array
    {
        $owner = $vehicle->owner;
        $blurred = $photo->getAttribute('blurred_at');

        return [
            'photo' => $photo->getKey(),
            'blurred' => $blurred instanceof \DateTimeInterface ? $blurred->getTimestamp() : null,
            'focal' => [$photo->getAttribute('focal_x'), $photo->getAttribute('focal_y')],
            'eyebrow' => $this->presenter->eyebrow($vehicle),
            'title' => $this->presenter->title($vehicle) !== '' ? $this->presenter->title($vehicle) : $this->presenter->fullTitle($vehicle),
            'specs' => $this->specLine($vehicle),
            // ADR-148 a: only when the owner shows themselves on the pages a code leads to.
            'handle' => $owner !== null && $owner->getAttribute('show_owner_on_qr') !== false && is_string($owner->username) ? '@'.$owner->username : null,
            'qr' => $vehicle->activeQrCode?->code,
            'format' => $format,
        ];
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

    private function photo(Vehicle $vehicle): ?Media
    {
        return $this->presenter->cover($vehicle, false);
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
}
