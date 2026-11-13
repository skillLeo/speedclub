<?php

use App\Enums\ConfigKey;
use App\Enums\QrStatus;
use App\Enums\VehicleStatus;
use App\Models\FeatureFlag;
use App\Models\Media;
use App\Models\QrCode;
use App\Models\Staff;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Config\ConfigVersions;
use App\Services\Qr\QrSticker;
use App\Services\Showcase\SampleContent;
use App\Services\Showcase\Showcase;
use App\Services\Showcase\ShowcasePhotos;
use App\Services\Showcase\ShowcasePurge;
use Database\Seeders\DemoShowcaseSeeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * The staging showcase (DemoShowcaseSeeder, speedclub:demo --purge) against a small photo set of its own: tiny JPEGs drawn here,
 * labelled for a few generations, a legacy entry without make/model (photo-map.json), a generic photo and too few photos of another
 * model, so the seeder has to choose.
 */
const SHOWCASE_PHOTOS = [
    ['BMW', 'M4', 'G82', 12],
    ['Porsche', '911', '992', 12],
    ['Nissan', 'Skyline GT-R', 'R34', 4],
    ['Honda', 'Civic Type R', 'FK8', 8],
    ['Nissan', 'GT-R', 'R35', 8],
    ['Nissan', '370Z', 'Z34', 4],
    ['Toyota', 'Supra', 'A80', 8],
    ['Nissan', '200SX', 'S14', 4],
    ['BMW', 'M3', 'E46', 3],
];

/**
 * Shoots named by database/data/showcase/editorial.json (`car`), of generations no showcase build has: RS 4 B9 (three photos), NSX
 * (with a graded rendition and a ThumbHash), 180SX. The 964 shoot the editorial data names is labelled as a 993 here, so its build
 * must be left out (no showcase build is a 991 either).
 */
const EDITORIAL_SHOOTS = [
    ['audi-rs4-b9-cGUsmL7ILlw', 'Audi', 'RS 4 Avant', 'B9', 3],
    ['honda-na1-K848UT9zrKE', 'Honda', 'NSX', 'NA1', 1],
    ['nissan-s13-w9hMpVXu2rc', 'Nissan', '180SX', 'S13', 1],
    ['porsche-964-ucSx_lPyuh8', 'Porsche', '911', '991', 1],
];

const EDITORIAL_THUMBHASH = '1QcSHQRnh493V4dIh4eXh1h4kJUI';

afterEach(function () {
    if (is_string($this->showcaseRoot ?? null)) {
        File::deleteDirectory($this->showcaseRoot);
    }
});

function showcasePhotoDirectory(): string
{
    $directory = storage_path('framework/testing/showcase-photos');
    File::ensureDirectoryExists($directory);
    $manifest = [];

    foreach (SHOWCASE_PHOTOS as [$make, $model, $generation, $count]) {
        for ($i = 1; $i <= $count; $i++) {
            $file = Str::slug("$make-$model-$generation")."-$i.jpg";
            showcaseJpeg("$directory/$file", $i);
            $manifest[] = ['file' => $file, 'make' => $make, 'model' => $model, 'generation' => $generation, 'category' => $i === 2 ? 'interior' : 'exterior', 'alt_de' => "$make $model $generation, Foto $i", 'focal' => ['x' => 0.5, 'y' => 0.5]];
        }
    }

    // The 2026-11-02 style: only a vehicle key, resolved through photo-map.json (Nissan Skyline GT-R R34).
    showcaseJpeg("$directory/nissan-r34-01.jpg", 9);
    $manifest[] = ['file' => 'nissan-r34-01.jpg', 'vehicle' => 'nissan-r34', 'category' => 'exterior', 'alt_de' => 'R34'];
    showcaseJpeg("$directory/generic-exterior-01.jpg", 3);
    $manifest[] = ['file' => 'generic-exterior-01.jpg', 'vehicle' => null, 'category' => 'exterior', 'alt_de' => 'Treffen'];

    foreach (EDITORIAL_SHOOTS as [$car, $make, $model, $generation, $count]) {
        for ($i = 1; $i <= $count; $i++) {
            $file = Str::slug("editorial-$make-$generation")."-$i.jpg";
            showcaseJpeg("$directory/$file", 4 + $i);
            $manifest[] = ['file' => $file, 'make' => $make, 'model' => $model, 'generation' => $generation, 'car' => $car, 'category' => $i === 1 ? 'detail' : 'exterior', 'alt_de' => "$make $model, Foto $i", 'focal' => ['x' => 0.5, 'y' => 0.5]];
        }
    }

    // process-photos.mjs output for the NSX: the graded 2048 rendition (another size, so the test can tell it from the raw file) and the
    // ThumbHash it writes into the manifest.
    File::ensureDirectoryExists("$directory/processed");
    $graded = imagecreatetruecolor(300, 200);
    imagefill($graded, 0, 0, (int) imagecolorallocate($graded, 200, 180, 40));
    imagejpeg($graded, "$directory/processed/editorial-honda-na1-1-2048.jpg", 80);
    $manifest = array_map(fn (array $entry): array => $entry['file'] === 'editorial-honda-na1-1.jpg' ? [...$entry, 'thumbhash' => EDITORIAL_THUMBHASH] : $entry, $manifest);

    File::put("$directory/manifest.json", (string) json_encode($manifest));

    return $directory;
}

function showcaseJpeg(string $path, int $shade): void
{
    $image = imagecreatetruecolor(360, 240);
    imagefill($image, 0, 0, (int) imagecolorallocate($image, 20 * $shade % 255, 90, 140));
    imagejpeg($image, $path, 80);
}

function showcaseSeeder(): DemoShowcaseSeeder
{
    $directory = showcasePhotoDirectory();

    return new class($directory) extends DemoShowcaseSeeder
    {
        public function __construct(private readonly string $photos) {}

        protected function photoDirectory(): string
        {
            return $this->photos;
        }
    };
}

function prepareShowcaseHost(): void
{
    app()->detectEnvironment(fn () => 'staging');

    foreach (['public', 'local'] as $disk) {
        Storage::fake($disk);
    }

    // Media on disks of this test alone: other test runs on this machine share (and clean) the Storage::fake() roots.
    $root = storage_path('framework/testing/disks/showcase-'.Str::lower(Str::random(10)));
    test()->showcaseRoot = $root;

    config([
        'filesystems.disks.showcase_public' => ['driver' => 'local', 'root' => "$root/public", 'url' => 'http://localhost/storage', 'visibility' => 'public', 'throw' => false],
        'filesystems.disks.showcase_private' => ['driver' => 'local', 'root' => "$root/private", 'throw' => false],
        'speedclub.media.disk' => 'showcase_public', 'speedclub.media.private_disk' => 'showcase_private',
        'speedclub.demo.member_password' => 'showcase-member-password', 'speedclub.demo.staff_password' => 'showcase-staff-password',
        'speedclub.demo.staff_totp_secret' => 'JBSWY3DPEHPK3PXP', 'speedclub.demo.clear_media_database' => 'none',
        'speedclub.staff.owner_email' => 'owner@speedclub.test', 'queue.default' => 'sync',
    ]);

    // As on a staging host: sample content is visible (FeatureFlagSeeder turns editorial_samples on outside production).
    FeatureFlag::query()->updateOrCreate(['key' => SampleContent::FLAG], ['enabled' => true]);
}

function runShowcase(): void
{
    showcaseSeeder()->setContainer(app())->__invoke();
}

/**
 * @return array<string, int>
 */
function showcaseTableCounts(): array
{
    $counts = [];

    foreach (['users', 'vehicles', 'media', 'modifications', 'build_updates', 'qr_codes', 'qr_scan_daily', 'follows', 'saves', 'conversations', 'messages', 'message_reactions', 'notifications', 'reports', 'moderation_cases', 'decisions', 'support_tickets', 'ticket_messages', 'approval_requests', 'catalog_requests', 'config_versions', 'staff'] as $table) {
        $counts[$table] = DB::table($table)->count();
    }

    return [...$counts, ...app(ShowcasePurge::class)->counts(), ...array_combine(array_map(fn (string $type): string => "type:$type", array_keys(app(ShowcasePurge::class)->notificationsByType())), app(ShowcasePurge::class)->notificationsByType())];
}

it('refuses production and every environment but local and staging', function (string $environment) {
    app()->detectEnvironment(fn () => $environment);
    config(['speedclub.demo.member_password' => 'showcase-member-password']);

    expect(fn () => showcaseSeeder()->setContainer(app())->__invoke())->toThrow(RuntimeException::class, "APP_ENV is $environment")
        ->and(User::query()->where('is_sample', true)->count())->toBe(0);

    $this->artisan('speedclub:demo', ['--purge' => true, '--force' => true])->assertFailed();
})->with(['production', 'testing', 'demo']);

it('refuses without the demo member password', function () {
    prepareShowcaseHost();
    config(['speedclub.demo.member_password' => '']);

    expect(fn () => runShowcase())->toThrow(RuntimeException::class, 'DEMO_MEMBER_PASSWORD');
});

it('seeds the showcase from matching photos only and changes nothing when run again', function () {
    prepareShowcaseHost();

    runShowcase();
    $first = showcaseTableCounts();

    // Members, the showcase account and its three builds: one BMW, one Porsche, one JDM.
    $sebastian = User::query()->where('username', Showcase::SHOWCASE_USERNAME)->firstOrFail();
    $garage = Vehicle::query()->where('owner_id', $sebastian->id)->where('status', VehicleStatus::Published)->with('make')->get();
    // 41 sample members and the SPEED CLUB Editorial account.
    expect($first['members'])->toBe(42)
        ->and($sebastian->getAttribute('is_sample'))->toBeTrue()
        ->and($sebastian->hasVerifiedEmail())->toBeTrue()
        ->and($sebastian->onboardingStep())->toBeNull()
        ->and($garage)->toHaveCount(3)
        // One BMW, one Porsche and one JDM build: of each pick group the alternative with the best photo coverage.
        ->and($garage->map(fn (Vehicle $vehicle): string => (string) $vehicle->make?->name)->filter(fn (string $make): bool => ! in_array($make, ['BMW', 'Porsche'], true))->values()->all())
        ->toHaveCount(1)->each->toBeIn(['Nissan', 'Toyota', 'Mazda'])
        ->and($garage->map(fn (Vehicle $vehicle): string => (string) $vehicle->make?->name)->intersect(['BMW', 'Porsche'])->sort()->values()->all())->toBe(['BMW', 'Porsche'])
        ->and($sebastian->followers()->count())->toBeGreaterThan(10)
        ->and($sebastian->following()->count())->toBeGreaterThan(3)
        ->and(DB::table('saves')->where('user_id', $sebastian->id)->count())->toBeGreaterThan(0);

    // Every build: 4-8 photos of exactly its make/model/generation per the manifest, a QR code with 30 days of scans, parts and history.
    $manifest = collect(json_decode((string) file_get_contents(storage_path('framework/testing/showcase-photos/manifest.json')), true))->keyBy('file');
    $editorial = User::query()->where('username', 'speedclub.editorial')->firstOrFail();
    $vehicles = Vehicle::query()->where('is_sample', true)->where('owner_id', '!=', $editorial->id)->with(['make', 'vehicleModel', 'generation'])->get();
    // sebastian's three (his JDM pick is the best-covered A80, which leaves the fixture's A80 photos for one more A80 only), maxi (G82),
    // felix (992), emma and sarah (FK8), luca and dominik (R35), niklas (Z34), one of david and yusuf (A80), jan (S14).
    expect($vehicles->count())->toBe(12);

    foreach ($vehicles as $vehicle) {
        $media = Media::query()->where('mediable_type', $vehicle->getMorphClass())->where('mediable_id', $vehicle->id)->get();
        expect($media->count())->toBeGreaterThanOrEqual(ShowcasePhotos::MIN)->toBeLessThanOrEqual(ShowcasePhotos::MAX)
            ->and($vehicle->status)->toBe(VehicleStatus::Published)
            ->and($vehicle->getAttribute('cover_media_id'))->toBeIn($media->pluck('id')->all());

        foreach ($media as $photo) {
            $file = Str::after((string) $photo->getAttribute('sample_source'), 'vehicle:');
            $entry = $manifest[$file] ?? null;
            $names = $entry !== null && isset($entry['make']) ? [$entry['make'], $entry['model'], $entry['generation']] : ['Nissan', 'Skyline GT-R', 'R34'];
            expect($entry)->not->toBeNull()
                ->and(ShowcasePhotos::matches($names[0], $names[1], $names[2], (string) $vehicle->make?->name, (string) $vehicle->vehicleModel?->name, (string) $vehicle->generation?->name))->toBeTrue()
                ->and($photo->getAttribute('blurhash'))->not->toBeNull()
                ->and($photo->getAttribute('variants'))->not->toBeEmpty();
        }

        $qr = QrCode::query()->where('vehicle_id', $vehicle->id)->where('status', QrStatus::Active)->first();
        expect($qr)->not->toBeNull()
            ->and(DB::table('qr_scan_daily')->where('qr_code_id', $qr?->id)->count())->toBe(30)
            ->and($vehicle->modifications()->count())->toBeGreaterThanOrEqual(5)->toBeLessThanOrEqual(15)
            ->and(DB::table('build_updates')->where('vehicle_id', $vehicle->id)->count())->toBeGreaterThanOrEqual(2);
    }

    // No photo of the E46 (three in the set) or the generic one is used, and no photo went on two builds.
    $sources = Media::query()->whereIn('mediable_id', $vehicles->pluck('id'))->pluck('sample_source');
    expect($sources->filter(fn (?string $source): bool => str_contains((string) $source, 'm3-e46') || str_contains((string) $source, 'generic'))->all())->toBe([])
        ->and($sources->duplicates()->all())->toBe([]);

    // The SPEED CLUB Editorial account (09 §8.19): a sample account with the editorial marker, its builds from exactly the shoots
    // editorial.json names (the 964 shoot shows another generation here, so that build is left out), manufacturer figures, real parts
    // with an unknown legal status, Verlauf in the editorial voice, and nothing social that would invent a number.
    $editorialBuilds = Vehicle::query()->where('owner_id', $editorial->id)->with(['make', 'vehicleModel', 'generation', 'specs'])->get()->keyBy(fn (Vehicle $vehicle): string => (string) $vehicle->generation?->name);
    expect($editorial->getAttribute('is_sample'))->toBeTrue()
        ->and($editorial->getAttribute('is_editorial'))->toBeTrue()
        ->and($editorial->getAttribute('display_name'))->toBe('SPEED CLUB Editorial')
        ->and(User::query()->where('is_editorial', true)->count())->toBe(1)
        ->and($editorialBuilds->keys()->sort()->values()->all())->toBe(['B9', 'NA1/NA2', 'S13'])
        ->and(DB::table('follows')->where('follower_id', $editorial->id)->orWhere('followee_id', $editorial->id)->count())->toBe(0)
        ->and(DB::table('saves')->whereIn('vehicle_id', $editorialBuilds->pluck('id'))->count())->toBe(0)
        ->and(DB::table('qr_scan_daily')->whereIn('qr_code_id', QrCode::query()->whereIn('vehicle_id', $editorialBuilds->pluck('id'))->select('id'))->sum('count'))->toBe(0)
        ->and(DB::table('notifications')->where('notifiable_id', $editorial->id)->count())->toBe(0);

    foreach ($editorialBuilds as $build) {
        $media = Media::query()->where('mediable_type', $build->getMorphClass())->where('mediable_id', $build->id)->get();
        expect($build->status)->toBe(VehicleStatus::Published)
            ->and($build->getAttribute('is_sample'))->toBeTrue()
            ->and($build->modifications()->count())->toBeGreaterThanOrEqual(5)
            ->and($build->modifications()->where('legal_status', '!=', 'unknown')->count())->toBe(0)
            ->and(DB::table('build_updates')->where('vehicle_id', $build->id)->count())->toBeGreaterThanOrEqual(2)
            ->and($media->pluck('sample_source')->map(fn (?string $source): string => Str::between((string) $source, 'vehicle:', '#'))->filter(fn (string $file): bool => ! str_starts_with($file, 'editorial-'))->all())->toBe([]);
    }

    $nsx = Media::query()->where('mediable_id', $editorialBuilds['NA1/NA2']->id)->firstOrFail();
    $rs4 = Media::query()->where('mediable_id', $editorialBuilds['B9']->id)->orderBy('sort')->get();
    expect($editorialBuilds['NA1/NA2']->specs?->getAttribute('torque_nm'))->toEqual(284)
        // The graded rendition was imported, with the manifest's ThumbHash; a photo without one keeps null.
        ->and($nsx->getAttribute('sample_source'))->toBe('vehicle:editorial-honda-na1-1.jpg'.DemoShowcaseSeeder::GRADED)
        ->and($nsx->getAttribute('width'))->toBe(300)
        ->and($nsx->getAttribute('thumbhash'))->toBe(EDITORIAL_THUMBHASH)
        ->and($rs4->pluck('thumbhash')->filter()->all())->toBe([])
        // The whole RS 4 shoot, an exterior shot as the cover.
        ->and($rs4)->toHaveCount(3)
        ->and($rs4->first()?->getAttribute('sample_source'))->toBe('vehicle:editorial-audi-b9-2.jpg');

    // The sticker resolves to the public page and its PDF renders.
    $qr = QrCode::query()->whereIn('vehicle_id', $garage->pluck('id'))->firstOrFail();
    $this->get('/c/'.$qr->code)->assertRedirectContains('/v/'.$qr->vehicle?->slug);
    expect(app(QrSticker::class)->pdf($qr))->toStartWith('%PDF');

    // The social and admin side.
    expect($first['conversations'])->toBeGreaterThanOrEqual(60)
        ->and($first['messages'])->toBeGreaterThan(200)
        ->and($first['message_reactions'])->toBeGreaterThan(0)
        ->and(DB::table('conversation_participants')->whereIn('user_id', User::query()->where('is_sample', true)->select('id'))->where('folder', 'requests')->whereNull('accepted_at')->count())->toBeGreaterThan(0)
        ->and(array_keys(array_filter($first, fn (int $count, string $key): bool => str_starts_with($key, 'type:') && $count > 0, ARRAY_FILTER_USE_BOTH)))
        ->toEqualCanonicalizing(['type:new_follower', 'type:followed_published', 'type:build_saved', 'type:security', 'type:moderation_decision', 'type:report_decided', 'type:qr_milestone', 'type:hu_au_reminder', 'type:catalog_request', 'type:support_reply'])
        ->and(DB::table('moderation_cases')->where('status', 'new')->whereIn('subject_id', User::query()->where('is_sample', true)->select('id'))->count())->toBeGreaterThanOrEqual(3)
        ->and(DB::table('support_tickets')->distinct()->pluck('status')->sort()->values()->all())->toBe(['closed', 'open', 'pending'])
        ->and(DB::table('approval_requests')->where('status', 'pending')->count())->toBe(3)
        ->and(DB::table('catalog_requests')->where('status', 'pending')->count())->toBe(1)
        // Colours are German (the manifest notes them in English).
        ->and(Vehicle::query()->where('is_sample', true)->pluck('color')->filter(fn (?string $c): bool => $c !== null && preg_match('/^(black|white|silver|red|blue|grey|gray|yellow|green|orange)\b/i', $c) === 1)->all())->toBe([])
        ->and($first['featured_on_home'])->toBe(1)
        ->and(homeCollectionKeys())->toContain(Showcase::COLLECTION_KEY)
        ->and(DB::table('audit_events')->where('action', Showcase::AUDIT_SEEDED)->count())->toBe(1);

    // The crawl's staff account: role admin, password and TOTP enrolled.
    $staff = Staff::query()->where('email', Showcase::STAFF_EMAIL)->firstOrFail();
    expect($staff->hasRole('admin'))->toBeTrue()
        ->and($staff->hasEnabledTwoFactorAuthentication())->toBeTrue()
        ->and(Hash::check('showcase-staff-password', $staff->password))->toBeTrue()
        ->and($staff->getAttribute('password_proof_required'))->toBeFalse();

    $hashes = [User::query()->where('username', Showcase::SHOWCASE_USERNAME)->value('password'), $staff->password];

    runShowcase();

    // A re-run keeps the password hashes, so it signs nobody out.
    expect([User::query()->where('username', Showcase::SHOWCASE_USERNAME)->value('password'), $staff->fresh()?->password])->toBe($hashes);
    expect(showcaseTableCounts())->toBe($first)
        ->and(DB::table('audit_events')->where('action', Showcase::AUDIT_SEEDED)->count())->toBe(1);
});

it('purges only sample data, files included, and keeps real members', function () {
    prepareShowcaseHost();

    runShowcase();

    // A real member on the same host (like the owner's account on staging), with a build and a follow of a sample member.
    $real = User::factory()->create(['email' => 'hassam.dev@example.com']);
    $realVehicle = Vehicle::factory()->for($real, 'owner')->create();
    DB::table('follows')->insert(['follower_id' => $real->id, 'followee_id' => User::query()->where('username', Showcase::SHOWCASE_USERNAME)->value('id'), 'created_at' => now()]);

    $samplePhoto = Media::query()->where('sample_source', 'like', 'vehicle:%')->whereNotNull('variants')->firstOrFail();
    $variant = (string) collect($samplePhoto->getAttribute('variants'))->first();
    expect(Storage::disk('showcase_public')->exists($variant))->toBeTrue();

    $this->artisan('speedclub:demo', ['--purge' => true, '--dry-run' => true])->assertSuccessful();
    expect(User::query()->where('is_sample', true)->count())->toBe(42);

    // Without --force the command asks, and "no" keeps everything.
    $this->artisan('speedclub:demo', ['--purge' => true])->expectsConfirmation('Remove all showcase data listed above? Real members are not touched.', 'no')->assertFailed();
    expect(User::query()->where('is_sample', true)->count())->toBe(42);

    $this->artisan('speedclub:demo', ['--purge' => true, '--force' => true])->assertSuccessful();

    expect(homeCollectionKeys())->not->toContain(Showcase::COLLECTION_KEY);
    expect(array_filter(app(ShowcasePurge::class)->counts()))->toBe([])
        ->and(User::withTrashed()->where('is_sample', true)->count())->toBe(0)
        ->and(Vehicle::withTrashed()->where('is_sample', true)->count())->toBe(0)
        ->and(Media::withTrashed()->whereNotNull('sample_source')->count())->toBe(0)
        ->and(Storage::disk('showcase_public')->exists($variant))->toBeFalse()
        ->and(DB::table('approval_requests')->count())->toBe(0)
        ->and(Staff::query()->where('email', Showcase::STAFF_EMAIL)->exists())->toBeFalse()
        ->and(User::query()->whereKey($real->id)->exists())->toBeTrue()
        ->and(Vehicle::query()->whereKey($realVehicle->id)->exists())->toBeTrue()
        ->and(DB::table('audit_events')->where('action', Showcase::AUDIT_PURGED)->count())->toBe(1);
});

it('matches photos on make, model and generation names only', function () {
    expect(ShowcasePhotos::matches('VW', 'Golf GTI', '5G', 'Volkswagen', 'Golf GTI', 'VII (5G)'))->toBeTrue()
        ->and(ShowcasePhotos::matches('BMW', 'M3', 'E92', 'BMW', 'M3', 'E90/E92/E93'))->toBeTrue()
        ->and(ShowcasePhotos::matches('Mercedes-AMG', 'C 63 AMG', 'W204', 'Mercedes-Benz', 'C 63 AMG', 'W204'))->toBeTrue()
        ->and(ShowcasePhotos::matches('BMW', 'M3', 'E46', 'BMW', 'M3', 'E92'))->toBeFalse()
        ->and(ShowcasePhotos::matches('VW', 'Golf', 'VII', 'Volkswagen', 'Golf GTI', 'VII (5G)'))->toBeFalse()
        ->and(ShowcasePhotos::matches('Audi', 'Quattro', 'Typ', 'Audi', 'Quattro', 'Typ 85'))->toBeFalse()
        ->and(ShowcasePhotos::matches('Mazda', 'MX-5', 'ND', 'Mazda', 'MX-5', 'NA'))->toBeFalse();
});

it('matches photo names to the catalogue spelling of the same model and generation only', function (array $photo, array $catalogue, bool $expected) {
    expect(ShowcasePhotos::matches(...$photo, ...$catalogue))->toBe($expected);
})->with([
    'VW Mk numeral' => [['Volkswagen', 'Golf GTI', 'Mk7'], ['Volkswagen', 'Golf GTI', 'VII (5G)'], true],
    'model variant' => [['Volkswagen', 'Corrado G60', 'Typ 53i'], ['Volkswagen', 'Corrado', '53I'], true],
    'Porsche variant' => [['Porsche', '911 Carrera', '992'], ['Porsche', '911', '992'], true],
    'trailing letter' => [['Porsche', 'Cayman GT4', '981'], ['Porsche', 'Cayman', '981c'], true],
    'trailing digit' => [['Honda', 'S2000', 'AP'], ['Honda', 'S2000', 'AP1'], true],
    'facelift word' => [['Subaru', 'Impreza WRX STI', 'GD (Blobeye)'], ['Subaru', 'Impreza WRX STI', 'GD'], true],
    'market name' => [['Nissan', 'Silvia', 'S14'], ['Nissan', '200SX', 'S14'], true],
    'AMG brand' => [['Mercedes-AMG', 'A 45 S', 'W177'], ['Mercedes-Benz', 'A 45 AMG', 'W177'], true],
    'Trueno' => [['Toyota', 'Sprinter Trueno', 'AE86'], ['Toyota', 'Corolla Levin/Trueno', 'AE86'], true],
    'other generation' => [['BMW', 'M3', 'E46'], ['BMW', 'M3', 'E92'], false],
    'other Golf' => [['Volkswagen', 'Golf GTI', 'Mk8'], ['Volkswagen', 'Golf GTI', 'VII (5G)'], false],
    // A Roman numeral plus one letter is the next generation, not a variant (M4.2: Mk7 photos went to a Golf VIII).
    'Mk7 is not the VIII' => [['Volkswagen', 'Golf GTI', 'Mk7'], ['Volkswagen', 'Golf GTI', 'VIII (CD)'], false],
    'Mk2 is not the III' => [['Volkswagen', 'Golf GTI', 'Mk2'], ['Volkswagen', 'Golf GTI', 'III (1H)'], false],
    'other model' => [['BMW', 'M4', 'F82'], ['BMW', 'M3', 'F80'], false],
    'other make' => [['Audi', 'RS3', '8Y'], ['Volkswagen', 'RS3', '8Y'], false],
]);

it('gives a build one whole shoot, the largest first, even a single-photo shoot', function () {
    $entry = fn (string $file, string $car): array => ['file' => $file, 'make' => 'BMW', 'model' => 'M3', 'generation' => 'E46', 'car' => $car, 'category' => 'exterior'];
    $dir = storage_path('framework/testing/showcase-photos-'.Str::random(6));
    File::ensureDirectoryExists($dir);
    $manifest = [$entry('a-1.jpg', 'solo'), $entry('b-1.jpg', 'trio'), $entry('b-2.jpg', 'trio'), $entry('b-3.jpg', 'trio')];
    foreach ($manifest as $row) {
        File::put($dir.'/'.$row['file'], 'x');
    }

    $candidate = fn (string $key): array => ['key' => $key, 'make' => 'BMW', 'model' => 'M3', 'generation' => 'E46', 'pick' => null];
    $allocated = (new ShowcasePhotos($dir, $manifest, [], []))->allocate([$candidate('first'), $candidate('second'), $candidate('third')], 10);

    expect(array_map(fn (array $photos): array => array_column($photos, 'file'), $allocated))
        ->toBe(['first' => ['b-1.jpg', 'b-2.jpg', 'b-3.jpg'], 'second' => ['a-1.jpg']]);

    File::deleteDirectory($dir);
});

/** @return list<mixed> keys of the live home_curation collections */
function homeCollectionKeys(): array
{
    $payload = app(ConfigVersions::class)->live(ConfigKey::HomeCuration)?->payload;

    return array_column(is_array($payload) && is_array($payload['collections'] ?? null) ? $payload['collections'] : [], 'key');
}
