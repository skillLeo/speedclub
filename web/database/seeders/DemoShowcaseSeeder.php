<?php

namespace Database\Seeders;

use App\Actions\Admin\Config\PublishConfigVersion;
use App\Actions\Admin\Config\SaveConfigDraft;
use App\Actions\Admin\Members\RequestMemberDeletion;
use App\Actions\Admin\Members\RequestMemberExport;
use App\Actions\Admin\Support\AddTicketNote;
use App\Actions\Admin\Support\ReplyToTicket;
use App\Actions\Garage\PublishVehicle;
use App\Actions\Garage\SaveModification;
use App\Actions\Garage\UpdateVehicleSpecs;
use App\Actions\Messaging\MarkConversationRead;
use App\Actions\Messaging\ReactToMessage;
use App\Actions\Messaging\SendMessage;
use App\Actions\Messaging\StartConversation;
use App\Actions\Moderation\DecideCase;
use App\Actions\Moderation\SubmitReport;
use App\Actions\Support\AddMemberReply;
use App\Actions\Support\CreateSupportTicket;
use App\Enums\BuildUpdateType;
use App\Enums\CatalogRequestStatus;
use App\Enums\ConfigKey;
use App\Enums\DecisionAction;
use App\Enums\GroundDocument;
use App\Enums\MediaCategory;
use App\Enums\MessageReaction;
use App\Enums\MessageType;
use App\Enums\ModerationStatus;
use App\Enums\ModStatus;
use App\Enums\QrStatus;
use App\Enums\ReportReason;
use App\Enums\ReportSource;
use App\Enums\ReportTargetType;
use App\Enums\SecurityNotice;
use App\Enums\StaffSecurityEvent;
use App\Enums\StaffStatus;
use App\Enums\SupportCategory;
use App\Enums\SupportTicketStatus;
use App\Enums\UserStatus;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Models\Brand;
use App\Models\BuildUpdate;
use App\Models\CatalogRequest;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Decision;
use App\Models\Follow;
use App\Models\Generation;
use App\Models\KnownDevice;
use App\Models\Make;
use App\Models\Media;
use App\Models\Message;
use App\Models\ModCategory;
use App\Models\ModerationCase;
use App\Models\Modification;
use App\Models\Notification;
use App\Models\QrCode;
use App\Models\Report;
use App\Models\Role;
use App\Models\Save;
use App\Models\Staff;
use App\Models\SupportTicket;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleModel;
use App\Services\Audit\Audit;
use App\Services\Auth\KnownDevices;
use App\Services\Config\ConfigVersions;
use App\Services\Garage\BuildUpdates;
use App\Services\Garage\ModFields;
use App\Services\Media\MediaService;
use App\Services\Messaging\ChatMedia;
use App\Services\Messaging\Conversations;
use App\Services\Moderation\DecisionInput;
use App\Services\Moderation\ReportDraft;
use App\Services\Moderation\ReportTargets;
use App\Services\Notifications\Notifier;
use App\Services\Notifications\PublicationFanout;
use App\Services\Notifications\QrMilestones;
use App\Services\Qr\QrCodes;
use App\Services\Search\VehicleSearchProjector;
use App\Services\Showcase\Showcase;
use App\Services\Showcase\ShowcaseBusinesses;
use App\Services\Showcase\ShowcaseEvents;
use App\Services\Showcase\ShowcaseMaintenance;
use App\Services\Showcase\ShowcasePhotos;
use App\Services\Showcase\ShowcasePurge;
use App\Support\Codes;
use App\Support\Slug;
use App\Support\Username;
use Carbon\CarbonImmutable;
use Database\Seeders\Concerns\SeedClock;
use Database\Seeders\Concerns\SeedsFromData;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Laravel\Fortify\Fortify;
use Laravel\Fortify\RecoveryCode;
use RuntimeException;
use Throwable;

/**
 * The staging showcase for a client review: `php artisan db:seed --class=DemoShowcaseSeeder` (local and staging only). 41 sample
 * members around sebastian.demo, up to 100 builds with real factory figures, parts of real brands, photos through the media pipeline,
 * QR stickers with 30 days of scans, follows, saves, chats, notifications of every type, and a moderation, support and approval queue
 * for the admin. Everything is read from database/data/showcase/*.json (no Faker: staging has no dev dependencies) and the seed
 * photos' manifest; `speedclub:demo --purge` removes it again (ShowcasePurge).
 *
 * The SPEED CLUB Editorial account (09 §8.19, ADR-412: is_sample and is_editorial) owns the editorial sample builds of
 * database/data/showcase/editorial.json: each names one shoot of the manifest (`car`) that shows exactly its make, model and generation
 * and that no showcase or classic demo build uses, with the manufacturer's figures and their source. Editorial builds take part in
 * nothing social (no follows, saves, chats, QR scans, curation or notifications), so no count on them is invented. Every sample photo is
 * imported from its graded rendition (design/scripts/process-photos.mjs, 09 §4.6) when one exists, with the manifest's ThumbHash.
 *
 * Idempotent: rows are keyed on e-mail, username, a public id derived from the vehicle's key, part titles, message client ids and
 * the ids the Actions keep unique, so a second run updates in place and adds nothing. All dates count back from the showcase clock,
 * the hour of the first run (recovered from sebastian.demo's join date on every later run), so a re-run writes the same story; only
 * the QR scans follow the real calendar (the last 30 days). Photos remember their seed file (media.sample_source): a re-run skips
 * what it processed before and replaces only what the manifest changed.
 *
 * Members, builds and messages go through the app's own Actions (UpdateVehicleSpecs, SaveModification, PublishVehicle with its QR code,
 * StartConversation/SendMessage, SubmitReport/DecideCase, CreateSupportTicket/ReplyToTicket, the approval requests, the home_curation
 * publish) at their moment, so what the app shows is what members and staff would have produced. The classic demo (DemoSeeder) is
 * never touched: sample members only follow, save, message and report each other.
 *
 * @phpstan-type MemberData array{username: string, display_name: string, city: string|null, joined_days: int, avatar: bool, bio: string}
 * @phpstan-type ModData array{ref: string, c: string, b: string, p: string, cost: int, lg: string, s: string, f: array<string, mixed>, notes?: string}
 * @phpstan-type VehicleData array{key: string, owner: string, pick: string|null, make: string, model: string, generation: string, year: int, color: string, nickname: string|null, description: string, published_days: int, specs: array{engine_code: string|null, engine_text: string, displacement_cc: int, fuel: string, aspiration: string, power_kw: int, torque_nm: int, drivetrain: string, gearbox: string}, factory: array{zero_to_100_s: float|int|null, weight_kg: int|null}, mods: list<ModData>, car?: string, source?: string}
 * @phpstan-type EditorialData array{member: MemberData, notes: list<string>, vehicles: list<VehicleData>}
 *
 * @phpstan-import-type Photo from ShowcasePhotos
 */
class DemoShowcaseSeeder extends Seeder
{
    use SeedsFromData;

    public const MAX_VEHICLES = 100;

    /**
     * Suffix of media.sample_source for a photo imported from its graded rendition (09 §4.6). It names the grade version of
     * process-photos.mjs (SETTINGS.v), so a corrected grade re-imports the sample photos once: #graded2 = net contrast exactly +6 %.
     */
    public const GRADED = '#graded2';

    private CarbonImmutable $clock;

    /** @var array<string, User> by username */
    private array $users = [];

    /** @var array<string, MemberData> */
    private array $members = [];

    /** @var array<string, Vehicle> by data key */
    private array $vehicles = [];

    /** @var array<string, VehicleData> */
    private array $vehicleData = [];

    /** @var array<string, list<Photo>> */
    private array $photos = [];

    /** @var array<string, string> username => data key of the main build */
    private array $mains = [];

    /** @var array<string, int> */
    private array $brands = [];

    /** @var array<string, ModCategory> */
    private array $categories = [];

    private ?Staff $staff = null;

    /** @var array<string, mixed> */
    private array $conversationData = [];

    /** @var array<string, mixed> */
    private array $admin = [];

    /** @var array{notes: list<string>, tracks: list<string>} */
    private array $stories = ['notes' => [], 'tracks' => []];

    /** The SPEED CLUB Editorial account's username (database/data/showcase/editorial.json). */
    private ?string $editorial = null;

    /** @var array<string, true> data keys of the editorial builds */
    private array $editorialKeys = [];

    /** @var list<string> Verlauf notes in the editorial voice */
    private array $editorialNotes = [];

    public function run(): void
    {
        Showcase::assertEnvironment('DemoShowcaseSeeder');

        $password = config('speedclub.demo.member_password');

        if (! is_string($password) || $password === '') {
            throw new RuntimeException('DemoShowcaseSeeder needs DEMO_MEMBER_PASSWORD in .env: the sample members sign in with it.');
        }

        $started = microtime(true);
        $this->ensureCatalogue();
        $this->loadData();
        $this->clock = $this->recoverClock();

        // No mail leaves the host while the showcase writes (security notices, ticket receipts, decision mails); the caller's mailer
        // (a test's fake included) comes back afterwards.
        $mailer = Mail::getFacadeRoot();
        Mail::fake();

        try {
            PublicationFanout::muted(function () use ($password): void {
                $this->seedMembers($password);
                $this->seedStaff();
                $this->seedVehicles();
                $this->seedProfileImages();
                $this->seedFollowsAndSaves();
                $this->seedQrScans();
                $this->seedConversations();
                $this->seedModeration();
                $this->seedSupport();
                $this->seedApprovals();
                $this->seedCatalogRequests();
                $this->seedCuration();
                // M4.12 (09 §8.19): the 8 sample events of the Editorial account, dated from now.
                app(ShowcaseEvents::class)->seed(photos: $this->photoDirectory());
                // M4.14 (09 §8.19): sample mods linked to catalogue products, the sample workshop and its confirmed portfolio.
                app(ShowcaseBusinesses::class)->seed(photos: $this->photoDirectory());
                // M4.13 (09 §8.19): sample maintenance on the showcase member's and the Editorial account's main build (owner-only).
                app(ShowcaseMaintenance::class)->seed();
                app(VehicleSearchProjector::class)->rebuildAll();
                $this->seedNotifications();
                $this->restoreStoryDates();
                $this->recordSeeded();
            });
        } finally {
            Mail::swap($mailer);
        }

        $this->say(sprintf('Showcase ready in %.0f s: %s', microtime(true) - $started, json_encode(app(ShowcasePurge::class)->counts(), JSON_UNESCAPED_UNICODE)));
    }

    /**
     * The seed photos: design/seed-photos (manifest.json and its files). A test points this at its own folder.
     */
    protected function photoDirectory(): string
    {
        return base_path('../design/seed-photos');
    }

    // ---------------------------------------------------------------------------------------------------------------------------
    // Setup

    private function ensureCatalogue(): void
    {
        $missing = array_keys(array_filter([
            CatalogSeeder::class => ! CatalogSeeder::catalogueHasRows(),
            ModCategorySeeder::class => ! ModCategory::query()->exists(),
            BrandSeeder::class => ! Brand::query()->exists(),
            StaffSeeder::class => ! Role::query()->where('guard_name', StaffSeeder::GUARD)->where('name', 'admin')->exists(),
        ]));

        if ($missing !== []) {
            $this->call($missing);
        }

        $this->brands = Brand::query()->pluck('id', 'name')->all();
        $this->categories = ModCategory::query()->with('fields')->get()->keyBy('key')->all();
    }

    private function loadData(): void
    {
        /** @var list<MemberData> $members */
        $members = $this->readJson('showcase/members.json');

        foreach ($members as $member) {
            $violations = Username::violations($member['username']);

            if ($violations !== []) {
                throw new RuntimeException("Showcase username [{$member['username']}] is not valid: ".implode(', ', $violations));
            }

            $this->members[$member['username']] = $member;
        }

        /** @var list<VehicleData> $vehicles */
        $vehicles = $this->readJson('showcase/vehicles.json');
        $candidates = [];

        foreach ($vehicles as $vehicle) {
            $this->vehicleData[$vehicle['key']] = $vehicle;
            $candidates[] = ['key' => $vehicle['key'], 'make' => $vehicle['make'], 'model' => $vehicle['model'], 'generation' => $vehicle['generation'], 'pick' => $vehicle['pick']];
        }

        $this->conversationData = $this->readJson('showcase/conversations.json');
        $this->admin = $this->readJson('showcase/admin.json');
        /** @var array{notes: list<string>, tracks: list<string>} $stories */
        $stories = $this->readJson('showcase/stories.json');
        $this->stories = $stories;

        $directory = $this->photoDirectory();
        $manifestPath = $directory.'/manifest.json';
        $manifest = is_file($manifestPath) ? json_decode((string) file_get_contents($manifestPath), true) : null;

        if (! is_array($manifest)) {
            throw new RuntimeException("The seed photo manifest [$manifestPath] is missing or unreadable: showcase builds need their photos.");
        }

        /** @var array<string, array{make: string, model: string, generation: string}> $legacy */
        $legacy = $this->readJson('showcase/photo-map.json');
        // DQ-1132: an event or business cover may be a car photo; it stays that item's own photo and never goes on a build too.
        $covers = $this->coverFiles();
        $manifest = array_filter($manifest, fn (mixed $entry): bool => ! is_array($entry) || ! is_string($entry['file'] ?? null) || ! isset($covers[$entry['file']]));
        $photos = new ShowcasePhotos($directory, array_values($manifest), $legacy, $this->demoPhotoFiles());
        $this->photos = $photos->allocate($candidates, self::MAX_VEHICLES);

        $left = array_values(array_filter($candidates, fn (array $candidate): bool => $candidate['pick'] === null && ! isset($this->photos[$candidate['key']])));

        if ($left !== []) {
            $this->warn(sprintf('%d showcase builds have no photos of their own model left in the manifest (a shoot of one car, or %d loose files) and are left out: %s', count($left), ShowcasePhotos::MIN, implode(', ', array_column($left, 'key'))));
        }

        $this->loadEditorial($photos);

        foreach (array_keys($this->photos) as $key) {
            $owner = $this->vehicleData[$key]['owner'];
            $this->mains[$owner] ??= $key;
        }
    }

    /**
     * The Editorial account and its builds: each build gets exactly the shoot it names, when that shoot matches its make, model and
     * generation and no other build (showcase, classic demo, an earlier editorial build) has one of its photos; otherwise it is left out.
     */
    private function loadEditorial(ShowcasePhotos $photos): void
    {
        /** @var EditorialData $data */
        $data = $this->readJson('showcase/editorial.json');
        $member = $data['member'];
        $violations = Username::violations($member['username']);

        if ($violations !== [] || isset($this->members[$member['username']])) {
            throw new RuntimeException("Editorial username [{$member['username']}] is not valid or taken: ".implode(', ', $violations));
        }

        $this->editorial = $member['username'];
        $this->members[$member['username']] = $member;
        $this->editorialNotes = $data['notes'];
        $taken = array_fill_keys($this->demoPhotoFiles(), true);

        foreach ($this->photos as $list) {
            foreach ($list as $photo) {
                $taken[$photo['file']] = true;
            }
        }

        $left = [];

        foreach ($data['vehicles'] as $vehicle) {
            $vehicle['owner'] = $member['username'];
            $vehicle['pick'] = null;
            $candidate = ['key' => $vehicle['key'], 'make' => $vehicle['make'], 'model' => $vehicle['model'], 'generation' => $vehicle['generation'], 'pick' => null];
            $shoot = isset($vehicle['car']) && ! isset($this->vehicleData[$vehicle['key']]) ? $photos->shoot($candidate, $vehicle['car'], $taken) : null;

            if ($shoot === null) {
                $left[] = $vehicle['key'];

                continue;
            }

            foreach ($shoot as $photo) {
                $taken[$photo['file']] = true;
            }

            $this->vehicleData[$vehicle['key']] = $vehicle;
            $this->photos[$vehicle['key']] = $shoot;
            $this->editorialKeys[$vehicle['key']] = true;
        }

        if ($left !== []) {
            $this->warn(sprintf('%d editorial builds are left out: their shoot is missing, shows another model or is already on a build: %s', count($left), implode(', ', $left)));
        }
    }

    private function isEditorial(string $username): bool
    {
        return $username === $this->editorial;
    }

    /**
     * The cover files of the sample events, the demo meets (showcase/events.json) and the sample businesses (showcase/businesses.json).
     *
     * @return array<string, true> file => true
     */
    private function coverFiles(): array
    {
        $events = $this->readJson('showcase/events.json');
        $businesses = $this->readJson('showcase/businesses.json');
        $rows = [
            ...(is_array($events['events'] ?? null) ? $events['events'] : []),
            ...(is_array($events['member_events'] ?? null) ? $events['member_events'] : []),
            ...(is_array($businesses['businesses'] ?? null) ? $businesses['businesses'] : []),
        ];
        $files = [];

        foreach ($rows as $row) {
            if (is_array($row) && is_string($row['cover'] ?? null)) {
                $files[$row['cover']] = true;
            }
        }

        return $files;
    }

    /**
     * @return list<string>
     */
    private function demoPhotoFiles(): array
    {
        $path = database_path('data/demo.json');
        $demo = is_file($path) ? json_decode((string) file_get_contents($path), true) : null;
        $files = [];

        foreach (is_array($demo) && is_array($demo['vehicles'] ?? null) ? $demo['vehicles'] : [] as $vehicle) {
            foreach (is_array($vehicle) && is_array($vehicle['photos'] ?? null) ? $vehicle['photos'] : [] as $file) {
                if (is_string($file)) {
                    $files[] = $file;
                }
            }
        }

        return $files;
    }

    /**
     * The hour of the first run. sebastian.demo joined joined_days before it, so a later run finds the same clock in his row.
     */
    private function recoverClock(): CarbonImmutable
    {
        $joined = User::withTrashed()->where('email', Showcase::showcaseEmail())->where('is_sample', true)->value('created_at');
        $days = $this->members[Showcase::SHOWCASE_USERNAME]['joined_days'] ?? null;

        if ($joined !== null && is_int($days)) {
            return CarbonImmutable::parse((string) $joined)->addDays($days)->setTime(12, 0);
        }

        return CarbonImmutable::now()->setTime(12, 0);
    }

    // ---------------------------------------------------------------------------------------------------------------------------
    // Members and staff

    private function seedMembers(string $password): void
    {
        $hash = Hash::make($password);
        $agent = config('speedclub.qa.user_agent');

        foreach ($this->members as $username => $data) {
            $email = $username.'@'.Showcase::EMAIL_DOMAIN;
            $user = User::withTrashed()->where('email', $email)->first();

            if ($user !== null && $user->getAttribute('is_sample') !== true) {
                throw new RuntimeException("[$email] exists and is not a sample account: the showcase never takes over a real one.");
            }

            if (User::withTrashed()->where('username', $username)->where('email', '!=', $email)->exists()) {
                throw new RuntimeException("The username [$username] belongs to another account: rename it in database/data/showcase/members.json.");
            }

            $joined = $this->clock->subDays($data['joined_days'])->setTime(self::pick("joined:$username", 9, 21), self::pick("joined-min:$username", 0, 59));
            $user ??= new User;
            $user->fill([
                'email' => $email,
                'username' => $username,
                'display_name' => $data['display_name'],
                'city' => $data['city'],
                'bio' => $data['bio'],
                'terms_version' => LegalDocumentSeeder::VERSION,
                'privacy_version' => LegalDocumentSeeder::VERSION,
                'consented_at' => $joined,
            ]);
            // A re-run keeps a hash that still matches: a new one would sign the member out everywhere (AuthenticateSession).
            $user->forceFill([
                'password' => $user->exists && is_string($user->password) && Hash::check($password, $user->password) ? $user->password : $hash,
                'email_verified_at' => $joined,
                'profile_setup_at' => $joined,
                'status' => UserStatus::Active,
                'is_sample' => true,
                'is_editorial' => $this->isEditorial($username),
                'deleted_at' => null,
                'last_seen_at' => $this->clock->subHours(self::pick("seen:$username", 1, 200)),
                'created_at' => $joined,
                'updated_at' => $joined,
            ]);
            $user->timestamps = false;
            $user->save();
            $user->timestamps = true;

            if (is_string($agent) && $agent !== '') {
                KnownDevice::query()->firstOrCreate(['user_id' => $user->id, 'fingerprint' => KnownDevices::userAgentFingerprint($agent)], ['last_seen_at' => $this->clock]);
            }

            $this->users[$username] = $user;
        }
    }

    /**
     * admin.demo@speedclub.test (role admin) for the crawl, with DEMO_STAFF_PASSWORD and, when DEMO_STAFF_TOTP_SECRET is set, TOTP
     * already enrolled with that key. Without a staff password the admin side of the showcase is left out.
     */
    private function seedStaff(): void
    {
        $password = config('speedclub.demo.staff_password');

        if (! is_string($password) || $password === '') {
            $this->warn('DEMO_STAFF_PASSWORD is empty: no showcase staff account, and no reports decided, tickets answered, approvals or curation.');

            return;
        }

        $staff = Staff::query()->where('email', Showcase::STAFF_EMAIL)->first();

        if ($staff !== null && $staff->getAttribute('is_sample') !== true) {
            throw new RuntimeException('['.Showcase::STAFF_EMAIL.'] exists and is not the showcase account: the showcase never takes over a real one.');
        }

        if ($staff === null) {
            $staff = new Staff(['name' => 'Demo Admin (Showcase)', 'email' => Showcase::STAFF_EMAIL, 'password' => $password, 'status' => StaffStatus::Active]);
            $staff->forceFill(['is_sample' => true, 'password_proof_required' => false]);
            SeedClock::at($this->clock->subDays(30), fn () => $staff->save());
        } else {
            // Only a changed password is set again, so a re-run does not end the showcase staff's sessions.
            $staff->forceFill([
                ...(Hash::check($password, $staff->password) ? [] : ['password' => $password]),
                'status' => StaffStatus::Active,
                'password_proof_required' => false,
            ])->save();
        }

        $staff->syncRoles(['admin']);
        $this->staff = $staff->refresh();
        $this->enrolTotp($this->staff);
    }

    private function enrolTotp(Staff $staff): void
    {
        $secret = config('speedclub.demo.staff_totp_secret');

        if (! is_string($secret) || trim($secret) === '') {
            $this->warn('DEMO_STAFF_TOTP_SECRET is empty: '.Showcase::STAFF_EMAIL.' has no TOTP and enrols at its first sign-in.');

            return;
        }

        $secret = strtoupper(str_replace(' ', '', trim($secret)));

        if (preg_match('/\A[A-Z2-7]{16,}\z/', $secret) !== 1) {
            throw new RuntimeException('DEMO_STAFF_TOTP_SECRET must be a base32 key (A-Z, 2-7, at least 16 characters).');
        }

        $current = $staff->getRawOriginal('two_factor_secret');

        try {
            $same = is_string($current) && Fortify::currentEncrypter()->decrypt($current) === $secret && $staff->getAttribute('two_factor_confirmed_at') !== null;
        } catch (Throwable) {
            $same = false;
        }

        if ($same) {
            return;
        }

        $codes = array_map(fn (): string => RecoveryCode::generate(), range(1, 8));
        $staff->forceFill([
            'two_factor_secret' => Fortify::currentEncrypter()->encrypt($secret),
            'two_factor_recovery_codes' => Fortify::currentEncrypter()->encrypt((string) json_encode($codes)),
            'two_factor_confirmed_at' => now(),
        ])->save();

        Audit::record(StaffSecurityEvent::TwoFactorEnabled->value, $staff, after: ['via' => 'showcase_seed'], reason: Showcase::REASON);
    }

    // ---------------------------------------------------------------------------------------------------------------------------
    // Vehicles

    private function seedVehicles(): void
    {
        $keep = [];

        foreach (array_keys($this->photos) as $key) {
            $keep[] = self::publicIdFor($key);
        }

        // Builds of an earlier run the data or the manifest no longer gives photos to.
        $stale = Vehicle::withTrashed()->where('is_sample', true)->whereNotIn('public_id', $keep)->get();

        foreach ($stale as $vehicle) {
            app(ShowcasePurge::class)->removeVehicle($vehicle);
        }

        foreach ($this->photos as $key => $photos) {
            $this->seedVehicle($this->vehicleData[$key], $photos);
        }

        // A member's main build is the first one seeded (PublishVehicle made it main).
        $this->mains = [];

        foreach (array_keys($this->vehicles) as $key) {
            $this->mains[$this->vehicleData[$key]['owner']] ??= $key;
        }
    }

    /**
     * @param  VehicleData  $data
     * @param  list<Photo>  $photos
     */
    private function seedVehicle(array $data, array $photos): void
    {
        $owner = $this->users[$data['owner']];
        $publicId = self::publicIdFor($data['key']);
        $vehicle = Vehicle::withTrashed()->where('public_id', $publicId)->first();

        if ($vehicle !== null && $vehicle->getAttribute('is_sample') !== true) {
            throw new RuntimeException("Vehicle [$publicId] exists and is not a sample build.");
        }

        $make = Make::query()->where('name', $data['make'])->first();
        $model = $make === null ? null : VehicleModel::query()->where('make_id', $make->id)->where('name', $data['model'])->first();
        $generation = $model === null ? null : Generation::query()->where('model_id', $model->id)->where('name', $data['generation'])->first();

        if ($make === null || $model === null || $generation === null) {
            $this->warn("Showcase build [{$data['key']}] left out: {$data['make']} {$data['model']} {$data['generation']} is not in the catalogue.");
            unset($this->photos[$data['key']]);

            return;
        }
        [$created, $published] = $this->vehicleDates($data, $owner);

        $attributes = [
            'visibility' => Visibility::Public,
            'nickname' => $data['nickname'],
            'description' => $this->description($data),
            'color' => self::colour($photos[0]['color'] ?? null, $data['color']),
            'make_id' => $make->id,
            'model_id' => $model->id,
            'generation_id' => $generation->id,
            'model_year' => $data['year'],
        ];

        if ($vehicle === null) {
            $vehicle = new Vehicle($attributes);
            $vehicle->forceFill([
                'owner_id' => $owner->id,
                'public_id' => $publicId,
                'slug' => Slug::forVehicle($make->name, $model->name, $generation->name, $publicId),
                'status' => VehicleStatus::Draft,
                'wizard_step' => 2,
                'is_main' => false,
                'is_sample' => true,
                'sort' => Vehicle::withTrashed()->where('owner_id', $owner->id)->count() + 1,
                'published_at' => $published,
                'created_at' => $created,
                'updated_at' => $created,
            ]);
            $vehicle->timestamps = false;
            $vehicle->save();
            $vehicle->timestamps = true;
        } else {
            $vehicle->fill($attributes)->forceFill(['deleted_at' => null, 'owner_id' => $owner->id])->save();
        }

        $this->vehicles[$data['key']] = $vehicle;

        SeedClock::at($created, fn () => app(UpdateVehicleSpecs::class)->handle($vehicle, [
            'engine_code' => $data['specs']['engine_code'],
            'engine_text' => $data['specs']['engine_text'],
            'displacement_cc' => $data['specs']['displacement_cc'],
            'fuel' => $data['specs']['fuel'],
            'aspiration' => $data['specs']['aspiration'],
            'power_value' => $data['specs']['power_kw'],
            'power_unit' => 'kw',
            'power_source' => 'factory',
            'torque_nm' => $data['specs']['torque_nm'],
            'torque_source' => 'factory',
            'drivetrain' => $data['specs']['drivetrain'],
            'gearbox' => $data['specs']['gearbox'],
        ]));

        $mods = $this->seedMods($vehicle, $data, $created, $published);
        $this->seedVehiclePhotos($vehicle, $owner, $photos, $created);

        $vehicle->refresh();

        if ($vehicle->isDraft()) {
            SeedClock::at($published, fn () => app(PublishVehicle::class)->handle($owner, $vehicle, Visibility::Public));
        } else {
            app(QrCodes::class)->ensureActive($vehicle);
        }

        $this->seedBuildUpdates($vehicle->refresh(), $data, $mods, $published);
    }

    /**
     * Joined → created (1-4 weeks before publishing) → published, never before the owner joined.
     *
     * @param  VehicleData  $data
     * @return array{0: CarbonImmutable, 1: CarbonImmutable}
     */
    private function vehicleDates(array $data, User $owner): array
    {
        $joined = CarbonImmutable::parse((string) $owner->getAttribute('created_at'));
        $published = $this->clock->subDays($data['published_days'])->setTime(self::pick('pub-h:'.$data['key'], 17, 21), self::pick('pub-m:'.$data['key'], 0, 59))
            ->max($joined->addDays(3));
        $created = $published->subDays(self::pick('created:'.$data['key'], 7, 28))->max($joined->addDay());

        return [$created, $published->max($created->addHour())];
    }

    /**
     * The owner's text and, where the manufacturer states them, 0-100 and the DIN weight (no spec field holds these).
     *
     * @param  VehicleData  $data
     */
    private function description(array $data): string
    {
        $facts = array_filter([
            $data['factory']['zero_to_100_s'] === null ? null : '0–100 km/h in '.number_format((float) $data['factory']['zero_to_100_s'], 1, ',', '.').' s',
            $data['factory']['weight_kg'] === null ? null : 'Leergewicht '.number_format($data['factory']['weight_kg'], 0, ',', '.').' kg (DIN)',
        ]);

        return mb_substr($data['description'].($facts === [] ? '' : "\n\nWerksangaben: ".implode(' · ', $facts).'.'), 0, 500);
    }

    /**
     * Parts by title: an existing one is brought in line without a Verlauf entry, a new one goes through SaveModification at its own
     * moment, one the data no longer lists goes. The first ~60 % were built before the build went online, the rest after it, spread
     * up to two weeks before the clock.
     *
     * @param  VehicleData  $data
     * @return list<array{mod: Modification, at: CarbonImmutable, after: bool, installed: bool}>
     */
    private function seedMods(Vehicle $vehicle, array $data, CarbonImmutable $created, CarbonImmutable $published): array
    {
        $fields = app(ModFields::class);
        $existing = Modification::withTrashed()->where('vehicle_id', $vehicle->id)->get()->keyBy('title');
        $count = count($data['mods']);
        $before = (int) ceil($count * 0.6);
        $after = max(1, $count - $before);
        $span = max(3, (int) $published->diffInDays($this->clock->subDays(2)));
        $result = [];
        $titles = [];

        foreach ($data['mods'] as $index => $mod) {
            $category = $this->categories[$mod['c']] ?? throw new RuntimeException("Unknown mod category [{$mod['c']}].");
            $brand = $this->brands[$mod['b']] ?? throw new RuntimeException("Showcase brand [{$mod['b']}] is not in the brands table.");
            $title = mb_substr($mod['b'].' '.$mod['p'], 0, 160);
            $titles[] = $title;
            $status = ModStatus::from($mod['s']);
            $isAfter = $index >= $before;
            $at = $isAfter
                ? $published->addDays(max(1, intdiv($span * ($index - $before + 1), $after + 1)))->setTime(self::pick("mod-h:{$vehicle->id}:$index", 16, 21), 0)
                : $published->subDays(self::pick("mod-d:{$data['key']}:$index", 20, 700))->setTime(14, 0);
            $at = $at->min($this->clock->subDay());
            $installed = $status === ModStatus::Planned ? null : $at->format('Y-m');
            $stamp = $isAfter ? $at : $created;
            $attributes = [
                'title' => $title,
                'brand_id' => $brand,
                'part_name' => $mod['p'],
                'status' => $status,
                'installed_on' => $installed,
                'cost_cents' => $mod['cost'] * 100,
                'cost_public' => self::pick("cost:{$data['key']}:$index", 0, 2) === 0,
                'notes' => $mod['notes'] ?? null,
                'fields' => $mod['c'] === 'other' ? ['title' => $title] : $mod['f'],
            ];

            $row = $existing->get($title);

            if ($row instanceof Modification) {
                $row->forceFill([
                    'category_id' => $category->id,
                    'brand_id' => $brand,
                    'brand_text' => null,
                    'part_name' => $mod['p'],
                    'status' => $status,
                    'installed_on' => $installed === null ? null : $installed.'-01',
                    'cost_cents' => $attributes['cost_cents'],
                    'cost_public' => $attributes['cost_public'],
                    'notes' => $attributes['notes'],
                    'fields' => $fields->validated($category, $attributes['fields']),
                    'legal_status' => $mod['lg'],
                    'deleted_at' => null,
                    'sort' => $index + 1,
                ]);
                $row->timestamps = false;
                $row->save();
                $row->timestamps = true;
            } else {
                $row = SeedClock::at($stamp, fn (): Modification => app(SaveModification::class)->add($vehicle, $category, $attributes));
                $row->forceFill(['legal_status' => $mod['lg'], 'sort' => $index + 1, 'created_at' => $stamp, 'updated_at' => $stamp]);
                $row->timestamps = false;
                $row->save();
                $row->timestamps = true;
            }

            $result[] = ['mod' => $row, 'at' => $at, 'after' => $isAfter && $status === ModStatus::Installed, 'installed' => $status === ModStatus::Installed];
        }

        foreach ($existing as $title => $row) {
            if (! in_array($title, $titles, true)) {
                $row->forceDelete();
            }
        }

        return $result;
    }

    /**
     * @param  list<Photo>  $photos
     */
    private function seedVehiclePhotos(Vehicle $vehicle, User $owner, array $photos, CarbonImmutable $created): void
    {
        $service = app(MediaService::class);
        $existing = Media::query()->where('mediable_type', $vehicle->getMorphClass())->where('mediable_id', $vehicle->id)->whereNotNull('sample_source')->get()->keyBy('sample_source');
        $wanted = [];
        $cover = null;

        foreach ($photos as $index => $photo) {
            // The graded rendition is its own source: a photo imported raw before process-photos.mjs ran is replaced by the graded one.
            $source = 'vehicle:'.$photo['file'].($photo['graded'] ? self::GRADED : '');
            $wanted[] = $source;
            $media = $existing->get($source);

            if (! $media instanceof Media) {
                $media = SeedClock::at($created->addMinutes($index + 1), fn (): Media => $service->storeFromPath($photo['path'], $owner, $vehicle, [
                    'alt' => $photo['alt'],
                    'focal_x' => $photo['focal_x'],
                    'focal_y' => $photo['focal_y'],
                    'category' => MediaCategory::tryFrom($photo['category']) ?? MediaCategory::Other,
                    'sort' => $index + 1,
                ]));
            }

            $media->forceFill(['sample_source' => $source, 'sort' => $index + 1, 'moderation_status' => ModerationStatus::Approved, 'thumbhash' => $photo['graded'] ? $photo['thumbhash'] : null]); // the manifest's ThumbHash is of the graded rendition
            $media->timestamps = false;
            $media->save();
            $media->timestamps = true;
            $cover ??= $media->id;
        }

        foreach ($existing as $source => $media) {
            if (! in_array($source, $wanted, true)) {
                $service->purge($media);
            }
        }

        $vehicle->forceFill(['cover_media_id' => $cover]);
        $vehicle->timestamps = false;
        $vehicle->save();
        $vehicle->timestamps = true;
    }

    /**
     * 2-6 Verlauf entries per build: parts that came after publishing (backdated, as DemoSeeder's) and owner notes from the story pool,
     * plus the spam notes the moderation queue needs.
     *
     * @param  VehicleData  $data
     * @param  list<array{mod: Modification, at: CarbonImmutable, after: bool, installed: bool}>  $mods
     */
    private function seedBuildUpdates(Vehicle $vehicle, array $data, array $mods, CarbonImmutable $published): void
    {
        $updates = app(BuildUpdates::class);
        $entries = 0;

        foreach (array_slice(array_values(array_filter($mods, fn (array $mod): bool => $mod['after'])), 0, 3) as $mod) {
            $exists = BuildUpdate::query()->where('vehicle_id', $vehicle->id)->where('type', BuildUpdateType::ModAdded)->where('created_at', $mod['at'])->exists();

            if (! $exists) {
                $updates->backdated($mod['mod'], BuildUpdateType::ModAdded, $mod['at']);
            }

            $entries++;
        }

        // The Editorial account writes in its own voice: no invented drives, inspections or trackdays.
        $notes = isset($this->editorialKeys[$data['key']]) ? $this->editorialNotes : $this->stories['notes'];
        $tracks = $this->stories['tracks'];
        $wanted = max(2 - $entries, self::pick('notes:'.$data['key'], 1, 3));
        $installed = array_values(array_filter($mods, fn (array $mod): bool => $mod['installed']));
        $span = max(4, (int) $published->diffInDays($this->clock->subDay()));

        for ($i = 0; $i < $wanted && $entries < 6; $i++) {
            $template = $notes[self::pick('note:'.$data['key'].":$i", 0, count($notes) - 1)];
            $part = $installed === [] ? 'das neue Teil' : (string) $installed[self::pick('note-mod:'.$data['key'].":$i", 0, count($installed) - 1)]['mod']->title;
            $text = strtr($template, ['{mod}' => $part, '{track}' => $tracks[self::pick('track:'.$data['key'].":$i", 0, count($tracks) - 1)]]);
            $at = $published->addDays(intdiv($span * ($i + 1), $wanted + 1))->setTime(self::pick('note-h:'.$data['key'].":$i", 18, 22), 15)->min($this->clock->subHours(3));
            $this->note($vehicle, $text, $at);
            $entries++;
        }

        /** @var array<string, array{vehicle: string, days_ago: int, text: string}> $spam */
        $spam = is_array($this->admin['notes'] ?? null) ? $this->admin['notes'] : [];

        foreach ($spam as $note) {
            if ($note['vehicle'] === $data['key']) {
                $this->note($vehicle, $note['text'], $this->clock->subDays($note['days_ago'])->setTime(20, 40));
            }
        }

        $this->enrichNotes($vehicle, $data);
    }

    /**
     * M4.9 (DQ-975): the build's own notes get a rising mileage (a believable odometer per build, from the key), and the newest one a photo
     * of this very car: the last of its seed shoot, stored again through the media pipeline for the entry. Seeding again changes nothing.
     *
     * @param  VehicleData  $data
     */
    private function enrichNotes(Vehicle $vehicle, array $data): void
    {
        $notes = BuildUpdate::query()->where('vehicle_id', $vehicle->id)->where('type', BuildUpdateType::Note)->orderBy('created_at')->orderBy('id')->get();
        $km = 8_000 + self::pick('odometer:'.$data['key'], 4, 60) * 1_000;

        foreach ($notes as $index => $note) {
            if ($note->getAttribute('mileage_km') === null) {
                $note->forceFill(['mileage_km' => $km + $index * (900 + self::pick('km-step:'.$data['key'].":$index", 1, 9) * 100)]);
                $note->timestamps = false;
                $note->save();
            }
        }

        $newest = $notes->last();
        $photos = $this->photos[$data['key']] ?? [];
        $photo = $photos === [] ? null : $photos[count($photos) - 1];

        if (! $newest instanceof BuildUpdate || $photo === null || $newest->photos()->exists()) {
            return;
        }

        $owner = $vehicle->owner;

        if (! $owner instanceof User) {
            return;
        }

        $media = SeedClock::at(CarbonImmutable::parse((string) $newest->getAttribute('created_at')), fn (): Media => app(MediaService::class)->storeFromPath($photo['path'], $owner, $newest, [
            'alt' => $photo['alt'],
            'focal_x' => $photo['focal_x'],
            'focal_y' => $photo['focal_y'],
            'category' => MediaCategory::tryFrom($photo['category']) ?? MediaCategory::Other,
            'sort' => 1,
        ]));
        $media->forceFill(['sample_source' => 'update:'.$photo['file'], 'moderation_status' => ModerationStatus::Approved, 'thumbhash' => $photo['graded'] ? $photo['thumbhash'] : null]);
        $media->timestamps = false;
        $media->save();
    }

    private function note(Vehicle $vehicle, string $text, CarbonImmutable $at): void
    {
        $exists = BuildUpdate::query()->where('vehicle_id', $vehicle->id)->where('type', BuildUpdateType::Note)->where('note', $text)->exists();

        if (! $exists) {
            app(BuildUpdates::class)->note($vehicle, $text, $at);
        }
    }

    /**
     * Avatars: a square crop of the main build's cover around its focal point, through the media pipeline like an upload; members with
     * avatar=false keep the monogram. Profile covers: two of three members show their main build's cover photo.
     */
    private function seedProfileImages(): void
    {
        $service = app(MediaService::class);

        foreach ($this->users as $username => $user) {
            $key = $this->mains[$username] ?? null;
            $vehicle = $key === null ? null : ($this->vehicles[$key] ?? null);
            $photo = $key === null ? null : ($this->photos[$key][0] ?? null);
            $cover = $vehicle?->refresh()->getAttribute('cover_media_id');
            $avatar = null;

            if ($photo !== null && $this->members[$username]['avatar']) {
                $source = 'avatar:'.$photo['file'];
                $avatar = Media::query()->where('mediable_type', $user->getMorphClass())->where('mediable_id', $user->id)->where('sample_source', $source)->first();

                if (! $avatar instanceof Media) {
                    $path = $this->squareCrop($photo);

                    try {
                        $avatar = SeedClock::at(CarbonImmutable::parse((string) $user->getAttribute('created_at'))->addHour(), fn (): Media => $service->storeFromPath($path, $user, $user, ['alt' => null, 'category' => MediaCategory::Other]));
                    } finally {
                        @unlink($path);
                    }

                    $avatar->forceFill(['sample_source' => $source, 'moderation_status' => ModerationStatus::Approved])->save();
                }
            }

            foreach (Media::query()->where('mediable_type', $user->getMorphClass())->where('mediable_id', $user->id)->whereNotNull('sample_source')->get() as $old) {
                if ($avatar === null || $old->id !== $avatar->id) {
                    $service->purge($old);
                }
            }

            $user->forceFill([
                'avatar_media_id' => $avatar?->id,
                'cover_media_id' => self::pick("cover:$username", 0, 2) === 0 ? null : $cover,
            ]);
            $user->timestamps = false;
            $user->save();
            $user->timestamps = true;
        }
    }

    /**
     * @param  Photo  $photo
     */
    private function squareCrop(array $photo): string
    {
        $image = @imagecreatefromstring((string) file_get_contents($photo['path']));

        if ($image === false) {
            throw new RuntimeException("Seed photo [{$photo['file']}] cannot be decoded for an avatar.");
        }

        $width = imagesx($image);
        $height = imagesy($image);
        $side = min($width, $height);
        $x = (int) max(0, min($width - $side, ($photo['focal_x'] ?? 0.5) * $width - $side / 2));
        $y = (int) max(0, min($height - $side, ($photo['focal_y'] ?? 0.5) * $height - $side / 2));
        $size = max(1, min(800, $side));
        $square = imagecreatetruecolor($size, $size);
        imagecopyresampled($square, $image, 0, 0, $x, $y, $size, $size, $side, $side);
        $path = storage_path('framework/cache/showcase-avatar-'.Str::random(12).'.jpg');
        imagejpeg($square, $path, 90);

        return $path;
    }

    // ---------------------------------------------------------------------------------------------------------------------------
    // Social

    /**
     * Follows among sample members only: about one in five pairs, most members follow sebastian.demo and he follows a third of them. A
     * quarter is from the last three weeks (new_follower). Chats need the recipient to follow the starter; a request needs the
     * opposite. Saves: every member keeps 2-7 builds of others; his builds are saved most.
     */
    private function seedFollowsAndSaves(): void
    {
        [$required, $forbidden] = $this->followRules();
        $rows = [];

        foreach ($this->users as $a => $follower) {
            foreach ($this->users as $b => $followee) {
                // The Editorial account follows nobody and has no followers: no invented numbers on samples (09 §8.19).
                if ($a === $b || isset($forbidden["$a>$b"]) || $this->isEditorial($a) || $this->isEditorial($b)) {
                    continue;
                }

                $chance = match (true) {
                    $b === Showcase::SHOWCASE_USERNAME => 70,
                    $a === Showcase::SHOWCASE_USERNAME => 35,
                    default => 18,
                };

                if (! isset($required["$a>$b"]) && self::pick("follow:$a>$b", 0, 99) >= $chance) {
                    continue;
                }

                $rows[] = ['follower_id' => $follower->id, 'followee_id' => $followee->id, 'created_at' => $this->socialDate("follow:$a>$b", $follower, $followee)];
            }
        }

        foreach ($forbidden as $pair => $true) {
            [$a, $b] = explode('>', $pair);
            Follow::query()->where('follower_id', $this->users[$a]->id)->where('followee_id', $this->users[$b]->id)->delete();
        }

        foreach (array_chunk($rows, 300) as $chunk) {
            Follow::query()->insertOrIgnore($chunk);
        }

        $public = array_filter($this->vehicles, fn (Vehicle $vehicle, string $key): bool => $vehicle->status === VehicleStatus::Published && ! isset($this->editorialKeys[$key]), ARRAY_FILTER_USE_BOTH);
        $saves = [];

        foreach ($this->users as $username => $user) {
            if ($this->isEditorial($username)) {
                continue;
            }

            $candidates = array_filter($public, fn (Vehicle $vehicle): bool => $vehicle->owner_id !== $user->id);
            uasort($candidates, fn (Vehicle $a, Vehicle $b): int => self::pick("save:$username:".$a->public_id, 0, 999) - ($a->owner_id === $this->users[Showcase::SHOWCASE_USERNAME]->id ? 600 : 0)
                <=> self::pick("save:$username:".$b->public_id, 0, 999) - ($b->owner_id === $this->users[Showcase::SHOWCASE_USERNAME]->id ? 600 : 0));

            foreach (array_slice($candidates, 0, self::pick("saves:$username", 2, 7)) as $vehicle) {
                $saves[] = ['user_id' => $user->id, 'vehicle_id' => $vehicle->id, 'created_at' => $this->socialDate("save:$username:".$vehicle->public_id, $user, $vehicle->owner ?? $user, $vehicle)];
            }
        }

        foreach (array_chunk($saves, 300) as $chunk) {
            Save::query()->insertOrIgnore($chunk);
        }
    }

    /**
     * @return array{0: array<string, true>, 1: array<string, true>} "follower>followee" pairs that must and must not exist
     */
    private function followRules(): array
    {
        $required = [];
        $forbidden = [];

        foreach ($this->conversations() as $conversation) {
            $pair = $conversation['recipient'].'>'.$conversation['starter'];

            if ($conversation['kind'] === 'request') {
                $forbidden[$pair] = true;
            } else {
                $required[$pair] = true;
            }
        }

        return [$required, array_diff_key($forbidden, $required)];
    }

    private function socialDate(string $seed, User $a, User $b, ?Vehicle $vehicle = null): CarbonImmutable
    {
        $earliest = CarbonImmutable::parse((string) $a->getAttribute('created_at'))->max(CarbonImmutable::parse((string) $b->getAttribute('created_at')));

        if ($vehicle !== null && $vehicle->getAttribute('published_at') !== null) {
            $earliest = $earliest->max(CarbonImmutable::parse((string) $vehicle->getAttribute('published_at')));
        }

        $at = self::pick("$seed:recent", 0, 3) === 0
            ? $this->clock->subDays(self::pick("$seed:days", 0, 20))
            : $earliest->addDays(self::pick("$seed:days", 1, max(1, (int) $earliest->diffInDays($this->clock))));

        return $at->setTime(self::pick("$seed:h", 8, 22), self::pick("$seed:m", 0, 59))->max($earliest->addHour())->min($this->clock->subMinutes(10));
    }

    /**
     * The last 30 days of the real calendar (Europe/Berlin, as QrScans counts), with quiet days; older showcase rows go, so every code
     * has exactly 30 days. qr_milestone is set to the milestone the totals reached, so qr:milestones finds nothing new to tell.
     */
    private function seedQrScans(): void
    {
        $today = now(config()->string('speedclub.display_timezone'))->startOfDay();
        $first = $today->copy()->subDays(29)->toDateString();

        foreach ($this->vehicles as $key => $vehicle) {
            $qr = QrCode::query()->where('vehicle_id', $vehicle->id)->where('status', QrStatus::Active)->first();

            // Nobody scans an editorial build's sticker: no scan numbers are invented for it.
            if (! $qr instanceof QrCode || isset($this->editorialKeys[$key])) {
                continue;
            }

            $level = $key === ($this->mains[Showcase::SHOWCASE_USERNAME] ?? null) ? 9 : self::pick("scan-level:$key", 1, 6);
            $rows = [];

            for ($ago = 29; $ago >= 0; $ago--) {
                $day = $today->copy()->subDays($ago);
                $weekend = $day->isWeekend() ? 2 : 0;
                $count = self::pick("scan:$key:".$day->toDateString(), 0, 9) < 2 ? 0 : self::pick("scan-n:$key:".$day->toDateString(), 0, $level + $weekend);
                $rows[] = ['qr_code_id' => $qr->id, 'day' => $day->toDateString(), 'count' => $count];
            }

            DB::table('qr_scan_daily')->where('qr_code_id', $qr->id)->where('day', '<', $first)->delete();
            DB::table('qr_scan_daily')->upsert($rows, ['qr_code_id', 'day'], ['count']);

            $total = (int) DB::table('qr_scan_daily')->join('qr_codes', 'qr_codes.id', '=', 'qr_scan_daily.qr_code_id')->where('qr_codes.vehicle_id', $vehicle->id)->sum('qr_scan_daily.count');
            $reached = QrMilestones::reached($total);
            DB::table('vehicles')->where('id', $vehicle->id)->update(['qr_milestone' => $reached === [] ? 0 : max($reached)]);
        }
    }

    // ---------------------------------------------------------------------------------------------------------------------------
    // Messages

    /**
     * @return list<array{starter: string, recipient: string, script: string|int, days_ago: int, kind: string}>
     */
    private function conversations(): array
    {
        /** @var list<array{starter: string, recipient: string, script: string|int, days_ago: int, kind: string}> $list */
        $list = is_array($this->conversationData['conversations'] ?? null) ? $this->conversationData['conversations'] : [];

        return array_values(array_filter($list, fn (array $conversation): bool => isset($this->users[$conversation['starter']], $this->users[$conversation['recipient']])));
    }

    /**
     * Through StartConversation and SendMessage at each line's moment, with fixed client ids (a re-run replays instead of writing). A
     * request stays one message in the recipient's Anfragen. Photos come from the sender's own build; a vehicle card shows the sender's
     * main build. Both sides read the chat half an hour after the last line, except sebastian.demo's three newest chats, and every other
     * chat ends with a reaction.
     */
    private function seedConversations(): void
    {
        /** @var array<string, list<array{0: int, 1: int, 2: string|array{vehicle?: string, photo?: string}}>> $scripts */
        $scripts = $this->conversationData['scripts'] ?? [];
        /** @var list<string> $requests */
        $requests = $this->conversationData['requests'] ?? [];
        /** @var list<string> $reactions */
        $reactions = $this->conversationData['reactions'] ?? ['thumbs_up'];
        $tracks = $this->stories['tracks'];
        $mine = array_filter($this->conversations(), fn (array $c): bool => $c['kind'] === 'chat' && in_array(Showcase::SHOWCASE_USERNAME, [$c['starter'], $c['recipient']], true));
        usort($mine, fn (array $a, array $b): int => $a['days_ago'] <=> $b['days_ago']);
        $unread = array_map(fn (array $c): string => $c['starter'].'>'.$c['recipient'], array_slice($mine, 0, 3));

        foreach ($this->conversations() as $index => $conversation) {
            $starter = $this->users[$conversation['starter']]->refresh();
            $recipient = $this->users[$conversation['recipient']]->refresh();
            $pair = $starter->username.'>'.$recipient->username;
            $placeholders = [
                '{a_car}' => $this->carName($conversation['starter']),
                '{b_car}' => $this->carName($conversation['recipient']),
                '{track}' => $tracks[self::pick("talk-track:$pair", 0, count($tracks) - 1)],
            ];
            $lines = $conversation['kind'] === 'request'
                ? [[0, 0, $requests[(int) $conversation['script'] % max(1, count($requests))]]]
                : ($scripts[(string) $conversation['script']] ?? []);
            $at = $this->clock->subDays($conversation['days_ago'])->setTime(self::pick("talk-h:$pair", 9, 20), self::pick("talk-m:$pair", 0, 59));
            $context = self::pick("talk-context:$pair", 0, 2) === 0 ? $this->vehicles[$this->mains[$recipient->username] ?? ''] ?? null : null;
            $last = $at;

            foreach ($lines as $line => [$side, $minutes, $content]) {
                $at = $at->addMinutes($minutes);
                $last = $at;
                $author = $side === 0 ? $starter : $recipient;
                $other = $side === 0 ? $recipient : $starter;
                $clientId = 'showcase-'.substr(hash('sha256', "$pair:$line"), 0, 32);

                if (Message::query()->where('sender_id', $author->id)->where('client_id', $clientId)->exists()) {
                    continue;
                }

                try {
                    SeedClock::at($at, function () use ($author, $other, $starter, $recipient, $content, $clientId, $placeholders, $context): void {
                        $draft = $this->messageDraft($author, $starter, $recipient, $content, $clientId, $placeholders);

                        if ($draft === null) {
                            return;
                        }

                        $mine = $this->sideOrNull($author, $other);

                        if ($mine === null) {
                            // The first line that can be sent opens the conversation (a script's photo needs it open already).
                            RateLimiter::clear('conversation_requests|user:'.$author->id);
                            app(StartConversation::class)->handle($author, $other, $context?->id, $draft, null);
                        } else {
                            app(SendMessage::class)->handle($author, $mine, $draft, null);
                        }
                    });
                } catch (Throwable $exception) {
                    $this->warn("Showcase chat $pair stopped at line $line: {$exception->getMessage()}");

                    break;
                }
            }

            if ($conversation['kind'] !== 'chat' || ! Conversation::query()->where('pair_key', Conversation::pairKey($starter, $recipient))->exists()) {
                continue;
            }

            foreach ([$starter, $recipient] as $reader) {
                if ($reader->username === Showcase::SHOWCASE_USERNAME && in_array($pair, $unread, true)) {
                    continue;
                }

                $this->readAll($reader, $reader->is($starter) ? $recipient : $starter, $last->addMinutes(30));
            }

            if ($index % 2 === 0) {
                $this->react($recipient, $starter, $reactions[self::pick("reaction:$pair", 0, count($reactions) - 1)], $last->addMinutes(31));
            }
        }
    }

    /**
     * @param  string|array{vehicle?: string, photo?: string}  $content
     * @param  array<string, string>  $placeholders
     * @return array{type: MessageType, body: string|null, media_id: string|null, vehicle_id: string|null, client_id: string}|null
     */
    private function messageDraft(User $author, User $starter, User $recipient, string|array $content, string $clientId, array $placeholders): ?array
    {
        $draft = ['type' => MessageType::Text, 'body' => null, 'media_id' => null, 'vehicle_id' => null, 'client_id' => $clientId];
        $key = $this->mains[(string) $author->username] ?? null;

        if (is_string($content)) {
            return [...$draft, 'body' => strtr($content, $placeholders)];
        }

        if ($key === null) {
            return null;
        }

        if (isset($content['vehicle'])) {
            return [...$draft, 'type' => MessageType::Vehicle, 'vehicle_id' => $this->vehicles[$key]->id];
        }

        $photo = $this->photos[$key][1] ?? $this->photos[$key][0] ?? null;
        $conversation = Conversation::query()->where('pair_key', Conversation::pairKey($starter, $recipient))->first();

        // A photo needs the conversation; a script never starts with one for that reason, but a missing one costs only the photo.
        if ($photo === null || ! $conversation instanceof Conversation) {
            return null;
        }

        $service = app(MediaService::class);
        $bytes = $service->inspectPath($photo['path']);
        $media = $service->processOrQueue($service->reserve($author, $conversation, ['alt' => $photo['alt'], 'category' => MediaCategory::tryFrom($photo['category']) ?? MediaCategory::Other], strlen($bytes), ChatMedia::disk()), $bytes);
        $media->forceFill(['moderation_status' => ModerationStatus::Approved, 'sample_source' => 'chat:'.$photo['file']])->save();

        return [...$draft, 'type' => MessageType::Photo, 'media_id' => $media->id];
    }

    private function carName(string $username): string
    {
        $key = $this->mains[$username] ?? null;

        return $key === null ? 'Auto' : $this->vehicleData[$key]['make'].' '.$this->vehicleData[$key]['model'];
    }

    private function readAll(User $reader, User $other, CarbonImmutable $at): void
    {
        $side = $this->side($reader, $other);

        if ($side->isPendingRequest()) {
            return;
        }

        $last = app(Conversations::class)->visibleMessages($side)->max('messages.id');

        if (is_string($last) && $side->getAttribute('last_read_message_id') !== $last) {
            SeedClock::at($at, fn () => app(MarkConversationRead::class)->handle($reader, $side, $last));
        }
    }

    private function react(User $member, User $other, string $reaction, CarbonImmutable $at): void
    {
        $side = $this->side($member, $other);
        $message = Message::query()->where('conversation_id', $side->conversation_id)->where('sender_id', $other->id)->orderByDesc('id')->first();
        $value = MessageReaction::tryFrom($reaction);

        if (! $message instanceof Message || $value === null || $side->isPendingRequest()) {
            return;
        }

        try {
            SeedClock::at($at, fn () => app(ReactToMessage::class)->react($member, $side, $message, $value));
        } catch (Throwable $exception) {
            $this->warn("Showcase reaction skipped: {$exception->getMessage()}");
        }
    }

    private function sideOrNull(User $member, User $other): ?ConversationParticipant
    {
        return ConversationParticipant::query()
            ->where('conversation_id', Conversation::query()->where('pair_key', Conversation::pairKey($member, $other))->value('id'))
            ->where('user_id', $member->id)
            ->first();
    }

    private function side(User $member, User $other): ConversationParticipant
    {
        return ConversationParticipant::query()
            ->where('conversation_id', Conversation::query()->where('pair_key', Conversation::pairKey($member, $other))->value('id'))
            ->where('user_id', $member->id)
            ->firstOrFail();
    }

    // ---------------------------------------------------------------------------------------------------------------------------
    // Admin side

    /**
     * Open reports on sample content for the queue, and two decided cases (no action; removal of a sales post) for SAFE-01, SET-16 and
     * the decision notifications. Through SubmitReport and DecideCase, decided by the showcase staff account.
     */
    private function seedModeration(): void
    {
        /** @var list<array<string, mixed>> $open */
        $open = $this->admin['reports'] ?? [];
        /** @var list<array<string, mixed>> $decided */
        $decided = $this->admin['decided'] ?? [];

        foreach ([...$open, ...$decided] as $report) {
            $reporter = $this->users[(string) $report['reporter']] ?? null;
            /** @var array<string, mixed> $target */
            $target = $report['target'];
            [$type, $id] = $this->reportTarget($target);

            if ($reporter === null || $id === null) {
                continue;
            }

            $exists = Report::query()->where('reporter_id', $reporter->id)->where('target_type', $type->value)
                ->where('target_id', $type === ReportTargetType::Member ? (string) ($this->users[$id]->id ?? '') : $id)->exists();

            if (! $exists) {
                try {
                    SeedClock::at($this->clock->subDays((int) $report['days_ago'])->setTime(19, 10), fn () => app(SubmitReport::class)->handle(
                        app(ReportTargets::class)->forMember($reporter, $type, $id),
                        new ReportDraft(source: ReportSource::App, reporter: $reporter, reason: ReportReason::from((string) $report['reason']), details: (string) $report['details']),
                    ));
                } catch (Throwable $exception) {
                    $this->warn("Showcase report [{$report['key']}] skipped: {$exception->getMessage()}");

                    continue;
                }
            }

            if (! isset($report['action']) || $this->staff === null) {
                continue;
            }

            $case = ModerationCase::query()->where('target_type', $type->value)->where('target_id', $type === ReportTargetType::Member ? (string) $this->users[$id]->id : $id)
                ->orderByDesc('created_at')->first();

            if (! $case instanceof ModerationCase || Decision::query()->where('case_id', $case->id)->exists()) {
                continue;
            }

            $staff = $this->staff;
            $decision = SeedClock::at($this->clock->subDays((int) $report['decided_days_ago'])->setTime(10, 20), fn (): Decision => app(DecideCase::class)->handle($case, new DecisionInput(
                action: DecisionAction::from((string) $report['action']),
                facts: (string) $report['facts'],
                ground: (string) $report['ground'],
                groundDocument: GroundDocument::Community,
                groundSection: (string) $report['section'],
                decidedBy: $staff,
                reason: Showcase::REASON,
            )));
            $decision->forceFill(['mailed_at' => $decision->decided_at])->save();
        }
    }

    /**
     * @param  array<string, mixed>  $target
     * @return array{0: ReportTargetType, 1: string|null} the type and the id ReportTargets takes (a username for a member)
     */
    private function reportTarget(array $target): array
    {
        $vehicle = isset($target['vehicle']) ? ($this->vehicles[(string) $target['vehicle']] ?? null) : null;

        return match ((string) $target['type']) {
            'member' => [ReportTargetType::Member, isset($this->users[(string) $target['member']]) ? (string) $target['member'] : null],
            'vehicle' => [ReportTargetType::Vehicle, $vehicle?->id],
            'photo' => [ReportTargetType::Photo, $vehicle === null ? null : Media::query()->where('mediable_type', $vehicle->getMorphClass())->where('mediable_id', $vehicle->id)
                ->orderBy('sort')->skip(max(0, (int) ($target['index'] ?? 1) - 1))->value('id')],
            'build_update' => [ReportTargetType::BuildUpdate, $vehicle === null ? null : BuildUpdate::query()->where('vehicle_id', $vehicle->id)->where('type', BuildUpdateType::Note)
                ->where('note', (string) (($this->admin['notes'][(string) $target['note']]['text'] ?? '')))->value('id')],
            default => throw new RuntimeException("Unknown showcase report target [{$target['type']}]."),
        };
    }

    /**
     * Tickets in every state (open, waiting for the member, answered again, closed) with team replies and an internal note.
     */
    private function seedSupport(): void
    {
        /** @var list<array<string, mixed>> $tickets */
        $tickets = $this->admin['tickets'] ?? [];

        foreach ($tickets as $data) {
            $member = $this->users[(string) $data['member']] ?? null;

            if ($member === null || SupportTicket::query()->where('user_id', $member->id)->where('subject', (string) $data['subject'])->exists()) {
                continue;
            }

            $at = fn (int $days, string $time): CarbonImmutable => $this->clock->subDays($days)->setTimeFromTimeString($time);
            $ticket = SeedClock::at($at((int) $data['days_ago'], '09:30'), fn (): SupportTicket => app(CreateSupportTicket::class)->forMember($member, SupportCategory::from((string) $data['category']), (string) $data['subject'], (string) $data['body']));
            $staff = $this->staff;

            if ($staff === null) {
                continue;
            }

            if (is_array($data['internal'] ?? null)) {
                SeedClock::at($at((int) $data['internal']['days_ago'], '10:05'), fn () => app(AddTicketNote::class)->handle($staff, $ticket, (string) $data['internal']['body']));
            }

            if (is_array($data['reply'] ?? null)) {
                SeedClock::at($at((int) $data['reply']['days_ago'], '10:40'), fn () => app(ReplyToTicket::class)->handle($staff, $ticket->refresh(), (string) $data['reply']['body'], SupportTicketStatus::from((string) $data['reply']['status'])));
            }

            if (is_array($data['member_reply'] ?? null)) {
                SeedClock::at($at((int) $data['member_reply']['days_ago'], '18:15'), fn () => app(AddMemberReply::class)->handle($member, $ticket->refresh(), (string) $data['member_reply']['body']));
            }
        }
    }

    /**
     * Pending four-eyes requests by the showcase staff (exports and a deletion of sample members). They expire after
     * speedclub.approvals.ttl_hours like every request; a re-run asks again.
     */
    private function seedApprovals(): void
    {
        $staff = $this->staff;

        if ($staff === null) {
            return;
        }

        /** @var list<array{key: string, type: string, member: string, reason: string}> $approvals */
        $approvals = $this->admin['approvals'] ?? [];

        foreach ($approvals as $data) {
            $member = $this->users[$data['member']] ?? null;

            if ($member === null) {
                continue;
            }

            try {
                match ($data['type']) {
                    'members.export' => app(RequestMemberExport::class)->handle($staff, $member, $data['reason']),
                    'members.delete' => app(RequestMemberDeletion::class)->handle($staff, $member, $data['reason']),
                    default => throw new RuntimeException("Unknown showcase approval [{$data['type']}]."),
                };
            } catch (RuntimeException $exception) {
                throw $exception;
            } catch (Throwable $exception) {
                $this->warn("Showcase approval [{$data['key']}] skipped: {$exception->getMessage()}");
            }
        }
    }

    private function seedCatalogRequests(): void
    {
        /** @var list<array{key: string, member: string, make: string, model: string, generation: string, accepted: bool|null, days_ago: int, reason?: string}> $requests */
        $requests = $this->admin['catalog_requests'] ?? [];

        foreach ($requests as $data) {
            $member = $this->users[$data['member']] ?? null;

            if ($member === null) {
                continue;
            }

            $at = $this->clock->subDays($data['days_ago']);
            $request = CatalogRequest::query()->firstOrNew(['user_id' => $member->id, 'make_text' => $data['make'], 'model_text' => $data['model'], 'generation_text' => $data['generation']]);
            $request->forceFill([
                'user_id' => $member->id,
                'vehicle_id' => $this->vehicles[$this->mains[$data['member']] ?? '']->id ?? null,
                // accepted null: still open in ADM-14's request queue.
                'status' => match ($data['accepted']) {
                    true => CatalogRequestStatus::Approved,
                    false => CatalogRequestStatus::Rejected,
                    null => CatalogRequestStatus::Pending,
                },
                'rejection_reason' => $data['accepted'] === false ? ($data['reason'] ?? null) : null,
                'resolved_by' => $data['accepted'] === null ? null : $this->staff?->id,
                'resolved_at' => $data['accepted'] === null ? null : $at->addDay(),
                'created_at' => $at,
                'updated_at' => $data['accepted'] === null ? $at : $at->addDay(),
            ]);
            $request->timestamps = false;
            $request->save();
        }
    }

    /** English colour words of the photo manifest, longest first, and their German names. */
    private const COLOURS = [
        'silver-grey' => 'Silbergrau', 'dark grey' => 'Dunkelgrau', 'matte grey' => 'Mattgrau', 'matte black' => 'Mattschwarz',
        'dark blue' => 'Dunkelblau', 'turbo blue' => 'Blau', 'dark green' => 'Dunkelgrün', 'lime green' => 'Limettengrün',
        'kyalami green' => 'Grün', 'dark red' => 'Dunkelrot', 'white' => 'Weiß', 'black' => 'Schwarz', 'silver' => 'Silber',
        'red' => 'Rot', 'blue' => 'Blau', 'grey' => 'Grau', 'gray' => 'Grau', 'yellow' => 'Gelb', 'orange' => 'Orange',
        'green' => 'Grün', 'teal' => 'Petrol', 'bronze' => 'Bronze', 'purple' => 'Violett', 'brown' => 'Braun', 'gold' => 'Gold',
    ];

    /**
     * The colour a build shows: the photo's colour in German, since the build page must match its photo. The data's own colour name
     * ("Laguna Seca Blau") wins when it names the same colour; a photo note that names no colour leaves the data's name.
     */
    private static function colour(?string $photo, ?string $data): ?string
    {
        $note = mb_strtolower(trim((string) $photo));

        foreach (self::COLOURS as $english => $german) {
            if ($note !== '' && preg_match('/^'.preg_quote($english, '/').'\b/u', $note) === 1) {
                $base = mb_strtolower(preg_replace('/^(Dunkel|Matt|Silber|Limetten)/u', '', $german) ?? $german);

                return $data !== null && str_contains(mb_strtolower($data), $base) ? $data : $german;
            }
        }

        return $data;
    }

    /**
     * Build der Woche: the strongest sample build (most parts, then photos) goes first into HOME-01's featured slot, and a hand-picked
     * Home collection "JDM-Klassiker" of the published Japanese sample builds is added, both through the home_curation draft and
     * publish, as ADM-29 does it. Already there: nothing changes.
     */
    private function seedCuration(): void
    {
        if ($this->staff === null || $this->vehicles === []) {
            return;
        }

        $best = null;
        $score = -1;

        foreach ($this->vehicles as $key => $vehicle) {
            $points = count($this->vehicleData[$key]['mods']) * 10 + count($this->photos[$key] ?? []);

            if ($this->vehicleData[$key]['owner'] !== Showcase::SHOWCASE_USERNAME && ! isset($this->editorialKeys[$key]) && $points > $score && $vehicle->refresh()->status === VehicleStatus::Published) {
                [$best, $score] = [$vehicle, $points];
            }
        }

        if (! $best instanceof Vehicle) {
            return;
        }

        $versions = app(ConfigVersions::class);
        $payload = $versions->startingPayload(ConfigKey::HomeCuration);
        /** @var list<array{vehicle_id: string, starts_at: string|null, ends_at: string|null}> $featured */
        $featured = is_array($payload['featured'] ?? null) ? array_values($payload['featured']) : [];
        /** @var list<array<string, mixed>> $collections */
        $collections = is_array($payload['collections'] ?? null) ? array_values($payload['collections']) : [];
        $changes = [];

        if (! in_array($best->id, array_column($featured, 'vehicle_id'), true)) {
            $live = array_values(array_filter($featured, fn (array $entry): bool => $entry['ends_at'] === null || CarbonImmutable::parse($entry['ends_at'])->isFuture()));
            // Room for the new entry within featured_live_max, the oldest live ones end first.
            $max = config()->integer('speedclub.content.featured_live_max');

            while (count($live) >= $max) {
                $drop = array_pop($live);
                $featured = array_values(array_filter($featured, fn (array $entry): bool => $entry !== $drop));
            }

            $featured = [['vehicle_id' => $best->id, 'starts_at' => $this->clock->subDays(2)->startOfDay()->toIso8601ZuluString(), 'ends_at' => null], ...$featured];
            $changes[] = 'Build der Woche: '.$best->slug;
        }

        if (! in_array(Showcase::COLLECTION_KEY, array_column($collections, 'key'), true) && count($collections) < config()->integer('speedclub.content.collections_max')) {
            $jdm = [];

            foreach ($this->vehicles as $key => $vehicle) {
                if (! isset($this->editorialKeys[$key]) && in_array($this->vehicleData[$key]['make'], ['Nissan', 'Toyota', 'Mazda', 'Honda', 'Subaru'], true) && $vehicle->status === VehicleStatus::Published) {
                    $jdm[] = (string) $vehicle->id;
                }
            }

            $jdm = array_slice($jdm, 0, min(12, config()->integer('speedclub.content.collection_vehicles_max')));

            if (count($jdm) >= 3) {
                $collections[] = [
                    'key' => Showcase::COLLECTION_KEY,
                    'title' => ['de' => 'JDM-Klassiker', 'en' => 'JDM classics'],
                    'subtitle' => ['de' => 'Skyline, Supra, RX-7 und Co. aus der Community', 'en' => 'Skyline, Supra, RX-7 and more from the community'],
                    'mode' => 'vehicles',
                    'filters' => null,
                    'sort' => null,
                    'vehicle_ids' => $jdm,
                    'cover_vehicle_id' => $jdm[0],
                    'active' => true,
                ];
                $changes[] = 'Sammlung JDM-Klassiker';
            }
        }

        if ($changes === []) {
            return;
        }

        $payload['featured'] = $featured;
        $payload['collections'] = $collections;

        try {
            $draft = app(SaveConfigDraft::class)->handle($this->staff, ConfigKey::HomeCuration, $payload, $versions->draft(ConfigKey::HomeCuration)?->revision);
            app(PublishConfigVersion::class)->handle($this->staff, ConfigKey::HomeCuration, implode(', ', $changes).' ('.Showcase::REASON.')', (int) $draft->revision);
        } catch (Throwable $exception) {
            $this->warn("Home curation not set: {$exception->getMessage()}");
        }
    }

    // ---------------------------------------------------------------------------------------------------------------------------
    // Notifications

    /**
     * Every type the app has, written through Notifier at the moments of the story, after everything they tell of exists. The sample
     * members' rows are written afresh on every run (what they say follows from the rows above), all but each member's three newest
     * are read.
     */
    private function seedNotifications(): void
    {
        $ids = array_map(fn (User $user): string => $user->id, $this->users);
        Notification::query()->whereIn('notifiable_id', $ids)->delete();
        $notifier = app(Notifier::class);
        $tz = config()->string('speedclub.notifications.timezone');
        $since = $this->clock->subDays(21);

        foreach ($this->users as $username => $user) {
            if ($this->isEditorial($username)) {
                continue;
            }

            $user->refresh();

            // new_follower: one row per day of the last three weeks.
            $follows = Follow::query()->where('followee_id', $user->id)->whereIn('follower_id', $ids)->where('created_at', '>=', $since)->orderBy('created_at')->get();

            foreach ($follows as $follow) {
                $follower = User::query()->find($follow->follower_id);

                if ($follower instanceof User) {
                    SeedClock::at(CarbonImmutable::parse((string) $follow->getAttribute('created_at')), fn () => $notifier->newFollower($user, $follower));
                }
            }

            // followed_published: the four newest updates of members they follow.
            $updates = BuildUpdate::query()->where('hidden', false)->where('created_at', '>=', $since)->where('created_at', '<=', $this->clock)
                ->whereIn('vehicle_id', Vehicle::query()->where('is_sample', true)->whereIn('owner_id', $user->following()->pluck('users.id'))->where('status', VehicleStatus::Published)->select('id'))
                ->orderByDesc('created_at')->limit(4)->get();

            foreach ($updates as $update) {
                $vehicle = $update->vehicle;
                $owner = $vehicle->owner;

                if ($owner instanceof User) {
                    $moment = CarbonImmutable::parse((string) $update->getAttribute('created_at'));
                    SeedClock::at($moment, fn () => $notifier->followedPublished($user, $owner, $vehicle, $update, $moment->setTimezone($tz)->toDateString()));
                }
            }

            // build_saved: the weekly digest of the last three ISO weeks.
            foreach (Vehicle::query()->where('owner_id', $user->id)->where('is_sample', true)->get() as $vehicle) {
                for ($week = 3; $week >= 1; $week--) {
                    $start = $this->clock->setTimezone($tz)->startOfWeek(CarbonImmutable::MONDAY)->subWeeks($week);
                    $count = Save::query()->where('vehicle_id', $vehicle->id)->whereBetween('created_at', [$start->utc(), $start->addWeek()->utc()])->count();

                    if ($count > 0) {
                        SeedClock::at($start->addWeek()->setTime(9, 0)->utc(), fn () => $notifier->buildSaved($user, $vehicle, $count, $start->isoFormat('GGGG-[W]WW')));
                    }
                }

                // qr_milestone: the highest milestone the stickers reached, told on a recent day.
                $milestone = (int) DB::table('vehicles')->where('id', $vehicle->id)->value('qr_milestone');

                if ($milestone > 0) {
                    SeedClock::at($this->clock->subDays(self::pick('milestone:'.$vehicle->id, 1, 12))->setTime(18, 5), fn () => $notifier->qrMilestone($user, $vehicle, $milestone));
                }
            }

            // hu_au_reminder: about every fifth member's main build is due next month.
            $main = $this->vehicles[$this->mains[$username] ?? ''] ?? null;

            if ($main instanceof Vehicle && ($username === Showcase::SHOWCASE_USERNAME || self::pick("hu:$username", 0, 4) === 0)) {
                $due = $this->clock->addMonth()->startOfMonth();
                $main->forceFill(['hu_au_due' => $due->toDateString(), 'hu_au_reminded_for' => $due->toDateString()]);
                $main->timestamps = false;
                $main->save();
                $main->timestamps = true;
                SeedClock::at($this->clock->subDays(self::pick("hu-at:$username", 1, 6))->setTime(8, 0), fn () => $notifier->huAuReminder($user, $main, $due->format('Y-m')));
            }

            // security: a sign-in on a new device for some members, sebastian.demo included.
            if ($username === Showcase::SHOWCASE_USERNAME || self::pick("security:$username", 0, 5) === 0) {
                $device = ['iPhone 15 Pro', 'Pixel 8', 'Galaxy S24', 'iPad Air'][self::pick("device:$username", 0, 3)];
                SeedClock::at($this->clock->subDays(self::pick("security-at:$username", 2, 15))->setTime(21, 40), fn () => $notifier->security($user, SecurityNotice::NewDevice, $device));
            }
        }

        // Decisions (moderation_decision, report_decided), support replies and catalogue requests of the admin side.
        foreach (Decision::query()->whereIn('subject_id', $ids)->orWhereIn('case_id', Report::query()->whereIn('reporter_id', $ids)->select('case_id'))->get() as $decision) {
            $moment = CarbonImmutable::parse((string) $decision->getAttribute('decided_at'));
            $subject = $decision->subject_id === null ? null : User::query()->find($decision->subject_id);

            if ($subject instanceof User && $decision->action !== DecisionAction::NoAction) {
                SeedClock::at($moment, fn () => $notifier->moderationDecision($subject, $decision));
            }

            foreach (Report::query()->where('case_id', $decision->case_id)->whereIn('reporter_id', $ids)->get() as $report) {
                $reporter = User::query()->find($report->reporter_id);

                if ($reporter instanceof User) {
                    SeedClock::at($moment->addMinute(), fn () => $notifier->reportDecided($reporter, $decision));
                }
            }
        }

        foreach (SupportTicket::query()->whereIn('user_id', $ids)->get() as $ticket) {
            $reply = DB::table('ticket_messages')->where('ticket_id', $ticket->id)->where('internal', false)->whereNotNull('staff_id')->max('created_at');
            $member = $ticket->user_id === null ? null : User::query()->find($ticket->user_id);

            if (is_string($reply) && $member instanceof User) {
                SeedClock::at(CarbonImmutable::parse($reply), fn () => $notifier->supportReply($member, $ticket));
            }
        }

        foreach (CatalogRequest::query()->whereIn('user_id', $ids)->whereNotNull('resolved_at')->get() as $request) {
            $member = User::query()->find($request->getAttribute('user_id'));

            if ($member instanceof User) {
                $accepted = $request->getAttribute('status') === CatalogRequestStatus::Approved || $request->getAttribute('status') === CatalogRequestStatus::Approved->value;
                SeedClock::at(CarbonImmutable::parse((string) $request->getAttribute('resolved_at')), fn () => $notifier->catalogRequest($member, $request, $accepted, is_string($request->getAttribute('rejection_reason')) ? $request->getAttribute('rejection_reason') : null));
            }
        }

        foreach ($ids as $id) {
            $unread = Notification::query()->where('notifiable_id', $id)->orderByDesc('created_at')->orderByDesc('id')->limit(3)->pluck('id');
            Notification::query()->where('notifiable_id', $id)->whereNotIn('id', $unread)->update(['read_at' => $this->clock->subHours(2)]);
        }
    }

    // ---------------------------------------------------------------------------------------------------------------------------
    // Finish

    /**
     * Specs, parts and photos count as edits for the app; for the showcase they are the story, so a build's last change is its newest
     * Verlauf entry (or its publishing).
     */
    private function restoreStoryDates(): void
    {
        foreach ($this->vehicles as $vehicle) {
            $published = $vehicle->getAttribute('published_at');
            $latest = BuildUpdate::query()->where('vehicle_id', $vehicle->id)->max('created_at');
            $at = collect([$published === null ? null : CarbonImmutable::parse((string) $published), is_string($latest) ? CarbonImmutable::parse($latest) : null])->filter()->max();

            if ($at instanceof CarbonImmutable) {
                DB::table('vehicles')->where('id', $vehicle->id)->update(['updated_at' => $at->min($this->clock)]);
            }
        }
    }

    private function recordSeeded(): void
    {
        if (DB::table('audit_events')->where('action', Showcase::AUDIT_SEEDED)->exists()) {
            return;
        }

        Audit::record(Showcase::AUDIT_SEEDED, after: app(ShowcasePurge::class)->counts(), reason: Showcase::REASON);
    }

    /**
     * The public id of a showcase build, derived from its data key (DemoSeeder's scheme with its own salt): the same on every run.
     */
    public static function publicIdFor(string $key): string
    {
        $bytes = hash('sha256', 'speedclub-showcase:vehicle:'.$key, true);
        $code = '';

        for ($i = 0; $i < Codes::LENGTH; $i++) {
            $code .= Codes::ALPHABET[ord($bytes[$i]) % strlen(Codes::ALPHABET)];
        }

        return $code;
    }

    /**
     * A number in [$min, $max] from $seed: the same on every machine and every run (no Faker on staging).
     */
    public static function pick(string $seed, int $min, int $max): int
    {
        return $max <= $min ? $min : $min + crc32($seed) % ($max - $min + 1);
    }
}
