<?php

namespace App\Services\PublicPages;

use App\Enums\LegalDocumentKey;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\AppConfig\LegalDocuments;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Throwable;
use XMLWriter;

/**
 * /sitemap.xml, written once a day by the scheduler, dropped by forget() when something leaves the public, and read by
 * PlatformFilesController. Public vehicles and members who allow search engines:
 * no private or unlisted vehicle, no owner who switched indexing off, nobody who is not public. Written with XMLWriter
 * and not spatie/laravel-sitemap: its add() compares every new tag with all earlier ones, so its time grows with the square
 * of the URLs, and a cron run on shared hosting does not have that time.
 *
 * A forget() while a write() renders (SEC-P1-08) would be undone by the put of the older render. forget() therefore sets a new epoch
 * first and drops the file second, and write() drops its own file again when the epoch moved since it began rendering: whichever of
 * the two comes last, no file outlives a forget() that began after the render started. The epoch lives in the cache, which every
 * process shares (the database store on the host).
 */
class SitemapWriter
{
    public const EPOCH_KEY = 'public_pages:sitemap_epoch';

    private const LEGAL_PATHS = [
        'impressum' => LegalDocumentKey::Imprint,
        'datenschutz' => LegalDocumentKey::Privacy,
        'agb' => LegalDocumentKey::Terms,
        'community-richtlinien' => LegalDocumentKey::Community,
    ];

    public function __construct(private readonly LegalDocuments $legal) {}

    public function write(): string
    {
        $epoch = $this->epoch();
        $xml = $this->render();
        $path = config()->string('speedclub.public_pages.sitemap_path');

        Storage::disk('local')->put($path, $xml);

        // Something left the public while this rendered: the file may still list it. The next read writes a fresh one.
        if ($this->epoch() !== $epoch) {
            Storage::disk('local')->delete($path);
        }

        return $xml;
    }

    /**
     * What was written last; writes it when there is none yet, so a fresh deploy does not answer 404 until the night, and nothing
     * forgotten is served again.
     */
    public function read(): string
    {
        return Storage::disk('local')->get(config()->string('speedclub.public_pages.sitemap_path')) ?? $this->write();
    }

    /**
     * Drops the written file, so the next read writes a fresh one. For whatever leaves the public, which must not wait for the
     * night: a vehicle that is no longer public or is deleted, an owner who switched search engines off, and in later modules a
     * member who is suspended or deactivated. Something new may wait. Never throws: the change itself has happened.
     */
    public function forget(): void
    {
        try {
            // The epoch first: a write() that puts its file after the delete below then sees it moved and drops that file too.
            Cache::forever(self::EPOCH_KEY, (string) Str::ulid());
        } catch (Throwable $exception) {
            report($exception);
        }

        try {
            Storage::disk('local')->delete(config()->string('speedclub.public_pages.sitemap_path'));
        } catch (Throwable $exception) {
            report($exception);
        }
    }

    /**
     * An unreadable cache counts as a moved epoch: the file is dropped rather than kept on trust.
     */
    private function epoch(): string
    {
        try {
            $epoch = Cache::get(self::EPOCH_KEY);
        } catch (Throwable $exception) {
            report($exception);

            return (string) Str::ulid();
        }

        return is_string($epoch) ? $epoch : '';
    }

    public function render(): string
    {
        $remaining = config()->integer('speedclub.public_pages.sitemap_max_urls');

        $writer = new XMLWriter;
        $writer->openMemory();
        $writer->startDocument('1.0', 'UTF-8');
        $writer->startElementNs(null, 'urlset', 'http://www.sitemaps.org/schemas/sitemap/0.9');

        $this->url($writer, '/');
        $remaining--;

        foreach (self::LEGAL_PATHS as $path => $key) {
            $document = $this->legal->current($key, 'de');

            if ($document !== null) {
                $this->url($writer, '/'.$path, $document->published_at);
                $remaining--;
            }
        }

        foreach ($this->vehicles() as $vehicle) {
            if ($remaining <= 0) {
                break;
            }

            if ($vehicle->owner?->isPubliclyVisible() === true) {
                $this->url($writer, '/v/'.$vehicle->canonicalSlug(), $vehicle->updated_at);
                $remaining--;
            }
        }

        foreach ($this->members() as $member) {
            if ($remaining <= 0) {
                break;
            }

            // No lastmod: users.updated_at moves with every sign-in and settings change, which is nobody's business (08 §1).
            if ($member->isPubliclyVisible()) {
                $this->url($writer, '/u/'.$member->username);
                $remaining--;
            }
        }

        $writer->endElement();
        $writer->endDocument();

        return $writer->outputMemory();
    }

    private function url(XMLWriter $writer, string $path, ?CarbonInterface $modified = null): void
    {
        $writer->startElement('url');
        $writer->writeElement('loc', rtrim(config()->string('app.url'), '/').$path);

        if ($modified !== null) {
            $writer->writeElement('lastmod', $modified->toAtomString());
        }

        $writer->endElement();
    }

    /**
     * @return iterable<int, Vehicle>
     */
    private function vehicles(): iterable
    {
        return Vehicle::query()
            ->where('status', VehicleStatus::Published)
            ->where('visibility', Visibility::Public)
            ->whereHas('owner', fn ($owner) => $owner->where('indexable', true))
            ->with(['owner', 'make', 'vehicleModel', 'generation'])
            ->orderByDesc('updated_at')
            ->orderBy('id')
            ->lazy(500);
    }

    /**
     * Oldest members first. Not by updated_at either: the order alone would tell who signed in last.
     *
     * @return iterable<int, User>
     */
    private function members(): iterable
    {
        return User::query()
            ->where('indexable', true)
            ->whereNotNull('username')
            ->whereNotNull('email_verified_at')
            ->lazyById(500);
    }
}
