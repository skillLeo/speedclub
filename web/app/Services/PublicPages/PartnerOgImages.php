<?php

namespace App\Services\PublicPages;

use App\Enums\BusinessStatus;
use App\Enums\EventStatus;
use App\Enums\ProductStatus;
use App\Models\Brand;
use App\Models\Business;
use App\Models\Event;
use App\Models\Media;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Businesses\BusinessListing;
use App\Services\Media\MediaService;
use App\Services\Parts\BrandPages;
use App\Services\Showcase\SampleContent;
use App\Support\PublicUrl;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Throwable;

/**
 * M4.16 (09 §9): the link previews of WEB-09 /e/{slug}, WEB-10 /b/{slug} and WEB-11 /brands/{slug}, a 1200 × 630 JPEG and a 1080 × 1080
 * square each, drawn by OgImageCanvas::feature() from real photos only (the cover, else the brand layer's own night photo; a part brand
 * has no photo and gets its name as the wordmark). No AI imagery.
 *
 * Unlike the vehicle and member cards (OgImages), these keep no column: a file is named after a keyed hash of everything it shows
 * (og/e/{hash}.jpg), so a changed title, date, cover or count names a new file by itself, and the public address
 * /og/e/{slug}-{hash16}.jpg can be cached for a year. The route draws a missing card on the spot, one draw per card at a time, so the
 * page view itself never waits for GD. Whatever a guest may not see (a followers-only or removed event, an unverified business, the
 * flag off, a sample while samples are hidden) has no card: cards() answers the brand card and serve() nothing (404). The exact place
 * of an after_rsvp event is never drawn, only the city (09 §8.7, ADR-437 c). og:prune removes files no current card names.
 */
final class PartnerOgImages
{
    /** Part of the hash: raising it redraws every card after a change to the drawing. */
    private const VERSION = 1;

    /** The route's type segment => the folder on the media disk. */
    public const TYPES = ['e' => 'og/e', 'b' => 'og/b', 'brands' => 'og/brands'];

    /** Characters of the hash in the address, as OgImages. */
    private const URL_HASH = 16;

    /** The brand layer's photo for an event or business without a cover. */
    private const FALLBACK_PHOTO = 'landing-hero';

    private const ORPHAN_AGE_SECONDS = 3600;

    private const LOCK_WAIT_SECONDS = 10;

    private const LOCK_SECONDS = 30;

    public function __construct(
        private readonly OgImageCanvas $canvas,
        private readonly OgImages $og,
        private readonly MediaService $media,
        private readonly FeatureFlags $flags,
        private readonly BusinessListing $listing,
        private readonly BrandPages $brands,
    ) {}

    /**
     * For a page: the subject's own cards while a guest may see it, the brand card otherwise. Never draws.
     *
     * @return array{landscape: string, square: string}
     */
    public function cards(Event|Business|Brand $subject): array
    {
        try {
            $spec = $this->spec($subject);

            if ($spec !== null) {
                $hash = substr($this->hash($spec), 0, self::URL_HASH);
                $base = '/og/'.$this->type($subject).'/'.$subject->getAttribute('slug');

                return [
                    OgImageCanvas::LANDSCAPE => PublicUrl::absolute($base.'-'.$hash.'.jpg'),
                    OgImageCanvas::SQUARE => PublicUrl::absolute($base.'-'.$hash.'-square.jpg'),
                ];
            }
        } catch (Throwable $exception) {
            report($exception);
        }

        return $this->og->defaultCards();
    }

    /**
     * For OgImageController: the JPEG behind /og/{type}/{slug}-{hash}[-square].jpg, drawn now when missing. Null when the address names
     * nothing a guest may see. An outdated hash gets today's card, marked not current (an hour of cache instead of a year), as does a
     * sample, whose card must not outlive the flag in caches.
     *
     * @return array{bytes: string, current: bool, etag: string}|null
     */
    public function serve(string $type, string $file): ?array
    {
        if (! isset(self::TYPES[$type]) || preg_match('/\A(?<key>[a-z0-9-]+?)-(?<hash>[0-9a-f]{16})(?<square>-square)?\.jpg\z/', $file, $match) !== 1) {
            return null;
        }

        $subject = $this->find($type, $match['key']);
        $spec = $subject === null ? null : $this->spec($subject);

        if ($subject === null || $spec === null) {
            return null;
        }

        $format = ($match['square'] ?? '') === '' ? OgImageCanvas::LANDSCAPE : OgImageCanvas::SQUARE;
        $paths = $this->paths($type, $spec);
        $sample = ($subject instanceof Event || $subject instanceof Business) && SampleContent::isSample($subject);
        $current = hash_equals(substr($this->hash($spec), 0, self::URL_HASH), $match['hash']) && ! $sample;

        try {
            if (! $this->drawn($paths)) {
                Cache::lock('og-draw:'.$paths[OgImageCanvas::LANDSCAPE], self::LOCK_SECONDS)->block(self::LOCK_WAIT_SECONDS, function () use ($subject, $paths): void {
                    if (! $this->drawn($paths)) {
                        foreach ($paths as $format => $path) {
                            $this->disk()->put($path, $this->draw($subject, $format), ['visibility' => 'public', 'CacheControl' => 'public, max-age=31536000, immutable']);
                        }
                    }
                });
            }

            $bytes = $this->disk()->get($paths[$format]) ?? throw new \RuntimeException('A drawn card is missing.');

            return ['bytes' => $bytes, 'current' => $current, 'etag' => basename($paths[$format], '.jpg')];
        } catch (LockTimeoutException) {
            return ['bytes' => $this->draw($subject, $format), 'current' => false, 'etag' => 'pending'];
        } catch (Throwable $exception) {
            report($exception);

            return ['bytes' => (string) file_get_contents(public_path(config()->string('speedclub.public_pages.og_default'))), 'current' => false, 'etag' => 'fallback'];
        }
    }

    /**
     * Daily with og:prune: every file in the three folders that no current card names, once it is older than an hour (a draw in
     * progress may not have finished its pair yet).
     */
    public function prune(): int
    {
        $disk = $this->disk();
        $cutoff = now()->getTimestamp() - self::ORPHAN_AGE_SECONDS;
        $inUse = [];
        $removed = 0;

        foreach ($this->publicSubjects() as $subject) {
            $spec = $this->spec($subject);

            if ($spec !== null) {
                $inUse += array_flip(array_values($this->paths($this->type($subject), $spec)));
            }
        }

        foreach (self::TYPES as $directory) {
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
     * Everything the card shows, or null when a guest may not see the subject. German, as every card: no reader is known when it is drawn.
     *
     * @return array<string, mixed>|null
     */
    public function spec(Event|Business|Brand $subject): ?array
    {
        if ($subject instanceof Event) {
            if (! $this->flags->enabled('events') || ! Gate::forUser(null)->allows('view', $subject) || $subject->starts_at === null) {
                return null;
            }

            $cover = $this->usable($subject->cover);
            $starts = CarbonImmutable::instance($subject->starts_at)->timezone((string) ($subject->getAttribute('timezone') ?? 'Europe/Berlin'))->settings(['locale' => 'de']);
            $eyebrow = $subject->type->label('de').($subject->status === EventStatus::Cancelled ? ' · '.__('public.event.cancelled', [], 'de') : '');

            return [
                'kind' => 'e',
                'photo' => $cover?->getKey(),
                'focal' => [$cover?->getAttribute('focal_x'), $cover?->getAttribute('focal_y')],
                'eyebrow' => $eyebrow,
                'title' => $subject->title,
                // Only the city: the venue of an after_rsvp event is never on a card (09 §8.7).
                'line' => $subject->city,
                'facts' => [
                    ['value' => $starts->isoFormat('D'), 'unit' => $starts->isoFormat('MMM'), 'label' => $starts->isoFormat('dddd')],
                    ['value' => $starts->format('H:i'), 'unit' => 'Uhr', 'label' => __('public.event.og_start', [], 'de')],
                ],
            ];
        }

        if ($subject instanceof Business) {
            if (! $this->flags->enabled('businesses') || ! Gate::forUser(null)->allows('view', $subject)) {
                return null;
            }

            $cover = $this->usable($subject->cover);
            $count = $subject->is_sample ? 0 : $this->listing->portfolioCount(null, $subject);

            return [
                'kind' => 'b',
                'photo' => $cover?->getKey(),
                'focal' => [$cover?->getAttribute('focal_x'), $cover?->getAttribute('focal_y')],
                'eyebrow' => $subject->kind->label('de').' · '.$subject->city,
                'title' => $subject->name,
                'line' => $subject->status === BusinessStatus::Verified ? __('public.business.verified', [], 'de') : null,
                'facts' => $count > 0 ? [['value' => (string) $count, 'unit' => $count === 1 ? 'Build' : 'Builds', 'label' => __('public.business.og_portfolio', [], 'de')]] : [],
            ];
        }

        if (! $this->flags->enabled('parts_catalogue') || $subject->getAttribute('merged_into_id') !== null) {
            return null;
        }

        $page = $this->brands->page(null, $subject);

        if ($page['products'] === 0) {
            return null;
        }

        $facts = [['value' => (string) $page['products'], 'unit' => '', 'label' => trans_choice('public.brand.og_products', $page['products'], [], 'de')]];

        if ($page['builds'] > 0) {
            array_unshift($facts, ['value' => (string) $page['builds'], 'unit' => '', 'label' => trans_choice('public.brand.builds', $page['builds'], [], 'de')]);
        }

        return [
            'kind' => 'brands',
            'eyebrow' => __('public.brand.og_eyebrow', [], 'de'),
            'title' => $subject->name,
            'line' => is_array($subject->about) ? ($subject->about['de'] ?? null) : null,
            'facts' => $facts,
        ];
    }

    private function find(string $type, string $slug): Event|Business|Brand|null
    {
        return match ($type) {
            'e' => Event::query()->with(['organiser', 'cover'])->where('slug', $slug)->first(),
            'b' => Business::query()->with(['owner', 'cover'])->where('slug', $slug)->first(),
            default => ($brand = $this->brands->find($slug)) !== null && $brand->slug === $slug ? $brand : null,
        };
    }

    /**
     * @return iterable<Event|Business|Brand>
     */
    private function publicSubjects(): iterable
    {
        yield from Event::query()->with(['organiser', 'cover'])->whereIn('status', [EventStatus::Published->value, EventStatus::Cancelled->value])
            ->whereNull('removed_at')->lazyById(200);
        yield from Business::query()->with(['owner', 'cover'])->where('status', BusinessStatus::Verified->value)->whereNull('removed_at')->lazyById(200);
        yield from Brand::query()->whereNull('merged_into_id')
            ->whereHas('products', fn ($products) => $products->where('status', ProductStatus::Active->value))->lazyById(200);
    }

    private function draw(Event|Business|Brand $subject, string $format): string
    {
        $spec = $this->spec($subject) ?? throw new \RuntimeException('No card for a subject a guest may not see.');
        $photo = null;
        $focalX = null;
        $focalY = null;

        if (! $subject instanceof Brand) {
            $cover = $this->usable($subject->cover);

            if ($cover !== null) {
                $photo = $this->media->largestVariant($cover);
                $focalX = $this->floatOrNull($cover->getAttribute('focal_x'));
                $focalY = $this->floatOrNull($cover->getAttribute('focal_y'));
            }

            if ($photo === null) {
                $brand = PublicPhoto::brand(self::FALLBACK_PHOTO);
                $largest = end($brand['variants']);
                $bytes = $largest === false ? false : @file_get_contents(public_path($largest['path']));
                $photo = $bytes === false ? null : $bytes;
                $focalX = $brand['focal_x'];
                $focalY = $brand['focal_y'];
            }
        }

        return $this->canvas->feature(
            $photo,
            $focalX,
            $focalY,
            (string) $spec['eyebrow'],
            (string) $spec['title'],
            $subject instanceof Brand ? 'marque' : 'name',
            is_string($spec['line']) ? $spec['line'] : null,
            $spec['facts'],
            $format,
        );
    }

    private function type(Event|Business|Brand $subject): string
    {
        return match (true) {
            $subject instanceof Event => 'e',
            $subject instanceof Business => 'b',
            default => 'brands',
        };
    }

    /**
     * @param  array<string, mixed>  $spec
     * @return array{landscape: string, square: string}
     */
    private function paths(string $type, array $spec): array
    {
        $landscape = self::TYPES[$type].'/'.$this->hash($spec).'.jpg';

        return [OgImageCanvas::LANDSCAPE => $landscape, OgImageCanvas::SQUARE => substr($landscape, 0, -4).'-square.jpg'];
    }

    /**
     * @param  array<string, mixed>  $spec
     */
    private function hash(array $spec): string
    {
        return substr(hash_hmac('sha256', (string) json_encode(['v' => self::VERSION, ...$spec]), config()->string('app.key')), 0, 40);
    }

    /**
     * @param  array{landscape: string, square: string}  $paths
     */
    private function drawn(array $paths): bool
    {
        return $this->disk()->exists($paths[OgImageCanvas::LANDSCAPE]) && $this->disk()->exists($paths[OgImageCanvas::SQUARE]);
    }

    private function usable(?Media $media): ?Media
    {
        return $media !== null && $media->isUsablePhoto() ? $media : null;
    }

    private function disk(): Filesystem
    {
        return Storage::disk(config()->string('speedclub.media.disk'));
    }

    private function floatOrNull(mixed $value): ?float
    {
        return is_numeric($value) ? (float) $value : null;
    }
}
