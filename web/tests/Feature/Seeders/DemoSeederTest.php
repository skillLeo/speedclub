<?php

use App\Actions\Auth\SignInMember;
use App\Enums\BuildUpdateType;
use App\Enums\ConversationFolder;
use App\Enums\MediaStatus;
use App\Enums\MemberSecurityEvent;
use App\Enums\ModFieldType;
use App\Enums\ModStatus;
use App\Enums\PowerSource;
use App\Enums\QrStatus;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Models\AuditEvent;
use App\Models\Brand;
use App\Models\BuildUpdate;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Follow;
use App\Models\Media;
use App\Models\Message;
use App\Models\ModCategoryField;
use App\Models\Modification;
use App\Models\Notification;
use App\Models\QrCode;
use App\Models\Save;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleSearch;
use App\Services\Messaging\MessagingCounts;
use App\Support\Codes;
use Carbon\CarbonImmutable;
use Database\Seeders\DemoSeeder;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

/**
 * Identifiers QA and the E2E tests rely on. Changing one breaks those tests, so it has to be a conscious change here.
 */
const DEMO_SLUGS = [
    'nissan-r34' => 'nissan-skyline-gt-r-r34-',
    'bmw-g82' => 'bmw-m4-g82-',
    'vw-golf7-gti' => 'volkswagen-golf-gti-vii-5g-',
    'toyota-a80' => 'toyota-supra-a80-',
    'porsche-992' => 'porsche-911-992-',
    'bmw-e30-draft' => 'bmw-m3-e30-',
];

const DEMO_USERNAMES = ['lukas.sc', 'jann.ptrs', 'max.e46', 'sara.gti', 'kenji.r34', 'tobi.quattro', 'lena.911', 'marco.amg', 'finn.jdm', 'aylin.vtec', 'nico.sti', 'paul.roadster'];

/**
 * Photos have their own test; this keeps the others fast and off the real disks.
 */
function seedDemo(int $photoLimit = 0): void
{
    config(['speedclub.demo.member_password' => 'demo-member-password', 'speedclub.demo.photo_limit' => $photoLimit]);

    test()->seed(DemoSeeder::class);
}

/**
 * Errors of a stored mod against its category schema (02_PRODUCT_SPEC §3.3).
 *
 * @return list<string>
 */
function modFieldErrors(Modification $mod): array
{
    $schema = ModCategoryField::query()->where('category_id', $mod->category_id)->get()->keyBy('key');
    $errors = [];

    foreach ($mod->getAttribute('fields') ?? [] as $key => $value) {
        $field = $schema[$key] ?? null;

        if ($field === null) {
            $errors[] = "unknown field $key";

            continue;
        }

        $valid = match ($field->type) {
            ModFieldType::Number => is_int($value) || is_float($value),
            ModFieldType::Boolean => is_bool($value),
            ModFieldType::Select => in_array($value, array_column($field->options, 'value'), true),
            ModFieldType::Brand => Brand::query()->where('name', $value)->exists(),
            ModFieldType::Text => is_string($value) && (! isset($field->options['pattern']) || preg_match('~'.$field->options['pattern'].'~', $value) === 1),
        };

        if (! $valid) {
            $errors[] = "invalid $key";
        }

        if ($field->type === ModFieldType::Number && is_numeric($value)) {
            if (($field->min !== null && $value < $field->min) || ($field->max !== null && $value > $field->max)) {
                $errors[] = "$key out of range";
            }

            if ($field->step !== null && fmod((float) $value - (float) $field->min, $field->step) !== 0.0) {
                $errors[] = "$key off step";
            }
        }
    }

    return $errors;
}

it('refuses to run in production with a clear error', function () {
    app()->detectEnvironment(fn () => 'production');

    config(['speedclub.demo.member_password' => 'demo-member-password']);

    expect(fn () => app(DemoSeeder::class)->setContainer(app())->__invoke())->toThrow(RuntimeException::class, 'APP_ENV is production');

    expect(User::query()->count())->toBe(0);
});

it('refuses to run without a member password', function () {
    config(['speedclub.demo.member_password' => null]);

    expect(fn () => test()->seed(DemoSeeder::class))->toThrow(RuntimeException::class, 'DEMO_MEMBER_PASSWORD');
});

it('creates the 12 members plus a verified member with an empty garage', function () {
    seedDemo();

    expect(User::query()->count())->toBe(13);

    foreach (DEMO_USERNAMES as $username) {
        $user = User::query()->where('username', $username)->firstOrFail();

        expect($user->email_verified_at)->not->toBeNull($username)
            ->and($user->display_name)->not->toBeEmpty()
            ->and($user->city)->not->toBeEmpty()
            ->and($user->bio)->not->toBeEmpty()
            ->and(Hash::check('demo-member-password', $user->password))->toBeTrue()
            ->and($user->vehicles()->count())->toBeGreaterThan(0);
    }

    $empty = User::query()->where('username', 'nina.neu')->firstOrFail();

    expect($empty->vehicles()->count())->toBe(0)->and($empty->email_verified_at)->not->toBeNull();
});

it('creates 35 published vehicles and one draft with the agreed visibility mix', function () {
    seedDemo();

    expect(Vehicle::query()->where('status', VehicleStatus::Published)->count())->toBe(35)
        ->and(Vehicle::query()->where('status', VehicleStatus::Draft)->count())->toBe(1)
        ->and(Vehicle::query()->where('visibility', Visibility::Unlisted)->count())->toBe(1)
        ->and(Vehicle::query()->where('visibility', Visibility::Private)->count())->toBe(1);

    expect(Vehicle::findBySlug(Vehicle::query()->where('status', VehicleStatus::Draft)->value('slug'))?->owner->username)->toBe('lukas.sc');
});

it('matches the flagship R34 of the design system', function () {
    seedDemo();

    $vehicle = Vehicle::query()->where('public_id', DemoSeeder::publicIdFor('nissan-r34'))->with(['specs', 'make', 'vehicleModel', 'generation', 'owner'])->firstOrFail();

    expect($vehicle->make->name)->toBe('Nissan')
        ->and($vehicle->vehicleModel->name)->toBe('Skyline GT-R')
        ->and($vehicle->generation->name)->toBe('R34')
        ->and($vehicle->model_year)->toBe(2002)
        ->and($vehicle->color)->toBe('Bayside Blue')
        ->and($vehicle->is_main)->toBeTrue()
        ->and($vehicle->owner->username)->toBe('lukas.sc')
        ->and($vehicle->owner->city)->toBe('Stuttgart')
        ->and($vehicle->specs->engine_code)->toBe('RB26DETT')
        ->and($vehicle->specs->engine_text)->toBe('2,6 l R6 Biturbo')
        ->and($vehicle->specs->displacement_cc)->toBe(2568)
        ->and($vehicle->specs->power_ps)->toBe(500.0)
        ->and($vehicle->specs->torque_nm)->toBe(540)
        ->and($vehicle->specs->power_source)->toBe(PowerSource::Measured);
});

it('shows the 14 mods of the flagship with wheels, suspension and exhaust first', function () {
    seedDemo();

    $mods = Vehicle::query()->where('public_id', DemoSeeder::publicIdFor('nissan-r34'))->firstOrFail()
        ->modifications()->where('status', ModStatus::Installed)->orderBy('sort')->with('category')->get();

    expect($mods->count())->toBe(12)
        ->and(Modification::query()->where('vehicle_id', $mods->first()->vehicle_id)->count())->toBe(14)
        ->and($mods->take(3)->map(fn (Modification $mod): string => $mod->category->key)->all())->toBe(['wheels_tires', 'suspension', 'exhaust']);
});

it('dates every account before its content, with the member-since date of the design system for lukas.sc', function () {
    seedDemo();

    expect(User::query()->where('username', 'lukas.sc')->firstOrFail()->created_at->format('Y-m'))->toBe('2023-03');

    foreach (Vehicle::query()->with(['owner', 'modifications'])->get() as $vehicle) {
        expect($vehicle->created_at->gte($vehicle->owner->created_at))->toBeTrue($vehicle->slug);

        if ($vehicle->published_at !== null) {
            expect($vehicle->published_at->gte($vehicle->created_at))->toBeTrue($vehicle->slug);
        }

        foreach ($vehicle->modifications as $mod) {
            expect($mod->created_at->gte($vehicle->created_at))->toBeTrue($mod->title);
        }
    }
});

it('keeps tyres and wheels of one mod on the same diameter', function () {
    seedDemo();

    foreach (Modification::query()->get() as $mod) {
        $fields = $mod->getAttribute('fields') ?? [];

        if (! isset($fields['diameter'], $fields['tyre_size_front'])) {
            continue;
        }

        expect($fields['tyre_size_front'])->toEndWith('R'.$fields['diameter'], $mod->title)
            ->and($fields['tyre_size_rear'])->toEndWith('R'.($fields['diameter_rear'] ?? $fields['diameter']), $mod->title);
    }
});

it('keeps identifiers stable across runs', function () {
    expect(DemoSeeder::publicIdFor('nissan-r34'))->toBe('5TF974VJ')
        ->and(DemoSeeder::qrCodeFor('nissan-r34'))->toBe('8TR0Q3MC');

    seedDemo();

    foreach (DEMO_SLUGS as $key => $prefix) {
        $publicId = DemoSeeder::publicIdFor($key);

        expect(Codes::isValid($publicId))->toBeTrue()
            ->and(Vehicle::query()->where('public_id', $publicId)->value('slug'))->toBe($prefix.strtolower($publicId));
    }

    $first = [
        Vehicle::query()->orderBy('public_id')->pluck('slug')->all(),
        QrCode::query()->orderBy('code')->pluck('code')->all(),
        User::query()->orderBy('username')->pluck('email')->all(),
        DB::table('follows')->count(),
        DB::table('saves')->count(),
        DB::table('qr_scan_daily')->sum('count'),
    ];

    Modification::query()->forceDelete();
    Vehicle::query()->forceDelete();
    User::query()->forceDelete();

    seedDemo();

    expect([
        Vehicle::query()->orderBy('public_id')->pluck('slug')->all(),
        QrCode::query()->orderBy('code')->pluck('code')->all(),
        User::query()->orderBy('username')->pluck('email')->all(),
        DB::table('follows')->count(),
        DB::table('saves')->count(),
        DB::table('qr_scan_daily')->sum('count'),
    ])->toBe($first);
});

it('does nothing when the demo members already exist', function () {
    seedDemo();
    $vehicles = Vehicle::query()->count();

    seedDemo();

    expect(Vehicle::query()->count())->toBe($vehicles)->and(User::query()->count())->toBe(13);
});

it('stores about 120 modifications that are valid per the category schema', function () {
    seedDemo();

    $mods = Modification::query()->with('vehicle')->get();

    expect($mods->count())->toBeGreaterThanOrEqual(120);

    foreach ([ModStatus::Installed, ModStatus::Planned, ModStatus::Removed] as $status) {
        expect($mods->where('status', $status)->count())->toBeGreaterThan(0);
    }

    foreach ($mods as $mod) {
        expect(modFieldErrors($mod))->toBe([], $mod->title)
            ->and($mod->brand_id)->not->toBeNull()
            ->and($mod->cost_public)->toBeFalse();

        if ($mod->status === ModStatus::Planned) {
            expect($mod->installed_on)->toBeNull($mod->title);
        } else {
            expect($mod->installed_on?->isPast())->toBeTrue($mod->title);
        }
    }

    $kw = Modification::query()->where('title', 'KW V3')->firstOrFail();

    expect($kw->getAttribute('fields'))->toMatchArray(['type' => 'coilover', 'lowering_front' => 35]);
});

it('never presents tuned figures as factory figures', function () {
    seedDemo();

    $tuned = Modification::query()->where('status', ModStatus::Installed)->get()
        ->filter(fn (Modification $mod): bool => isset($mod->getAttribute('fields')['claimed_power']));

    expect($tuned->count())->toBeGreaterThan(0);

    foreach ($tuned as $mod) {
        $specs = $mod->vehicle->specs;

        expect($specs->power_source)->not->toBe(PowerSource::Factory, $mod->title)
            ->and($specs->power_ps)->toBe((float) $mod->getAttribute('fields')['claimed_power'], $mod->title);
    }
});

it('keeps every model year inside its generation', function () {
    seedDemo();

    foreach (Vehicle::query()->with('generation')->get() as $vehicle) {
        expect($vehicle->model_year)->toBeGreaterThanOrEqual($vehicle->generation->year_from, $vehicle->slug);

        if ($vehicle->generation->year_to !== null) {
            expect($vehicle->model_year)->toBeLessThanOrEqual($vehicle->generation->year_to, $vehicle->slug);
        }
    }
});

it('writes build updates with before and after diffs and one hidden entry', function () {
    seedDemo();

    $update = BuildUpdate::query()->where('type', BuildUpdateType::ModAdded)->get()
        ->firstOrFail(fn (BuildUpdate $update): bool => ($update->payload['after'] ?? null) === 'KW V3 · −35 mm');

    expect($update->payload)->toMatchArray(['label' => 'Fahrwerk', 'before' => 'Serie', 'after' => 'KW V3 · −35 mm', 'category' => 'suspension'])
        ->and($update->vehicle->public_id)->toBe(DemoSeeder::publicIdFor('nissan-r34'))
        ->and(BuildUpdate::query()->where('hidden', true)->count())->toBe(1)
        ->and(BuildUpdate::query()->where('type', BuildUpdateType::Note)->count())->toBeGreaterThan(0);
});

it('gives each member at most one main vehicle and it is a listed one', function () {
    seedDemo();

    foreach (User::query()->whereIn('username', DEMO_USERNAMES)->get() as $user) {
        $mains = $user->vehicles()->where('is_main', true)->get();

        expect($mains)->toHaveCount(1)
            ->and($mains->first()->status)->toBe(VehicleStatus::Published)
            ->and($mains->first()->visibility)->toBe(Visibility::Public);
    }
});

it('gives every published vehicle one active QR code and no draft any', function () {
    seedDemo();

    foreach (Vehicle::query()->where('status', VehicleStatus::Published)->get() as $vehicle) {
        expect($vehicle->qrCodes()->where('status', QrStatus::Active)->count())->toBe(1, $vehicle->slug)
            ->and(Codes::isValid($vehicle->qrCodes()->where('status', QrStatus::Active)->value('code')))->toBeTrue();
    }

    expect(QrCode::query()->where('status', QrStatus::Revoked)->count())->toBe(1)
        ->and(QrCode::query()->whereHas('vehicle', fn ($query) => $query->where('status', VehicleStatus::Draft))->count())->toBe(0);
});

it('creates follows and saves without self references and leaves the empty member out', function () {
    seedDemo();

    expect(DB::table('follows')->whereColumn('follower_id', 'followee_id')->count())->toBe(0)
        ->and(DB::table('follows')->count())->toBeGreaterThan(20)
        ->and(User::query()->where('username', 'nina.neu')->firstOrFail()->following()->count())->toBe(0)
        ->and(DB::table('saves')->join('vehicles', 'vehicles.id', '=', 'saves.vehicle_id')->whereColumn('vehicles.owner_id', 'saves.user_id')->count())->toBe(0)
        ->and(DB::table('saves')->join('vehicles', 'vehicles.id', '=', 'saves.vehicle_id')->where('vehicles.visibility', '!=', 'public')->count())->toBe(0);
});

it('gives QA the M2.1 states: four saved builds for lukas.sc and paul.roadster blocking nina.neu', function () {
    seedDemo();

    $lukas = User::query()->where('username', 'lukas.sc')->firstOrFail();
    $paul = User::query()->where('username', 'paul.roadster')->firstOrFail();
    $nina = User::query()->where('username', 'nina.neu')->firstOrFail();
    $saved = $lukas->savedVehicles()->with('owner')->orderByDesc('saves.created_at')->get();

    expect($saved)->toHaveCount(4)
        ->and($saved->every(fn (Vehicle $vehicle): bool => $vehicle->owner_id !== $lukas->id && $vehicle->visibility === Visibility::Public && $vehicle->status === VehicleStatus::Published))->toBeTrue()
        ->and($saved->map(fn (Vehicle $vehicle): string => (string) $vehicle->owner?->username)->unique()->count())->toBe(4)
        ->and($saved->pluck('owner.username')->intersect(['paul.roadster', 'nina.neu'])->all())->toBe([])
        ->and($paul->blockedUsers()->pluck('username')->all())->toBe(['nina.neu'])
        ->and(DB::table('blocks')->count())->toBe(1)
        ->and($paul->hasBlockWith($nina))->toBeTrue()
        ->and(DB::table('follows')->whereIn('follower_id', [$paul->id, $nina->id])->whereIn('followee_id', [$paul->id, $nina->id])->count())->toBe(0);
});

it('gives lukas.sc a true notification history (M2.2): followers by day, a followed member\'s update, a weekly save count, a new device', function () {
    seedDemo();

    $lukas = User::query()->where('username', 'lukas.sc')->firstOrFail();
    Sanctum::actingAs($lukas);
    $rows = test()->getJson('/api/v1/notifications')->assertOk()->json('data');
    $types = array_count_values(array_column($rows, 'type'));

    expect(Notification::query()->where('notifiable_id', '!=', $lukas->id)->count())->toBe(0)
        ->and($types['new_follower'] ?? 0)->toBeBetween(1, 2)
        ->and($types['followed_published'] ?? 0)->toBe(1)
        ->and($types['build_saved'] ?? 0)->toBe(1)
        ->and($types['security'] ?? 0)->toBe(1);

    foreach ($rows as $row) {
        if ($row['type'] === 'new_follower') {
            // Every named follower really follows him.
            expect($lukas->followers()->whereIn('username', array_column($row['actors'], 'username'))->count())->toBe(count($row['actors']));
        }

        if ($row['type'] === 'build_saved') {
            expect($row['details']['count'])->toBeGreaterThanOrEqual(1)
                ->and($row['details']['count'])->toBeLessThanOrEqual(Save::query()->where('vehicle_id', $row['vehicle']['id'])->count())
                ->and($row['actors'])->toBe([]);
        }

        if ($row['type'] === 'followed_published') {
            expect($lukas->following()->where('username', $row['actors'][0]['username'])->exists())->toBeTrue();
        }
    }
});

it('fills the search projection for published vehicles only', function () {
    seedDemo();

    expect(VehicleSearch::query()->count())->toBe(35)
        ->and(VehicleSearch::query()->where('is_public', true)->count())->toBe(33);

    $r34 = VehicleSearch::query()->where('vehicle_id', Vehicle::query()->where('public_id', DemoSeeder::publicIdFor('nissan-r34'))->value('id'))->firstOrFail();

    expect($r34->power_ps)->toBe(500.0)
        ->and($r34->wheel_diameter)->toBe(18.0)
        ->and($r34->suspension_type)->toBe('coilover')
        ->and($r34->search_text)->toContain('Skyline GT-R', 'RB26DETT', 'KW V3');
});

it('attaches real photos through the media pipeline and sets the cover', function () {
    Storage::fake('public');
    Storage::fake('local');

    config(['speedclub.media.disk' => 'public', 'speedclub.media.private_disk' => 'local', 'queue.default' => 'sync']);

    seedDemo(photoLimit: 1);

    expect(Media::query()->count())->toBe(1);

    $media = Media::query()->firstOrFail();
    $vehicle = Vehicle::query()->where('public_id', DemoSeeder::publicIdFor('nissan-r34'))->firstOrFail();

    expect($media->status)->toBe(MediaStatus::Ready)
        ->and($media->blurhash)->not->toBeEmpty()
        ->and($media->getAttribute('mediable_id'))->toBe($vehicle->id)
        ->and($media->owner_id)->toBe($vehicle->owner_id)
        ->and($vehicle->cover_media_id)->toBe($media->id)
        ->and($media->alt)->toContain('Blauer Nissan Skyline GT-R R34')
        ->and(array_keys($media->variants))->toContain(320, 1080);
});

/**
 * @return list<array<string, mixed>>
 */
function demoVehicles(): array
{
    return json_decode((string) file_get_contents(database_path('data/demo.json')), true, 64, JSON_THROW_ON_ERROR)['vehicles'];
}

/**
 * @param  array<string, mixed>  $vehicle
 * @return list<string> every photo file of a vehicle, gallery first, mod photos after it
 */
function vehiclePhotos(array $vehicle): array
{
    return [...$vehicle['photos'], ...array_values(array_filter(array_column($vehicle['mods'], 'photo')))];
}

/**
 * The rule for every gallery: a build page shows one physical car. Files named after a car ("nissan-r34-01.jpg") form a
 * family; a vehicle uses one family, and from these families, which show two different cars (lead's review of
 * design/seed-photos), one file only. No photo appears twice. "generic-*" files are details, never another car's exterior.
 */
it('shows one physical car per build page', function () {
    $twoCars = ['nissan-r34', 'audi-tt-8s', 'bmw-g82', 'bmw-e92', 'mazda-fd', 'mazda-mx5', 'toyota-a80', 'toyota-ae86', 'nissan-s15'];
    $manifest = collect(json_decode((string) file_get_contents(base_path('../design/seed-photos/manifest.json')), true, 64, JSON_THROW_ON_ERROR))->keyBy('file');

    foreach (demoVehicles() as $vehicle) {
        $named = array_values(array_filter(vehiclePhotos($vehicle), fn (string $file): bool => ! str_starts_with($file, 'generic-')));
        $families = array_unique(array_map(fn (string $file): string => (string) preg_replace('/-\d+\.jpg$/', '', $file), $named));

        expect(count($families))->toBeLessThanOrEqual(1, "{$vehicle['key']} shows more than one car");

        foreach ($families as $family) {
            expect(str_starts_with($vehicle['key'], $family))->toBeTrue("{$vehicle['key']} uses the photos of $family");

            if (in_array($family, $twoCars, true)) {
                expect(count($named))->toBe(1, "{$vehicle['key']}: $family shows two different cars");
            }
        }

        foreach (vehiclePhotos($vehicle) as $file) {
            if (str_starts_with($file, 'generic-')) {
                expect($manifest[$file]['category'])->not->toBe('exterior', "{$vehicle['key']}: $file shows a whole car");
            }
        }
    }

    $used = array_merge(...array_map(vehiclePhotos(...), demoVehicles()));

    expect($used)->toBe(array_values(array_unique($used)));
});

it('keeps reserved and misleading photos off the builds', function () {
    foreach (demoVehicles() as $vehicle) {
        $photos = vehiclePhotos($vehicle);

        expect($photos)->not->toContain('generic-exterior-01.jpg', 'generic-exterior-03.jpg');

        // The first gallery photo becomes the cover, so it has to show the whole car.
        if ($vehicle['photos'] !== []) {
            expect($vehicle['photos'][0])->not->toStartWith('generic-', $vehicle['key'])
                ->not->toBe('nissan-s15-02.jpg', $vehicle['key'])
                ->not->toBe('audi-tt-8s-01.jpg', $vehicle['key']);
        }

        // Galleries carry only photos that cannot contradict the car.
        $rules = ['generic-engine-02.jpg' => 'honda-', 'generic-wheels-04.jpg' => 'audi-', 'generic-interior-01.jpg' => 'toyota-gt86'];

        foreach ($rules as $file => $prefix) {
            if (in_array($file, $vehicle['photos'], true)) {
                expect($vehicle['key'])->toStartWith($prefix);
            }
        }

        // Photos showing a brand belong to a mod that names it.
        expect($vehicle['photos'])->not->toContain('generic-wheels-01.jpg', 'generic-wheels-02.jpg', 'generic-wheels-03.jpg', 'generic-interior-02.jpg');

        foreach ($vehicle['mods'] as $mod) {
            match ($mod['photo'] ?? null) {
                'generic-wheels-01.jpg' => expect($mod['b'])->toBe('Work Wheels'),
                'generic-wheels-02.jpg' => expect([$mod['b'], $mod['f']['tyre_brand']])->toBe(['Work Wheels', 'Toyo']),
                'generic-interior-02.jpg' => expect($mod['b'])->toBe('Corbeau'),
                default => null,
            };
        }
    }
});

it('lists only wheels the photo of the car can show as installed', function () {
    $vehicle = fn (string $key): array => collect(demoVehicles())->firstWhere('key', $key);
    $wheels = fn (string $key): array => collect($vehicle($key)['mods'])->firstWhere('c', 'wheels_tires');

    expect($wheels('vw-golf2')['b'])->toBe('OZ Racing')
        ->and($wheels('honda-fk8')['s'])->toBe('planned')
        ->and($wheels('porsche-964')['p'])->toBe('RS')
        ->and($vehicle('porsche-964')['description'])->not->toContain('Fuchs')
        ->and($wheels('mercedes-w201')['b'])->toBe('Continental')
        ->and($vehicle('mercedes-w201')['description'])->not->toContain('fast alles original');
});

it('matches the wheels the flagship and the other checked cars show on their photos', function () {
    $vehicle = fn (string $key): array => collect(demoVehicles())->firstWhere('key', $key);
    $wheels = fn (string $key): array => collect($vehicle($key)['mods'])->firstWhere('c', 'wheels_tires');

    // Dark six-spoke wheels on the flagship; factory cross-spokes on the M2; factory centre-lock wheels on the 992 GTS.
    expect($wheels('nissan-r34')['b'])->toBe('Rays')
        ->and($wheels('nissan-r34')['f']['finish'])->toBe('Schwarz')
        ->and($wheels('nissan-r34')['f']['diameter'])->toBe(18)
        ->and($wheels('bmw-f87')['s'])->toBe('planned')
        ->and($wheels('porsche-992')['s'])->toBe('planned')
        ->and($vehicle('porsche-992')['nickname'])->toBe('Carrera GTS')
        ->and($wheels('honda-s2000')['f']['finish'])->toContain('Weiß')
        ->and($wheels('toyota-a80-silver')['f']['finish'])->toContain('Schwarz')
        ->and($wheels('vw-golf7-gti')['f']['finish'])->not->toContain('Black');
});

it('keeps unverified part numbers out of mod names', function () {
    foreach (demoVehicles() as $vehicle) {
        foreach ($vehicle['mods'] as $mod) {
            expect($mod['p'])->not->toMatch('/\([A-Z0-9-]{5,}\)/', $vehicle['key']);
        }
    }
});

it('does not name a bolt pattern for a car where it depends on the model year', function () {
    $sti = collect(demoVehicles())->firstWhere('key', 'subaru-sti');

    expect($sti['description'])->toContain('Blobeye')->not->toContain('rund')
        ->and(collect($sti['mods'])->firstWhere('c', 'wheels_tires')['f'])->not->toHaveKey('bolt_pattern');
});

it('keeps factory carbon parts of the V-Spec II off the mod list of the flagship', function () {
    $r34 = collect(demoVehicles())->firstWhere('key', 'nissan-r34');
    $aero = collect($r34['mods'])->where('c', 'aero_body');

    expect($r34['mods'])->toHaveCount(14)
        ->and($aero->pluck('f.part')->all())->not->toContain('hood', 'diffuser');
});

it('lists every demo photo in the manifest', function () {
    $manifest = json_decode((string) file_get_contents(base_path('../design/seed-photos/manifest.json')), true, 64, JSON_THROW_ON_ERROR);
    $files = array_column($manifest, 'file');

    foreach (demoVehicles() as $vehicle) {
        foreach (vehiclePhotos($vehicle) as $file) {
            expect($files)->toContain($file);
        }
    }
});

it('attaches mod photos to their mod and never uses them as a cover', function () {
    Storage::fake('public');
    Storage::fake('local');

    config([
        'speedclub.media.disk' => 'public',
        'speedclub.media.private_disk' => 'local',
        'queue.default' => 'sync',
        'speedclub.demo.member_password' => 'demo-member-password',
        'speedclub.demo.photo_limit' => 99,
    ]);

    // Only the mod photos exist here, so every gallery photo is skipped as missing.
    $directory = sys_get_temp_dir().'/speedclub-seed-'.uniqid();
    mkdir($directory);
    $entries = [];

    foreach (['generic-wheels-01.jpg', 'generic-wheels-02.jpg', 'generic-interior-02.jpg'] as $file) {
        $image = UploadedFile::fake()->image($file, 400, 300);
        file_put_contents($directory.'/'.$file, $image->getContent());
        $entries[] = ['file' => $file, 'alt_de' => 'Manifest', 'category' => 'wheels', 'focal' => ['x' => 0.5, 'y' => 0.5]];
    }

    file_put_contents($directory.'/manifest.json', json_encode($entries));

    $seeder = new class($directory) extends DemoSeeder
    {
        public function __construct(private readonly string $directory) {}

        protected function photoDirectory(): string
        {
            return $this->directory;
        }
    };

    $seeder->setContainer(app())->__invoke();

    array_map(unlink(...), glob($directory.'/*') ?: []);
    rmdir($directory);

    expect(Media::query()->where('mediable_type', 'modification')->count())->toBe(3)
        ->and(Media::query()->count())->toBe(3)
        ->and(Vehicle::query()->whereNotNull('cover_media_id')->count())->toBe(0);

    $removed = Modification::query()->where('part_name', 'Meister S1')->where('status', ModStatus::Removed)->firstOrFail();
    $work = Modification::query()->where('part_name', 'Meister S1 3P')->whereHas('media')->firstOrFail();

    expect($removed->media()->firstOrFail()->alt)->toBe('Manifest')
        ->and($work->media()->firstOrFail()->alt)->toBe('Manifest')
        ->and($work->media()->firstOrFail()->owner_id)->toBe($work->vehicle->owner_id);
});

it('still seeds the vehicles when the manifest or a photo file is missing', function (string $manifest) {
    Storage::fake('public');
    Storage::fake('local');

    $directory = sys_get_temp_dir().'/speedclub-seed-'.uniqid();
    mkdir($directory);

    if ($manifest !== '') {
        file_put_contents($directory.'/manifest.json', $manifest);
    }

    config(['speedclub.demo.member_password' => 'demo-member-password', 'speedclub.demo.photo_limit' => 5]);

    $seeder = new class($directory) extends DemoSeeder
    {
        public function __construct(private readonly string $directory) {}

        protected function photoDirectory(): string
        {
            return $this->directory;
        }
    };

    $seeder->setContainer(app())->__invoke();

    @unlink($directory.'/manifest.json');
    rmdir($directory);

    expect(Vehicle::query()->where('status', VehicleStatus::Published)->count())->toBe(35)
        ->and(Vehicle::query()->whereNotNull('cover_media_id')->count())->toBe(0)
        ->and(Media::query()->count())->toBe(0);
})->with([
    'no manifest' => [''],
    'broken manifest' => ['{not json'],
    'files missing' => ['[{"file":"nissan-r34-01.jpg","alt_de":"Test","category":"exterior","focal":{"x":0.5,"y":0.5}}]'],
]);

/**
 * M2.2 test round D2: the E2E harness signs in from Chromium and WebKit with one fixed user agent; for a demo member that is a known
 * device, so HOME-02 keeps exactly the seeded history.
 */
function demoBrowserSignIn(User $member, string $userAgent): void
{
    $request = Request::create('/api/v1/auth/login', 'POST', server: ['HTTP_USER_AGENT' => $userAgent]);
    $request->setLaravelSession(app('session')->driver('array'));

    app(SignInMember::class)->handle($member, null, $request);
    app('auth')->forgetGuards();
}

it('knows the QA user agent of the E2E harness as a device of every demo member, so its sign-ins write no new-device notice', function () {
    Mail::fake();
    seedDemo();
    $agent = config('speedclub.qa.user_agent');
    $lukas = User::query()->where('username', 'lukas.sc')->firstOrFail();
    $security = fn () => Notification::query()->where('notifiable_id', $lukas->id)->where('type', 'security')->count();
    $before = $security();

    expect($agent)->toBe('SpeedClubQA/1.0 (Playwright)')
        ->and(file_get_contents(base_path('tests/e2e/support/qa.mjs')))->toContain("QA_USER_AGENT = '$agent'");

    foreach (DEMO_USERNAMES as $username) {
        expect(User::query()->where('username', $username)->firstOrFail()->knownDevices()->count())->toBe(1, $username);
    }

    demoBrowserSignIn($lukas, $agent);
    demoBrowserSignIn($lukas, $agent);

    expect($security())->toBe($before)
        ->and(AuditEvent::query()->where('action', MemberSecurityEvent::LoginNewDevice->value)->where('actor_id', $lukas->id)->count())->toBe(0);
    Mail::assertNothingSent();

    // Any other browser is still a new device.
    demoBrowserSignIn($lukas, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15');

    expect($security())->toBe($before + 1);
});

it('stores no QA device where no QA user agent is configured, as in production', function () {
    config(['speedclub.qa.user_agent' => null]);
    seedDemo();

    expect(User::query()->where('username', 'lukas.sc')->firstOrFail()->knownDevices()->count())->toBe(0);
});

/**
 * M2.4 demo conversations (m2.4-contract §6): the same rows and ids on every machine.
 */
it('seeds the messaging demo for lukas.sc deterministically', function () {
    seedDemo();
    $user = fn (string $name): User => User::query()->where('username', $name)->firstOrFail();
    $lukas = $user('lukas.sc');
    $side = function (string $other) use ($lukas, $user): ConversationParticipant {
        $conversation = Conversation::query()->where('pair_key', Conversation::pairKey($lukas, $user($other)))->firstOrFail();

        return ConversationParticipant::query()->where('conversation_id', $conversation->id)->where('user_id', $lukas->id)->firstOrFail();
    };

    expect(Conversation::query()->orderBy('id')->pluck('id')->all())->toBe([
        '01m4jmbs706ww8pewwcwggwra4', '01m5j5ee008eg6ycyg4ey2tgw8', '01m5qvzg200gc60g288tcg08r4', '01m5wpk0c0e8jjewpe4ycappww',
        // M3.4: marco.amg → aylin.vtec, the reported conversation of ADM-22 (ModerationDemoSeeder::seedAdminQueue).
        '01m5zf94p04pgc8jg40mpjg4ca',
        '01m63k07g0m4m0p4wwggarp6tm',
    ])
        ->and(Message::query()->where('conversation_id', $side('jann.ptrs')->conversation_id)->count())->toBe(20)
        ->and(Message::query()->where('conversation_id', $side('jann.ptrs')->conversation_id)->where('type', 'vehicle')->count())->toBe(1)
        ->and($side('jann.ptrs')->folder)->toBe(ConversationFolder::Chats)
        ->and(Conversation::query()->find($side('kenji.r34')->conversation_id)?->vehicle_id)->not->toBeNull()
        ->and($side('kenji.r34')->unread_count)->toBe(1)
        ->and($side('max.e46')->folder)->toBe(ConversationFolder::Requests)
        ->and($side('max.e46')->accepted_at)->toBeNull()
        ->and($side('sara.gti')->muted_until?->toDateTimeString())->toBe('2026-11-30 12:00:00')
        ->and($side('finn.jdm')->archived_at?->toDateTimeString())->toBe('2026-10-11 09:00:00')
        ->and(Follow::query()->where('follower_id', $lukas->id)->where('followee_id', $user('max.e46')->id)->exists())->toBeTrue()
        ->and(app(MessagingCounts::class)->for($lukas))->toBe(['messages' => 1, 'requests' => 1])
        ->and(DemoSeeder::demoUlid(CarbonImmutable::parse('2026-10-30 12:00:00'), 'x'))->toHaveLength(26);

    // jann.ptrs read lukas.sc's last message: "Gelesen" under it in MSG-02.
    $jannSide = ConversationParticipant::query()->where('conversation_id', $side('jann.ptrs')->conversation_id)->where('user_id', $user('jann.ptrs')->id)->firstOrFail();
    expect($jannSide->last_read_message_id)->toBe(Conversation::query()->find($side('jann.ptrs')->conversation_id)?->last_message_id);
});
