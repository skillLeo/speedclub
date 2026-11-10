<?php

namespace Database\Seeders;

use App\Actions\Garage\SaveModification;
use App\Actions\Garage\UpdateVehicleSpecs;
use App\Actions\Messaging\MarkConversationRead;
use App\Actions\Messaging\OrganiseConversation;
use App\Actions\Messaging\SendMessage;
use App\Actions\Messaging\StartConversation;
use App\Actions\Social\BlockMember;
use App\Enums\BuildUpdateType;
use App\Enums\MediaCategory;
use App\Enums\MessageType;
use App\Enums\ModerationStatus;
use App\Enums\ModStatus;
use App\Enums\NotificationType;
use App\Enums\QrRevocationReason;
use App\Enums\QrStatus;
use App\Enums\SecurityNotice;
use App\Enums\UserStatus;
use App\Enums\VehicleStatus;
use App\Models\Block;
use App\Models\Brand;
use App\Models\BuildUpdate;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Follow;
use App\Models\Generation;
use App\Models\KnownDevice;
use App\Models\Make;
use App\Models\Media;
use App\Models\ModCategory;
use App\Models\Modification;
use App\Models\Notification;
use App\Models\QrCode;
use App\Models\Role;
use App\Models\Save;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleModel;
use App\Services\Auth\KnownDevices;
use App\Services\Garage\BuildUpdates;
use App\Services\Media\MediaService;
use App\Services\Messaging\ChatMedia;
use App\Services\Messaging\Conversations;
use App\Services\Notifications\Notifier;
use App\Services\Notifications\PublicationFanout;
use App\Services\Search\VehicleSearchProjector;
use App\Support\Codes;
use App\Support\Slug;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Closure;
use Database\Seeders\Concerns\SeedClock;
use Database\Seeders\Concerns\SeedsFromData;
use Faker\Factory as Faker;
use Faker\Generator;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use RuntimeException;
use Throwable;

/**
 * Deterministic demo content for local, staging and test fixtures (07_QA_AND_RELEASE §2). Never runs in production.
 *
 * Usernames, slugs and QR codes must stay the same on every machine because QA and E2E tests use them, so public ids and
 * codes are derived from each vehicle's fixed key instead of coming from Codes::generate(). Dates are absolute for the
 * same reason. So vehicle rows and QR codes are written here, and everything else goes through what members use: UpdateVehicleSpecs,
 * SaveModification (which checks every demo mod against its category schema), BuildUpdates and the search projector. Conversations go through
 * the messaging Actions (seedConversations); the report case follows with the moderation module.
 *
 * Photo rule (DemoSeederTest): a vehicle's photos show one physical car. One photo family per vehicle, each file used once,
 * generic files are details that cannot contradict the car, and installed wheels match what the photos show.
 *
 * @phpstan-type ModData array{c: string, b: string, p: string, s?: string, d?: string, lg: string, cost?: int, notes?: string, photo?: string, photo_alt?: string, f: array<string, mixed>, diff?: array{0: string, 1: string, 2: string}}
 * @phpstan-type VehicleData array{key: string, owner: string, main?: bool, make: string, model: string, generation: string, year: int, status?: string, visibility?: string, nickname?: string, description?: string, color: string, published?: string, photos: list<string>, specs: array<string, mixed>, mods: list<ModData>, notes?: list<array{date: string, text: string, hidden?: bool}>}
 * @phpstan-type MemberData array{username: string, joined: string, display_name: string, city: string, bio: string}
 */
class DemoSeeder extends Seeder
{
    use SeedsFromData;

    public const FAKER_SEED = 20260214;

    public const EMAIL_DOMAIN = 'speedclub.test';

    /** The moment the demo content was "written": every relative date counts back from here. LegalDocumentSeeder dates the legal texts to it. */
    public const NOW = '2026-10-30 12:00:00';

    /**
     * PROF-05 of lukas.sc: days since the save => vehicle key, newest first. Public builds of four other members, none of them
     * paul.roadster or nina.neu, who carry the block.
     */
    private const LUKAS_SAVES = [2 => 'porsche-964', 9 => 'bmw-g82', 17 => 'honda-fk8', 30 => 'toyota-a80'];

    /** Where the demo draft resumes: "Entwurf · Schritt 2 von 4". */
    private const DRAFT_STEP = 2;

    private Generator $faker;

    private CarbonImmutable $now;

    /** @var array<string, User> */
    private array $users = [];

    /** @var array<string, Vehicle> */
    private array $vehicles = [];

    /** @var array<string, int> */
    private array $brands = [];

    /** @var array<string, ModCategory> */
    private array $categories = [];

    /** @var list<array{mod: Modification, owner: User, file: string, alt: string|null}> */
    private array $modPhotos = [];

    /**
     * The demo's clock: locally the fixed NOW (ADR-166, before the QA clock), on staging the seed hour. Every row the demo writes, and on a
     * demo host every row of the install seeders (DatabaseSeeder), is dated from it, so a re-seed writes the same timestamps (DQ-677).
     */
    public static function clock(): CarbonImmutable
    {
        return app()->environment('staging') ? CarbonImmutable::now()->startOfHour() : CarbonImmutable::parse(self::NOW);
    }

    public static function runsAutomatically(): bool
    {
        return app()->environment('local')
            || (app()->environment('staging') && config('speedclub.demo.seed_on_staging') === true);
    }

    /**
     * The public id of a demo vehicle, the same on every machine.
     */
    public static function publicIdFor(string $key): string
    {
        return self::derivedCode('vehicle:'.$key);
    }

    public static function qrCodeFor(string $key): string
    {
        return self::derivedCode('qr:'.$key);
    }

    public function run(): void
    {
        if (app()->environment('production') || config('app.env') === 'production') {
            throw new RuntimeException('DemoSeeder refuses to run: APP_ENV is production. Demo members and fake builds must never reach production.');
        }

        $password = config('speedclub.demo.member_password');

        if (! is_string($password) || $password === '') {
            throw new RuntimeException('DemoSeeder needs DEMO_MEMBER_PASSWORD in .env to create the demo members.');
        }

        if (! class_exists(Faker::class)) {
            throw new RuntimeException('DemoSeeder needs fakerphp/faker. Install the dev dependencies on this environment.');
        }

        /** @var array{members: list<MemberData>, empty_member: MemberData, vehicles: list<VehicleData>} $data */
        $data = $this->readJson('demo.json');

        if (User::query()->where('username', $data['members'][0]['username'])->exists()) {
            $this->warn('Demo members already exist, nothing seeded. Use migrate:fresh --seed for a clean start.');

            return;
        }

        SeedClock::at(self::clock(), fn () => $this->call([CatalogSeeder::class, ModCategorySeeder::class, BrandSeeder::class]));

        $this->faker = Faker::create('de_DE');
        $this->faker->seed(self::FAKER_SEED);
        // Locally the story ends at the fixed NOW (the visual matrix depends on it, ADR-166, and HomeClock reads it there). A staging host
        // seeds at its own hour, so the recent activity below is recent there too.
        $this->now = self::clock();
        $this->brands = Brand::query()->pluck('id', 'name')->all();
        $this->categories = ModCategory::query()->with('fields')->get()->keyBy('key')->all();

        // The story is history, not news: no follower hears of it (followed_published). Whatever is not dated by its own moment below is
        // dated NOW, never the wall clock (DQ-677).
        SeedClock::at($this->now, fn () => PublicationFanout::muted(function () use ($data, $password): void {
            DB::transaction(function () use ($data, $password): void {
                $this->seedMembers($data['members'], $data['empty_member'], $password);
                $this->seedVehicles($data['vehicles']);
                // Faker draws from PHP's global generator, and the Actions above go through code that may draw from it as well.
                $this->faker->seed(self::FAKER_SEED);
                $this->seedFollowsAndSaves($data['members']);
                $this->seedQaSocialStates();
                $this->seedQrScans();
            });

            // Outside the transaction: image processing is slow and holds no lock this way.
            $this->seedPhotos($data['vehicles']);
            $this->useCoversOnProfiles($data['members']);
            $this->restoreStoryDates();
            $this->seedRecentActivity();
            // Also scores every build for Für dich (HomeRanking, at HomeClock::now()).
            app(VehicleSearchProjector::class)->rebuildAll();
            $this->seedNotifications();
            $this->seedConversations();
            // M2.6: one decided case (tobi.quattro, SAFE-01) and one open report by lukas.sc (SET-16), through the moderation Actions.
            $this->call(ModerationDemoSeeder::class, false, ['now' => $this->now]);
            // M3.3: the catalogue admin's requests, aliases, schema versions and CSV imports (ADM-14…17), fixed ids and dates.
            $this->call(CatalogDemoSeeder::class);
            $this->dateShippedDefaults();
            // M3.6 and M3.5 demo rows (ADM-28…52) need the staff roles and atoms of StaffSeeder, which DatabaseSeeder runs first; a
            // DemoSeeder run on its own (most tests) has none, so it leaves them out (code review M3.5-M3.6 MF-1).
            if (Role::query()->where('guard_name', StaffSeeder::GUARD)->where('name', 'owner')->exists()) {
                $this->call(TeamPrivacyDemoSeeder::class, false, ['now' => $this->now]);
                $this->call(BrandContentDemoSeeder::class, false, ['now' => $this->now]);
            }
        }));
    }

    /**
     * The last two weeks before NOW (M2.2 review B1), so FS-2 has something to show: Build-Updates, Aktive Mitglieder, Beliebte Mods diese
     * Woche and a ranking that is not all decay. Members add parts through SaveModification at the dates below (the clock is set for each
     * call), which writes their mods, their Verlauf entries and the change dates of their builds as a member's edit would; and a few
     * members follow each other. Deterministic and real: parts every build plausibly gets, brands of the catalogue. Leaves out the builds
     * and lists the visual baselines show (lukas.sc's R34 and his PROF-04, jann.ptrs's G82 and PROF-04), and paul.roadster/nina.neu.
     */
    private function seedRecentActivity(): void
    {
        $save = app(SaveModification::class);
        $parts = [
            // [vehicle key, [days, minutes] before NOW 19:00, category, brand, part, fields]
            ['subaru-sti', [1, 0], 'interior', 'Recaro', 'Sportster CS', ['part' => 'seats', 'brand' => 'Recaro', 'model' => 'Sportster CS']],
            ['vw-golf7-gti', [2, 20], 'brakes', 'EBC', 'Yellowstuff', ['brand' => 'EBC', 'model' => 'Yellowstuff', 'pads' => 'EBC Yellowstuff']],
            ['vw-golf7-gti', [2, 12], 'aero_body', 'Maxton Design', 'Seitenschweller', ['part' => 'side_skirts', 'brand' => 'Maxton Design', 'material' => 'abs', 'colour' => 'Glanzschwarz']],
            ['honda-fk8', [3, 0], 'interior', 'Recaro', 'Sportster CS', ['part' => 'seats', 'brand' => 'Recaro', 'model' => 'Sportster CS']],
            ['mazda-mx5', [4, 0], 'brakes', 'EBC', 'Yellowstuff', ['brand' => 'EBC', 'model' => 'Yellowstuff', 'pads' => 'EBC Yellowstuff']],
            ['mercedes-w177', [5, 0], 'aero_body', 'Maxton Design', 'Seitenschweller', ['part' => 'side_skirts', 'brand' => 'Maxton Design', 'material' => 'abs', 'colour' => 'Glanzschwarz']],
            ['audi-rs3-8y', [6, 0], 'brakes', 'EBC', 'Yellowstuff', ['brand' => 'EBC', 'model' => 'Yellowstuff', 'pads' => 'EBC Yellowstuff']],
            ['porsche-718', [9, 0], 'interior', 'Schroth', 'Profi II ASM', ['part' => 'harness', 'brand' => 'Schroth', 'model' => 'Profi II ASM']],
            ['toyota-ae86', [12, 0], 'brakes', 'Endless', 'MX72', ['brand' => 'Endless', 'model' => 'MX72', 'pads' => 'Endless MX72']],
        ];

        foreach ($parts as [$key, [$days, $minutes], $category, $brand, $part, $fields]) {
            $vehicle = $this->vehicles[$key]->refresh();
            $at = $this->now->subDays($days)->setTime(19, 0)->subMinutes($minutes);

            $outer = Carbon::getTestNow();
            Carbon::setTestNow($at);

            try {
                $save->add($vehicle, $this->categories[$category], [
                    'title' => $brand.' '.$part,
                    'brand_id' => $this->brands[$brand] ?? throw new RuntimeException("Demo brand [$brand] is not in brands.json."),
                    'part_name' => $part,
                    'status' => ModStatus::Installed,
                    'installed_on' => $at->format('Y-m'),
                    'fields' => $fields,
                ]);
            } finally {
                Carbon::setTestNow($outer);
            }
        }

        // Follows of the last week, between members whose follow lists no baseline shows; only where none exists yet.
        $follows = [['aylin.vtec', 'nico.sti', 1], ['finn.jdm', 'sara.gti', 2], ['marco.amg', 'tobi.quattro', 3], ['kenji.r34', 'aylin.vtec', 4], ['sara.gti', 'nico.sti', 5]];

        foreach ($follows as [$follower, $followee, $days]) {
            Follow::query()->insertOrIgnore([
                'follower_id' => $this->users[$follower]->id,
                'followee_id' => $this->users[$followee]->id,
                'created_at' => $this->now->subDays($days)->setTime(20, 30),
            ]);
        }
    }

    /**
     * HOME-02 of lukas.sc (M2.2), from the seeded data itself, so every row tells something true: the last two days on which members
     * followed him (grouped per day), the latest update of a member he follows, the week his most saved build was saved last (the count of that week, never who),
     * and one sign-in on a new device. Written through Notifier at the dates of the story; the security row directly, as no mail goes out
     * for it. All but the two newest rows are read. Deterministic: no Faker, and the dates follow from the follows, updates and saves.
     */
    private function seedNotifications(): void
    {
        Notification::query()->delete();
        $notifier = app(Notifier::class);
        $tz = config()->string('speedclub.notifications.timezone');
        $lukas = $this->users['lukas.sc']->refresh();
        $at = function (CarbonImmutable $moment, Closure $write): void {
            $this->at($moment, $write);
        };

        // new_follower: one row per day, his followers of the two most recent days.
        $follows = Follow::query()->where('followee_id', $lukas->id)->orderBy('created_at')->orderBy('follower_id')->get();
        $days = $follows->groupBy(fn (Follow $follow): string => CarbonImmutable::parse((string) $follow->getAttribute('created_at'))->setTimezone($tz)->toDateString());

        foreach ($days->keys()->sort()->slice(-2) as $day) {
            foreach ($days->get($day) ?? [] as $follow) {
                $follower = User::query()->find($follow->follower_id);
                $moment = CarbonImmutable::parse((string) $follow->getAttribute('created_at'));

                if ($follower instanceof User) {
                    $at($moment, fn () => $notifier->newFollower($lukas, $follower));
                }
            }
        }

        // followed_published: the newest visible update of the members he follows.
        $update = BuildUpdate::query()
            ->where('hidden', false)
            ->whereIn('vehicle_id', Vehicle::query()->whereIn('owner_id', $lukas->following()->pluck('users.id'))->where('status', VehicleStatus::Published)->where('visibility', 'public')->select('id'))
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->first();

        if ($update instanceof BuildUpdate) {
            $vehicle = $update->vehicle;
            $owner = $vehicle->owner;

            if ($owner instanceof User) {
                $at(CarbonImmutable::parse((string) $update->getAttribute('created_at')), fn () => $notifier->followedPublished($lukas, $owner, $vehicle, $update));
            }
        }

        // build_saved: the ISO week of the latest save of his most saved build, counted as the Monday digest counts it.
        $saved = Vehicle::query()->where('owner_id', $lukas->id)->withCount('saves')->orderByDesc('saves_count')->orderBy('id')->first();
        $lastSave = $saved === null ? null : Save::query()->where('vehicle_id', $saved->id)->max('created_at');

        if ($saved !== null && $lastSave !== null) {
            $week = CarbonImmutable::parse((string) $lastSave)->setTimezone($tz)->startOfWeek(CarbonImmutable::MONDAY);
            $count = Save::query()->where('vehicle_id', $saved->id)->whereBetween('created_at', [$week->utc(), $week->addWeek()->utc()])->count();
            $at($week->addWeek()->setTime(9, 0)->utc(), fn () => $notifier->buildSaved($lukas, $saved, $count, $week->isoFormat('GGGG-[W]WW')));
        }

        // security: a sign-in on a new device four days before NOW.
        $row = new Notification;
        $row->forceFill([
            'type' => NotificationType::Security,
            'notifiable_type' => 'user',
            'notifiable_id' => $lukas->id,
            'data' => ['event' => SecurityNotice::NewDevice->value, 'device_name' => 'iPhone 15 Pro'],
            'created_at' => $this->now->subDays(4)->setTime(21, 40),
        ])->save();

        // The two newest rows stay unread, for the bell's dot and the unread marks of HOME-02.
        $unread = Notification::query()->orderByDesc('created_at')->orderByDesc('id')->limit(2)->pluck('id')->all();
        Notification::query()->whereNotIn('id', $unread)->update(['read_at' => $this->now->subDays(1)]);
    }

    /**
     * MSG-01…05 (m2.4-contract §6), through the messaging Actions at fixed moments before NOW, so every row is what members would have
     * written: lukas.sc ↔ jann.ptrs (20 messages over four days, a photo when demo photos are on, a vehicle card, read on both sides),
     * kenji.r34 → lukas.sc started from the R34 (context card, one unread), a request from max.e46 (FS-7 "@max.e46 möchte dir schreiben"),
     * sara.gti muted and finn.jdm archived. lukas.sc follows max.e46, so the request is written while that follow is set aside and the follow
     * comes back with its own date; a follow after a request does not move it (DeliverMessage). Deterministic: no Faker, fixed client ids.
     */
    private function seedConversations(): void
    {
        $lukas = $this->users['lukas.sc']->refresh();
        $jann = $this->users['jann.ptrs']->refresh();
        $kenji = $this->users['kenji.r34']->refresh();
        $max = $this->users['max.e46']->refresh();
        $sara = $this->users['sara.gti']->refresh();
        $finn = $this->users['finn.jdm']->refresh();
        $day = fn (int $days, string $time): CarbonImmutable => $this->now->subDays($days)->setTimeFromTimeString($time);

        $this->chat($jann, $lukas, null, [
            [$jann, $day(4, '18:12'), 'Moin Lukas! Hab deinen R34 beim Treffen in Hockenheim gesehen. Ist das Bayside Blue original?'],
            [$lukas, $day(4, '18:40'), 'Moin! Ja, original Bayside Blue, nur einmal aufbereitet. Danke dir!'],
            [$lukas, $day(4, '18:41'), 'Dein G82 stand doch direkt am Eingang, oder?'],
            [$jann, $day(4, '19:05'), 'Genau, der grüne. Fährst du das KW V3 eigentlich mit den Serien-Domlagern?'],
            [$lukas, $day(4, '19:20'), 'Nein, mit Uniball-Domlagern. Vorne 30 mm tiefer, hinten 25.'],
            [$lukas, $day(4, '19:21'), 'Am Anfang hatte ich zu viel Druckstufe drin, das war auf der Landstraße richtig hart.'],
            [$jann, $day(3, '08:15'), 'Welche Klicks fährst du jetzt?'],
            [$lukas, $day(3, '08:47'), 'Zugstufe 8, Druckstufe 10, jeweils von hart gezählt. Für die Straße passt das gut.'],
            [$jann, $day(3, '20:10'), 'Ich überlege, auf Michelin Pilot Sport 4S zu wechseln. Hast du Erfahrungen damit?'],
            [$lukas, $day(3, '20:31'), 'Fahre die 4S in 265/35 R18. Bei Nässe deutlich besser als meine alten Reifen.'],
            [$jann, $day(2, '12:05'), ['photo' => 'generic-wheels-03.jpg', 'alt' => 'Kreuzspeichenfelge an einem klassischen BMW, schwarz-weiß']],
            [$jann, $day(2, '12:06'), 'Hab ich am Wochenende beim Klassikertreffen gesehen. Kreuzspeichen, wäre das nichts für deinen E30?'],
            [$lukas, $day(2, '12:30'), 'Sieht stark aus! Für den E30 suche ich aber eher BBS RS in 15 Zoll.'],
            [$lukas, $day(2, '12:32'), 'Apropos, kennst du eigentlich meinen S15?'],
            [$lukas, $day(2, '12:32'), ['vehicle' => 'nissan-s15']],
            [$jann, $day(2, '13:00'), 'Den kannte ich noch gar nicht. Ist das noch der SR20?'],
            [$lukas, $day(2, '13:20'), 'Ja, SR20DET mit größerem Lader. Ungefähr 320 PS, die Eintragung kommt im Frühjahr.'],
            [$jann, $day(1, '17:45'), 'Fährst du am Samstag mit zu den Touristenfahrten an den Ring?'],
            [$lukas, $day(1, '18:02'), 'Wenn das Wetter hält, auf jeden Fall. Treffpunkt wie immer auf dem Parkplatz an der Döttinger Höhe?'],
            [$jann, $day(1, '18:10'), 'Passt. Ich bin gegen neun da.'],
            [$lukas, $day(1, '18:11'), 'Top, bis Samstag!'],
        ], [[$jann, $day(1, '18:30')]]);

        $this->chat($kenji, $lukas, $this->vehicles['nissan-r34'], [
            [$kenji, $day(6, '21:10'), 'Hi Lukas, ich fahre selbst einen R34 und bin über deinen Build gestolpert. Welche Turbos fährst du?'],
            [$lukas, $day(6, '21:40'), 'Hi Kenji! Noch die originalen Keramiklader, aber mit Stahlwellen. Die Umrüstung auf Garrett ist für den Winter geplant.'],
            [$kenji, $day(5, '09:02'), 'Klingt vernünftig. Bei mir haben die originalen bei 1,1 bar aufgegeben.'],
            [$lukas, $day(5, '09:30'), 'Autsch. Wo hast du das machen lassen?'],
            [$kenji, $day(5, '11:15'), 'Bei einem RB-Spezialisten in Mönchengladbach. Ich schick dir gern den Kontakt.'],
        ], [[$kenji, $day(5, '09:40')]]);

        $this->chat($lukas, $sara, null, [
            [$lukas, $day(8, '16:00'), 'Hi Sara, wie war das GTI-Treffen am Wörthersee?'],
            [$sara, $day(8, '19:22'), 'Richtig gut! Fast 300 Golfs auf einem Platz.'],
            [$sara, $day(8, '19:23'), 'Nächstes Jahr musst du mitkommen, auch ohne Golf.'],
        ]);
        $this->at($day(7, '09:00'), fn () => app(OrganiseConversation::class)->handle($lukas, $this->side($lukas, $sara), ['mute' => $this->now->addMonth()->toIso8601String()]));

        $this->chat($finn, $lukas, null, [
            [$finn, $day(20, '10:05'), 'Hast du die originalen Endrohre vom S15 noch übrig?'],
            [$lukas, $day(20, '12:40'), 'Leider schon verkauft, sorry!'],
            [$finn, $day(20, '12:44'), 'Kein Ding, danke trotzdem.'],
        ], [[$lukas, $day(20, '13:00')]]);
        $this->at($day(19, '09:00'), fn () => app(OrganiseConversation::class)->handle($lukas, $this->side($lukas, $finn), ['archived' => true]));

        // The request: written while lukas.sc's follow of max.e46 is set aside, which then comes back unchanged.
        $follow = Follow::query()->where('follower_id', $lukas->id)->where('followee_id', $max->id)->first();
        Follow::query()->where('follower_id', $lukas->id)->where('followee_id', $max->id)->delete();
        $this->chat($max, $lukas, null, [
            [$max, $day(1, '10:24'), 'Hi Lukas, ich bin Max. Mir ist dein S15 aufgefallen. Darf ich fragen, woher du den Ladeluftkühler hast?'],
        ]);

        if ($follow instanceof Follow) {
            Follow::query()->insert(['follower_id' => $lukas->id, 'followee_id' => $max->id, 'created_at' => $follow->getAttribute('created_at')]);
        }
    }

    /**
     * One conversation: the first entry starts it (from $vehicle when given), the rest are messages, each at its moment. An entry is
     * [author, moment, text | ['photo' => file] | ['vehicle' => key]]. $reads: [member, moment], who read everything at that moment.
     *
     * @param  list<array{0: User, 1: CarbonImmutable, 2: string|array{photo?: string, alt?: string, vehicle?: string}}>  $script
     * @param  list<array{0: User, 1: CarbonImmutable}>  $reads
     */
    private function chat(User $starter, User $recipient, ?Vehicle $vehicle, array $script, array $reads = []): void
    {
        $pair = $starter->username.'-'.$recipient->username;

        // A fixed id per pair, so seeded URLs (/app/messages/{id}) are the same on every machine; StartConversation then finds the row.
        Conversation::query()->insertOrIgnore([
            'id' => self::demoUlid($script[0][1], 'conversation:'.$pair),
            'pair_key' => Conversation::pairKey($starter, $recipient),
            'created_by' => $starter->id,
            'created_at' => $script[0][1],
            'updated_at' => $script[0][1],
        ]);

        foreach ($script as $index => [$author, $at, $content]) {
            $outer = Carbon::getTestNow();
            Carbon::setTestNow($at);

            try {
                $draft = $this->draft($author, $recipient, $starter, $content, substr(hash('sha256', "$pair:$index"), 0, 32));

                if ($draft === null) {
                    continue;
                }

                if ($index === 0) {
                    app(StartConversation::class)->handle($starter, $recipient, $vehicle?->id, $draft, null);
                } else {
                    app(SendMessage::class)->handle($author, $this->side($author, $author->is($starter) ? $recipient : $starter), $draft, null);
                }
            } finally {
                Carbon::setTestNow($outer);
            }
        }

        foreach ($reads as [$reader, $at]) {
            $side = $this->side($reader, $reader->is($starter) ? $recipient : $starter);
            $last = app(Conversations::class)->visibleMessages($side)->max('messages.id');
            $outer = Carbon::getTestNow();
            Carbon::setTestNow($at);

            try {
                if (is_string($last)) {
                    app(MarkConversationRead::class)->handle($reader, $side, $last);
                }
            } finally {
                Carbon::setTestNow($outer);
            }
        }
    }

    /**
     * @param  string|array{photo?: string, alt?: string, vehicle?: string}  $content
     * @return array{type: MessageType, body: string|null, media_id: string|null, vehicle_id: string|null, client_id: string}|null null for a photo
     *                                                                                                                             the demo cannot upload
     */
    private function draft(User $author, User $recipient, User $starter, string|array $content, string $clientId): ?array
    {
        $draft = ['type' => MessageType::Text, 'body' => null, 'media_id' => null, 'vehicle_id' => null, 'client_id' => 'demo-'.$clientId];

        if (is_string($content)) {
            return [...$draft, 'body' => $content];
        }

        if (isset($content['vehicle'])) {
            return [...$draft, 'type' => MessageType::Vehicle, 'vehicle_id' => $this->vehicles[$content['vehicle']]->id];
        }

        $path = $this->photoDirectory().'/'.($content['photo'] ?? '');

        // Within the demo's photo limit, after the builds' photos.
        if (Media::query()->count() >= config()->integer('speedclub.demo.photo_limit') || ! is_file($path)) {
            return null;
        }

        $conversation = Conversation::query()->where('pair_key', Conversation::pairKey($starter, $recipient))->firstOrFail();
        // A chat photo lives on the private disk like every chat photo (M2.4 review #5).
        $service = app(MediaService::class);
        $bytes = $service->inspectPath($path);
        $media = $service->processOrQueue($service->reserve($author, $conversation, ['category' => MediaCategory::Wheels, 'alt' => $content['alt'] ?? null], strlen($bytes), ChatMedia::disk()), $bytes);
        $media->forceFill(['moderation_status' => ModerationStatus::Approved])->save();

        return [...$draft, 'type' => MessageType::Photo, 'media_id' => $media->id];
    }

    /**
     * @param  Closure(): mixed  $write
     */
    private function at(CarbonImmutable $moment, Closure $write): void
    {
        SeedClock::at($moment, $write);
    }

    /**
     * A ULID whose time part is $at and whose random part comes from $seed: the same on every machine.
     */
    public static function demoUlid(CarbonImmutable $at, string $seed): string
    {
        $alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
        $time = (int) $at->getTimestampMs();
        $id = '';

        for ($i = 0; $i < 10; $i++) {
            $id = $alphabet[$time % 32].$id;
            $time = intdiv($time, 32);
        }

        foreach (str_split(substr(hash('sha256', $seed), 0, 16)) as $hex) {
            $id .= $alphabet[hexdec($hex) * 2 % 32];
        }

        return $id;
    }

    private function side(User $member, User $other): ConversationParticipant
    {
        return ConversationParticipant::query()
            ->where('conversation_id', Conversation::query()->where('pair_key', Conversation::pairKey($member, $other))->value('id'))
            ->where('user_id', $member->id)
            ->firstOrFail();
    }

    /**
     * @param  list<MemberData>  $members
     * @param  MemberData  $empty
     */
    private function seedMembers(array $members, array $empty, string $password): void
    {
        // One hash for all: argon2id is slow on purpose, and these accounts share the password anyway.
        $hash = Hash::make($password);

        foreach ([...$members, $empty] as $member) {
            $joined = CarbonImmutable::parse($member['joined'].' 10:00:00');
            $user = new User([
                'email' => $member['username'].'@'.self::EMAIL_DOMAIN,
                'password' => $hash,
                'username' => $member['username'],
                'display_name' => $member['display_name'],
                'city' => $member['city'],
                'bio' => $member['bio'],
                'terms_version' => LegalDocumentSeeder::VERSION,
                'privacy_version' => LegalDocumentSeeder::VERSION,
                'consented_at' => $joined,
            ]);
            $user->forceFill([
                'email_verified_at' => $joined,
                'status' => UserStatus::Active,
                'last_seen_at' => $this->now->subHours($this->faker->numberBetween(1, 240)),
                'created_at' => $joined,
                'updated_at' => $joined,
            ])->save();

            $this->users[$member['username']] = $user;
            $this->rememberQaDevice($user);
        }
    }

    /**
     * The E2E harness signs in with speedclub.qa.user_agent: a device every demo member already knows, so its sign-ins from any
     * browser engine write no new-device notice and HOME-02 stays the seeded history (M2.2 test round D2).
     */
    private function rememberQaDevice(User $user): void
    {
        $agent = config('speedclub.qa.user_agent');

        if (is_string($agent) && $agent !== '') {
            KnownDevice::query()->firstOrCreate(
                ['user_id' => $user->getKey(), 'fingerprint' => KnownDevices::userAgentFingerprint($agent)],
                ['last_seen_at' => $this->now],
            );
        }
    }

    /**
     * @param  list<VehicleData>  $vehicles
     */
    private function seedVehicles(array $vehicles): void
    {
        $sorts = [];
        $mains = array_column(array_filter($vehicles, fn (array $data): bool => $data['main'] ?? false), 'key', 'owner');

        foreach ($vehicles as $data) {
            $owner = $data['owner'];
            $sorts[$owner] = ($sorts[$owner] ?? 0) + 1;
            $status = VehicleStatus::from($data['status'] ?? VehicleStatus::Published->value);
            $isListed = $status === VehicleStatus::Published && ($data['visibility'] ?? 'public') === 'public';

            // The first listed vehicle of a member is the main one, unless the data names another.
            $mains[$owner] ??= $isListed ? $data['key'] : null;

            $make = Make::query()->where('name', $data['make'])->firstOrFail();
            $model = VehicleModel::query()->where('make_id', $make->id)->where('name', $data['model'])->firstOrFail();
            $generation = Generation::query()->where('model_id', $model->id)->where('name', $data['generation'])->firstOrFail();
            $publicId = self::publicIdFor($data['key']);
            $published = isset($data['published']) ? CarbonImmutable::parse($data['published'].' 18:30:00') : null;
            $created = $this->vehicleCreatedAt($data, $this->users[$owner], $published);

            $vehicle = new Vehicle([
                'visibility' => $data['visibility'] ?? 'public',
                'sort' => $sorts[$owner],
                'nickname' => $data['nickname'] ?? null,
                'description' => $data['description'] ?? null,
                'color' => $data['color'],
                'make_id' => $make->id,
                'model_id' => $model->id,
                'generation_id' => $generation->id,
                'model_year' => $data['year'],
            ]);
            $vehicle->forceFill([
                'owner_id' => $this->users[$owner]->id,
                'public_id' => $publicId,
                'slug' => Slug::forVehicle($make->name, $model->name, $generation->name, $publicId),
                'status' => VehicleStatus::Draft,
                'wizard_step' => self::DRAFT_STEP,
                'is_main' => $mains[$owner] === $data['key'],
                'published_at' => $published,
                'created_at' => $created,
                'updated_at' => $published ?? $created,
            ])->save();

            $this->vehicles[$data['key']] = $vehicle;

            $this->seedSpecs($vehicle, $data['specs']);
            $this->seedMods($vehicle, $data['mods'], $this->users[$owner], $created);
            $this->seedNotes($vehicle, $data['notes'] ?? []);

            // Written as a draft, so that filling it in made no history of its own. The date stays that of the story.
            $vehicle->forceFill(['status' => $status, 'wizard_step' => $status === VehicleStatus::Draft ? self::DRAFT_STEP : null, 'updated_at' => $published ?? $created]);
            $vehicle->timestamps = false;
            $vehicle->save();
            $vehicle->timestamps = true;

            if ($status === VehicleStatus::Published) {
                $this->seedQrCodes($vehicle, $data['key'], $published ?? $created);
            }
        }
    }

    /**
     * Before the first entry of the build, but never before the owner's account existed: a mod installed before someone
     * joined keeps its installed_on date, only its entry in the app is younger.
     *
     * @param  VehicleData  $data
     */
    private function vehicleCreatedAt(array $data, User $owner, ?CarbonImmutable $published): CarbonImmutable
    {
        $created = ($published ?? $this->now)->subDays(14);

        foreach ($data['mods'] as $mod) {
            if (isset($mod['d'])) {
                $created = $created->min(CarbonImmutable::parse($mod['d'].'-01')->addDays(2)->setTime(19, 0));
            }
        }

        $joined = $owner->created_at;

        return $joined === null ? $created : $created->max($joined->toImmutable()->addDay());
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function seedSpecs(Vehicle $vehicle, array $data): void
    {
        /** @var array{0: int, 1: string, 2: string}|null $power */
        $power = $data['power'] ?? null;
        /** @var array{0: int, 1: string}|null $torque */
        $torque = $data['torque'] ?? null;

        app(UpdateVehicleSpecs::class)->handle($vehicle, [
            'engine_code' => $data['engine_code'] ?? null,
            'engine_text' => $data['engine_text'] ?? null,
            'displacement_cc' => $data['displacement_cc'] ?? null,
            'fuel' => $data['fuel'] ?? null,
            'aspiration' => $data['aspiration'] ?? null,
            'power_value' => $power[0] ?? null,
            'power_unit' => $power[1] ?? null,
            'power_source' => $power[2] ?? null,
            'torque_nm' => $torque[0] ?? null,
            'torque_source' => $torque[1] ?? null,
            'drivetrain' => $data['drivetrain'] ?? null,
            'gearbox' => $data['gearbox'] ?? null,
        ]);
    }

    /**
     * @param  list<ModData>  $mods
     */
    private function seedMods(Vehicle $vehicle, array $mods, User $owner, CarbonImmutable $vehicleCreated): void
    {
        $save = app(SaveModification::class);
        $updates = app(BuildUpdates::class);

        foreach ($mods as $data) {
            $status = ModStatus::from($data['s'] ?? ModStatus::Installed->value);
            $installed = isset($data['d']) ? CarbonImmutable::parse($data['d'].'-01') : null;
            $created = ($installed?->addDays(2)->setTime(19, 0) ?? $this->now->subDays(30))->max($vehicleCreated);

            $mod = $save->add($vehicle, $this->categories[$data['c']], [
                'title' => $data['b'].' '.$data['p'],
                'brand_id' => $this->brands[$data['b']] ?? throw new RuntimeException("Demo brand [{$data['b']}] is not in brands.json."),
                'part_name' => $data['p'],
                'status' => $status,
                'installed_on' => $data['d'] ?? null,
                'cost_cents' => isset($data['cost']) ? $data['cost'] * 100 : null,
                'notes' => $data['notes'] ?? null,
                'fields' => $data['f'],
            ]);

            // The demo shows the legal status whatever the flag says today; the dates are those of the story.
            $mod->forceFill(['legal_status' => $data['lg'], 'created_at' => $created, 'updated_at' => $created])->save();

            if (isset($data['photo'])) {
                $this->modPhotos[] = ['mod' => $mod, 'owner' => $owner, 'file' => $data['photo'], 'alt' => $data['photo_alt'] ?? null];
            }

            if (isset($data['diff'])) {
                [$label, $before, $after] = $data['diff'];

                $updates->backdated($mod, $status === ModStatus::Removed ? BuildUpdateType::ModRemoved : BuildUpdateType::ModAdded, $created, ['label' => $label, 'before' => $before, 'after' => $after]);
            }
        }
    }

    /**
     * @param  list<array{date: string, text: string, hidden?: bool}>  $notes
     */
    private function seedNotes(Vehicle $vehicle, array $notes): void
    {
        $updates = app(BuildUpdates::class);

        foreach ($notes as $note) {
            $updates->note($vehicle, $note['text'], CarbonImmutable::parse($note['date'].' 20:15:00'), $note['hidden'] ?? false);
        }
    }

    /**
     * The codes are derived, so a seed after the demo vehicles were deleted meets their tombstones (QrResolver). Outside
     * production a demo code may take its own tombstone back; nothing else ever reuses a code.
     */
    private function seedQrCodes(Vehicle $vehicle, string $key, CarbonImmutable $at): void
    {
        QrCode::query()->whereNull('vehicle_id')->whereIn('code', [self::qrCodeFor($key), self::derivedCode('qr-revoked:'.$key)])->delete();

        $qr = new QrCode(['vehicle_id' => $vehicle->id, 'code' => self::qrCodeFor($key)]);
        $qr->forceFill(['status' => QrStatus::Active, 'created_at' => $at, 'updated_at' => $at])->save();

        // One revoked code for the "nicht mehr gültig" state of the resolver (WEB-06).
        if ($key === 'bmw-e46') {
            $old = new QrCode(['vehicle_id' => $vehicle->id, 'code' => self::derivedCode('qr-revoked:'.$key)]);
            $old->forceFill([
                'status' => QrStatus::Revoked,
                'revoked_at' => $at,
                'revoked_reason' => QrRevocationReason::Reissued,
                'created_at' => $at->subDays(60),
                'updated_at' => $at,
            ])->save();
        }
    }

    /**
     * @param  list<MemberData>  $members
     */
    private function seedFollowsAndSaves(array $members): void
    {
        $usernames = array_column($members, 'username');
        $public = array_filter($this->vehicles, fn (Vehicle $vehicle): bool => $vehicle->status === VehicleStatus::Published && $vehicle->visibility->value === 'public');

        foreach ($usernames as $username) {
            $user = $this->users[$username];
            $others = array_values(array_diff($usernames, [$username]));

            foreach ($this->faker->randomElements($others, $this->faker->numberBetween(3, 7)) as $followee) {
                $user->following()->attach($this->users[$followee]->id, ['created_at' => $this->pastDate()]);
            }

            $saveable = array_values(array_filter($public, fn (Vehicle $vehicle): bool => $vehicle->owner_id !== $user->id));

            foreach ($this->faker->randomElements($saveable, $this->faker->numberBetween(1, 5)) as $vehicle) {
                $user->savedVehicles()->attach($vehicle->id, ['created_at' => $this->pastDate()]);
            }
        }
    }

    /**
     * M2.1 states for QA: PROF-05 of lukas.sc shows exactly four saved builds of other members, and SET-08 of paul.roadster one
     * blocked account, nina.neu (the empty member). The block goes through BlockMember, as a member's would, so it ends any follow
     * between the two. Runs after the random follows and saves without drawing from Faker, so those stay as they were.
     */
    private function seedQaSocialStates(): void
    {
        $lukas = $this->users['lukas.sc'];
        $lukas->savedVehicles()->detach();

        foreach (self::LUKAS_SAVES as $days => $key) {
            $lukas->savedVehicles()->attach($this->vehicles[$key]->id, ['created_at' => $this->now->subDays($days)]);
        }

        $blocker = $this->users['paul.roadster'];
        $blocked = $this->users['nina.neu'];
        app(BlockMember::class)->handle($blocker, $blocked);
        Block::query()->where('blocker_id', $blocker->id)->where('blocked_id', $blocked->id)->update(['created_at' => $this->now->subDays(6)]);
    }

    private function seedQrScans(): void
    {
        $rows = [];

        foreach (QrCode::query()->where('status', QrStatus::Active)->orderBy('code')->limit(8)->get() as $qr) {
            for ($daysAgo = 13; $daysAgo >= 0; $daysAgo--) {
                $rows[] = [
                    'qr_code_id' => $qr->id,
                    'day' => $this->now->subDays($daysAgo)->toDateString(),
                    'count' => $this->faker->numberBetween(0, 9),
                ];
            }
        }

        DB::table('qr_scan_daily')->insert($rows);
    }

    /**
     * Photos go through the real media pipeline. A missing manifest or file costs that photo and a warning, nothing more.
     * Gallery photos come first because a vehicle's first one becomes its cover; mod photos never do.
     *
     * @param  list<VehicleData>  $vehicles
     */
    private function seedPhotos(array $vehicles): void
    {
        $limit = config()->integer('speedclub.demo.photo_limit', 0);

        if ($limit <= 0) {
            return;
        }

        $directory = $this->photoDirectory();
        $manifest = $this->readManifest($directory.'/manifest.json');

        if ($manifest === null) {
            $this->warn('design/seed-photos/manifest.json is missing or unreadable: demo vehicles have no photos.');

            return;
        }

        $this->removeOrphanedMediaFiles();

        $service = app(MediaService::class);
        $started = microtime(true);
        $stored = 0;

        $queue = [];

        foreach ($vehicles as $data) {
            foreach ($data['photos'] as $sort => $file) {
                $queue[] = ['file' => $file, 'owner' => $this->users[$data['owner']], 'mediable' => $this->vehicles[$data['key']], 'sort' => $sort + 1, 'alt' => null];
            }
        }

        foreach ($this->modPhotos as $photo) {
            $queue[] = ['file' => $photo['file'], 'owner' => $photo['owner'], 'mediable' => $photo['mod'], 'sort' => 1, 'alt' => $photo['alt']];
        }

        foreach ($queue as $photo) {
            if ($stored >= $limit) {
                $this->warn("Demo photo limit of $limit reached, the rest of the photos were skipped.");

                break;
            }

            if ($this->storePhoto($service, $directory, $manifest[$photo['file']] ?? null, $photo['file'], $photo['owner'], $photo['mediable'], $photo['sort'], $photo['alt'])) {
                $stored++;
            }
        }

        $this->say(sprintf('Demo photos: %d processed in %.1f s.', $stored, microtime(true) - $started));
    }

    /**
     * @param  array<string, mixed>|null  $entry
     */
    private function storePhoto(MediaService $service, string $directory, ?array $entry, string $file, User $owner, Model $mediable, int $sort, ?string $alt): bool
    {
        $path = $directory.'/'.$file;

        if ($entry === null || ! is_file($path)) {
            $this->warn("Demo photo [$file] is missing, skipped.");

            return false;
        }

        /** @var array{x?: float, y?: float} $focal */
        $focal = is_array($entry['focal'] ?? null) ? $entry['focal'] : [];

        // A photo dates from its vehicle or mod (DQ-677: ADM-12 printed the seed time).
        $taken = $mediable->getAttribute('created_at');

        try {
            $media = SeedClock::at($taken instanceof CarbonInterface ? $taken : $this->now, fn (): Media => $service->storeFromPath($path, $owner, $mediable, [
                'alt' => $alt ?? (is_string($entry['alt_de'] ?? null) ? $entry['alt_de'] : null),
                'focal_x' => $focal['x'] ?? null,
                'focal_y' => $focal['y'] ?? null,
                'category' => MediaCategory::tryFrom(is_string($entry['category'] ?? null) ? $entry['category'] : '') ?? MediaCategory::Other,
                'sort' => $sort,
            ]));
            SeedClock::at($taken instanceof CarbonInterface ? $taken : $this->now, fn () => $media->forceFill(['moderation_status' => ModerationStatus::Approved])->save());

            return true;
        } catch (Throwable $exception) {
            $this->warn("Demo photo [$file] failed: {$exception->getMessage()}");

            return false;
        }
    }

    /**
     * After migrate:fresh the media table is empty but earlier files are still on disk, each under a new ULID. Without a
     * single row pointing at them they are unreachable, so a repeated seed would only pile them up.
     */
    private function removeOrphanedMediaFiles(): void
    {
        if (Media::withTrashed()->exists()) {
            return;
        }

        // Every database on this host shares one media folder. A seed of any other database (a scratch copy, a lane) must never clear
        // it, or the dev server loses its photos (2026-11-09 18:11). Only the configured demo database may (DEMO_CLEAR_MEDIA_DATABASE).
        if (DB::connection()->getDatabaseName() !== config()->string('speedclub.demo.clear_media_database')) {
            return;
        }

        foreach (['speedclub.media.disk', 'speedclub.media.private_disk'] as $disk) {
            $storage = Storage::disk(config()->string($disk));
            // Tests share the filesystem with the dev server: a test database has no media rows, so without a faked disk this would
            // empty the dev server's real media (it did, 2026-11-09 17:23). In testing only a Storage::fake() root may be cleared.
            if (app()->environment('testing') && ! str_contains(str_replace('\\', '/', $storage->path('')), '/framework/testing/disks/')) {
                continue;
            }
            $storage->deleteDirectory('media');
        }
    }

    /**
     * @return array<string, array<string, mixed>>|null by file name
     */
    private function readManifest(string $path): ?array
    {
        $contents = is_file($path) ? file_get_contents($path) : false;
        $entries = $contents === false ? null : json_decode($contents, true);

        if (! is_array($entries)) {
            return null;
        }

        $manifest = [];

        foreach ($entries as $entry) {
            if (is_array($entry) && is_string($entry['file'] ?? null)) {
                $manifest[$entry['file']] = $entry;
            }
        }

        return $manifest;
    }

    /**
     * DQ-687: the migration that ships the statement-of-reasons templates and support macros (ADM-24, ADM-27) stamps them with the clock
     * of `migrate`, so their "Geändert" would move with every re-seed. On a demo host they are dated by the demo clock like every other
     * row, as long as nobody of the team has edited them. Production never runs this seeder and keeps the install time.
     */
    private function dateShippedDefaults(): void
    {
        foreach (['sor_templates', 'support_macros'] as $table) {
            DB::table($table)->whereNull('updated_by')->update(['created_at' => $this->now, 'updated_at' => $this->now]);
        }
    }

    /**
     * Specs, mods and photos count as changes of the vehicle, for a member's edit. Here they are the story, and its dates stay.
     */
    private function restoreStoryDates(): void
    {
        foreach ($this->vehicles as $vehicle) {
            Vehicle::query()->whereKey($vehicle->id)->toBase()->update(['updated_at' => $vehicle->getAttribute('updated_at')]);
        }
    }

    /**
     * Half the members use the photo of their main vehicle as profile cover, the rest show the plain header and initials.
     *
     * @param  list<MemberData>  $members
     */
    private function useCoversOnProfiles(array $members): void
    {
        foreach ($members as $index => $member) {
            if ($index % 2 !== 0) {
                continue;
            }

            $user = $this->users[$member['username']];
            $cover = Vehicle::query()->where('owner_id', $user->id)->where('is_main', true)->value('cover_media_id');

            if ($cover !== null) {
                $user->forceFill(['cover_media_id' => $cover])->save();
            }
        }
    }

    protected function photoDirectory(): string
    {
        return base_path('../design/seed-photos');
    }

    private function pastDate(): CarbonImmutable
    {
        return $this->now->subDays($this->faker->numberBetween(1, 90));
    }

    private static function derivedCode(string $seed): string
    {
        $bytes = hash('sha256', 'speedclub-demo:'.$seed, true);
        $code = '';

        for ($i = 0; $i < Codes::LENGTH; $i++) {
            $code .= Codes::ALPHABET[ord($bytes[$i]) % strlen(Codes::ALPHABET)];
        }

        return $code;
    }
}
