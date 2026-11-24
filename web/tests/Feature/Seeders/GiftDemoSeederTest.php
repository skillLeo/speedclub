<?php

use App\Enums\ConfigKey;
use App\Enums\EventStatus;
use App\Enums\HighlightItemType;
use App\Enums\PlateBlurState;
use App\Enums\VehicleStatus;
use App\Models\AuditEvent;
use App\Models\Badge;
use App\Models\CarOfTheDay;
use App\Models\Event;
use App\Models\FeatureFlag;
use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\Wrapped;
use App\Services\BuildScore\BuildScoreNightly;
use App\Services\BuildScore\BuildScores;
use App\Services\CarOfTheDay\CarOfTheDays;
use App\Services\Config\ConfigVersions;
use App\Services\Dex\CityMatcher;
use App\Services\Invites\InviteCodes;
use App\Services\Showcase\SampleContent;
use App\Services\Showcase\Showcase;
use App\Services\Showcase\ShowcasePlates;
use App\Services\Social\VehicleHighlights;
use App\Services\Wrapped\WrappedReleases;
use Carbon\CarbonImmutable;
use Database\Seeders\CatalogSeeder;
use Database\Seeders\DemoShowcaseSeeder;
use Database\Seeders\GiftDemoSeeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;

/**
 * M5.9f gift demo (GiftDemoSeeder, run by DemoShowcaseSeeder at its end) against a small photo set of its own: every fixture photo has a
 * plate decision in the folder's own plates.json; the "blurred" ones carry a checkerboard "plate" exactly in their rectangle, so the test
 * can prove the pixelation reached every file the pipeline wrote.
 */
const GIFT_PHOTOS = [
    ['BMW', 'M4', 'G82', 10],
    ['Porsche', '911', '992', 8],
    ['Toyota', 'Supra', 'A80', 8],
    ['Nissan', 'Skyline GT-R', 'R34', 4],
    ['Honda', 'Civic Type R', 'FK8', 8],
    ['Nissan', 'GT-R', 'R35', 8],
    ['Nissan', '200SX', 'S14', 4],
];

/** The plate rectangle of every "blurred" fixture photo (normalised). */
const GIFT_PLATE = ['x' => 0.3, 'y' => 0.55, 'w' => 0.4, 'h' => 0.2];

beforeEach(function () {
    ShowcasePlates::flush();
    // A fixed Sunday morning in Berlin: the 2026 season is over, spots of the last 60 days reach back into it.
    $this->travelTo(CarbonImmutable::parse('2026-11-15 10:00', 'Europe/Berlin'));
});

afterEach(function () {
    if (is_string($this->giftRoot ?? null)) {
        File::deleteDirectory($this->giftRoot);
    }

    ShowcasePlates::flush();
});

function giftPhotoDirectory(): string
{
    $directory = storage_path('framework/testing/gift-photos');
    File::deleteDirectory($directory);
    File::ensureDirectoryExists($directory);
    $manifest = [];
    $plates = [];

    foreach (GIFT_PHOTOS as [$make, $model, $generation, $count]) {
        for ($i = 1; $i <= $count; $i++) {
            $file = Str::slug("$make-$model-$generation")."-$i.jpg";
            $plate = $i % 2 === 1;
            giftJpeg("$directory/$file", $i, $plate);
            $manifest[] = ['file' => $file, 'make' => $make, 'model' => $model, 'generation' => $generation, 'category' => 'exterior', 'alt_de' => "$make $model $generation, Foto $i", 'focal' => ['x' => 0.5, 'y' => 0.6]];
            $plates[$file] = $plate ? ['decision' => 'blurred', 'regions' => [GIFT_PLATE]] : ['decision' => 'declined'];
        }
    }

    File::put("$directory/manifest.json", (string) json_encode($manifest));
    File::put("$directory/plates.json", (string) json_encode(['version' => 1, 'photos' => $plates]));

    return $directory;
}

/**
 * A flat 600 × 400 photo; with $plate a 6 px black/white checkerboard fills exactly GIFT_PLATE.
 */
function giftJpeg(string $path, int $shade, bool $plate): void
{
    $image = imagecreatetruecolor(600, 400);
    imagefill($image, 0, 0, (int) imagecolorallocate($image, 20 * $shade % 255, 90, 140));

    if ($plate) {
        $black = (int) imagecolorallocate($image, 0, 0, 0);
        $white = (int) imagecolorallocate($image, 255, 255, 255);

        for ($y = (int) (GIFT_PLATE['y'] * 400); $y < (int) ((GIFT_PLATE['y'] + GIFT_PLATE['h']) * 400); $y++) {
            for ($x = (int) (GIFT_PLATE['x'] * 600); $x < (int) ((GIFT_PLATE['x'] + GIFT_PLATE['w']) * 600); $x++) {
                imagesetpixel($image, $x, $y, (intdiv($x, 6) + intdiv($y, 6)) % 2 === 0 ? $black : $white);
            }
        }
    }

    imagejpeg($image, $path, 92);
}

function giftHost(): void
{
    app()->detectEnvironment(fn () => 'staging');
    $root = storage_path('framework/testing/disks/gift-'.Str::lower(Str::random(10)));
    test()->giftRoot = $root;

    config([
        'filesystems.disks.gift_public' => ['driver' => 'local', 'root' => "$root/public", 'url' => 'http://localhost/storage', 'visibility' => 'public', 'throw' => false],
        'filesystems.disks.gift_private' => ['driver' => 'local', 'root' => "$root/private", 'throw' => false],
        'speedclub.media.disk' => 'gift_public', 'speedclub.media.private_disk' => 'gift_private',
        'speedclub.demo.member_password' => 'showcase-member-password', 'speedclub.demo.staff_password' => null,
        'speedclub.demo.clear_media_database' => 'none', 'speedclub.staff.owner_email' => 'owner@speedclub.test', 'queue.default' => 'sync',
    ]);

    FeatureFlag::query()->updateOrCreate(['key' => SampleContent::FLAG], ['enabled' => true]);
}

function runGiftShowcase(): void
{
    $directory = giftPhotoDirectory();

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
 * @return array<string, int>
 */
function giftCounts(): array
{
    $counts = [];

    foreach (['spots', 'vehicle_spot_stats', 'user_set_progress', 'xp_events', 'user_badges', 'invite_codes', 'car_of_the_day', 'build_scores', 'build_score_history', 'build_score_ranks', 'wrapped', 'reactions', 'vehicle_follows', 'media', 'build_updates', 'notifications', 'modifications'] as $table) {
        $counts[$table] = DB::table($table)->count();
    }

    $counts['xp'] = (int) DB::table('users')->sum('xp');

    return $counts;
}

/**
 * Summed RGB variance of the box (normalised) of a JPEG or WebP image, inset by 10 % of its size so edge blocks do not count.
 *
 * @param  array{x: float, y: float, w: float, h: float}  $box
 */
function giftBoxVariance(string $bytes, array $box): float
{
    $image = imagecreatefromstring($bytes);
    expect($image)->not->toBeFalse();
    $width = imagesx($image);
    $height = imagesy($image);
    $x0 = (int) (($box['x'] + $box['w'] * 0.1) * $width);
    $x1 = (int) (($box['x'] + $box['w'] * 0.9) * $width);
    $y0 = (int) (($box['y'] + $box['h'] * 0.1) * $height);
    $y1 = (int) (($box['y'] + $box['h'] * 0.9) * $height);
    $values = [[], [], []];

    for ($y = $y0; $y < $y1; $y++) {
        for ($x = $x0; $x < $x1; $x++) {
            $rgb = imagecolorat($image, $x, $y);
            $values[0][] = ($rgb >> 16) & 0xFF;
            $values[1][] = ($rgb >> 8) & 0xFF;
            $values[2][] = $rgb & 0xFF;
        }
    }

    $variance = 0.0;

    foreach ($values as $channel) {
        $mean = array_sum($channel) / max(1, count($channel));
        $variance += array_sum(array_map(fn (int $value): float => ($value - $mean) ** 2, $channel)) / max(1, count($channel));
    }

    return $variance;
}

it('refuses production and every environment but local and staging', function (string $environment) {
    app()->detectEnvironment(fn () => $environment);

    expect(fn () => (new GiftDemoSeeder)->setContainer(app())->__invoke())->toThrow(RuntimeException::class, "APP_ENV is $environment")
        ->and(DB::table('spots')->count())->toBe(0);
})->with(['production', 'testing', 'demo']);

it('needs the showcase first', function () {
    giftHost();

    expect(fn () => (new GiftDemoSeeder)->setContainer(app())->__invoke())->toThrow(RuntimeException::class, 'needs the showcase');
});

it('decides a plate for every seed photo of the repository', function () {
    $manifest = json_decode((string) file_get_contents(base_path('../design/seed-photos/manifest.json')), true);
    $plates = json_decode((string) file_get_contents(database_path(ShowcasePlates::FILE)), true)['photos'];

    expect($manifest)->toBeArray()->not->toBeEmpty();

    foreach ($manifest as $entry) {
        $decision = $plates[$entry['file']] ?? null;
        expect($decision)->not->toBeNull("{$entry['file']} has no plate decision")
            ->and($decision['decision'])->toBeIn(['blurred', 'declined']);

        if ($decision['decision'] === 'declined') {
            expect($decision['regions'] ?? [])->toBe([]);

            continue;
        }

        expect(count($decision['regions']))->toBeGreaterThanOrEqual(1)->toBeLessThanOrEqual(8);

        foreach ($decision['regions'] as $region) {
            expect($region['x'])->toBeGreaterThanOrEqual(0)->and($region['y'])->toBeGreaterThanOrEqual(0)
                ->and($region['w'])->toBeGreaterThanOrEqual(0.02)->and($region['h'])->toBeGreaterThanOrEqual(0.02)
                ->and($region['x'] + $region['w'])->toBeLessThanOrEqual(1.0001)->and($region['y'] + $region['h'])->toBeLessThanOrEqual(1.0001);
        }
    }

    expect(array_diff(array_keys($plates), array_column($manifest, 'file')))->toBe([]);
});

it('seeds the gift demo once, safely again, for sample members only', function () {
    giftHost();

    // A real member with a public build on the same host: the demo must never touch them. The real catalogue first (the factory's
    // makes would otherwise make the showcase skip CatalogSeeder and leave every build out).
    $this->seed(CatalogSeeder::class);
    $real = User::factory()->create(['email' => 'real.member@example.com']);
    $realCar = Vehicle::factory()->for($real, 'owner')->create(['status' => VehicleStatus::Published, 'published_at' => now()->subDays(90)]);

    app(BuildScores::class)->recompute($realCar->id);

    runGiftShowcase();
    $first = giftCounts();
    $sebastian = User::query()->where('username', Showcase::SHOWCASE_USERNAME)->firstOrFail();
    $samples = User::query()->where('is_sample', true)->pluck('id')->all();
    $sampleCars = Vehicle::query()->where('is_sample', true)->pluck('id')->all();

    // --- Plates (ADR-509): a decision on every sample photo, nothing unblurred left on either disk.
    $photos = Media::query()->whereIn('owner_id', $samples)->get();
    expect($photos)->not->toBeEmpty()
        ->and($photos->filter(fn (Media $media): bool => $media->getAttribute('plate_blur') === PlateBlurState::Unchecked)->pluck('sample_source')->all())->toBe([])
        ->and($photos->filter(fn (Media $media): bool => $media->getAttribute('plate_blur') === PlateBlurState::Blurred)->count())->toBeGreaterThan(5);

    foreach ($photos as $media) {
        $directory = 'media/'.$media->id;
        $keep = array_values(array_filter([$media->getAttribute('original_path'), ...array_values((array) $media->getAttribute('variants'))]));

        foreach (['gift_public', 'gift_private'] as $disk) {
            foreach (Storage::disk($disk)->allFiles(dirname((string) $media->getAttribute('original_path'))) as $file) {
                expect($keep)->toContain($file);
            }
        }

        if ($media->getAttribute('plate_blur') !== PlateBlurState::Blurred || str_starts_with((string) $media->getAttribute('sample_source'), 'avatar:')) {
            continue;
        }

        // The master and the widest variant: the checkerboard plate is pixelated (≤ 5 % of the fixture's variance in the box).
        $fixture = giftBoxVariance((string) file_get_contents(storage_path('framework/testing/gift-photos/'.ShowcasePlates::fileOf((string) $media->getAttribute('sample_source')))), GIFT_PLATE);
        $variants = (array) $media->getAttribute('variants');
        krsort($variants);
        expect(giftBoxVariance((string) Storage::disk('gift_private')->get((string) $media->getAttribute('original_path')), GIFT_PLATE))->toBeLessThan($fixture * 0.05)
            ->and(giftBoxVariance((string) Storage::disk('gift_public')->get((string) reset($variants)), GIFT_PLATE))->toBeLessThan($fixture * 0.05);
    }

    expect(collect(Storage::disk('gift_private')->allFiles())->filter(fn (string $file): bool => str_ends_with($file, 'pending.bin'))->all())->toBe([]);

    // --- Spots: sample members, sample cars, the twelve gift cities, day times of the last 60 days, never a coordinate.
    $spots = DB::table('spots')->get();
    $cities = json_decode((string) file_get_contents(database_path('data/showcase/gift.json')), true)['cities'];
    $cityIds = DB::table('de_cities')->whereIn('name', array_column($cities, 'name'))->pluck('id')->all();
    expect($spots->count())->toBeGreaterThan(20)
        ->and(array_values(array_filter(Schema::getColumnListing('spots'), fn (string $column): bool => (bool) preg_match('/lat|lng|lon|coord|geo/i', $column))))->toBe([]);

    foreach ($spots as $spot) {
        $local = CarbonImmutable::parse((string) $spot->created_at, 'UTC')->setTimezone('Europe/Berlin');
        expect($spot->spotter_id)->toBeIn($samples)
            ->and($spot->vehicle_id)->toBeIn($sampleCars)
            ->and($spot->city_id)->toBeIn($cityIds)
            ->and((bool) $spot->is_night)->toBeFalse()
            ->and((bool) $spot->counted)->toBeTrue()
            ->and((int) $local->format('G'))->toBeGreaterThanOrEqual(9)->toBeLessThanOrEqual(19)
            ->and($local->greaterThanOrEqualTo(now()->subDays(GiftDemoSeeder::SPOT_DAYS + 1)))->toBeTrue()
            ->and($local->lessThan(now()))->toBeTrue()
            ->and(DB::table('vehicles')->where('id', $spot->vehicle_id)->value('owner_id'))->not->toBe($spot->spotter_id);
    }

    // ADR-514: every spot is older than the DEX-06 window (nothing live), sample members on sample cars count; the public spot map lists
    // only cities with spots of at least dex.map.min_cars distinct cars, and the demo has such cities.
    expect($spots->every(fn (object $spot): bool => CarbonImmutable::parse((string) $spot->created_at, 'UTC')->lessThan(now()->subHours(config()->integer('speedclub.dex.alerts.window_hours')))))->toBeTrue();
    $map = $this->getJson('/api/v1/spot-map')->assertOk()->json('data.cities');
    expect($map)->not->toBeEmpty();

    foreach ($map as $city) {
        expect($spots->where('city_id', $city['city_id'])->where('created_at', '<=', now()->subDay()->utc()->format('Y-m-d H:i:s'))->pluck('vehicle_id')->unique()->count())
            ->toBeGreaterThanOrEqual(config()->integer('speedclub.dex.map.min_cars'));
    }

    // ADR-514: the Bundesland comes from the public profile city only.
    foreach (User::query()->where('is_sample', true)->where('is_editorial', false)->get() as $member) {
        expect($member->getRawOriginal('bundesland'))->not->toBeNull()
            ->toBe(app(CityMatcher::class)->bundeslandFor($member)?->value);
    }

    // First Spotter foils: the first three distinct spotters of a car, and only they.
    foreach ($spots->groupBy('vehicle_id') as $carSpots) {
        $order = $carSpots->sortBy([['created_at', 'asc'], ['id', 'asc']])->values();
        expect($order->filter(fn (object $spot): bool => (bool) $spot->is_first_three)->pluck('id')->all())->toBe($order->take(3)->pluck('id')->all());
    }

    expect(DB::table('user_set_progress')->where('user_id', $sebastian->id)->where('progress', '>', 0)->count())->toBeGreaterThan(0)
        ->and(DB::table('vehicles')->whereIn('id', $sampleCars)->where('status', 'published')->whereNull('dex_number')->count())->toBe(0)
        ->and(DB::table('vehicles')->whereIn('id', $sampleCars)->where('status', 'published')->whereNull('rarity')->count())->toBe(0);

    // --- Build Score: every sample build scored, history in the season, rank rows among sample builds only, shown off production only.
    expect(DB::table('build_scores')->whereIn('vehicle_id', $sampleCars)->count())->toBe(Vehicle::query()->where('is_sample', true)->where('status', 'published')->count())
        ->and(DB::table('build_score_history')->whereIn('vehicle_id', $sampleCars)->whereBetween('day', ['2026-03-01', '2026-10-31'])->count())->toBeGreaterThan(0)
        ->and(DB::table('build_score_ranks')->count())->toBeGreaterThan(0)
        ->and(DB::table('build_score_ranks')->whereNotIn('vehicle_id', $sampleCars)->count())->toBe(0)
        ->and(DB::table('build_score_ranks')->min('group_size'))->toBeGreaterThanOrEqual(3);

    $ranked = Vehicle::query()->whereKey(DB::table('build_score_ranks')->value('vehicle_id'))->firstOrFail();
    expect(app(BuildScores::class)->ranks($ranked))->not->toBe([]);
    app()->detectEnvironment(fn () => 'production');
    expect(app(BuildScores::class)->ranks($ranked->fresh() ?? $ranked))->toBe([]);
    app()->detectEnvironment(fn () => 'staging');

    // The night never ranks samples and keeps the demo's rows.
    $rows = DB::table('build_score_ranks')->count();
    for ($i = 0; $i < 5 && ! (app(BuildScoreNightly::class)->run()['done'] ?? false); $i++);
    expect(DB::table('build_score_ranks')->count())->toBe($rows);

    // --- XP and badges: the ledger adds up, no Berlin day above the cap, hidden and unseen badges for the showcase account.
    foreach (User::query()->where('is_sample', true)->get() as $member) {
        expect((int) $member->getAttribute('xp'))->toBe((int) DB::table('xp_events')->where('user_id', $member->id)->sum('points'));
    }

    expect(DB::table('xp_events')->groupBy('user_id', 'day')->selectRaw('sum(points) as day_points')->pluck('day_points')->max())->toBeLessThanOrEqual(200)
        ->and((int) $sebastian->fresh()?->getAttribute('xp'))->toBeGreaterThan(100);

    $badges = DB::table('user_badges')->where('user_id', $sebastian->id)->pluck('seen_at', 'badge_key');
    expect($badges->count())->toBeGreaterThanOrEqual(3)
        ->and(Badge::query()->whereIn('key', $badges->keys())->where('hidden', true)->count())->toBeGreaterThanOrEqual(1)
        ->and($badges->filter(fn (?string $seen): bool => $seen === null)->count())->toBe(2)
        ->and(DB::table('notifications')->where('notifiable_id', $sebastian->id)->where('type', 'badge_unlocked')->count())->toBe(2);

    // --- Car of the Day: 14 days back to 3 ahead, published at 18:00 Berlin, sample builds, Home shows yesterday's pick this morning.
    $days = DB::table('car_of_the_day')->orderBy('day')->get();
    // ADR-514: every seeded day passes the publication check, so none is withdrawn at 18:00.
    expect(CarOfTheDay::query()->get()->every(fn (CarOfTheDay $pick): bool => app(CarOfTheDays::class)->eligible($pick)))->toBeTrue();
    $pool = Vehicle::query()->where('is_sample', true)->where('status', 'published')->whereIn('owner_id', User::query()->where('is_sample', true)->where('is_editorial', false)->select('id'))->count();
    expect($days->count())->toBe(min(18, $pool))
        ->and($days->first()?->day)->toBe(CarbonImmutable::parse('2026-11-18')->subDays(min(18, $pool) - 1)->toDateString())
        ->and($days->last()?->day)->toBe('2026-11-18')
        ->and($days->pluck('vehicle_id')->unique()->count())->toBe($days->count())
        ->and($days->every(fn (object $row): bool => (bool) $row->is_sample && in_array($row->vehicle_id, $sampleCars, true)))->toBeTrue()
        ->and($days->every(fn (object $row): bool => CarbonImmutable::parse((string) $row->published_at, 'UTC')->setTimezone('Europe/Berlin')->format('H:i') === '18:00'))->toBeTrue()
        ->and($days->pluck('bundesland')->unique()->count())->toBeGreaterThan(2);

    Sanctum::actingAs($sebastian);
    $home = $this->getJson('/api/v1/home/modules')->assertOk();
    expect($home->json('data.car_of_the_day.day'))->toBe('2026-11-14')
        ->and($home->json('data.car_of_the_day.is_sample'))->toBeTrue();

    // DEX-01 header: the showcase account's total counts the sample cars it may see (else found > total); a real member's stays real.
    $dex = $this->getJson('/api/v1/me/dex')->assertOk();
    expect($dex->json('meta.found'))->toBeGreaterThan(0)
        ->and($dex->json('meta.total'))->toBeGreaterThanOrEqual($dex->json('meta.found'));
    Sanctum::actingAs($real);
    expect($this->getJson('/api/v1/me/dex')->assertOk()->json('meta.total'))->toBeLessThanOrEqual(1);
    Sanctum::actingAs($sebastian);

    // --- Invites: five codes, two redeemed by sample members, listed for the showcase account off production (INV-01).
    $this->getJson('/api/v1/me/invites')->assertOk()->assertJsonCount(5, 'data');
    expect(DB::table('invite_codes')->where('inviter_id', $sebastian->id)->count())->toBe(5)
        ->and(DB::table('invite_codes')->where('inviter_id', $sebastian->id)->whereNotNull('accepted_by')->pluck('accepted_by')->diff($samples)->all())->toBe([])
        ->and(DB::table('invite_codes')->where('inviter_id', $sebastian->id)->whereNotNull('accepted_by')->count())->toBe(2);

    // --- Wrapped: both 2026 seasons for sebastian.demo, every card the data allows, open on staging without a release date.
    $saison = Wrapped::query()->where('user_id', $sebastian->id)->where('season_key', '2026-saison')->firstOrFail();
    expect($saison->getAttribute('is_sample'))->toBeTrue()
        ->and(array_column($saison->payload['cards'], 'kind'))->toContain('intro', 'spots', 'scans', 'score', 'top_mod', 'build_spirit', 'share')
        ->and(Wrapped::query()->where('user_id', $sebastian->id)->where('season_key', '2026-jahr')->exists())->toBeTrue();

    FeatureFlag::query()->updateOrCreate(['key' => 'wrapped'], ['enabled' => true]);
    $cards = collect($this->getJson('/api/v1/me/wrapped/2026-saison')->assertOk()->assertJsonPath('data.is_sample', true)->json('data.cards'))->keyBy('kind');
    // ADR-516 a: the intro, score and Build Spirit cards show a photo of his own car; spots never carry one.
    expect($cards['intro']['image']['url'] ?? null)->toBeString()
        ->and($cards['score']['image']['url'] ?? null)->toBeString()
        ->and($cards['build_spirit']['image']['url'] ?? null)->toBeString()
        ->and($cards['spots'])->not->toHaveKey('image');

    // --- Crawl triage (M5.9f). Highlights: each public build of his leads with an update everybody may read, then up to two photos.
    $ownCars = Vehicle::query()->where('owner_id', $sebastian->id)->where('status', VehicleStatus::Published)->where('visibility', 'public')->get();
    expect($ownCars)->not->toBeEmpty();

    foreach ($ownCars as $car) {
        $rows = DB::table('vehicle_highlights')->where('vehicle_id', $car->id)->orderBy('position')->get();
        expect($rows->count())->toBeGreaterThanOrEqual(1)->toBeLessThanOrEqual(3)
            ->and($rows->first()?->item_type)->toBe(HighlightItemType::BuildUpdate->value)
            ->and($rows->where('item_type', HighlightItemType::Photo->value)->count())->toBeLessThanOrEqual(2)
            ->and(count(app(VehicleHighlights::class)->visible($car, null)))->toBe($rows->count());
    }

    // Wrapped releases in the published remote config, by the system; the season is open through the real release rule.
    $releases = app(ConfigVersions::class)->live(ConfigKey::RemoteConfig)?->payload['wrapped']['releases'] ?? [];
    expect($releases)->toMatchArray(['2026-saison' => '2026-11-05T10:00:00+01:00', '2026-jahr' => '2026-12-28T10:00:00+01:00'])
        ->and(app(WrappedReleases::class)->isReleased('2026-saison'))->toBeTrue()
        ->and(AuditEvent::query()->where('action', 'config.published')->where('reason', GiftDemoSeeder::RELEASE_REASON)->sole()->getRawOriginal('actor_type'))->toBe('system');

    // His own meets: one in review (frozen), one draft, upcoming, sample, never published.
    $own = Event::query()->where('organiser_id', $sebastian->id)->get();
    expect($own->map(fn (Event $event): string => $event->status->value)->sort()->values()->all())->toBe([EventStatus::Draft->value, EventStatus::PendingReview->value])
        ->and($own->every(fn (Event $event): bool => $event->getAttribute('is_sample') === true && $event->published_at === null && (bool) $event->starts_at?->isFuture()))->toBeTrue();

    // His invite codes work off production (lead decision): an open one is found.
    $open = DB::table('invite_codes')->where('inviter_id', $sebastian->id)->whereNull('accepted_by')->value('code');
    expect(app(InviteCodes::class)->open(is_string($open) ? $open : null))->not->toBeNull();

    // A demo session marked everything seen: the next run makes the two new again.
    DB::table('user_badges')->where('user_id', $sebastian->id)->update(['seen_at' => now()]);
    $highlights = DB::table('vehicle_highlights')->orderBy('vehicle_id')->orderBy('position')->get(['vehicle_id', 'item_type', 'item_id'])->toArray();

    // --- Nothing for real members.
    expect(DB::table('spots')->where('spotter_id', $real->id)->orWhere('vehicle_id', $realCar->id)->count())->toBe(0)
        ->and(DB::table('xp_events')->whereNotIn('user_id', $samples)->count())->toBe(0)
        ->and(DB::table('user_badges')->whereNotIn('user_id', $samples)->count())->toBe(0)
        ->and(DB::table('invite_codes')->whereNotIn('inviter_id', $samples)->count())->toBe(0)
        ->and(DB::table('wrapped')->whereNotIn('user_id', $samples)->count())->toBe(0)
        ->and(DB::table('reactions')->whereNotIn('user_id', $samples)->count())->toBe(0)
        ->and(DB::table('vehicle_follows')->where('vehicle_id', $realCar->id)->count())->toBe(0)
        ->and((int) $real->fresh()?->getAttribute('xp'))->toBe(0);

    // --- Again: nothing doubles.
    runGiftShowcase();
    expect(giftCounts())->toBe($first)
        ->and(DB::table('user_badges')->where('user_id', $sebastian->id)->whereNull('seen_at')->count())->toBe(2)
        ->and(DB::table('vehicle_highlights')->orderBy('vehicle_id')->orderBy('position')->get(['vehicle_id', 'item_type', 'item_id'])->toArray())->toEqual($highlights)
        ->and(AuditEvent::query()->where('action', 'config.published')->where('reason', GiftDemoSeeder::RELEASE_REASON)->count())->toBe(1)
        ->and(Event::query()->where('organiser_id', $sebastian->id)->count())->toBe(2);
});
