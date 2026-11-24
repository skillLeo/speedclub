<?php

namespace Database\Seeders;

use App\Actions\Dex\RecordSpot;
use App\Actions\Social\SetHighlights;
use App\Actions\Social\Updates\PostBuildUpdate;
use App\Enums\BadgeMetric;
use App\Enums\BuildScoreRankScope;
use App\Enums\BuildUpdateAudience;
use App\Enums\BuildUpdateKind;
use App\Enums\BuildUpdateType;
use App\Enums\Bundesland;
use App\Enums\CarOfTheDaySource;
use App\Enums\ConfigKey;
use App\Enums\HighlightItemType;
use App\Enums\MediaCategory;
use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Enums\ModStatus;
use App\Enums\PlateBlurState;
use App\Enums\QrStatus;
use App\Enums\ReactionType;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Enums\XpType;
use App\Exceptions\ApiException;
use App\Models\Badge;
use App\Models\BuildScore;
use App\Models\BuildUpdate;
use App\Models\CarOfTheDay;
use App\Models\DeCity;
use App\Models\DexSet;
use App\Models\InviteCode;
use App\Models\Media;
use App\Models\Modification;
use App\Models\QrCode;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\Wrapped;
use App\Services\Badges\BadgeMetrics;
use App\Services\Badges\BadgeRules;
use App\Services\BuildScore\BuildScoreInputs;
use App\Services\BuildScore\BuildScores;
use App\Services\CarOfTheDay\CarOfTheDays;
use App\Services\Config\ConfigVersions;
use App\Services\Dex\CityMatcher;
use App\Services\Dex\DexNumbers;
use App\Services\Dex\DexSets;
use App\Services\Dex\RarityRules;
use App\Services\Garage\BuildUpdates;
use App\Services\Home\BuildOfWeek;
use App\Services\Invites\InviteCodes;
use App\Services\Media\MediaService;
use App\Services\Media\PlateBlurChoice;
use App\Services\Notifications\Notifier;
use App\Services\Notifications\PublicationFanout;
use App\Services\PublicPages\OgImages;
use App\Services\Showcase\Showcase;
use App\Services\Showcase\ShowcasePhotos;
use App\Services\Showcase\ShowcasePlates;
use App\Services\Wrapped\Season;
use App\Services\Wrapped\WrappedGenerator;
use App\Services\Wrapped\WrappedReleases;
use Carbon\CarbonImmutable;
use Database\Seeders\Concerns\SeedClock;
use Database\Seeders\Concerns\SeedsFromData;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use RuntimeException;
use Throwable;

/**
 * M5.9f gift demo (owner gift detail "Gift demo + deploy + report"): the Phase 5 gifts on top of the staging showcase, so STREET DEX,
 * the scanner reveal, the Build Score gauge, badges, Car of the Day and Season Wrapped show full screens for sebastian.demo. Local and
 * staging only (Showcase::assertEnvironment, like DemoShowcaseSeeder, which runs this at its end); every row stays `is_sample` or hangs off
 * a sample member or build, so `speedclub:demo --purge` removes it.
 *
 * What it writes, through the app's own services wherever one exists:
 * - Plate decisions (ADR-509): every sample photo still `unchecked` (imported before M5.9f) is pixelated by the media pipeline with the
 *   rectangles of database/data/showcase/plates.json, or declined where no plate is visible; the pre-blur master is replaced.
 * - Region: users.bundesland from the member's city (de_cities), activated_at for members imported before M5.9d.
 * - Showpieces (database/data/showcase/gift.json): documented mods with a photo of their own car, before/after posts and notes in the
 *   2026 season, so the real Build Score calculator reaches every stage from content.
 * - Community: private reactions and car follows among sample members (counts stay owner-only).
 * - Spots: RecordSpot under the moment of each spot, by sample members of sample cars, in the twelve gift cities over the last 60 days,
 *   day times only (09:00–19:59 Europe/Berlin), so stats, Dex numbers, rarity, set progress and First Spotter foils come from the real
 *   rules; then the nightly set repair.
 * - Build Score: the real calculator for every sample build, a season history per build and the rank rows (generation, Bundesland, groups
 *   ≥ 3, sample builds only): the nightly job never ranks samples (ADR-512 b), so the demo writes them and the read shows them only off
 *   production.
 * - XP from the members' own seeded activity with the real points, day cap and day maxima; badges by the real rules and metrics
 *   (sebastian.demo gets hidden ones and two unseen for the unlock toast).
 * - Car of the Day for the last 14 days, today and three days ahead (published at 18:00 Europe/Berlin, Bundesland round robin, the owner's
 *   first sentence as the story line); a sample pick is told to nobody.
 * - Five invite codes for sebastian.demo, two redeemed by sample members who joined later.
 * - Season Wrapped 2026-saison and 2026-jahr for sebastian.demo through WrappedGenerator.
 *
 * Idempotent: spots are keyed on (spotter, car), reactions and follows on their unique keys, photos on media.sample_source, posts and
 * notes on their text, XP and rank rows are rewritten from the data, badges and invites are only added, Car of the Day keeps a day it
 * has. Spots and Car of the Day follow the real calendar (the last 60 days, today), like the showcase's QR scans.
 *
 * @phpstan-type Showpiece array{stage: int, documented: int, before_after: int, notes: int, spot_weight: int, reactors: int, followers: int}
 * @phpstan-type GiftData array{cities: list<array{name: string, bundesland: string}>, showpieces: array<string, Showpiece>, cotd_days_back: int, cotd_days_ahead: int, invites_accepted_by: list<string>}
 * @phpstan-type CarPhoto array{file: string, path: string, alt: string|null, focal_x: float|null, focal_y: float|null, category: MediaCategory}
 */
class GiftDemoSeeder extends Seeder
{
    use SeedsFromData;

    public const SEASONS = ['2026-saison', '2026-jahr'];

    /**
     * The demo's Wrapped release dates (Europe/Berlin), published in the remote config `wrapped.releases` so ADM-37 lists them and the
     * member sees a season through the real release rule: the season already open, the year in its usual week.
     */
    public const RELEASES = ['2026-saison' => '2026-11-05 10:00', '2026-jahr' => '2026-12-28 10:00'];

    public const RELEASE_REASON = 'Demo: Wrapped-Freigaben der Saison 2026 (lokal/Staging, GiftDemoSeeder).';

    public const TIMEZONE = 'Europe/Berlin';

    /** Spots happen between 09:00 and 19:59 Berlin time: never a night spot in the demo (10 §16: nothing the owner sees is a night hit). */
    public const DAY_START = 9 * 60;

    public const DAY_END = 19 * 60 + 59;

    /** How far back spots go (days). */
    public const SPOT_DAYS = 60;

    /** A Bundesland without one of the twelve gift cities borrows its neighbour's. */
    private const NEIGHBOURS = ['SH' => 'HH', 'MV' => 'BE', 'BB' => 'BE', 'ST' => 'SN', 'TH' => 'SN', 'SL' => 'RP'];

    /** History checkpoints of a build's score over the 2026 season: [day, share of today's total]. */
    private const HISTORY = [['2026-02-20', 0.66], ['2026-04-18', 0.74], ['2026-06-13', 0.82], ['2026-08-08', 0.9], ['2026-10-24', 1.0]];

    private const BEFORE_AFTER = [
        'Vorher, nachher: {mod}. Hat sich gelohnt.',
        '{mod} ist drin. Erst das alte Foto, dann das neue.',
        'Endlich verbaut: {mod}. Der Unterschied ist größer als gedacht.',
    ];

    private ?string $photos = null;

    private CarbonImmutable $now;

    private CarbonImmutable $today;

    /** @var GiftData */
    private array $gift;

    /** @var array{notes: list<string>, tracks: list<string>} */
    private array $stories = ['notes' => [], 'tracks' => []];

    /** @var array<string, User> sample members (not the Editorial account) by username */
    private array $members = [];

    /** @var array<string, Vehicle> their published public builds by id */
    private array $cars = [];

    /** @var array<string, string> vehicle id => gift.json showpiece key */
    private array $keys = [];

    /** @var array<string, DeCity> gift city by Bundesland code (the first listed) */
    private array $cityByLand = [];

    /** @var list<DeCity> */
    private array $cities = [];

    /** @var array<string, array{width: int|null, height: int|null, focal_x: float|null, focal_y: float|null}> seed manifest by file */
    private array $manifest = [];

    private ShowcasePlates $plates;

    /** @var array<string, int|string> what this run did, for the summary */
    private array $done = [];

    /**
     * The seed photo folder of the showcase run (a test points it at its own).
     */
    public function withPhotos(string $directory): static
    {
        $this->photos = $directory;

        return $this;
    }

    public function run(): void
    {
        Showcase::assertEnvironment('GiftDemoSeeder');

        if (! User::query()->where('email', Showcase::showcaseEmail())->where('is_sample', true)->exists()) {
            throw new RuntimeException('GiftDemoSeeder needs the showcase: run php artisan db:seed --class=DemoShowcaseSeeder (it runs this seeder at its end).');
        }

        $started = microtime(true);
        $this->ensureReference();
        $this->load();

        $mailer = Mail::getFacadeRoot();
        Mail::fake();

        try {
            PublicationFanout::muted(function (): void {
                $this->decidePlates();
                $this->seedRegions();
                $this->done['dex_numbers'] = app(DexNumbers::class)->assignMissing();
                $this->seedShowpieces();
                $this->seedHighlights();
                $this->seedCommunity();
                $this->seedSpots();
                $this->seedScores();
                $this->seedRarity();
                $this->seedXp();
                // Invites before badges: "Crew Starter" counts accepted invites.
                $this->seedInvites();
                $this->seedBadges();
                $this->seedCarOfTheDay();
                $this->seedWrapped();
            });
        } finally {
            Mail::swap($mailer);
        }

        $this->say(sprintf('Gift demo ready in %.0f s: %s', microtime(true) - $started, json_encode($this->done, JSON_UNESCAPED_UNICODE)));
    }

    protected function photoDirectory(): string
    {
        return $this->photos ?? base_path('../design/seed-photos');
    }

    // ---------------------------------------------------------------------------------------------------------------------------
    // Setup

    private function ensureReference(): void
    {
        $missing = array_keys(array_filter([
            DeCitySeeder::class => ! DeCity::query()->exists(),
            DexSetSeeder::class => ! DexSet::query()->exists(),
            BadgeSeeder::class => ! Badge::query()->exists(),
        ]));

        if ($missing !== []) {
            $this->call($missing);
        }
    }

    private function load(): void
    {
        /** @var GiftData $gift */
        $gift = $this->readJson('showcase/gift.json');
        $this->gift = $gift;
        /** @var array{notes: list<string>, tracks: list<string>} $stories */
        $stories = $this->readJson('showcase/stories.json');
        $this->stories = $stories;
        $this->plates = ShowcasePlates::for($this->photoDirectory());
        $this->now = SeedClock::host()->setTimezone(self::TIMEZONE)->startOfMinute();
        $this->today = $this->now->startOfDay();

        $manifest = json_decode((string) @file_get_contents($this->photoDirectory().'/manifest.json'), true);

        foreach (is_array($manifest) ? $manifest : [] as $entry) {
            if (is_array($entry) && is_string($entry['file'] ?? null)) {
                $focal = is_array($entry['focal'] ?? null) ? $entry['focal'] : [];
                $this->manifest[$entry['file']] = [
                    'width' => is_int($entry['width'] ?? null) ? $entry['width'] : null,
                    'height' => is_int($entry['height'] ?? null) ? $entry['height'] : null,
                    'focal_x' => is_numeric($focal['x'] ?? null) ? (float) $focal['x'] : null,
                    'focal_y' => is_numeric($focal['y'] ?? null) ? (float) $focal['y'] : null,
                ];
            }
        }

        foreach (User::query()->where('is_sample', true)->where('is_editorial', false)->orderBy('username')->get() as $member) {
            $this->members[(string) $member->username] = $member;
        }

        $cars = Vehicle::query()
            ->whereIn('owner_id', array_map(fn (User $member): string => $member->id, $this->members))
            ->where('is_sample', true)
            ->where('status', VehicleStatus::Published)
            ->where('visibility', Visibility::Public)
            ->where('ghost_mode', false)
            ->with(['make', 'owner'])
            ->orderBy('public_id')
            ->get();

        foreach ($cars as $car) {
            $this->cars[$car->id] = $car;
        }

        foreach (array_keys($this->gift['showpieces']) as $key) {
            $car = $cars->firstWhere('public_id', DemoShowcaseSeeder::publicIdFor($key));

            if ($car instanceof Vehicle) {
                $this->keys[$car->id] = $key;
            }
        }

        $matcher = app(CityMatcher::class);

        foreach ($this->gift['cities'] as $row) {
            $city = $matcher->byName($row['name'], Bundesland::from($row['bundesland']));

            if (! $city instanceof DeCity) {
                $this->warn("Gift city [{$row['name']}] is not in de_cities: left out.");

                continue;
            }

            $this->cities[] = $city;
            $this->cityByLand[$row['bundesland']] ??= $city;
        }

        if ($this->cities === []) {
            throw new RuntimeException('None of the gift cities is in de_cities: run DeCitySeeder.');
        }
    }

    // ---------------------------------------------------------------------------------------------------------------------------
    // Plates (ADR-509)

    /**
     * Sample photos imported before M5.9f are `unchecked`: each goes through the pipeline once with its decision. Blurred: the
     * rectangles are pixelated into a new master and every variant is drawn again (MediaService::blur, the GAR-08 path), which removes
     * the pre-blur master and variants from both disks; the build's OG image and share cards are dropped. Declined: only the state.
     */
    private function decidePlates(): void
    {
        $service = app(MediaService::class);
        $og = app(OgImages::class);
        $owners = User::withTrashed()->where('is_sample', true)->pluck('id')->all();
        $counts = ['blurred' => 0, 'declined' => 0, 'left' => 0];

        $rows = Media::query()
            ->whereIn('owner_id', $owners)
            ->whereNotNull('sample_source')
            ->where('plate_blur', PlateBlurState::Unchecked)
            ->where('status', MediaStatus::Ready)
            ->get();

        foreach ($rows as $media) {
            $source = (string) $media->getAttribute('sample_source');
            $file = ShowcasePlates::fileOf($source);
            $choice = $file === null || ! $this->plates->has($file) ? PlateBlurChoice::unchecked()
                : (str_starts_with($source, 'avatar:') ? $this->avatarChoice($file) : $this->plates->choice($file));

            if ($choice->state === PlateBlurState::Unchecked) {
                $counts['left']++;

                continue;
            }

            if ($choice->state === PlateBlurState::Declined) {
                $media->forceFill(['plate_blur' => PlateBlurState::Declined]);
                $media->timestamps = false;
                $media->save();
                $counts['declined']++;

                continue;
            }

            $media->forceFill(['plate_blur' => PlateBlurState::Blurred, 'blur_regions' => $choice->regions])->save();
            $service->blur($media);
            $counts['blurred']++;

            $parent = $media->mediable;
            $vehicle = $parent instanceof Vehicle ? $parent : ($parent instanceof Modification ? $parent->vehicle : null);

            if ($vehicle instanceof Vehicle) {
                $og->purge($vehicle);
            }

            $owner = User::query()->find($media->owner_id);

            if ($owner instanceof User && ($parent instanceof User || $owner->getAttribute('cover_media_id') === $media->getKey())) {
                $og->purge($owner);
            }
        }

        if ($counts['left'] > 0) {
            $this->warn("{$counts['left']} sample photos have no entry in the plate decisions (database/data/showcase/plates.json) and stay unchecked.");
        }

        $this->done['plates'] = "{$counts['blurred']} blurred, {$counts['declined']} declined, {$counts['left']} left";
    }

    /**
     * An avatar is the square DemoShowcaseSeeder cut around the photo's focal point: the rectangles moved into it.
     */
    private function avatarChoice(string $file): PlateBlurChoice
    {
        $path = $this->photoPath($file);
        $size = $path === null ? false : @getimagesize($path);
        $meta = $this->manifest[$file] ?? ['focal_x' => null, 'focal_y' => null];

        if ($size === false) {
            return PlateBlurChoice::unchecked();
        }

        [$x, $y, $side] = ShowcasePlates::squareAround($size[0], $size[1], $meta['focal_x'], $meta['focal_y']);

        return $this->plates->forCrop($file, $size[0], $size[1], $x, $y, $side, $side);
    }

    private function photoPath(string $file): ?string
    {
        $raw = rtrim($this->photoDirectory(), '/').'/'.$file;

        return ShowcasePhotos::gradedPath($this->photoDirectory(), $file) ?? (is_file($raw) ? $raw : null);
    }

    // ---------------------------------------------------------------------------------------------------------------------------
    // Members

    /**
     * The Bundesland of the member's city (de_cities; SET-11 sets it the same way) and the activation moment the M5.9d backfill gives an
     * account that was verified before (a fresh install seeds the showcase after that migration).
     */
    private function seedRegions(): void
    {
        $matcher = app(CityMatcher::class);

        foreach (User::query()->where('is_sample', true)->get() as $member) {
            $changes = [];

            // ADR-514: the Bundesland (public on rank lines) comes from the public profile city only, exactly as the app derives it.
            $land = $matcher->bundeslandFor($member)?->value;
            $current = $member->getRawOriginal('bundesland');

            if ($land !== $current) {
                $changes['bundesland'] = $land;
            }

            if ($land === null && ! $member->getAttribute('is_editorial')) {
                $this->warn("Sample member [{$member->username}] has no public city in de_cities: no Bundesland, so no Bundesland rank or Car of the Day rotation.");
            }

            if ($member->getAttribute('activated_at') === null && $member->getAttribute('email_verified_at') !== null) {
                $changes['activated_at'] = $member->getAttribute('email_verified_at');
            }

            if ($changes !== []) {
                DB::table('users')->where('id', $member->id)->update($changes);
            }
        }

        $byId = [];

        foreach ($this->members as $username => $member) {
            $this->members[$username] = $byId[$member->id] = $member->refresh();
        }

        foreach ($this->cars as $car) {
            if (isset($byId[$car->owner_id])) {
                $car->setRelation('owner', $byId[$car->owner_id]);
            }
        }
    }

    // ---------------------------------------------------------------------------------------------------------------------------
    // Showpieces: documented mods, before/after, notes

    private function seedShowpieces(): void
    {
        $counts = ['mod_photos' => 0, 'before_after' => 0, 'notes' => 0];

        foreach ($this->keys as $id => $key) {
            $car = $this->cars[$id];
            $owner = $car->owner;
            $photos = $this->carPhotos($car);

            if (! $owner instanceof User || $photos === []) {
                continue;
            }

            $spec = $this->gift['showpieces'][$key];
            $counts['mod_photos'] += $this->documentMods($car, $owner, $photos, $spec['documented']);
            $counts['before_after'] += $this->beforeAfter($car, $owner, $photos, $spec['before_after']);
            $counts['notes'] += $this->extraNotes($car, $key, $spec['notes']);
        }

        $this->done += $counts;
    }

    /**
     * VEH-01 / GAR-02 "Highlights" of the showcase account's public builds (09 §8.5): its newest public post (else note, else any
     * update everybody may read) and two photos (gallery after the cover, then the build's post photos; never the same picture twice),
     * pinned through SetHighlights, which replaces the list: the same data pins the same items on every run.
     */
    private function seedHighlights(): void
    {
        $showcase = $this->members[Showcase::SHOWCASE_USERNAME] ?? null;
        $pinned = 0;

        foreach ($this->cars as $car) {
            if (! $showcase instanceof User || $car->owner_id !== $showcase->id) {
                continue;
            }

            $update = BuildUpdate::query()->where('vehicle_id', $car->id)->where('hidden', false)
                ->where(fn ($query) => $query->whereNull('audience')->orWhere('audience', '!=', BuildUpdateAudience::Followers->value))
                ->orderByRaw('CASE type WHEN ? THEN 0 WHEN ? THEN 1 ELSE 2 END', [BuildUpdateType::Post->value, BuildUpdateType::Note->value])
                ->orderByDesc('created_at')->orderByDesc('id')
                ->first();
            $posts = BuildUpdate::query()->select('id')->where('vehicle_id', $car->id)->where('hidden', false)
                ->where(fn ($query) => $query->whereNull('audience')->orWhere('audience', '!=', BuildUpdateAudience::Followers->value));
            $candidates = Media::query()->usablePhoto()
                ->where(fn ($parent) => $parent
                    ->where(fn ($own) => $own->where('mediable_type', $car->getMorphClass())->where('mediable_id', $car->id))
                    ->orWhere(fn ($post) => $post->where('mediable_type', (new BuildUpdate)->getMorphClass())->whereIn('mediable_id', $posts)))
                ->orderByRaw('CASE WHEN mediable_type = ? THEN 0 ELSE 1 END', [$car->getMorphClass()])
                ->orderBy('sort')->orderBy('id')
                ->get();
            $photos = [];
            $seen = [];

            // The cover leads the page already: the rail starts with what the page does not show first.
            foreach ($candidates->sortBy(fn (Media $media): int => $media->id === $car->cover_media_id ? 1 : 0)->values() as $media) {
                $hash = $media->getAttribute('blurhash');

                if (count($photos) < 2 && ! (is_string($hash) && in_array($hash, $seen, true))) {
                    $photos[] = $media;
                    $seen[] = $hash;
                }
            }

            $items = [
                ...($update instanceof BuildUpdate ? [['type' => HighlightItemType::BuildUpdate->value, 'id' => (string) $update->id]] : []),
                ...array_map(fn (Media $media): array => ['type' => HighlightItemType::Photo->value, 'id' => (string) $media->id], $photos),
            ];

            if ($items !== []) {
                app(SetHighlights::class)->handle($car, $items);
                $pinned++;
            }
        }

        $this->done['highlights'] = $pinned;
    }

    /**
     * The build's own gallery photos (its seed shoot), cover first.
     *
     * @return list<CarPhoto>
     */
    private function carPhotos(Vehicle $car): array
    {
        $photos = [];
        $media = Media::query()->where('mediable_type', $car->getMorphClass())->where('mediable_id', $car->id)
            ->whereNotNull('sample_source')->usablePhoto()->orderBy('sort')->orderBy('id')->get();

        foreach ($media as $row) {
            $file = ShowcasePlates::fileOf((string) $row->getAttribute('sample_source'));
            $path = $file === null ? null : $this->photoPath($file);

            if ($file !== null && $path !== null) {
                $photos[] = [
                    'file' => $file,
                    'path' => $path,
                    'alt' => is_string($row->getAttribute('alt')) ? $row->getAttribute('alt') : null,
                    'focal_x' => is_numeric($row->getAttribute('focal_x')) ? (float) $row->getAttribute('focal_x') : null,
                    'focal_y' => is_numeric($row->getAttribute('focal_y')) ? (float) $row->getAttribute('focal_y') : null,
                    'category' => $row->getAttribute('category') instanceof MediaCategory ? $row->getAttribute('category') : MediaCategory::Other,
                ];
            }
        }

        return $photos;
    }

    /**
     * The first $count installed, branded, dated mods get a photo of the car (round robin over its shoot), so they count as documented
     * (BuildScoreInputs::isDocumented). Returns the photos added.
     *
     * @param  list<CarPhoto>  $photos
     */
    private function documentMods(Vehicle $car, User $owner, array $photos, int $count): int
    {
        $mods = Modification::query()->where('vehicle_id', $car->id)->where('status', ModStatus::Installed)
            ->whereNotNull('brand_id')->whereNotNull('installed_on')->orderBy('sort')->orderBy('id')->limit($count)->get();
        $published = $this->publishedAt($car);
        $added = 0;

        foreach ($mods->values() as $index => $mod) {
            if (Media::query()->where('mediable_type', $mod->getMorphClass())->where('mediable_id', $mod->id)->whereNotNull('sample_source')->exists()) {
                continue;
            }

            $photo = $photos[$index % count($photos)];
            $installed = CarbonImmutable::parse((string) $mod->getRawOriginal('installed_on'), self::TIMEZONE)->setTime(19, 10 + $index);
            $at = $installed->max($published->addHours(2 + $index))->min($this->now->subDays(2));
            $this->store($photo, $owner, $mod, $at, 'mod:'.$photo['file'], 1);
            $added++;
        }

        return $added;
    }

    /**
     * Before/after posts in the 2026 season (M5.9c `before_after`, linked to an installed mod, two photos of the car paired in order).
     *
     * @param  list<CarPhoto>  $photos
     */
    private function beforeAfter(Vehicle $car, User $owner, array $photos, int $count): int
    {
        if ($count < 1 || count($photos) < 2) {
            return 0;
        }

        $mods = Modification::query()->where('vehicle_id', $car->id)->where('status', ModStatus::Installed)->whereNotNull('brand_id')
            ->orderByDesc('installed_on')->orderByDesc('sort')->limit($count)->get()->values();
        $days = $this->seasonDays($car, $count, '2026-04-12', '2026-10-18');
        $added = 0;

        foreach ($mods as $index => $mod) {
            $text = strtr(self::BEFORE_AFTER[$index % count(self::BEFORE_AFTER)], ['{mod}' => (string) $mod->getAttribute('title')]);

            if (BuildUpdate::query()->where('vehicle_id', $car->id)->where('kind', BuildUpdateKind::BeforeAfter)->where('note', $text)->exists() || ! isset($days[$index])) {
                continue;
            }

            $at = $days[$index]->setTime(18, 20 + $index);
            $update = SeedClock::at($at, fn (): BuildUpdate => app(PostBuildUpdate::class)->handle($owner, $car, [
                'text' => $text,
                'kind' => BuildUpdateKind::BeforeAfter->value,
                'modification_ids' => [(string) $mod->id],
                'happened_on' => $at->toDateString(),
            ]));
            $before = $this->store($photos[$index % count($photos)], $owner, $update, $at->addMinute(), 'update-before:'.$photos[$index % count($photos)]['file'], 1);
            $after = $this->store($photos[($index + 1) % count($photos)], $owner, $update, $at->addMinutes(2), 'update-after:'.$photos[($index + 1) % count($photos)]['file'], 2);
            $update->forceFill(['photo_pairs' => [[(string) $before->id, (string) $after->id]]]);
            $update->timestamps = false;
            $update->save();
            $added++;
        }

        return $added;
    }

    /**
     * Owner notes from the showcase's story pool, in the season and before the build's newest showcase note (which carries that run's
     * photo: DemoShowcaseSeeder::enrichNotes must find the same newest note on a re-run).
     */
    private function extraNotes(Vehicle $car, string $key, int $count): int
    {
        $notes = $this->stories['notes'];
        $tracks = $this->stories['tracks'];

        if ($count < 1 || $notes === [] || $tracks === []) {
            return 0;
        }

        $newest = BuildUpdate::query()->where('vehicle_id', $car->id)->where('type', BuildUpdateType::Note)->max('created_at');
        $until = is_string($newest) ? CarbonImmutable::parse($newest)->setTimezone(self::TIMEZONE)->subDay()->format('Y-m-d') : '2026-10-18';
        $days = $this->seasonDays($car, $count, '2026-03-21', min('2026-10-18', $until));
        $mods = Modification::query()->where('vehicle_id', $car->id)->where('status', ModStatus::Installed)->orderBy('sort')->pluck('title')->all();
        $added = 0;
        $have = 0;

        for ($i = 0; $i < count($notes) && $have < $count && isset($days[$have]); $i++) {
            $template = $notes[(DemoShowcaseSeeder::pick("gift-note:$key", 0, count($notes) - 1) + $i) % count($notes)];
            $text = strtr($template, [
                '{mod}' => $mods === [] ? 'das neue Teil' : (string) $mods[($i + $have) % count($mods)],
                '{track}' => $tracks[DemoShowcaseSeeder::pick("gift-track:$key:$i", 0, count($tracks) - 1)],
            ]);

            if (BuildUpdate::query()->where('vehicle_id', $car->id)->where('type', BuildUpdateType::Note)->where('note', $text)->exists()) {
                // Already there (this or an earlier run): it counts towards the notes wanted only when this seeder wrote it.
                if (BuildUpdate::query()->where('vehicle_id', $car->id)->where('type', BuildUpdateType::Note)->where('note', $text)->where('created_at', $days[$have]->setTime(20, 5 + $have)->utc())->exists()) {
                    $have++;
                }

                continue;
            }

            app(BuildUpdates::class)->note($car, $text, $days[$have]->setTime(20, 5 + $have)->utc());
            $have++;
            $added++;
        }

        return $added;
    }

    /**
     * $count days spread evenly in [$from, $until] (Berlin dates), never before the build went online + 2 days or after 3 days ago.
     *
     * @return list<CarbonImmutable>
     */
    private function seasonDays(Vehicle $car, int $count, string $from, string $until): array
    {
        $start = CarbonImmutable::parse($from, self::TIMEZONE)->max($this->publishedAt($car)->addDays(2)->startOfDay());
        $end = CarbonImmutable::parse($until, self::TIMEZONE)->min($this->today->subDays(3));

        if ($count < 1 || $end->lt($start)) {
            return [];
        }

        $span = (int) $start->diffInDays($end);
        $days = [];

        for ($i = 0; $i < $count; $i++) {
            $days[] = $start->addDays($count === 1 ? intdiv($span, 2) : intdiv($span * $i, $count - 1));
        }

        return $days;
    }

    /**
     * A photo through the media pipeline with its plate decision, remembered by its sample source.
     *
     * @param  CarPhoto  $photo
     */
    private function store(array $photo, User $owner, Modification|BuildUpdate $mediable, CarbonImmutable $at, string $source, int $sort): Media
    {
        $media = SeedClock::at($at, fn (): Media => app(MediaService::class)->storeFromPath($photo['path'], $owner, $mediable, [
            'alt' => $photo['alt'],
            'focal_x' => $photo['focal_x'],
            'focal_y' => $photo['focal_y'],
            'category' => $photo['category'],
            'sort' => $sort,
        ], $this->plates->choice($photo['file'])));
        $media->forceFill(['sample_source' => $source, 'moderation_status' => ModerationStatus::Approved]);
        $media->timestamps = false;
        $media->save();

        return $media;
    }

    private function publishedAt(Vehicle $car): CarbonImmutable
    {
        $published = $car->getAttribute('published_at') ?? $car->getAttribute('created_at');

        return CarbonImmutable::parse((string) $published)->setTimezone(self::TIMEZONE);
    }

    // ---------------------------------------------------------------------------------------------------------------------------
    // Community: reactions and follows among sample members (owner-only counts)

    private function seedCommunity(): void
    {
        $reactions = 0;
        $follows = 0;
        $types = ReactionType::cases();

        foreach ($this->cars as $car) {
            $pid = (string) $car->public_id;
            $spec = isset($this->keys[$car->id]) ? $this->gift['showpieces'][$this->keys[$car->id]] : null;
            $people = $this->ordered($car, "community:$pid");
            $published = $this->publishedAt($car);
            $days = max(1, (int) $published->diffInDays($this->today));

            foreach (array_slice($people, 0, $spec['reactors'] ?? DemoShowcaseSeeder::pick("reactors:$pid", 1, 9)) as $index => $member) {
                $at = $published->addDays(DemoShowcaseSeeder::pick("react-day:$pid:{$member->id}", 0, $days))->setTime(DemoShowcaseSeeder::pick("react-h:$pid:$index", 10, 21), 12)->min($this->now->subHour());
                $reactions += DB::table('reactions')->insertOrIgnore([
                    'user_id' => $member->id,
                    'reactable_type' => $car->getMorphClass(),
                    'reactable_id' => $car->id,
                    'type' => $types[DemoShowcaseSeeder::pick("react-type:$pid:{$member->id}", 0, count($types) - 1)]->value,
                    'created_at' => $at->utc(),
                    'updated_at' => $at->utc(),
                ]);
            }

            foreach (array_slice($this->ordered($car, "follow:$pid"), 0, $spec['followers'] ?? DemoShowcaseSeeder::pick("followers:$pid", 0, 7)) as $member) {
                $at = $published->addDays(DemoShowcaseSeeder::pick("follow-day:$pid:{$member->id}", 0, $days))->setTime(20, 30)->min($this->now->subHour());
                $follows += DB::table('vehicle_follows')->insertOrIgnore(['user_id' => $member->id, 'vehicle_id' => $car->id, 'created_at' => $at->utc()]);
            }
        }

        $this->done['reactions'] = $reactions;
        $this->done['vehicle_follows'] = $follows;
    }

    /**
     * The sample members other than the car's owner in a fixed order of their own for $seed.
     *
     * @return list<User>
     */
    private function ordered(Vehicle $car, string $seed): array
    {
        $people = array_values(array_filter($this->members, fn (User $member): bool => $member->id !== $car->owner_id));
        usort($people, fn (User $a, User $b): int => DemoShowcaseSeeder::pick("$seed:{$a->username}", 0, 99999) <=> DemoShowcaseSeeder::pick("$seed:{$b->username}", 0, 99999));

        return $people;
    }

    // ---------------------------------------------------------------------------------------------------------------------------
    // STREET DEX spots

    /**
     * Every car gets its spotters in a fixed order (its first three keep the First Spotter foil); sebastian.demo spots about 60 % of
     * the cars, early on about a third of them. Each spot goes through RecordSpot at its own moment, oldest first.
     */
    private function seedSpots(): void
    {
        $showcase = $this->members[Showcase::SHOWCASE_USERNAME] ?? null;
        $taken = [];

        foreach (DB::table('spots')->whereIn('vehicle_id', array_keys($this->cars))->get(['vehicle_id', 'spotter_id']) as $row) {
            $taken[$row->vehicle_id.'|'.$row->spotter_id] = true;
        }

        $plan = [];
        $sequence = 0;

        foreach ($this->cars as $car) {
            $pid = (string) $car->public_id;
            $key = $this->keys[$car->id] ?? null;
            $weight = $key === null ? DemoShowcaseSeeder::pick("spots:$pid", 2, 11) : $this->gift['showpieces'][$key]['spot_weight'];
            $people = array_values(array_filter($this->ordered($car, "spot-order:$pid"), fn (User $member): bool => $member->id !== $showcase?->id));
            $withShowcase = $showcase instanceof User && $car->owner_id !== $showcase->id && ($key !== null || DemoShowcaseSeeder::pick("seb:$pid", 0, 99) < 60);
            $list = array_slice($people, 0, max(1, $withShowcase ? $weight - 1 : $weight));

            if ($withShowcase) {
                $early = DemoShowcaseSeeder::pick("seb-early:$pid", 0, 99) < 35;
                $position = $early ? DemoShowcaseSeeder::pick("seb-pos:$pid", 0, 2) : DemoShowcaseSeeder::pick("seb-late:$pid", 3, max(3, count($list)));
                array_splice($list, min($position, count($list)), 0, [$showcase]);
            }

            $home = $this->homeCity($car);
            $back = self::SPOT_DAYS - DemoShowcaseSeeder::pick("spot-start:$pid", 0, $key === null ? 40 : 6);
            $minute = self::DAY_START + DemoShowcaseSeeder::pick("spot-min:$pid", 0, 300);

            foreach ($list as $index => $spotter) {
                if ($index > 0) {
                    $step = DemoShowcaseSeeder::pick("spot-step:$pid:$index", 0, $key === null ? 4 : 2);
                    $back = max(1, $back - $step);
                    $minute = $step === 0 ? $minute + DemoShowcaseSeeder::pick("spot-gap:$pid:$index", 25, 95) : self::DAY_START + DemoShowcaseSeeder::pick("spot-min:$pid:$index", 0, 600);

                    if ($minute > self::DAY_END && $back > 1) {
                        $back--;
                        $minute = self::DAY_START + DemoShowcaseSeeder::pick("spot-early:$pid:$index", 0, 120);
                    }
                }

                $minute = min($minute, self::DAY_END);
                $plan[] = [
                    'at' => $this->today->subDays($back)->addMinutes($minute),
                    'seq' => $sequence++,
                    'spotter' => $spotter,
                    'car' => $car,
                    'city' => $this->spotCity($car, $spotter, $home),
                ];
            }
        }

        usort($plan, fn (array $a, array $b): int => [$a['at'], $a['seq']] <=> [$b['at'], $b['seq']]);
        $codes = QrCode::query()->whereIn('vehicle_id', array_keys($this->cars))->where('status', QrStatus::Active)->pluck('code', 'vehicle_id')->all();
        $recorded = 0;
        $refused = 0;

        $plan = array_values(array_filter($plan, fn (array $spot): bool => ! isset($taken[$spot['car']->id.'|'.$spot['spotter']->id]) && is_string($codes[$spot['car']->id] ?? null)));
        // The follow-up jobs a spot queues (Build Score recompute, the owner's badge check) are done below in one go: Build Score
        // synchronously, badges are not the awarder's for samples. Under the moving seed clock their uniqueness locks expire at once, so
        // queued they would be one pair of jobs per spot. Spots are written in batches of 50 per transaction (one commit each).
        $queue = Queue::getFacadeRoot();
        Queue::fake();

        try {
            foreach (array_chunk($plan, 50) as $batch) {
                DB::transaction(function () use ($batch, $codes, &$recorded, &$refused): void {
                    foreach ($batch as $spot) {
                        $car = $spot['car'];

                        try {
                            SeedClock::at($spot['at']->utc(), fn () => app(RecordSpot::class)->handle($spot['spotter'], ['code' => (string) $codes[$car->id], 'city_id' => $spot['city']->id]));
                            $recorded++;
                        } catch (ApiException $exception) {
                            $refused++;
                            $this->warn("Spot of {$car->public_id} by {$spot['spotter']->username} refused: {$exception->getMessage()}");
                        }
                    }
                });
            }
        } finally {
            Queue::swap($queue);
        }

        // The nightly repair (DexNightly `sets`), now: every set from the Dex as it reads today.
        $sets = app(DexSets::class);

        foreach ($this->members as $member) {
            $sets->repair($member);
        }

        $this->done['spots'] = $recorded;
        $this->done['spots_refused'] = $refused;
    }

    /**
     * Where the car usually is: the gift city of its owner's Bundesland (or the neighbour's), else one from the car's id.
     */
    private function homeCity(Vehicle $car): DeCity
    {
        $land = $car->owner?->getAttribute('bundesland');
        $land = $land instanceof Bundesland ? $land->value : (is_string($land) ? $land : null);

        if ($land !== null) {
            $city = $this->cityByLand[$land] ?? $this->cityByLand[self::NEIGHBOURS[$land] ?? ''] ?? null;

            if ($city instanceof DeCity) {
                return $city;
            }
        }

        return $this->cities[DemoShowcaseSeeder::pick('home:'.$car->public_id, 0, count($this->cities) - 1)];
    }

    /**
     * Mostly where the car lives, sometimes at a meet elsewhere; sebastian.demo spots a lot at home in München.
     */
    private function spotCity(Vehicle $car, User $spotter, DeCity $home): DeCity
    {
        $pid = (string) $car->public_id;

        if ($spotter->username === Showcase::SHOWCASE_USERNAME && DemoShowcaseSeeder::pick("seb-city:$pid", 0, 99) < 45) {
            return $this->cityByLand['BY'] ?? $home;
        }

        return DemoShowcaseSeeder::pick("city:$pid:{$spotter->username}", 0, 99) < 70
            ? $home
            : $this->cities[DemoShowcaseSeeder::pick("city-any:$pid:{$spotter->username}", 0, count($this->cities) - 1)];
    }

    // ---------------------------------------------------------------------------------------------------------------------------
    // Build Score: computed, its season history, ranks among sample builds

    private function seedScores(): void
    {
        $scores = app(BuildScores::class);
        $all = Vehicle::query()->where('is_sample', true)->where('status', VehicleStatus::Published)->pluck('id')->all();

        foreach ($all as $id) {
            $scores->recompute((string) $id);
        }

        $totals = BuildScore::query()->whereIn('vehicle_id', array_keys($this->cars))->pluck('total', 'vehicle_id')->map(fn (mixed $total): int => (int) $total)->all();
        $history = [];

        foreach ($this->cars as $id => $car) {
            $total = $totals[$id] ?? null;

            if ($total === null) {
                continue;
            }

            $first = $this->publishedAt($car)->addDays(3)->startOfDay();
            $points = [];

            if ($first->lt($this->today)) {
                $points[$first->toDateString()] = (int) round($total * 0.45);
            }

            foreach (self::HISTORY as [$day, $share]) {
                if ($day > $first->toDateString() && $day < $this->today->toDateString()) {
                    $points[$day] = (int) round($total * $share);
                }
            }

            $points[$this->today->toDateString()] = $total;

            foreach ($points as $day => $value) {
                $history[] = ['vehicle_id' => $id, 'day' => $day, 'total' => $value];
            }
        }

        foreach (array_chunk($history, 200) as $chunk) {
            DB::table('build_score_history')->upsert($chunk, ['vehicle_id', 'day'], ['total']);
        }

        $this->done['build_score_stages'] = json_encode(BuildScore::query()->whereIn('vehicle_id', array_keys($this->cars))->groupBy('stage')->orderBy('stage')->selectRaw('stage, count(*) as n')->pluck('n', 'stage')->all()) ?: '';
        $this->seedRanks($totals);
    }

    /**
     * Rank rows like the nightly's (equal totals share a rank, groups of at least build_score.ranks.min_group), among the sample
     * builds only: by generation and by the owner's Bundesland. Rows of sample builds are rewritten on every run.
     *
     * @param  array<string, int>  $totals
     */
    private function seedRanks(array $totals): void
    {
        $groups = [];

        foreach ($this->cars as $id => $car) {
            if (! isset($totals[$id])) {
                continue;
            }

            $generation = $car->getAttribute('generation_id');
            $land = $car->owner?->getAttribute('bundesland');
            $land = $land instanceof Bundesland ? $land->value : (is_string($land) ? $land : null);

            if ($generation !== null) {
                $groups[BuildScoreRankScope::Generation->value.'|'.$generation][$id] = $totals[$id];
            }

            if ($land !== null) {
                $groups[BuildScoreRankScope::Bundesland->value.'|'.$land][$id] = $totals[$id];
            }
        }

        $min = max(1, config()->integer('speedclub.build_score.ranks.min_group'));
        $rows = [];
        $now = CarbonImmutable::now();

        foreach ($groups as $group => $members) {
            if (count($members) < $min) {
                continue;
            }

            [$scope, $key] = explode('|', $group, 2);

            foreach ($members as $id => $total) {
                $rows[] = [
                    'vehicle_id' => $id,
                    'scope' => $scope,
                    'scope_key' => $key,
                    'rank' => 1 + count(array_filter($members, fn (int $other): bool => $other > $total)),
                    'group_size' => count($members),
                    'computed_at' => $now,
                ];
            }
        }

        DB::transaction(function () use ($rows): void {
            DB::table('build_score_ranks')->whereIn('vehicle_id', Vehicle::withTrashed()->where('is_sample', true)->select('id'))->delete();

            foreach (array_chunk($rows, 200) as $chunk) {
                DB::table('build_score_ranks')->insert($chunk);
            }
        });

        $this->done['rank_rows'] = count($rows);
    }

    private function seedRarity(): void
    {
        $rarity = app(RarityRules::class);
        $tiers = [];

        foreach (Vehicle::query()->where('is_sample', true)->where('status', VehicleStatus::Published)->get() as $car) {
            $tier = $rarity->refresh($car)->value;
            $tiers[$tier] = ($tiers[$tier] ?? 0) + 1;
        }

        ksort($tiers);
        $this->done['rarity'] = json_encode($tiers) ?: '';
    }

    // ---------------------------------------------------------------------------------------------------------------------------
    // XP, levels, badges

    /**
     * Samples earn nothing through the hooks (Xp::eligible), so the ledger is written from each member's own seeded activity with the
     * real points, the 200 XP Berlin-day cap and the day maxima (Xp::award's arithmetic), oldest first; users.xp is its sum.
     */
    private function seedXp(): void
    {
        $cap = config()->integer('speedclub.xp.daily_cap');
        $inputs = app(BuildScoreInputs::class);
        $levels = [];

        foreach ($this->members as $member) {
            $events = [];
            $cars = Vehicle::query()->where('owner_id', $member->id)->where('status', VehicleStatus::Published)->get();
            $first = $cars->min(fn (Vehicle $car): string => (string) $car->getAttribute('published_at'));

            if (is_string($first) && $first !== '') {
                $events[] = [CarbonImmutable::parse($first), XpType::FirstVehicle, 'user', $member->id];
            }

            foreach ($cars as $car) {
                foreach ($inputs->documentedModIds($car) as $modId) {
                    $at = Media::query()->where('mediable_type', (new Modification)->getMorphClass())->where('mediable_id', $modId)->usablePhoto()->min('created_at');
                    $events[] = [CarbonImmutable::parse(is_string($at) ? $at : (string) $car->getAttribute('published_at')), XpType::DocumentedMod, 'modification', $modId];
                }

                $updates = BuildUpdate::query()->where('vehicle_id', $car->id)->where('hidden', false)
                    ->whereIn('type', [BuildUpdateType::Note->value, BuildUpdateType::Post->value])->get(['id', 'created_at']);

                foreach ($updates as $update) {
                    $events[] = [CarbonImmutable::parse((string) $update->getAttribute('created_at')), XpType::BuildUpdate, 'build_update', (string) $update->id];
                }
            }

            foreach (DB::table('spots')->where('spotter_id', $member->id)->where('counted', true)->whereNull('deleted_at')->get(['id', 'created_at']) as $spot) {
                $events[] = [CarbonImmutable::parse((string) $spot->created_at), XpType::NewSpot, 'spot', (string) $spot->id];
            }

            foreach (DB::table('user_set_progress')->where('user_id', $member->id)->whereNotNull('completed_at')->get(['set_key', 'period', 'completed_at']) as $set) {
                $events[] = [CarbonImmutable::parse((string) $set->completed_at), XpType::SetCompleted, 'dex_set', $set->period === '' ? $set->set_key : $set->set_key.':'.$set->period];
            }

            usort($events, fn (array $a, array $b): int => [$a[0], $a[1]->value, $a[3]] <=> [$b[0], $b[1]->value, $b[3]]);
            $rows = [];
            $day = [];
            $dayType = [];

            foreach ($events as [$at, $type, $refType, $refId]) {
                $date = $at->setTimezone(self::TIMEZONE)->toDateString();
                $left = max(0, $cap - ($day[$date] ?? 0));
                $max = $type->dailyMax();

                if ($max !== null) {
                    $left = min($left, max(0, $max - ($dayType[$date.'|'.$type->value] ?? 0)));
                }

                $points = min($type->points(), $left);
                $day[$date] = ($day[$date] ?? 0) + $points;
                $dayType[$date.'|'.$type->value] = ($dayType[$date.'|'.$type->value] ?? 0) + $points;
                $rows[$type->value.'|'.$refType.'|'.$refId] = [
                    'user_id' => $member->id,
                    'type' => $type->value,
                    'points' => $points,
                    'capped' => $points < $type->points(),
                    'ref_type' => $refType,
                    'ref_id' => $refId,
                    'day' => $date,
                    'created_at' => $at->utc(),
                ];
            }

            $xp = array_sum(array_column($rows, 'points'));

            DB::transaction(function () use ($member, $rows, $xp): void {
                DB::table('xp_events')->where('user_id', $member->id)->delete();

                foreach (array_chunk(array_values($rows), 200) as $chunk) {
                    DB::table('xp_events')->insert($chunk);
                }

                DB::table('users')->where('id', $member->id)->update(['xp' => $xp]);
            });

            $member->forceFill(['xp' => $xp])->syncOriginalAttribute('xp');
            $level = 1;

            foreach (config()->array('speedclub.xp.levels') as $step => $threshold) {
                $level = $xp >= (int) $threshold ? (int) $step : $level;
            }

            $levels[$level] = ($levels[$level] ?? 0) + 1;
        }

        ksort($levels);
        $this->done['levels'] = json_encode($levels) ?: '';
    }

    /**
     * The badges each sample member has earned by the real rules (BadgeRules over BadgeMetrics, which BadgeAwarder skips for samples).
     * Only added, never taken back. sebastian.demo's two newest (hidden first) stay unseen with their badge_unlocked row, so the app shows
     * the unlock toast once; every other award is marked seen.
     */
    private function seedBadges(): void
    {
        $rules = app(BadgeRules::class);
        $metrics = app(BadgeMetrics::class);
        $ids = array_values(array_map(fn (User $member): string => $member->id, $this->members));
        $earned = [];

        foreach (Badge::query()->where('active', true)->orderBy('sort')->orderBy('key')->get() as $badge) {
            $rule = $rules->read($badge->rule_json);

            if ($rule === null) {
                continue;
            }

            $values = $metrics->values(BadgeMetric::from($rule['metric']), $rule['set'] ?? null, $ids);

            foreach ($this->members as $username => $member) {
                if ($rules->matches($rule, $values[$member->id] ?? 0)) {
                    $earned[$username][] = $badge;
                }
            }
        }

        $added = 0;

        foreach ($earned as $username => $badges) {
            $member = $this->members[$username];
            $fresh = [];

            if ($username === Showcase::SHOWCASE_USERNAME) {
                $order = $badges;
                usort($order, fn (Badge $a, Badge $b): int => [$b->hidden ? 1 : 0, $b->sort] <=> [$a->hidden ? 1 : 0, $a->sort]);
                $fresh = array_map(fn (Badge $badge): string => $badge->key, array_slice($order, 0, 2));
            }

            foreach ($badges as $badge) {
                $position = array_search($badge->key, $fresh, true);
                $awarded = $position === false
                    ? $this->today->subDays(DemoShowcaseSeeder::pick("badge:{$badge->key}:$username", 4, 55))->setTime(19, DemoShowcaseSeeder::pick("badge-m:{$badge->key}:$username", 0, 59))
                    : $this->now->subHours(3 + 22 * $position);
                $inserted = DB::table('user_badges')->insertOrIgnore([
                    'user_id' => $member->id,
                    'badge_key' => $badge->key,
                    'awarded_at' => $awarded->utc(),
                    'source_ref' => 'nightly',
                    'seen_at' => $position === false ? $awarded->addHours(2)->utc() : null,
                ]) === 1;

                // The two the demo keeps new are new again on every run (a demo session marks them seen).
                if ($position !== false) {
                    DB::table('user_badges')->where('user_id', $member->id)->where('badge_key', $badge->key)->whereNotNull('seen_at')->update(['seen_at' => null]);
                }

                // DemoShowcaseSeeder rewrites the sample notifications on every run: an unseen award gets its row again (grouped, so once).
                $unseen = $position !== false ? DB::table('user_badges')->where('user_id', $member->id)->where('badge_key', $badge->key)->whereNull('seen_at')->value('awarded_at') : null;

                if ($unseen !== null) {
                    SeedClock::at(CarbonImmutable::parse((string) $unseen), fn () => app(Notifier::class)->badgeUnlocked($member, $badge, false));
                }

                $added += $inserted ? 1 : 0;
            }

            // Only those two: one that was new on an earlier run (before a newer badge took its place) counts as seen now.
            if ($username === Showcase::SHOWCASE_USERNAME) {
                DB::table('user_badges')->where('user_id', $member->id)->whereNotIn('badge_key', $fresh)->whereNull('seen_at')->update(['seen_at' => DB::raw('awarded_at')]);
            }
        }

        $this->done['badges_added'] = $added;
        $this->done['showcase_badges'] = implode(', ', array_map(fn (Badge $badge): string => $badge->key, $earned[Showcase::SHOWCASE_USERNAME] ?? []));
    }

    // ---------------------------------------------------------------------------------------------------------------------------
    // Car of the Day

    /**
     * One pick per day from 14 days ago to three days ahead, each published at 18:00 Europe/Berlin (Home shows a day's pick from its 18:00
     * to the next day's): Bundesland round robin by last pick as CarOfTheDayPicker, inside a Bundesland the highest Build Score, no car
     * twice. A day that has a row keeps it. Sample picks are told to nobody (CarOfTheDays::publish), so no notification is written.
     */
    private function seedCarOfTheDay(): void
    {
        $scores = BuildScore::query()->whereIn('vehicle_id', array_keys($this->cars))->pluck('total', 'vehicle_id')->map(fn (mixed $total): int => (int) $total)->all();
        $pool = [];

        $days = app(CarOfTheDays::class);

        foreach ($this->cars as $id => $car) {
            $land = $car->owner?->getAttribute('bundesland');
            $land = $land instanceof Bundesland ? $land->value : (is_string($land) ? $land : null);

            // ADR-514: a pick that fails the publication check (CarOfTheDays::eligible: a build a guest may see in a list) would be
            // withdrawn at 18:00 (`auto_withdrawn`), so only eligible builds go into the pool.
            if ($land !== null && isset($scores[$id]) && $days->eligible((new CarOfTheDay)->forceFill(['vehicle_id' => $id, 'is_sample' => true]))) {
                $pool[$land][] = $id;
            }
        }

        foreach ($pool as $land => $ids) {
            usort($ids, fn (string $a, string $b): int => [$scores[$b], $a] <=> [$scores[$a], $b]);
            $pool[$land] = $ids;
        }

        $used = array_fill_keys(CarOfTheDay::query()->whereNotNull('vehicle_id')->where('day', '>=', $this->today->subDays(180)->toDateString())->pluck('vehicle_id')->all(), true);
        $order = array_flip(array_map(fn (Bundesland $land): string => $land->value, Bundesland::cases()));
        $added = 0;

        // A small pool (a test's photo set) starts later, so yesterday's and today's pick are always there.
        $available = count(array_filter(array_merge(...array_values($pool)), fn (string $id): bool => ! isset($used[$id])));
        $from = max(-$this->gift['cotd_days_back'], $this->gift['cotd_days_ahead'] + 1 - $available);

        for ($offset = $from; $offset <= $this->gift['cotd_days_ahead']; $offset++) {
            $day = $this->today->addDays($offset);
            $date = $day->toDateString();

            if (CarOfTheDay::query()->where('day', $date)->exists()) {
                continue;
            }

            /** @var array<string, string> $last */
            $last = DB::table('car_of_the_day')->where('skipped', false)->whereNotNull('bundesland')->where('day', '<', $date)
                ->groupBy('bundesland')->selectRaw('bundesland, MAX(day) as last_day')->pluck('last_day', 'bundesland')->map(strval(...))->all();
            $lands = array_keys($pool);
            usort($lands, fn (string $a, string $b): int => [$last[$a] ?? '', $order[$a] ?? 99] <=> [$last[$b] ?? '', $order[$b] ?? 99]);
            $pick = null;
            $pickLand = null;

            foreach ($lands as $land) {
                foreach ($pool[$land] as $id) {
                    if (! isset($used[$id])) {
                        [$pick, $pickLand] = [$id, $land];

                        break 2;
                    }
                }
            }

            if ($pick === null) {
                break;
            }

            $used[$pick] = true;
            $picked = $day->setTime(17, 55)->utc();
            $published = $day->setTime(18, 0)->utc();
            DB::table('car_of_the_day')->insert([
                'day' => $date,
                'vehicle_id' => $pick,
                'story_line' => BuildOfWeek::quote($this->cars[$pick]),
                'bundesland' => $pickLand,
                'source' => CarOfTheDaySource::Auto->value,
                'is_sample' => true,
                'skipped' => false,
                'picked_at' => $picked,
                'published_at' => $published,
                'notified_at' => $published,
                'created_at' => $picked,
                'updated_at' => $published,
            ]);
            $added++;
        }

        $this->done['car_of_the_day_added'] = $added;
    }

    // ---------------------------------------------------------------------------------------------------------------------------
    // Invites, Wrapped

    /**
     * sebastian.demo's five codes (created long before the invitees joined), two redeemed by sample members. Lookups of sample codes
     * answer 404 by rule (InviteCodes::mayInvite), so the demo never hands out a working sample invite.
     */
    private function seedInvites(): void
    {
        $showcase = $this->members[Showcase::SHOWCASE_USERNAME] ?? null;

        if (! $showcase instanceof User) {
            return;
        }

        $created = CarbonImmutable::parse((string) $showcase->getAttribute('created_at'))->addDays(40)->setTime(20, 15);
        SeedClock::at($created, fn () => app(InviteCodes::class)->for($showcase));
        $codes = InviteCode::query()->where('inviter_id', $showcase->id)->orderBy('created_at')->orderBy('code')->get()->values();
        $accepted = 0;

        foreach ($this->gift['invites_accepted_by'] as $index => $username) {
            $invitee = $this->members[$username] ?? null;
            $code = $codes[$index] ?? null;

            if (! $invitee instanceof User || ! $code instanceof InviteCode || InviteCode::query()->where('accepted_by', $invitee->id)->exists()) {
                continue;
            }

            if ($code->accepted_by === null) {
                $code->forceFill(['accepted_by' => $invitee->id, 'accepted_at' => $invitee->getAttribute('created_at')])->save();
                $accepted++;
            }
        }

        $this->done['invites'] = $codes->count().' codes, '.InviteCode::query()->where('inviter_id', $showcase->id)->whereNotNull('accepted_by')->count().' accepted';
    }

    private function seedWrapped(): void
    {
        $showcase = $this->members[Showcase::SHOWCASE_USERNAME] ?? null;

        if (! $showcase instanceof User) {
            return;
        }

        $this->publishReleases();
        $generator = app(WrappedGenerator::class);

        foreach (self::SEASONS as $key) {
            try {
                $wrapped = $generator->generate($showcase, Season::from($key), CarbonImmutable::now());
            } catch (Throwable $exception) {
                report($exception);
                $this->warn("Wrapped $key for sebastian.demo failed: {$exception->getMessage()}");

                continue;
            }

            $this->done["wrapped:$key"] = $wrapped instanceof Wrapped ? implode(',', array_column((array) ($wrapped->payload['cards'] ?? []), 'kind')) : 'none';
        }
    }

    /**
     * RELEASES into the published remote config (`wrapped.releases`), as the system (ConfigVersions::publishBySystem, audited
     * `config.published`): ADM-37 lists them, the member reads the season through the real release rule. A season that has a release
     * already keeps it (staff may have set another date); nothing to add writes nothing. Local and staging only, like the whole seeder.
     */
    private function publishReleases(): void
    {
        if (app()->isProduction()) {
            return;
        }

        $added = [];

        app(ConfigVersions::class)->publishBySystem(ConfigKey::RemoteConfig, function (array $payload) use (&$added): ?array {
            /** @var array<string, mixed> $releases */
            $releases = is_array($payload['wrapped'] ?? null) && is_array($payload['wrapped']['releases'] ?? null) ? $payload['wrapped']['releases'] : [];

            foreach (self::RELEASES as $season => $at) {
                if (! is_string($releases[$season] ?? null)) {
                    $releases[$season] = CarbonImmutable::parse($at, self::TIMEZONE)->format(DATE_ATOM);
                    $added[] = $season;
                }
            }

            return $added === [] ? null : [...$payload, 'wrapped' => ['releases' => $releases]];
        }, self::RELEASE_REASON);

        app()->forgetInstance(WrappedReleases::class);
        $this->done['wrapped_releases'] = $added === [] ? 'kept' : implode(', ', $added);
    }
}
