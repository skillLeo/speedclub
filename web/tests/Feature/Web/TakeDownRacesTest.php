<?php

use App\Actions\Garage\ChangeVehicleVisibility;
use App\Enums\DecisionAction;
use App\Enums\ReportTargetType;
use App\Enums\RestrictionType;
use App\Enums\Visibility;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\AppConfig\LegalDocuments;
use App\Services\PublicPages\OgImages;
use App\Services\PublicPages\SitemapWriter;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Tests\Support\TestImages;

require_once dirname(__DIR__).'/Garage/GarageTestHelpers.php';
require_once dirname(__DIR__).'/Moderation/ModerationTestHelpers.php';

/**
 * SEC-P1-08: a change that leaves the public while the sitemap renders is not undone by the render's put. SEC-P1-09: a suspension
 * takes the member's and the vehicles' OG files down at once, not with og:prune.
 */
beforeEach(function () {
    Storage::fake('local');
    Storage::fake('public');
    Mail::fake();
    $this->withoutDefer();
    config(['app.url' => 'https://speedclub.de']);
});

/** A SitemapWriter that runs $during between rendering and writing, where a concurrent request would hit. */
function racingSitemap(Closure $during): SitemapWriter
{
    return new class(app(LegalDocuments::class), $during) extends SitemapWriter
    {
        public function __construct(LegalDocuments $legal, private readonly Closure $during)
        {
            parent::__construct($legal);
        }

        public function render(): string
        {
            $xml = parent::render();
            ($this->during)();

            return $xml;
        }
    };
}

function takeDownOgPath(Vehicle|User $subject): ?string
{
    return $subject::query()->withoutGlobalScopes()->whereKey($subject->getKey())->toBase()->value('og_image_path');
}

function takeDownDrawnVehicle(User $owner): Vehicle
{
    $vehicle = publishedVehicle($owner);

    foreach ($vehicle->media()->firstOrFail()->getAttribute('variants') as $path) {
        Storage::disk('public')->put($path, TestImages::webp(1600, 1067));
    }

    app(OgImages::class)->draw(Vehicle::query()->findOrFail($vehicle->id));

    return $vehicle;
}

describe('SEC-P1-08 sitemap', function () {
    it('drops its own file when something left the public while it rendered, and the next read leaves it out', function () {
        $owner = User::factory()->create(['username' => 'bleibt']);
        $leaving = publishedVehicle($owner);
        $staying = publishedVehicle($owner);
        $path = config()->string('speedclub.public_pages.sitemap_path');

        $stale = racingSitemap(fn () => app(ChangeVehicleVisibility::class)->handle(Vehicle::query()->findOrFail($leaving->id), Visibility::Private))->write();

        // The render began before the change, so it still lists the vehicle; its file must not stay.
        expect($stale)->toContain(strtolower($leaving->public_id));
        Storage::disk('local')->assertMissing($path);

        expect($this->get('/sitemap.xml')->assertOk()->getContent())
            ->not->toContain(strtolower($leaving->public_id))
            ->toContain(strtolower($staying->public_id));
        Storage::disk('local')->assertExists($path);
    });

    it('keeps its file when nothing left the public while it rendered', function () {
        publishedVehicle(User::factory()->create());

        racingSitemap(fn () => app(ChangeVehicleVisibility::class)->handle(publishedVehicle(User::factory()->create(), ['visibility' => 'unlisted']), Visibility::Public))->write();

        Storage::disk('local')->assertExists(config()->string('speedclub.public_pages.sitemap_path'));
    });

    it('moves the epoch with every forget', function () {
        $writer = app(SitemapWriter::class);
        $writer->forget();
        $first = Cache::get(SitemapWriter::EPOCH_KEY);
        $writer->forget();

        expect($first)->toBeString()->and(Cache::get(SitemapWriter::EPOCH_KEY))->toBeString()->not->toBe($first);
    });
});

describe('SEC-P1-09 OG files of a suspended member', function () {
    beforeEach(function () {
        $this->affected = User::factory()->create(['username' => 'tobi.quattro', 'locale' => 'de']);
        $this->reporter = User::factory()->create(['username' => 'nico.sti']);
    });

    it('removes the member\'s and every vehicle\'s file at once, and the sitemap', function (?CarbonImmutable $until) {
        $first = takeDownDrawnVehicle($this->affected);
        $second = takeDownDrawnVehicle($this->affected);
        app(OgImages::class)->draw(User::query()->findOrFail($this->affected->id));
        $other = takeDownDrawnVehicle($this->reporter);
        app(SitemapWriter::class)->write();

        $paths = [takeDownOgPath($first), takeDownOgPath($second), takeDownOgPath($this->affected)];
        expect($paths)->each->toBeString();

        modDecide(modCaseOf(modReport($this->reporter, ReportTargetType::Member, 'tobi.quattro')), DecisionAction::Suspend, ['until' => $until]);

        foreach ($paths as $path) {
            Storage::disk('public')->assertMissing($path);
        }

        expect(takeDownOgPath($first))->toBeNull()
            ->and(takeDownOgPath($second))->toBeNull()
            ->and(takeDownOgPath($this->affected))->toBeNull()
            ->and(takeDownOgPath($other))->toBeString();
        Storage::disk('public')->assertExists(takeDownOgPath($other));
        Storage::disk('local')->assertMissing(config()->string('speedclub.public_pages.sitemap_path'));
        expect($this->get('/sitemap.xml')->getContent())->not->toContain('/u/tobi.quattro')->not->toContain(strtolower($first->public_id));
    })->with(['with an end' => fn () => CarbonImmutable::now()->addWeek(), 'without an end' => null]);

    it('leaves the files of a member who is only restricted from messaging', function () {
        $vehicle = takeDownDrawnVehicle($this->affected);
        $path = takeDownOgPath($vehicle);

        modDecide(modCaseOf(modReport($this->reporter, ReportTargetType::Member, 'tobi.quattro')), DecisionAction::Restrict, ['restriction' => RestrictionType::Messaging]);

        Storage::disk('public')->assertExists($path);
        expect(takeDownOgPath($vehicle))->toBe($path);
    });
});
