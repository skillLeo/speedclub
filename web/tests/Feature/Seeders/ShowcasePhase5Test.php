<?php

use App\Actions\Admin\Stickers\DownloadStickerPrintFile;
use App\Enums\CheckinMethod;
use App\Enums\GalleryPhotoStatus;
use App\Enums\ModStatus;
use App\Enums\QrStatus;
use App\Enums\StickerScanTest;
use App\Enums\ViewSource;
use App\Enums\ViewSubject;
use App\Models\Event;
use App\Models\EventCheckin;
use App\Models\EventPhoto;
use App\Models\FeatureFlag;
use App\Models\Media;
use App\Models\Modification;
use App\Models\StickerDesign;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Events\EventCheckins;
use App\Services\Events\EventGallery;
use App\Services\Qr\QrCodes;
use App\Services\Showcase\SampleContent;
use App\Services\Showcase\Showcase;
use App\Services\Showcase\ShowcaseEvents;
use App\Services\Showcase\ShowcasePhase5;
use App\Services\Showcase\ShowcasePurge;
use Carbon\CarbonImmutable;
use Database\Seeders\CatalogSeeder;
use Database\Seeders\DemoShowcaseSeeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;

/**
 * M5.10 demo refresh (ShowcasePhase5, run by DemoShowcaseSeeder after ShowcaseMaintenance) on a small photo set of its own and the
 * classic demo members the past meet names: sticker designs through the Scan-Test, plans, the owner-only view history, check-ins and
 * the gallery queue; a re-run changes nothing, the purge removes all of it, production refuses.
 */
const P5_PHOTOS = [
    ['BMW', 'M4', 'G82', 12],
    ['Porsche', '911', '992', 12],
    ['Toyota', 'Supra', 'A80', 8],
    ['Honda', 'Civic Type R', 'FK8', 8],
];

/** Graded gallery photos of the past demo meet (events.json): two approved, the two pending ones. */
const P5_GALLERY = ['cover-garage-02.jpg', 'porsche-964-01.jpg', 'generic-exterior-03.jpg', 'generic-detail-02.jpg'];

/** The classic demo members (DemoSeeder, no samples) of the two demo meets. */
const P5_CLASSIC = ['lukas.sc', 'max.e46', 'jann.ptrs', 'sara.gti', 'lena.911', 'finn.jdm', 'tobi.quattro'];

beforeEach(function () {
    // A Wednesday noon in Germany; the view history counts back from this day.
    $this->travelTo(CarbonImmutable::parse('2026-11-18 12:00', 'Europe/Berlin'));
});

afterEach(function () {
    if (is_string($this->p5Root ?? null)) {
        File::deleteDirectory($this->p5Root);
    }
});

function p5PhotoDirectory(): string
{
    $directory = storage_path('framework/testing/p5-photos');
    File::deleteDirectory($directory);
    File::ensureDirectoryExists("$directory/processed");
    $manifest = [];

    foreach (P5_PHOTOS as [$make, $model, $generation, $count]) {
        for ($i = 1; $i <= $count; $i++) {
            $file = Str::slug("$make-$model-$generation")."-$i.jpg";
            p5Jpeg("$directory/$file", $i, 360, 240);
            $manifest[] = ['file' => $file, 'make' => $make, 'model' => $model, 'generation' => $generation, 'category' => $i === 2 ? 'interior' : 'exterior', 'alt_de' => "$make $model $generation, Foto $i", 'focal' => ['x' => 0.5, 'y' => 0.5]];
        }
    }

    foreach (P5_GALLERY as $index => $file) {
        p5Jpeg("$directory/processed/".Str::beforeLast($file, '.jpg').'-2048.jpg', 3 + $index, 300, 200);
    }

    File::put("$directory/manifest.json", (string) json_encode($manifest));

    return $directory;
}

function p5Jpeg(string $path, int $shade, int $width, int $height): void
{
    $image = imagecreatetruecolor($width, $height);
    imagefill($image, 0, 0, (int) imagecolorallocate($image, 20 * $shade % 255, 90, 140));
    imagejpeg($image, $path, 80);
}

function p5Host(): void
{
    app()->detectEnvironment(fn () => 'staging');

    foreach (['public', 'local'] as $disk) {
        Storage::fake($disk);
    }

    $root = storage_path('framework/testing/disks/p5-'.Str::lower(Str::random(10)));
    test()->p5Root = $root;

    config([
        'filesystems.disks.p5_public' => ['driver' => 'local', 'root' => "$root/public", 'url' => 'http://localhost/storage', 'visibility' => 'public', 'throw' => false],
        'filesystems.disks.p5_private' => ['driver' => 'local', 'root' => "$root/private", 'throw' => false],
        'speedclub.media.disk' => 'p5_public', 'speedclub.media.private_disk' => 'p5_private',
        'speedclub.demo.member_password' => 'showcase-member-password', 'speedclub.demo.staff_password' => 'showcase-staff-password',
        'speedclub.demo.staff_totp_secret' => null, 'speedclub.demo.clear_media_database' => 'none',
        'speedclub.staff.owner_email' => 'owner@speedclub.test', 'queue.default' => 'sync',
        // A configured store, so "Sticker bestellen" records the request (STK-06).
        'speedclub.stickers.shop' => ['domain' => 'speedclub-demo.myshopify.com', 'variant' => '4242', 'variants' => ['s' => null, 'm' => null, 'l' => null]],
    ]);

    foreach ([SampleContent::FLAG, 'insights'] as $flag) {
        FeatureFlag::query()->updateOrCreate(['key' => $flag], ['enabled' => true, 'description' => $flag]);
    }
}

/**
 * The classic demo members of events.json, and lukas.sc's published build with its sticker code.
 */
function p5ClassicMembers(): Vehicle
{
    // The catalogue first: the factory's own make would make DemoShowcaseSeeder think it is there already.
    test()->seed(CatalogSeeder::class);

    foreach (P5_CLASSIC as $username) {
        User::factory()->create(['username' => $username, 'email' => "$username@speedclub.test", 'is_sample' => false]);
    }

    $lukas = User::query()->where('username', 'lukas.sc')->firstOrFail();
    $vehicle = Vehicle::factory()->published()->create(['owner_id' => $lukas->id, 'is_main' => true]);
    Media::factory()->forModel($vehicle)->create(['owner_id' => $lukas->id]);
    app(QrCodes::class)->ensureActive($vehicle);

    return $vehicle->refresh();
}

function p5Run(): void
{
    $directory = p5PhotoDirectory();

    (new class($directory) extends DemoShowcaseSeeder
    {
        public function __construct(private readonly string $photos) {}

        protected function photoDirectory(): string
        {
            return $this->photos;
        }
    })->setContainer(app())->__invoke();
}

/**
 * @return array<string, int|string>
 */
function p5Snapshot(): array
{
    $counts = app(ShowcasePurge::class)->counts();

    foreach (['sticker_designs', 'view_days', 'event_checkins', 'event_checkin_codes', 'event_photos', 'modifications', 'build_updates', 'media', 'notifications'] as $table) {
        $counts["table:$table"] = DB::table($table)->count();
    }

    $counts['views'] = (int) DB::table('view_days')->sum('views');
    $counts['view_rows'] = md5((string) json_encode(DB::table('view_days')->orderBy('subject_id')->orderBy('day')->orderBy('source')->get(['subject_id', 'day', 'source', 'views'])));
    $counts['designs'] = md5((string) json_encode(StickerDesign::query()->orderBy('reference')->get(['reference', 'version', 'revision', 'template', 'scan_test', 'validated_at'])));
    $counts['plan_rows'] = md5((string) json_encode(Modification::query()->where('status', ModStatus::Planned->value)->orderBy('id')->get(['id', 'target_month', 'priority', 'budget_cents', 'plan_sort'])));
    $counts['print_downloads'] = DB::table('audit_events')->where('action', DownloadStickerPrintFile::EVENT)->count();

    return $counts;
}

it('refuses production and every environment but local and staging', function (string $environment) {
    app()->detectEnvironment(fn () => $environment);

    expect(fn () => app(ShowcasePhase5::class)->seed(CarbonImmutable::now()))->toThrow(RuntimeException::class, "APP_ENV is $environment")
        ->and(StickerDesign::query()->count())->toBe(0)
        ->and(DB::table('view_days')->count())->toBe(0)
        ->and(EventCheckin::query()->count())->toBe(0);
})->with(['production', 'testing', 'demo']);

it('fills the Phase 5 pages, keeps insights owner-only, changes nothing when run again and leaves nothing after the purge', function () {
    p5Host();
    $lukasCar = p5ClassicMembers();

    p5Run();
    $first = p5Snapshot();

    $hero = User::query()->where('username', Showcase::SHOWCASE_USERNAME)->firstOrFail();
    $heroCars = Vehicle::query()->where('owner_id', $hero->id)->where('status', 'published')->orderByDesc('is_main')->orderBy('sort')->orderBy('id')->get();
    $main = $heroCars->firstOrFail();
    expect($heroCars)->toHaveCount(3);

    // --- 1. Sticker designs: all six templates, frozen versions passed the server Scan-Test with the car's active code, a version
    // history, a draft, the ordered design and one audited print download; lukas.sc's build has its two versions too.
    $designs = StickerDesign::query()->with(['vehicle.owner', 'qrCode'])->get();
    $validated = $designs->filter(fn (StickerDesign $design): bool => $design->isValidated());
    expect($designs->pluck('template')->map->value->unique()->sort()->values()->all())->toBe(['banner', 'classic', 'minimal', 'plate', 'round', 'vertical_jdm'])
        ->and($designs->pluck('vehicle_id')->unique()->count())->toBe(8)
        ->and($validated->count())->toBeGreaterThanOrEqual(7)
        ->and($designs->filter(fn (StickerDesign $design): bool => ! $design->isValidated())->count())->toBeGreaterThanOrEqual(2)
        ->and(StickerDesign::query()->whereNotNull('order_requested_at')->count())->toBe(2)
        ->and($first['print_downloads'])->toBe(1);

    foreach ($validated as $design) {
        expect($design->scan_test)->toBe(StickerScanTest::Passed)
            ->and($design->qrCode?->status)->toBe(QrStatus::Active)
            ->and($design->qrCode?->vehicle_id)->toBe($design->vehicle_id)
            ->and($design->reference)->toBe(ShowcasePhase5::reference($design->vehicle_id, $design->version));
    }

    $mainVersions = StickerDesign::query()->where('vehicle_id', $main->id)->orderBy('version')->get();
    expect($mainVersions->pluck('version')->all())->toBe([1, 2])
        ->and($mainVersions->every(fn (StickerDesign $design): bool => $design->isValidated()))->toBeTrue()
        ->and($mainVersions->last()?->order_requested_at)->not->toBeNull()
        ->and(DB::table('audit_events')->where('action', DownloadStickerPrintFile::EVENT)->value('target_id'))->toBe($mainVersions->last()?->id)
        ->and(StickerDesign::query()->where('vehicle_id', $lukasCar->id)->orderBy('version')->pluck('template')->map->value->all())->toBe(['classic', 'vertical_jdm'])
        ->and(StickerDesign::query()->where('vehicle_id', $heroCars[2]->id)->firstOrFail()->isValidated())->toBeFalse();

    // --- 2. Plans: target months in the coming season and the year after, all three priorities, owner-only budgets, the owner's order.
    $plans = Modification::query()->whereIn('vehicle_id', Vehicle::query()->where('is_sample', true)->select('id'))->where('status', ModStatus::Planned->value)->whereNotNull('target_month')->get();
    // The showcase clock of a first run is now: every target month lies ahead of it.
    $clock = CarbonImmutable::now();
    expect($plans->pluck('vehicle_id')->unique()->count())->toBeGreaterThanOrEqual(7)
        ->and($plans->map(fn (Modification $mod): string => (string) $mod->getAttribute('priority')?->value)->unique()->sort()->values()->all())->toBe(['high', 'low', 'normal'])
        ->and($plans->map(fn (Modification $mod): int => CarbonImmutable::parse((string) $mod->getAttribute('target_month'))->year)->unique()->count())->toBeGreaterThanOrEqual(2)
        ->and($plans->every(fn (Modification $mod): bool => CarbonImmutable::parse((string) $mod->getAttribute('target_month'))->greaterThan($clock->startOfMonth())))->toBeTrue()
        ->and($plans->every(fn (Modification $mod): bool => is_int($mod->getAttribute('budget_cents')) && $mod->getAttribute('budget_cents') > 0))->toBeTrue()
        ->and(Modification::query()->where('vehicle_id', $main->id)->where('status', ModStatus::Planned->value)->count())->toBeGreaterThanOrEqual(3);

    foreach ($plans->groupBy('vehicle_id') as $vehiclePlans) {
        $all = Modification::query()->where('vehicle_id', $vehiclePlans->first()?->vehicle_id)->where('status', ModStatus::Planned->value)->orderBy('plan_sort')->get();
        // The owner's order: the more urgent plan first.
        $ranks = $all->map(fn (Modification $mod): int => ['high' => 0, 'normal' => 1, 'low' => 2][$mod->getAttribute('priority')?->value] ?? 3)->all();
        $sorted = $ranks;
        sort($sorted);
        expect($all->pluck('plan_sort')->all())->toBe(range(0, $all->count() - 1))
            ->and($ranks)->toBe($sorted);
    }

    foreach (Vehicle::query()->where('is_sample', true)->withCount('modifications')->get() as $vehicle) {
        expect($vehicle->modifications_count)->toBeLessThanOrEqual(15);
    }

    // --- 3. View history: 120 Berlin days for profiles and builds, every source, sticker-scan views never above the day's scans,
    // a weekend rhythm, nothing for the Editorial account.
    $today = CarbonImmutable::now('Europe/Berlin')->toDateString();
    $views = DB::table('view_days')->where('owner_id', $hero->id);
    expect((clone $views)->min('day'))->toBeGreaterThanOrEqual(CarbonImmutable::now('Europe/Berlin')->subDays(ShowcasePhase5::VIEW_DAYS - 1)->toDateString())
        ->and(substr((string) (clone $views)->max('day'), 0, 10))->toBe($today)
        ->and((clone $views)->where('subject_type', ViewSubject::Profile->value)->where('subject_id', $hero->id)->whereNull('vehicle_id')->sum('views'))->toBeGreaterThan(0)
        ->and((clone $views)->distinct()->pluck('source')->sort()->values()->all())->toBe(collect(ViewSource::cases())->map->value->sort()->values()->all())
        ->and(DB::table('view_days')->whereIn('owner_id', User::query()->where('is_editorial', true)->select('id'))->count())->toBe(0)
        ->and(DB::table('view_days')->whereNotIn('owner_id', User::query()->where('is_sample', true)->select('id'))->count())->toBe(0);

    $scans = DB::table('qr_scan_daily')->join('qr_codes', 'qr_codes.id', '=', 'qr_scan_daily.qr_code_id')
        ->groupBy('qr_codes.vehicle_id', 'qr_scan_daily.day')->selectRaw('qr_codes.vehicle_id as vehicle_id, qr_scan_daily.day as day, SUM(qr_scan_daily.count) as total')
        ->get()->mapWithKeys(fn (object $row): array => [$row->vehicle_id.'|'.substr((string) $row->day, 0, 10) => (int) $row->total]);

    foreach (DB::table('view_days')->where('source', ViewSource::StickerScan->value)->get() as $row) {
        expect($row->views)->toBeLessThanOrEqual($scans[$row->vehicle_id.'|'.substr((string) $row->day, 0, 10)] ?? 0);
    }

    $byWeekday = DB::table('view_days')->where('vehicle_id', $main->id)->get()->groupBy(fn (object $row): int => CarbonImmutable::parse((string) $row->day)->isoWeekday())
        ->map(fn ($rows): int => (int) $rows->sum('views'));
    expect($byWeekday[6] + $byWeekday[7])->toBeGreaterThan($byWeekday[1] + $byWeekday[2]);

    // Owner-only: the hero reads his numbers, another member gets 403, no public surface carries a view count or a budget amount.
    Sanctum::actingAs($hero);
    $account = $this->getJson('/api/v1/me/insights')->assertOk()->json('data');
    expect($account['views']['this_week'])->toBeGreaterThan(0)
        ->and(collect($account['sources'])->where('views', '>', 0)->count())->toBeGreaterThanOrEqual(3);

    Sanctum::actingAs(User::query()->where('username', 'lukas.sc')->firstOrFail());
    $this->getJson("/api/v1/vehicles/{$main->id}/insights")->assertForbidden();

    app('auth')->forgetGuards();
    $public = $this->getJson('/api/v1/public/vehicles/'.$main->canonicalSlug());
    $public->assertOk();
    expect(array_keys($public->json('data')))->not->toContain('views', 'view_count', 'views_count', 'insights')
        // A plan's budget is the owner's alone: null for everybody else.
        ->and(preg_match_all('/"budget":(?!null)/', (string) $public->getContent()))->toBe(0)
        ->and(substr_count((string) $public->getContent(), '"budget":null'))->toBeGreaterThan(0);

    // --- 4. The past demo meet: four going members and a walk-in checked in with the organiser's code during the meet, the gallery
    // with approved photos and two in the organiser's queue, uploaded inside the gallery window, within the per-attendee limit.
    $meet = Event::query()->where('slug', ShowcaseEvents::slug('saugmotor', 'Saugmotor-Abend'))->firstOrFail();
    $checkins = EventCheckin::query()->with('user')->where('event_id', $meet->id)->get();
    $window = app(EventCheckins::class);
    expect($checkins->map(fn (EventCheckin $checkin): string => (string) $checkin->user->username)->sort()->values()->all())->toBe(['finn.jdm', 'lena.911', 'lukas.sc', 'sara.gti', 'tobi.quattro'])
        ->and($checkins->every(fn (EventCheckin $checkin): bool => $checkin->method === CheckinMethod::Code
            && $checkin->checked_in_at->betweenIncluded($window->opensAt($meet), $window->closesAt($meet))))->toBeTrue()
        ->and($checkins->where('profile_visible', false)->count())->toBe(1)
        ->and(DB::table('event_checkin_codes')->where('event_id', $meet->id)->count())->toBe(0);

    $photos = EventPhoto::query()->where('event_id', $meet->id)->get();
    $gallery = app(EventGallery::class);
    expect($photos->where('status', GalleryPhotoStatus::Approved)->count())->toBe(2)
        ->and($photos->where('status', GalleryPhotoStatus::Pending)->count())->toBe(2)
        ->and($photos->where('status', GalleryPhotoStatus::Pending)->every(fn (EventPhoto $photo): bool => $photo->reviewed_by === null
            && $photo->created_at?->betweenIncluded($gallery->opensAt($meet), $gallery->closesAt($meet)) === true))->toBeTrue()
        ->and($photos->every(fn (EventPhoto $photo): bool => $photo->getAttribute('is_sample') === true))->toBeTrue()
        ->and($photos->countBy('uploader_id')->max())->toBeLessThanOrEqual(10);

    // --- Re-run: the same rows, numbers and design ids.
    p5Run();
    expect(p5Snapshot())->toBe($first);

    // A sample code replaced since (speedclub:qr:rotate-samples): the next run tests the frozen design again with the active code, which
    // opens version 3 as the app would; a member's own design is never touched.
    $this->artisan('speedclub:qr:rotate-samples')->assertSuccessful();
    app(ShowcasePhase5::class)->seed(CarbonImmutable::now());
    $healed = StickerDesign::query()->with('qrCode')->where('vehicle_id', $main->id)->orderByDesc('version')->firstOrFail();
    expect($healed->version)->toBe(3)
        ->and($healed->isValidated())->toBeTrue()
        ->and($healed->qrCode?->status)->toBe(QrStatus::Active)
        ->and($healed->reference)->toBe(ShowcasePhase5::reference($main->id, 3));

    // --- Purge: everything above goes; lukas.sc's own design (another id) and the classic members stay.
    $own = StickerDesign::factory()->create(['vehicle_id' => $lukasCar->id, 'version' => 3, 'revision' => 9]);
    $this->artisan('speedclub:demo', ['--purge' => true, '--force' => true])->assertSuccessful();

    expect(array_filter(app(ShowcasePurge::class)->counts()))->toBe([])
        ->and(StickerDesign::query()->pluck('id')->all())->toBe([$own->id])
        ->and(DB::table('view_days')->count())->toBe(0)
        ->and(EventCheckin::query()->count())->toBe(0)
        ->and(EventPhoto::withTrashed()->count())->toBe(0)
        ->and(Media::withTrashed()->whereNotNull('sample_source')->count())->toBe(0)
        ->and(User::query()->whereIn('username', P5_CLASSIC)->count())->toBe(count(P5_CLASSIC));
});
