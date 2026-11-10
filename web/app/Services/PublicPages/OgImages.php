<?php

namespace App\Services\PublicPages;

use App\Enums\PowerDisplay;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\AppConfig\AppConfig;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Garage\VehiclePresenter;
use App\Services\Media\MediaService;
use App\Services\Signature\DrawShareCards;
use App\Services\Signature\ShareCards;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Throwable;

/**
 * Open Graph images: a JPEG per public vehicle and member, named after a keyed hash of what it shows. So a changed title, photo or focal
 * point gets a new file by itself, an old link cannot be derived from the id, and the file can be cached forever.
 *
 * Drawn in the queue (DrawVehicleOgImage, DrawMemberOgImage), never during a page view: a stranger who scans a sticker must not wait for GD (F4). The Actions
 * that change what a picture shows queue a draw after their commit, so the file is usually there before the first link is shared.
 * The page names a file only while it shows the current state, and answers the default otherwise; that read also queues the draw,
 * so no missing hook leaves a page without its picture for long. Taking things down cannot wait, so hiding, deleting and removing
 * a photo call purge() directly, and og:prune sweeps up daily for whatever changed elsewhere, such as a suspension.
 *
 * Nothing hidden ever gets a file: forVehicle, forMember and draw answer the default for anything the public may not see.
 */
class OgImages
{
    /** What the drawing of a vehicle reads. */
    public const VEHICLE_RELATIONS = ['owner', 'make', 'vehicleModel', 'generation', 'specs', 'cover', 'media'];

    public const MEMBER_RELATIONS = ['avatar', 'cover'];

    /** Part of the hash: raising it redraws everything after a change to the drawing. */
    private const VERSION = 3;

    private const VEHICLES = 'og/v';

    private const MEMBERS = 'og/u';

    /** A file younger than this may belong to a draw that has not written its row yet. */
    private const ORPHAN_AGE_SECONDS = 3600;

    public function __construct(
        private readonly OgImageCanvas $canvas,
        private readonly VehiclePresenter $presenter,
        private readonly MediaService $media,
    ) {}

    public function defaultUrl(): string
    {
        // ADM-28: the published OG default, else config (AppConfig).
        return app(AppConfig::class)->ogDefaultUrl();
    }

    /**
     * For the page: the file while it shows the current state, the default otherwise, and then a draw is queued. Never draws.
     */
    public function forVehicle(Vehicle $vehicle): string
    {
        return $this->forPage($vehicle);
    }

    public function forMember(User $member): string
    {
        return $this->forPage($member);
    }

    /**
     * For the Actions, after something the picture shows changed: queues a draw after the commit. Decided on the row alone, since the
     * caller's relations may be older than its write; the job reads everything again and draws only what is missing or outdated.
     */
    public function queue(Vehicle|User $subject): void
    {
        $candidate = $subject instanceof Vehicle
            ? $subject->status === VehicleStatus::Published && $subject->visibility !== Visibility::Private && ! $subject->trashed()
            : $subject->isPubliclyVisible() && $subject->username !== null;

        if ($candidate) {
            $this->dispatch($subject);
        }
    }

    /**
     * The queue's work (OgImageJob): draws the file when it is missing or outdated and returns its address, removes it when the subject is
     * no longer public.
     */
    public function draw(Vehicle|User $subject): string
    {
        try {
            if ($subject instanceof Vehicle) {
                $photo = $this->vehiclePhoto($subject);

                if (! $this->vehicleIsPublic($subject) || $photo === null) {
                    $this->purge($subject);

                    return $this->defaultUrl();
                }

                return $this->stored($subject, self::VEHICLES, $this->vehicleSpec($subject, $photo), fn (): string => $this->drawVehicle($subject, $photo), fn (): bool => $this->vehicleIsPublic($subject->fresh() ?? $subject));
            }

            if (! $this->memberIsPublic($subject)) {
                $this->purge($subject);

                return $this->defaultUrl();
            }

            return $this->stored($subject, self::MEMBERS, $this->memberSpec($subject), fn (): string => $this->drawMember($subject), fn (): bool => $this->memberIsPublic($subject->fresh() ?? $subject));
        } catch (Throwable $exception) {
            report($exception);

            return $this->defaultUrl();
        }
    }

    private function forPage(Vehicle|User $subject): string
    {
        try {
            $path = $this->currentPath($subject);

            if ($path === null) {
                $this->purge($subject);

                return $this->defaultUrl();
            }

            if ($subject->getAttribute('og_image_path') === $path) {
                return $this->url($path);
            }

            $this->dispatch($subject);
        } catch (Throwable $exception) {
            report($exception);
        }

        return $this->defaultUrl();
    }

    private function dispatch(Vehicle|User $subject): void
    {
        $id = (string) $subject->getKey();
        $vehicle = $subject instanceof Vehicle;

        DB::afterCommit(fn () => $vehicle ? DrawVehicleOgImage::dispatch($id) : DrawMemberOgImage::dispatch($id));

        // M2.7: the share cards show what the OG image shows, so they follow every change that redraws it [SIG sig.share_cards].
        if ($vehicle && app(FeatureFlags::class)->enabled('sig.share_cards')) {
            DB::afterCommit(fn () => DrawShareCards::dispatch($id));
        }
    }

    /**
     * Where the file showing the current state lies, or null when the subject may have none.
     */
    private function currentPath(Vehicle|User $subject): ?string
    {
        if ($subject instanceof User) {
            return $this->memberIsPublic($subject) ? $this->path(self::MEMBERS, $this->memberSpec($subject)) : null;
        }

        $photo = $this->vehiclePhoto($subject);

        return $this->vehicleIsPublic($subject) && $photo !== null ? $this->path(self::VEHICLES, $this->vehicleSpec($subject, $photo)) : null;
    }

    /**
     * Removes the file at once. The next read of a page that is still public draws it again.
     */
    public function purge(Vehicle|User $subject): void
    {
        // M2.7: what takes the OG image down takes the share cards down too (hidden, deleted, a photo removed or pixelated).
        if ($subject instanceof Vehicle) {
            app(ShareCards::class)->purge($subject);
        }

        /** @var string|null $path */
        $path = $subject::query()->withoutGlobalScopes()->whereKey($subject->getKey())->value('og_image_path');

        if ($path === null) {
            return;
        }

        try {
            $this->disk()->delete($path);
            $subject::query()->withoutGlobalScopes()->whereKey($subject->getKey())->toBase()->update(['og_image_path' => null]);
            $subject->setAttribute('og_image_path', null);
        } catch (Throwable $exception) {
            // og:prune tries again.
            report($exception);
        }
    }

    /**
     * Daily (routes/console.php): what is no longer public or no longer shows the current state, then files no row points at.
     */
    public function prune(): int
    {
        $removed = 0;

        $keep = fn (Vehicle|User $subject): bool => $subject->getAttribute('og_image_path') === $this->currentPath($subject);

        $this->sweep(Vehicle::withTrashed()->with(self::VEHICLE_RELATIONS), $keep, $removed);
        $this->sweep(User::withTrashed()->with(self::MEMBER_RELATIONS), $keep, $removed);

        return $removed + $this->removeOrphans() + app(ShareCards::class)->prune();
    }

    /**
     * @template TModel of Model
     *
     * @param  Builder<TModel>  $query
     * @param  callable(TModel): bool  $keep
     */
    private function sweep(Builder $query, callable $keep, int &$removed): void
    {
        foreach ($query->whereNotNull('og_image_path')->lazyById(200) as $subject) {
            if (($subject instanceof Vehicle || $subject instanceof User) && ! $keep($subject)) {
                $this->purge($subject);
                $removed++;
            }
        }
    }

    /**
     * One query per table for the paths in use, then the files are compared in memory: a query per file would scan the table once
     * for every file, since nothing filters on og_image_path otherwise.
     */
    private function removeOrphans(): int
    {
        $disk = $this->disk();
        $removed = 0;
        $cutoff = now()->getTimestamp() - self::ORPHAN_AGE_SECONDS;

        foreach ([self::VEHICLES => Vehicle::class, self::MEMBERS => User::class] as $directory => $model) {
            // Read before the files are listed: a file whose row is written later is younger than the cutoff.
            $inUse = array_flip(array_filter(
                $model::query()->withoutGlobalScopes()->whereNotNull('og_image_path')->toBase()->pluck('og_image_path')->all(),
                is_string(...),
            ));

            foreach ($disk->files($directory) as $file) {
                if (! isset($inUse[$file]) && $disk->lastModified($file) < $cutoff) {
                    $disk->delete($file);
                    $removed++;
                }
            }
        }

        return $removed;
    }

    /**
     * @param  array<string, mixed>  $spec
     * @param  callable(): string  $draw
     * @param  callable(): bool  $stillPublic
     */
    private function stored(Vehicle|User $subject, string $directory, array $spec, callable $draw, callable $stillPublic): string
    {
        $path = $this->path($directory, $spec);
        $current = $subject->getAttribute('og_image_path');

        if ($current === $path) {
            return $this->url($path);
        }

        $disk = $this->disk();
        $disk->put($path, $draw(), ['visibility' => 'public', 'CacheControl' => 'public, max-age=31536000, immutable']);

        // Hidden while this was drawing: the purge of that request found nothing yet, so this one has to clean up.
        if (! $stillPublic()) {
            $disk->delete($path);

            return $this->defaultUrl();
        }

        $subject::query()->withoutGlobalScopes()->whereKey($subject->getKey())->toBase()->update(['og_image_path' => $path]);
        $subject->setAttribute('og_image_path', $path);

        if (is_string($current) && $current !== $path) {
            $disk->delete($current);
        }

        return $this->url($path);
    }

    /**
     * @param  array<string, mixed>  $spec
     */
    private function path(string $directory, array $spec): string
    {
        $hash = hash_hmac('sha256', (string) json_encode(['v' => self::VERSION, ...$spec]), config()->string('app.key'));

        return $directory.'/'.substr($hash, 0, 40).'.jpg';
    }

    /**
     * As media: local disks answer on the host of the request.
     */
    private function url(string $path): string
    {
        $disk = config()->string('speedclub.media.disk');

        return config('filesystems.disks.'.$disk.'.driver') === 'local' ? url('storage/'.$path) : Storage::disk($disk)->url($path);
    }

    private function disk(): Filesystem
    {
        return Storage::disk(config()->string('speedclub.media.disk'));
    }

    private function vehicleIsPublic(Vehicle $vehicle): bool
    {
        return $vehicle->isReachable() && $vehicle->owner?->isPubliclyVisible() === true;
    }

    private function memberIsPublic(User $member): bool
    {
        return $member->isPubliclyVisible() && $member->username !== null;
    }

    private function vehiclePhoto(Vehicle $vehicle): ?Media
    {
        $cover = $vehicle->cover;

        return $cover !== null && $cover->isUsablePhoto()
            ? $cover
            : $vehicle->media->filter(fn (Media $media): bool => $media->isUsablePhoto())->sortBy([['sort', 'asc'], ['id', 'asc']])->first();
    }

    /**
     * Everything the picture shows. German and PS (kW), since no viewer is known when it is drawn.
     *
     * @return array<string, mixed>
     */
    private function vehicleSpec(Vehicle $vehicle, Media $photo): array
    {
        $blurred = $photo->getAttribute('blurred_at');

        return [
            'photo' => $photo->getKey(),
            // A pixelated photo (sig.plate_blur) is a new picture under the same id. Only then in the spec, so other files keep their names.
            ...($blurred instanceof \DateTimeInterface ? ['blurred' => $blurred->getTimestamp()] : []),
            'focal' => [$photo->getAttribute('focal_x'), $photo->getAttribute('focal_y')],
            'eyebrow' => $this->presenter->eyebrow($vehicle),
            'title' => $this->presenter->title($vehicle),
            'specs' => $this->specLine($vehicle),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function memberSpec(User $member): array
    {
        $cover = $this->usable($member->cover);
        $avatar = $this->usable($member->avatar);

        return [
            'cover' => $cover?->getKey(),
            'focal' => [$cover?->getAttribute('focal_x'), $cover?->getAttribute('focal_y')],
            'avatar' => $avatar?->getKey(),
            'name' => $member->getAttribute('display_name') ?? $member->username,
            'username' => $member->username,
            'city' => $member->getAttribute('city'),
        ];
    }

    private function usable(?Media $media): ?Media
    {
        return $media !== null && $media->isUsablePhoto() ? $media : null;
    }

    /**
     * "500 PS · 540 Nm · 2002 · AWD"
     */
    private function specLine(Vehicle $vehicle): string
    {
        $parts = [];

        foreach ($this->presenter->specStrip($vehicle, PowerDisplay::PsKw, 'de') as $entry) {
            if ($entry['value'] !== null) {
                $parts[] = trim($entry['value'].' '.$entry['unit']);
            }
        }

        return implode(' · ', $parts);
    }

    private function drawVehicle(Vehicle $vehicle, Media $photo): string
    {
        return $this->canvas->vehicle(
            $this->media->largestVariant($photo) ?? throw new \RuntimeException('A ready photo has no variant.'),
            $this->floatOrNull($photo->getAttribute('focal_x')),
            $this->floatOrNull($photo->getAttribute('focal_y')),
            // OgImageCanvas skips a line with nothing left to draw.
            $this->presenter->eyebrow($vehicle),
            $this->presenter->title($vehicle),
            $this->specLine($vehicle),
        );
    }

    private function drawMember(User $member): string
    {
        $cover = $this->usable($member->cover);
        $avatar = $this->usable($member->avatar);
        $name = $member->getAttribute('display_name');
        $city = $member->getAttribute('city');
        // Nothing of the name may be drawable, an emoji or a name in Arabic: the handle stands in.
        $drawable = $this->canvas->sanitise(is_string($name) ? $name : '');

        return $this->canvas->member(
            $cover === null ? null : $this->media->largestVariant($cover),
            $this->floatOrNull($cover?->getAttribute('focal_x')),
            $this->floatOrNull($cover?->getAttribute('focal_y')),
            $avatar === null ? null : $this->media->largestVariant($avatar),
            $drawable !== '' ? $drawable : (string) $member->username,
            '@'.$member->username,
            is_string($city) ? $city : null,
        );
    }

    private function floatOrNull(mixed $value): ?float
    {
        return is_numeric($value) ? (float) $value : null;
    }
}
