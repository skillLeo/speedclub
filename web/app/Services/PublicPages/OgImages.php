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
use App\Services\Qr\QrCodes;
use App\Services\Qr\QrRenderer;
use App\Services\Showcase\SampleContent;
use App\Services\Signature\DrawShareCards;
use App\Services\Signature\ShareCards;
use App\Support\PublicUrl;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Throwable;

/**
 * Link previews (Open Graph, X cards): a 1200 × 630 JPEG and a 1080 × 1080 square per public vehicle and member, and the brand card
 * for the landing page and everything without a picture of its own.
 *
 * Files lie on the media disk under og/v, og/u and og/site, named after a keyed hash of what they show, so a changed title, photo or
 * focal point gets new files by itself. Pages name them through /og/v/{slug}-{hash}.jpg (OgImageController): the hash in the address
 * changes with the card, so the address can be cached forever, and the route draws a missing card on the spot (bounded, one draw per
 * card at a time). So the first crawler that sees a link gets the real card, also when the cron has not run the queue yet; a page view
 * itself never waits for GD (F4: LCP < 2.0 s). The Actions that change what a card shows still queue a draw after their commit, so the
 * crawler usually finds the file ready.
 *
 * Nothing hidden ever gets a file and its route answers 404: cards(), draw() and serve() answer the default or nothing for anything the
 * public may not see. Taking things down cannot wait, so hiding, deleting and removing a photo call purge() directly, and og:prune
 * sweeps up daily for whatever changed elsewhere, such as a suspension.
 */
class OgImages
{
    /** What the drawing of a vehicle reads. */
    public const VEHICLE_RELATIONS = ['owner', 'make', 'vehicleModel', 'generation', 'specs', 'cover', 'media', 'activeQrCode'];

    public const MEMBER_RELATIONS = ['avatar', 'cover'];

    /** Part of the hash: raising it redraws everything after a change to the drawing. */
    private const VERSION = 7;

    private const VEHICLES = 'og/v';

    private const MEMBERS = 'og/u';

    private const SITE = 'og/site';

    /** Characters of the file hash in the public address: enough to tell versions apart, nothing to guess from. */
    private const URL_HASH = 16;

    /** The brand photo of the default card and the line under the wordmark (German, as every card: no viewer is known when it is drawn). */
    private const SITE_PHOTO = 'state-garage';

    private const SITE_LINE = 'Autos. Builds. Treffen.';

    /** A file younger than this may belong to a draw that has not written its row yet. */
    private const ORPHAN_AGE_SECONDS = 3600;

    /** How long a crawler waits for a draw that another request is doing, and how long a draw may hold the card. */
    private const LOCK_WAIT_SECONDS = 10;

    private const LOCK_SECONDS = 30;

    public function __construct(
        private readonly OgImageCanvas $canvas,
        private readonly VehiclePresenter $presenter,
        private readonly MediaService $media,
        private readonly QrCodes $codes,
        private readonly QrRenderer $renderer,
    ) {}

    /**
     * The landscape default: the OG default staff published (ADM-28), else the drawn brand card.
     */
    public function defaultUrl(): string
    {
        return $this->defaultCards()[OgImageCanvas::LANDSCAPE];
    }

    /**
     * @return array{landscape: string, square: string}
     */
    public function defaultCards(): array
    {
        $hash = $this->hash($this->siteSpec());
        $published = app(AppConfig::class)->publishedOgDefaultUrl();

        return [
            OgImageCanvas::LANDSCAPE => $published ?? $this->address('/og/site', $hash, OgImageCanvas::LANDSCAPE),
            OgImageCanvas::SQUARE => $this->address('/og/site', $hash, OgImageCanvas::SQUARE),
        ];
    }

    /**
     * For a page: the subject's own cards while it may have them, the default otherwise. Never draws; queues a draw while the files
     * do not show the current state yet (the address already names that state, and its route draws it for the first crawler).
     *
     * @return array{landscape: string, square: string}
     */
    public function cards(Vehicle|User|null $subject): array
    {
        if ($subject === null) {
            return $this->defaultCards();
        }

        try {
            $path = $this->currentPath($subject);

            if ($path === null) {
                $this->purge($subject);

                return $this->defaultCards();
            }

            if ($subject->getAttribute('og_image_path') !== $path) {
                $this->dispatch($subject);
            }

            $hash = $this->hashOf($path);
            $base = $subject instanceof Vehicle ? '/og/v/'.$subject->canonicalSlug() : '/og/u/'.$subject->username;

            return [
                OgImageCanvas::LANDSCAPE => $this->address($base, $hash, OgImageCanvas::LANDSCAPE),
                OgImageCanvas::SQUARE => $this->address($base, $hash, OgImageCanvas::SQUARE),
            ];
        } catch (Throwable $exception) {
            report($exception);
        }

        return $this->defaultCards();
    }

    public function forVehicle(Vehicle $vehicle): string
    {
        return $this->cards($vehicle)[OgImageCanvas::LANDSCAPE];
    }

    public function forMember(User $member): string
    {
        return $this->cards($member)[OgImageCanvas::LANDSCAPE];
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
     * The queue's work (OgImageJob): draws both formats when they are missing or outdated and returns the landscape card's address,
     * removes them when the subject is no longer public.
     */
    public function draw(Vehicle|User $subject): string
    {
        try {
            if ($this->ensure($subject) === null) {
                return $this->defaultUrl();
            }

            return $this->cards($subject)[OgImageCanvas::LANDSCAPE];
        } catch (Throwable $exception) {
            report($exception);

            return $this->defaultUrl();
        }
    }

    /**
     * For OgImageController: the JPEG behind a public address, drawn now when it is missing. Null for an address that names nothing
     * public. An address with an outdated hash gets the current card, marked as not current so it is not cached forever.
     *
     * @return array{bytes: string, current: bool, etag: string}|null
     */
    public function serve(string $type, string $file): ?array
    {
        if (preg_match('/\A(?<key>[A-Za-z0-9._-]+?)-(?<hash>[0-9a-f]{16})(?<square>-square)?\.jpg\z/', $file, $match) !== 1) {
            return null;
        }

        $format = ($match['square'] ?? '') === '' ? OgImageCanvas::LANDSCAPE : OgImageCanvas::SQUARE;
        $subject = match ($type) {
            'v' => Vehicle::findBySlug($match['key'])?->load(self::VEHICLE_RELATIONS),
            'u' => User::query()->where('username', $match['key'])->with(self::MEMBER_RELATIONS)->first(),
            default => $match['key'] === 'site' ? 'site' : null,
        };

        // A sample while editorial_samples is off names nothing public (09 §8.19); its files stay for when the flag comes back on.
        if ($subject === null || ($subject !== 'site' && app(SampleContent::class)->hides($subject))) {
            return null;
        }
        // A sample's card must not outlive the flag in caches: never `immutable`, an hour at most (the not-current branch).
        $sample = $subject !== 'site' && SampleContent::isSample($subject);

        try {
            $paths = $subject === 'site' ? $this->ensureSite() : $this->ensure($subject);

            if ($paths === null) {
                return null;
            }

            $bytes = $this->disk()->get($paths[$format]) ?? throw new \RuntimeException('A drawn card is missing.');

            return ['bytes' => $bytes, 'current' => hash_equals($this->hashOf($paths[OgImageCanvas::LANDSCAPE]), $match['hash']) && ! $sample, 'etag' => basename($paths[$format], '.jpg')];
        } catch (LockTimeoutException) {
            // Another request is drawing this card: this one draws it too, without storing.
            return ['bytes' => $this->drawFormat($subject, $format), 'current' => false, 'etag' => 'pending'];
        } catch (Throwable $exception) {
            report($exception);

            // The client's delivered card, never a broken image.
            return ['bytes' => (string) file_get_contents(public_path(config()->string('speedclub.public_pages.og_default'))), 'current' => false, 'etag' => 'fallback'];
        }
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
     * Where the landscape file showing the current state lies, or null when the subject may have none.
     */
    private function currentPath(Vehicle|User $subject): ?string
    {
        $spec = $this->spec($subject);

        return $spec === null ? null : $this->path($subject instanceof Vehicle ? self::VEHICLES : self::MEMBERS, $spec);
    }

    /**
     * @return array<string, mixed>|null
     */
    private function spec(Vehicle|User $subject): ?array
    {
        if ($subject instanceof User) {
            return $this->memberIsPublic($subject) ? $this->memberSpec($subject) : null;
        }

        $photo = $this->vehiclePhoto($subject);

        return $this->vehicleIsPublic($subject) && $photo !== null ? $this->vehicleSpec($subject, $photo) : null;
    }

    /**
     * Both files for the current state, drawn when one is missing; one draw per card at a time. Null (and the files gone) when the
     * subject may have none.
     *
     * @return array{landscape: string, square: string}|null
     */
    private function ensure(Vehicle|User $subject): ?array
    {
        $path = $this->currentPath($subject);

        if ($path === null) {
            $this->purge($subject);

            return null;
        }

        $paths = $this->pair($path);

        if ($subject->getAttribute('og_image_path') === $path && $this->drawn($paths)) {
            return $paths;
        }

        return Cache::lock('og-draw:'.$path, self::LOCK_SECONDS)->block(self::LOCK_WAIT_SECONDS, function () use ($subject, $path, $paths): ?array {
            $current = $subject::query()->withoutGlobalScopes()->whereKey($subject->getKey())->toBase()->value('og_image_path');

            if ($current === $path && $this->drawn($paths)) {
                $subject->setAttribute('og_image_path', $path);

                return $paths;
            }

            return $this->store($subject, $paths, is_string($current) ? $current : null);
        });
    }

    /**
     * @return array{landscape: string, square: string}
     */
    private function ensureSite(): array
    {
        $paths = $this->pair($this->path(self::SITE, $this->siteSpec()));

        if ($this->drawn($paths)) {
            return $paths;
        }

        return Cache::lock('og-draw:'.$paths[OgImageCanvas::LANDSCAPE], self::LOCK_SECONDS)->block(self::LOCK_WAIT_SECONDS, function () use ($paths): array {
            if (! $this->drawn($paths)) {
                foreach ($paths as $format => $path) {
                    $this->put($path, $this->drawFormat('site', $format));
                }
            }

            return $paths;
        });
    }

    /**
     * @param  array{landscape: string, square: string}  $paths
     * @return array{landscape: string, square: string}|null
     */
    private function store(Vehicle|User $subject, array $paths, ?string $previous): ?array
    {
        foreach ($paths as $format => $path) {
            $this->put($path, $this->drawFormat($subject, $format));
        }

        // Hidden while this was drawing: the purge of that request found nothing yet, so this one has to clean up.
        $fresh = $subject->fresh($subject instanceof Vehicle ? self::VEHICLE_RELATIONS : self::MEMBER_RELATIONS);

        if ($fresh === null || $this->spec($fresh) === null) {
            $this->disk()->delete(array_values($paths));

            return null;
        }

        $subject::query()->withoutGlobalScopes()->whereKey($subject->getKey())->toBase()->update(['og_image_path' => $paths[OgImageCanvas::LANDSCAPE]]);
        $subject->setAttribute('og_image_path', $paths[OgImageCanvas::LANDSCAPE]);

        if ($previous !== null && $previous !== $paths[OgImageCanvas::LANDSCAPE]) {
            $this->disk()->delete(array_values($this->pair($previous)));
        }

        return $paths;
    }

    private function put(string $path, string $jpeg): void
    {
        $this->disk()->put($path, $jpeg, ['visibility' => 'public', 'CacheControl' => 'public, max-age=31536000, immutable']);
    }

    /**
     * @param  array{landscape: string, square: string}  $paths
     */
    private function drawn(array $paths): bool
    {
        return $this->disk()->exists($paths[OgImageCanvas::LANDSCAPE]) && $this->disk()->exists($paths[OgImageCanvas::SQUARE]);
    }

    /**
     * Removes the files at once. The next read of a page that is still public names them again, and their route draws them.
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
            $this->disk()->delete(array_values($this->pair($path)));
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

        // M4.16: the event, business and brand cards keep no column; their folders are swept by what is current.
        return $removed + $this->removeOrphans() + app(ShareCards::class)->prune() + app(PartnerOgImages::class)->prune();
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
     * for every file, since nothing filters on og_image_path otherwise. The square lies beside its landscape file; the brand card keeps
     * only its current pair.
     */
    private function removeOrphans(): int
    {
        $disk = $this->disk();
        $removed = 0;
        $cutoff = now()->getTimestamp() - self::ORPHAN_AGE_SECONDS;
        $site = array_flip(array_values($this->pair($this->path(self::SITE, $this->siteSpec()))));

        foreach ([self::VEHICLES => Vehicle::class, self::MEMBERS => User::class, self::SITE => null] as $directory => $model) {
            $inUse = $site;

            // Read before the files are listed: a file whose row is written later is younger than the cutoff.
            if ($model !== null) {
                $inUse = [];

                foreach ($model::query()->withoutGlobalScopes()->whereNotNull('og_image_path')->toBase()->pluck('og_image_path') as $path) {
                    if (is_string($path)) {
                        $inUse += array_flip(array_values($this->pair($path)));
                    }
                }
            }

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
     */
    private function path(string $directory, array $spec): string
    {
        return $directory.'/'.$this->hash($spec).'.jpg';
    }

    /**
     * @param  array<string, mixed>  $spec
     */
    private function hash(array $spec): string
    {
        return substr(hash_hmac('sha256', (string) json_encode(['v' => self::VERSION, ...$spec]), config()->string('app.key')), 0, 40);
    }

    /**
     * @return array{landscape: string, square: string}
     */
    private function pair(string $landscape): array
    {
        return [OgImageCanvas::LANDSCAPE => $landscape, OgImageCanvas::SQUARE => substr($landscape, 0, -4).'-square.jpg'];
    }

    private function hashOf(string $path): string
    {
        return substr(basename($path, '.jpg'), 0, self::URL_HASH);
    }

    /**
     * "https://speedclub.de/og/v/nissan-skyline-gt-r-r34-5tf974vj-3f9c…-square.jpg"
     */
    private function address(string $base, string $hash, string $format): string
    {
        return PublicUrl::absolute($base.'-'.substr($hash, 0, self::URL_HASH).($format === OgImageCanvas::SQUARE ? '-square' : '').'.jpg');
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
            'title' => $this->vehicleTitle($vehicle),
            'specs' => $this->cardSpecs($vehicle),
            'handle' => $this->handle($vehicle),
            'qr' => $vehicle->activeQrCode?->code,
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
            'builds' => $this->builds($member),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function siteSpec(): array
    {
        $photo = PublicPhoto::brand(self::SITE_PHOTO);
        $largest = end($photo['variants']);

        return ['site' => self::SITE_PHOTO, 'file' => $largest === false ? null : $largest['path'], 'line' => self::SITE_LINE];
    }

    private function usable(?Media $media): ?Media
    {
        return $media !== null && $media->isUsablePhoto() ? $media : null;
    }

    /**
     * What WEB-02 lists: the member's published public builds.
     */
    private function builds(User $member): int
    {
        return $member->vehicles()->where('status', VehicleStatus::Published)->where('visibility', Visibility::Public)->count();
    }

    private function vehicleTitle(Vehicle $vehicle): string
    {
        $title = $this->presenter->title($vehicle);

        return $title !== '' ? $title : $this->presenter->fullTitle($vehicle);
    }

    /**
     * ADR-148 a: the handle only when the owner shows themselves on the pages a link or a code leads to.
     */
    private function handle(Vehicle $vehicle): ?string
    {
        $owner = $vehicle->owner;

        return $owner !== null && $owner->getAttribute('show_owner_on_qr') !== false && is_string($owner->username) ? '@'.$owner->username : null;
    }

    /**
     * The first three entered of the strip: Leistung and Drehmoment first, then Baujahr and Antrieb.
     *
     * @return list<array{value: string, unit: string|null, label: string}>
     */
    public function cardSpecs(Vehicle $vehicle): array
    {
        $specs = [];
        $labels = ['power' => 'garage.spec.power', 'torque' => 'garage.spec.torque', 'model_year' => 'garage.spec.model_year', 'drivetrain' => 'garage.spec.drivetrain'];

        foreach ($this->presenter->specStrip($vehicle, PowerDisplay::PsKw, 'de') as $entry) {
            if ($entry['value'] !== null && count($specs) < 3) {
                $specs[] = [
                    'value' => $entry['value'],
                    'unit' => in_array($entry['key'], ['power', 'torque'], true) ? $entry['unit'] : null,
                    'label' => (string) __($labels[$entry['key']] ?? 'garage.spec.'.$entry['key'], [], 'de'),
                ];
            }
        }

        return $specs;
    }

    private function drawFormat(Vehicle|User|string $subject, string $format): string
    {
        if ($subject instanceof Vehicle) {
            $photo = $this->vehiclePhoto($subject) ?? throw new \RuntimeException('A vehicle card needs a photo.');
            $qr = $subject->activeQrCode;

            return $this->canvas->vehicle(
                $this->media->largestVariant($photo) ?? throw new \RuntimeException('A ready photo has no variant.'),
                $this->floatOrNull($photo->getAttribute('focal_x')),
                $this->floatOrNull($photo->getAttribute('focal_y')),
                // OgImageCanvas skips a line with nothing left to draw.
                $this->presenter->eyebrow($subject),
                $this->vehicleTitle($subject),
                $this->cardSpecs($subject),
                $this->handle($subject),
                $qr === null ? null : $this->renderer->png($this->codes->payload($qr), $format === OgImageCanvas::SQUARE ? 152 : 112),
                $format,
            );
        }

        if ($subject instanceof User) {
            return $this->drawMember($subject, $format);
        }

        $photo = PublicPhoto::brand(self::SITE_PHOTO);
        $largest = end($photo['variants']);
        $bytes = $largest === false ? false : @file_get_contents(public_path($largest['path']));

        if ($bytes === false) {
            throw new \RuntimeException('The brand photo of the default card is missing.');
        }

        return $this->canvas->site($bytes, $photo['focal_x'], $photo['focal_y'], self::SITE_LINE, $format);
    }

    private function drawMember(User $member, string $format): string
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
            $this->builds($member),
            $format,
        );
    }

    private function floatOrNull(mixed $value): ?float
    {
        return is_numeric($value) ? (float) $value : null;
    }
}
