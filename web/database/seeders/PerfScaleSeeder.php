<?php

namespace Database\Seeders;

use App\Enums\BuildUpdateType;
use App\Enums\MediaCategory;
use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Enums\UserStatus;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Models\BuildUpdate;
use App\Models\Media;
use App\Models\Notification;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Notifications\Notifier;
use App\Services\Notifications\PublicationFanout;
use App\Services\Search\VehicleSearchProjector;
use App\Support\Slug;
use Carbon\CarbonImmutable;
use Database\Seeders\Concerns\SeedClock;
use Database\Seeders\Concerns\SeedsFromData;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * Scale data for the API performance probes of 09_PREMIUM_2_0 §12 (M4.0 baseline, reused by M4.18): by default 2,000 published
 * vehicles with specs and photos across the catalogue and 400 owners, follows among them and with the measuring member, 5,000 build
 * updates (the v1 Verlauf entity) and about 200 notifications for the measuring member, on top of the demo seed. Events do not exist in
 * v1, so the "200 events" of §12 are not seeded.
 *
 * Never part of DatabaseSeeder: run it on its own, on a measuring database only (`php artisan db:seed --class=PerfScaleSeeder`), after
 * the demo. It refuses production and a database without the demo.
 *
 * Idempotent: every row has a fixed key (ULIDs from DemoSeeder::demoUlid, public ids from DemoSeeder::publicIdFor, perf usernames) and
 * is written with insertOrIgnore, notifications go through Notifier, whose groups ignore a repeated actor; a second run adds nothing.
 * Deterministic: no Faker, every value follows from the row's index, every date counts back from the demo's clock.
 *
 * Rows are written in bulk (2,000 Actions with their row locks would take many minutes); what the endpoints read is then rebuilt through
 * the app's own services: VehicleSearchProjector::rebuildAll() (search rows, facets) and with it HomeRanking::rankAll() (Für dich).
 * The photos reuse the files of the demo's vehicle photos (no image processing; the alt text is left out, as it describes another car),
 * or placeholder paths when the demo ran without photos.
 */
class PerfScaleSeeder extends Seeder
{
    use SeedsFromData;

    public const EMAIL_DOMAIN = 'perf.speedclub.test';

    public const USERNAME_PREFIX = 'perf.m';

    /** The member whose feed, notifications and profile the probes read (docs/HANDOFF.md §4, flagship R34). */
    public const MEASURING_MEMBER = 'lukas.sc';

    private const CHUNK = 500;

    private const FIRST_NAMES = ['Jonas', 'Lea', 'Felix', 'Mia', 'Paul', 'Emma', 'Ben', 'Hannah', 'Luca', 'Sophie', 'Noah', 'Lina', 'Elias', 'Marie', 'Leon', 'Clara', 'Tim', 'Johanna', 'David', 'Ida'];

    private const CITIES = ['Hamburg', 'Berlin', 'München', 'Köln', 'Stuttgart', 'Leipzig', 'Dortmund', 'Bremen', 'Hannover', 'Nürnberg', 'Dresden', 'Essen', 'Frankfurt am Main', 'Freiburg', 'Kiel', 'Rostock'];

    private const COLOURS = ['Alpinweiß', 'Saphirschwarz', 'Nardograu', 'Racing Yellow', 'Tornadorot', 'Estorilblau', 'Silbermetallic', 'British Racing Green', 'Mangogelb', 'Daytonagrau'];

    private const NOTES = [
        'Ölwechsel mit 5W-40 erledigt, Filter gleich mit getauscht.',
        'Erste Ausfahrt nach dem Winter, alles läuft sauber.',
        'Bremsflüssigkeit gewechselt, Pedal fühlt sich deutlich fester an.',
        'Fahrwerk nach der Saison neu vermessen lassen.',
        'Felgen aufbereitet und versiegelt.',
        'Neue Sommerreifen montiert, Spur passt wieder.',
        'Kurzer Ausflug zum Treffen am Nürburgring.',
        'Innenraum gereinigt, Leder gepflegt.',
        'Zündkerzen getauscht, Leerlauf jetzt ruhiger.',
        'HU ohne Mängel bestanden.',
        'Keramikversiegelung aufgefrischt.',
        'Probefahrt nach dem Einbau, keine Geräusche mehr.',
    ];

    /** @var list<array{make: string, model: string, generation: string, make_id: int, model_id: int, generation_id: int, year_from: int|null, year_to: int|null}> */
    private array $catalogue = [];

    /** @var list<array<string, mixed>> */
    private array $photoSources = [];

    private CarbonImmutable $now;

    public function __construct(
        private readonly int $vehicles = 2000,
        private readonly int $owners = 400,
        private readonly int $updates = 5000,
        private readonly int $photosPerVehicle = 3,
        private readonly int $followsPerOwner = 3,
        private readonly int $measuringFollows = 40,
        private readonly int $notifications = 200,
    ) {}

    /**
     * Only a dedicated measuring database (speedclub_perf…) may take the scale data; the test suite's own databases
     * (speedclub_testing…) are allowed under APP_ENV=testing. Never the shared dev database speedclub.
     */
    public static function allowsDatabase(string $database, bool $testing): bool
    {
        return str_starts_with($database, 'speedclub_perf') || ($testing && str_starts_with($database, 'speedclub_testing'));
    }

    public function run(): void
    {
        if (app()->environment('production') || config('app.env') === 'production') {
            throw new RuntimeException('PerfScaleSeeder refuses to run: APP_ENV is production.');
        }

        $database = (string) DB::connection()->getDatabaseName();
        if (! self::allowsDatabase($database, app()->environment('testing'))) {
            throw new RuntimeException('PerfScaleSeeder refuses to run on the database "'.$database.'": it adds about 2,000 vehicles and 400 members, which would break the seeded demo of every other database. Use a database named speedclub_perf… (docs/reports/phase-4/baseline/numbers.md).');
        }

        $member = User::query()->where('username', self::MEASURING_MEMBER)->first();

        if (! $member instanceof User) {
            throw new RuntimeException('PerfScaleSeeder needs the demo seed first (no '.self::MEASURING_MEMBER.'): php artisan db:seed, then this seeder.');
        }

        $this->catalogue = $this->readCatalogue();

        if ($this->catalogue === []) {
            throw new RuntimeException('PerfScaleSeeder needs the vehicle catalogue (CatalogSeeder).');
        }

        $this->now = DemoSeeder::clock();
        $sources = Media::query()->toBase()
            ->where('mediable_type', 'vehicle')->where('status', MediaStatus::Ready->value)->whereNull('deleted_at')
            ->orderBy('id')
            ->get(['disk', 'original_path', 'variants', 'width', 'height', 'blurhash', 'original_bytes', 'variant_bytes'])
            ->map(fn (object $row): array => get_object_vars($row))
            ->all();
        $this->photoSources = array_values($sources);

        $started = microtime(true);
        $push = config('speedclub.push.enabled');
        // Scale data is history: no push, no follower fan-out.
        config(['speedclub.push.enabled' => false]);

        try {
            SeedClock::at($this->now, fn () => PublicationFanout::muted(function () use ($member): void {
                $owners = $this->seedOwners();
                $vehicles = $this->seedVehicles($owners);
                $this->seedFollows($owners, $member);
                $updates = $this->seedUpdates($vehicles);
                $this->seedNotifications($member, $owners, $updates);

                // What the endpoints read, through the app's own services: search rows and facets, then the Für dich scores.
                app(VehicleSearchProjector::class)->rebuildAll();
            }));
        } finally {
            config(['speedclub.push.enabled' => $push]);
        }

        $this->say(sprintf(
            'Perf scale: %d perf vehicles, %d perf owners, %d perf updates, %d notifications of %s in %.1f s.',
            Vehicle::query()->whereIn('owner_id', User::query()->where('email', 'like', '%@'.self::EMAIL_DOMAIN)->select('id'))->count(),
            User::query()->where('email', 'like', '%@'.self::EMAIL_DOMAIN)->count(),
            BuildUpdate::query()->whereIn('vehicle_id', Vehicle::query()->whereIn('owner_id', User::query()->where('email', 'like', '%@'.self::EMAIL_DOMAIN)->select('id'))->select('id'))->count(),
            Notification::query()->where('notifiable_id', $member->id)->count(),
            self::MEASURING_MEMBER,
            microtime(true) - $started,
        ));
    }

    public static function username(int $index): string
    {
        return self::USERNAME_PREFIX.str_pad((string) ($index + 1), 4, '0', STR_PAD_LEFT);
    }

    public static function vehicleKey(int $index): string
    {
        return 'perf-'.($index + 1);
    }

    /**
     * Active generations with their model and make, in a fixed order; vehicles walk it with a stride, so every make shows up.
     *
     * @return list<array{make: string, model: string, generation: string, make_id: int, model_id: int, generation_id: int, year_from: int|null, year_to: int|null}>
     */
    private function readCatalogue(): array
    {
        $rows = DB::table('generations as g')
            ->join('vehicle_models as m', 'm.id', '=', 'g.model_id')
            ->join('makes as k', 'k.id', '=', 'm.make_id')
            ->where('g.active', true)->whereNull('g.merged_into_id')
            ->where('m.active', true)->whereNull('m.merged_into_id')
            ->where('k.active', true)->whereNull('k.merged_into_id')
            ->orderBy('g.id')
            ->get(['k.name as make', 'm.name as model', 'g.name as generation', 'k.id as make_id', 'm.id as model_id', 'g.id as generation_id', 'g.year_from', 'g.year_to'])
            ->map(fn (object $row): array => [
                'make' => (string) $row->make,
                'model' => (string) $row->model,
                'generation' => (string) $row->generation,
                'make_id' => (int) $row->make_id,
                'model_id' => (int) $row->model_id,
                'generation_id' => (int) $row->generation_id,
                'year_from' => $row->year_from === null ? null : (int) $row->year_from,
                'year_to' => $row->year_to === null ? null : (int) $row->year_to,
            ])
            ->all();

        return array_values($rows);
    }

    /**
     * @return list<string> owner ids by index
     */
    private function seedOwners(): array
    {
        // One hash for all: nobody signs in as a perf owner, and argon2id is slow on purpose.
        $hash = Hash::make(Str::random(40));
        $rows = [];
        $ids = [];

        for ($i = 0; $i < $this->owners; $i++) {
            $joined = $this->now->subDays(400 + ($i * 7) % 900)->setTime(10, 0);
            $id = DemoSeeder::demoUlid($joined, 'perf:user:'.$i);
            $ids[] = $id;
            $first = self::FIRST_NAMES[$i % count(self::FIRST_NAMES)];
            $rows[] = [
                'id' => $id,
                'email' => self::username($i).'@'.self::EMAIL_DOMAIN,
                'email_verified_at' => $this->stamp($joined),
                'password' => $hash,
                'username' => self::username($i),
                'display_name' => $first.' '.chr(65 + ($i * 5) % 26).'.',
                'city' => self::CITIES[$i % count(self::CITIES)],
                'bio' => null,
                'profile_setup_at' => $this->stamp($joined),
                'status' => UserStatus::Active->value,
                'last_seen_at' => $this->stamp($this->now->subHours(1 + $i % 240)),
                'terms_version' => LegalDocumentSeeder::VERSION,
                'privacy_version' => LegalDocumentSeeder::VERSION,
                'consented_at' => $this->stamp($joined),
                'created_at' => $this->stamp($joined),
                'updated_at' => $this->stamp($joined),
            ];
        }

        $this->insertAll('users', $rows, 'username');

        // An id written by an earlier run stays the one in the table (the same, as it is derived), so the lookup is by username.
        $stored = User::query()->whereIn('username', array_column($rows, 'username'))->pluck('id', 'username')->all();

        return array_map(fn (int $i): string => (string) ($stored[self::username($i)] ?? throw new RuntimeException('Perf owner '.self::username($i).' is missing.')), array_keys($ids));
    }

    /**
     * @param  list<string>  $owners
     * @return list<array{id: string, owner_id: string, published: CarbonImmutable}>
     */
    private function seedVehicles(array $owners): array
    {
        $vehicles = [];
        $vehicleRows = [];
        $specRows = [];
        $mediaRows = [];
        $sorts = [];
        $catalogueSize = count($this->catalogue);
        $sourceCount = count($this->photoSources);
        // A stride coprime to the catalogue size spreads consecutive vehicles over the makes.
        $stride = $this->coprimeStride($catalogueSize);

        for ($i = 0; $i < $this->vehicles; $i++) {
            $ownerIndex = $i % max(1, count($owners));
            $ownerId = $owners[$ownerIndex];
            $sorts[$ownerId] = ($sorts[$ownerId] ?? 0) + 1;
            $entry = $this->catalogue[($i * $stride) % $catalogueSize];
            $publicId = DemoSeeder::publicIdFor(self::vehicleKey($i));
            $published = $this->now->subDays(20 + ($i * 13) % 340)->setTime(18, 30)->addMinutes($i % 60);
            $created = $published->subDays(3 + $i % 11);
            $id = DemoSeeder::demoUlid($created, 'perf:vehicle:'.$i);
            $from = $entry['year_from'] ?? 1995;
            $to = max($from, min($entry['year_to'] ?? 2024, 2025));
            $coverId = null;

            for ($p = 0; $p < $this->photosPerVehicle; $p++) {
                $mediaId = DemoSeeder::demoUlid($created->addMinutes($p + 1), 'perf:media:'.$i.':'.$p);
                $coverId ??= $mediaId;
                $source = $sourceCount === 0 ? null : $this->photoSources[($i * $this->photosPerVehicle + $p) % $sourceCount];
                $hash = substr(hash('sha256', 'perf:media:'.$i.':'.$p), 0, 16);
                $mediaRows[] = [
                    'id' => $mediaId,
                    'owner_id' => $ownerId,
                    'mediable_type' => 'vehicle',
                    'mediable_id' => $id,
                    'disk' => $source['disk'] ?? 'public',
                    'original_path' => $source['original_path'] ?? "originals/perf/$hash.jpg",
                    'variants' => $source['variants'] ?? json_encode(['320' => "media/perf/$hash-320.webp", '640' => "media/perf/$hash-640.webp", '1080' => "media/perf/$hash-1080.webp", '1440' => "media/perf/$hash-1440.webp"]),
                    'width' => $source['width'] ?? 1440,
                    'height' => $source['height'] ?? 960,
                    'original_bytes' => $source['original_bytes'] ?? 0,
                    'variant_bytes' => $source['variant_bytes'] ?? 0,
                    'blurhash' => $source['blurhash'] ?? 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
                    'category' => [MediaCategory::Exterior, MediaCategory::Interior, MediaCategory::Wheels, MediaCategory::Engine][$p % 4]->value,
                    'sort' => $p + 1,
                    'status' => MediaStatus::Ready->value,
                    'moderation_status' => ModerationStatus::Approved->value,
                    'created_at' => $this->stamp($created->addMinutes($p + 1)),
                    'updated_at' => $this->stamp($created->addMinutes($p + 1)),
                ];
            }

            $vehicleRows[] = [
                'id' => $id,
                'owner_id' => $ownerId,
                'public_id' => $publicId,
                'slug' => Slug::forVehicle($entry['make'], $entry['model'], $entry['generation'], $publicId),
                'status' => VehicleStatus::Published->value,
                'visibility' => Visibility::Public->value,
                'is_main' => $sorts[$ownerId] === 1,
                'sort' => $sorts[$ownerId],
                'description' => $i % 4 === 0 ? 'Alltagsauto mit Wochenendcharakter, Stück für Stück aufgebaut.' : null,
                'color' => self::COLOURS[$i % count(self::COLOURS)],
                'cover_media_id' => $coverId,
                'make_id' => $entry['make_id'],
                'model_id' => $entry['model_id'],
                'generation_id' => $entry['generation_id'],
                'model_year' => $from + ($i % ($to - $from + 1)),
                'published_at' => $this->stamp($published),
                'created_at' => $this->stamp($created),
                'updated_at' => $this->stamp($published),
            ];

            $power = 110 + ($i * 37) % 520;
            $specRows[] = [
                'vehicle_id' => $id,
                'engine_text' => ['2,0 l R4 Turbo', '3,0 l R6 Biturbo', '1,8 l R4', '2,5 l R5 Turbo', '4,0 l V8'][$i % 5],
                'displacement_cc' => [1984, 2993, 1781, 2480, 3996][$i % 5],
                'fuel' => ['petrol', 'petrol', 'petrol', 'diesel', 'hybrid'][$i % 5],
                'aspiration' => ['turbo', 'biturbo', 'naturally_aspirated', 'turbo', 'naturally_aspirated'][$i % 5],
                'power_value' => $power,
                'power_unit' => 'ps',
                'power_source' => $i % 3 === 0 ? 'measured' : 'factory',
                'power_ps' => $power,
                'torque_nm' => 180 + ($i * 23) % 520,
                'torque_source' => 'factory',
                'drivetrain' => ['front', 'rear', 'all'][$i % 3],
                'gearbox' => ['manual', 'automatic', 'dual_clutch'][$i % 3],
                'created_at' => $this->stamp($created),
                'updated_at' => $this->stamp($created),
            ];

            $vehicles[] = ['id' => $id, 'owner_id' => $ownerId, 'published' => $published];
        }

        // Photos first: vehicles.cover_media_id references them. INSERT IGNORE also turns a failed foreign key into a warning, so every
        // table is counted afterwards.
        $this->insertAll('media', $mediaRows, 'id');
        $this->insertAll('vehicles', $vehicleRows, 'id');
        $this->insertAll('vehicle_specs', $specRows, 'vehicle_id');

        return $vehicles;
    }

    /**
     * Each owner follows a few others; the first owners follow the measuring member (new_follower rows) and the measuring member follows
     * the first $measuringFollows owners (Folge ich, followed_published rows). Dates spread over the last 60 days, a few inside the 7 days
     * the ranking counts.
     *
     * @param  list<string>  $owners
     */
    private function seedFollows(array $owners, User $member): void
    {
        $count = count($owners);
        $rows = [];

        for ($i = 0; $i < $count; $i++) {
            foreach ([1, 7, 31, 101, 211] as $n => $step) {
                if ($n >= $this->followsPerOwner || $count < 2) {
                    break;
                }

                $other = ($i + $step) % $count;

                if ($other !== $i) {
                    $rows[] = ['follower_id' => $owners[$i], 'followee_id' => $owners[$other], 'created_at' => $this->stamp($this->now->subDays(($i + $n * 3) % 60)->setTime(20, 0)->subMinutes($i % 50))];
                }
            }
        }

        for ($i = 0; $i < min($this->measuringFollows, $count); $i++) {
            $rows[] = ['follower_id' => $member->id, 'followee_id' => $owners[$i], 'created_at' => $this->stamp($this->now->subDays(90 + $i)->setTime(21, 0))];
        }

        foreach (array_chunk($rows, self::CHUNK) as $chunk) {
            DB::table('follows')->insertOrIgnore($chunk);
        }
    }

    /**
     * Owner notes (BuildUpdateType::Note, as BuildUpdates::note() writes them), each after its vehicle went public, newest last; the
     * vehicle's updated_at follows its latest entry, as "Zuletzt aktualisiert" does when a member writes one.
     *
     * @param  list<array{id: string, owner_id: string, published: CarbonImmutable}>  $vehicles
     * @return list<array{id: string, vehicle_id: string, owner_id: string, at: CarbonImmutable}>
     */
    private function seedUpdates(array $vehicles): array
    {
        if ($vehicles === []) {
            return [];
        }

        $rows = [];
        $updates = [];
        $latest = [];

        for ($u = 0; $u < $this->updates; $u++) {
            $vehicle = $vehicles[($u * 7) % count($vehicles)];
            $span = max(60, $vehicle['published']->diffInSeconds($this->now->subHour()));
            $at = $vehicle['published']->addSeconds((int) floor($span * ((($u * 7919) % 1000) + 1) / 1001));
            $id = DemoSeeder::demoUlid($at, 'perf:update:'.$u);
            $rows[] = [
                'id' => $id,
                'vehicle_id' => $vehicle['id'],
                'type' => BuildUpdateType::Note->value,
                'payload' => null,
                'note' => self::NOTES[$u % count(self::NOTES)],
                'hidden' => false,
                'open_until' => null,
                'created_at' => $this->stamp($at),
            ];
            $updates[] = ['id' => $id, 'vehicle_id' => $vehicle['id'], 'owner_id' => $vehicle['owner_id'], 'at' => $at];
            $latest[$vehicle['id']] = isset($latest[$vehicle['id']]) ? $latest[$vehicle['id']]->max($at) : $at;
        }

        $this->insertAll('build_updates', $rows, 'id');

        foreach ($latest as $vehicleId => $at) {
            DB::table('vehicles')->where('id', $vehicleId)->where('updated_at', '<', $this->stamp($at))->update(['updated_at' => $this->stamp($at)]);
        }

        return $updates;
    }

    /**
     * About $notifications rows for the measuring member, through Notifier at the moments they happened: half new_follower days (two
     * perf owners follow per day) and half followed_published groups (one per followed owner and day, newest first). The perf rows older
     * than a day are read, as the demo's are.
     *
     * @param  list<string>  $owners
     * @param  list<array{id: string, vehicle_id: string, owner_id: string, at: CarbonImmutable}>  $updates
     */
    private function seedNotifications(User $member, array $owners, array $updates): void
    {
        if ($owners === [] || $this->notifications < 1) {
            return;
        }

        $notifier = app(Notifier::class);
        $tz = config()->string('speedclub.notifications.timezone');
        $days = intdiv($this->notifications, 2);
        $users = User::query()->whereIn('id', $owners)->get()->keyBy('id');
        $follows = [];

        for ($day = 0; $day < $days; $day++) {
            foreach ([0, 1] as $k) {
                $owner = $owners[(2 * $day + $k) % count($owners)];
                $at = $this->now->subDays($day + 1)->setTime(17, 0)->addMinutes(20 * $k);
                $follows[] = ['follower_id' => $owner, 'followee_id' => $member->id, 'created_at' => $this->stamp($at)];
                $follower = $users->get($owner);

                if ($follower instanceof User) {
                    SeedClock::at($at, fn () => $notifier->newFollower($member, $follower));
                }
            }
        }

        foreach (array_chunk($follows, self::CHUNK) as $chunk) {
            DB::table('follows')->insertOrIgnore($chunk);
        }

        $followed = array_flip(array_slice($owners, 0, $this->measuringFollows));
        $groups = [];
        $wanted = $this->notifications - $days;

        usort($updates, fn (array $a, array $b): int => [$b['at'], $b['id']] <=> [$a['at'], $a['id']]);

        foreach ($updates as $update) {
            if (count($groups) >= $wanted) {
                break;
            }

            if (! isset($followed[$update['owner_id']]) || $update['at']->greaterThan($this->now)) {
                continue;
            }

            $group = $update['owner_id'].':'.$update['at']->setTimezone($tz)->toDateString();

            if (isset($groups[$group])) {
                continue;
            }

            $groups[$group] = true;
            $actor = $users->get($update['owner_id']);
            $vehicle = Vehicle::query()->find($update['vehicle_id']);
            $row = BuildUpdate::query()->find($update['id']);

            if ($actor instanceof User && $vehicle instanceof Vehicle && $row instanceof BuildUpdate) {
                SeedClock::at($update['at'], fn () => $notifier->followedPublished($member, $actor, $vehicle, $row));
            }
        }

        Notification::query()
            ->where('notifiable_id', $member->id)
            ->whereIn('actor_id', $owners)
            ->whereNull('read_at')
            ->where('created_at', '<', $this->stamp($this->now->subDay()))
            ->update(['read_at' => $this->stamp($this->now->subDay())]);
    }

    /**
     * insertOrIgnore in chunks, then a check that every row is there: from this run or, the same key, from an earlier one.
     *
     * @param  list<array<string, mixed>>  $rows
     */
    private function insertAll(string $table, array $rows, string $key): void
    {
        foreach (array_chunk($rows, self::CHUNK) as $chunk) {
            DB::table($table)->insertOrIgnore($chunk);
        }

        $stored = 0;

        foreach (array_chunk(array_column($rows, $key), self::CHUNK) as $keys) {
            $stored += DB::table($table)->whereIn($key, $keys)->count();
        }

        if ($stored !== count($rows)) {
            throw new RuntimeException("PerfScaleSeeder wrote $stored of ".count($rows)." rows of $table (a unique key collided or a reference is missing).");
        }
    }

    private function coprimeStride(int $size): int
    {
        if ($size < 3) {
            return 1;
        }

        $stride = max(1, (int) floor($size * 0.618));

        while ($this->gcd($stride, $size) !== 1) {
            $stride++;
        }

        return $stride;
    }

    private function gcd(int $a, int $b): int
    {
        return $b === 0 ? $a : $this->gcd($b, $a % $b);
    }

    private function stamp(CarbonImmutable $at): string
    {
        return $at->utc()->format('Y-m-d H:i:s');
    }
}
