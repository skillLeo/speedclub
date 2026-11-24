<?php

namespace App\Services\Showcase;

use App\Actions\Admin\Stickers\DownloadStickerPrintFile;
use App\Actions\Events\Checkin\CheckInToEvent;
use App\Actions\Garage\ReorderPlans;
use App\Actions\Garage\SaveModification;
use App\Actions\Social\PostComment;
use App\Actions\Stickers\RequestStickerOrderLink;
use App\Actions\Stickers\SaveStickerDesign;
use App\Actions\Stickers\ValidateStickerDesign;
use App\Enums\BuildUpdateType;
use App\Enums\ModPriority;
use App\Enums\ModStatus;
use App\Enums\QrStatus;
use App\Enums\StaffStatus;
use App\Enums\StickerClientScanTest;
use App\Enums\StickerTemplate;
use App\Enums\VehicleStatus;
use App\Enums\ViewSource;
use App\Enums\ViewSubject;
use App\Exceptions\ApiException;
use App\Models\Brand;
use App\Models\Comment;
use App\Models\Event;
use App\Models\EventCheckin;
use App\Models\EventCheckinCode;
use App\Models\EventPhoto;
use App\Models\ModCategory;
use App\Models\Modification;
use App\Models\Staff;
use App\Models\StickerDesign;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Events\EventCheckins;
use App\Services\Media\MediaService;
use App\Support\Codes;
use Carbon\CarbonImmutable;
use Database\Seeders\Concerns\SeedClock;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * M5.10 demo refresh (10 §17): what the Phase 5 pages show on a staging host, on top of the showcase (DemoShowcaseSeeder runs it after
 * ShowcaseMaintenance, before GiftDemoSeeder), through the app's own Actions at their moment:
 *
 * - Sticker designs (STK-05/06/07, ADM-65): the showcase account's builds, the main builds of four more sample members and of the classic
 *   demo's lukas.sc, in all six templates, through SaveStickerDesign and the server Scan-Test (ValidateStickerDesign), with a version
 *   history, a draft, the Shopify link asked for (RequestStickerOrderLink, only where the shop is configured) and one print download by
 *   the showcase staff (DownloadStickerPrintFile, audited). Design ids are derived from the car and version, so a re-run and the purge
 *   find them again.
 * - Plans (M5.3): target month (some this coming season, some the year after), priority, the owner-only budget and the owner's order
 *   (ReorderPlans) on the same builds, through SaveModification.
 * - View history (M5.7 INS-01, owner-only): view_days of the sample members' profiles and published builds over the last VIEW_DAYS Berlin
 *   days of the real calendar (INS-01 counts back from today, like the QR scans), from fixed rules: weekday and season rhythm, a spike
 *   after each Verlauf entry of build progress, sticker-scan views never above that day's scans. Nothing for the Editorial account: no number is invented
 *   for it. Numbers only, never shown to anybody but the owner.
 * - Check-ins (M5.6): the going members of the past classic demo meet, and one walk-in, check in with the organiser's code during the
 *   meet (CheckInToEvent). Its gallery, approved and pending, is ShowcaseEvents' (events.json).
 * - Car comments (R5-5 [build_comments]): a short thread on the showcase account's main build and the first featured builds, a
 *   question by another sample member and the owner's answer, through PostComment at their moment. Only sample cars, only sample
 *   members; they go with them in the purge.
 *
 * Idempotent (keys: car and version, mod titles, (subject, day, source), (event, member), (car, author, text)) and deterministic (the showcase clock, crc32
 * picks, no randomness). `speedclub:demo --purge` removes all of it (purge(), the rest cascades with the sample members and builds).
 *
 * @phpstan-type StickerStep array{template: StickerTemplate, options: array<string, mixed>, validate: bool}
 * @phpstan-type PlanData array{category: string, brand: string|null, part: string, fields: array<string, mixed>, months: int, priority: ModPriority, budget: int, exclusive: bool}
 */
class ShowcasePhase5
{
    /** Sample members whose main build gets designs and plans after the showcase account's builds: the first four with a published build. */
    public const FEATURED = ['maxi.g82', 'felix.gt3', 'david.supra', 'sarah.fk8', 'luca.r35', 'niklas.z33', 'emma.typer', 'jan.s15', 'dominik.r32', 'yusuf.r33'];

    public const FEATURED_COUNT = 4;

    /** Classic demo members (DemoSeeder, no samples) whose main build gets designs: the crawl's member for STK-06/07. */
    public const CLASSIC_STICKERS = ['lukas.sc'];

    /** Berlin days of view history, today included. */
    public const VIEW_DAYS = 120;

    /** Plans no build of the showcase data names; seedMods keeps them on a re-run (planTitles()). */
    private const PLANS = [
        ['category' => 'brakes', 'brand' => 'Endless', 'part' => 'MX72 Bremsbeläge', 'fields' => ['brand' => 'Endless', 'model' => 'MX72', 'pads' => 'Endless MX72'], 'months' => 4, 'priority' => ModPriority::High, 'budget' => 380, 'exclusive' => false],
        ['category' => 'wheels_tires', 'brand' => 'Michelin', 'part' => 'Pilot Sport 4 S Sommerreifen', 'fields' => ['tyre_brand' => 'Michelin', 'tyre_model' => 'Pilot Sport 4 S'], 'months' => 5, 'priority' => ModPriority::Normal, 'budget' => 1250, 'exclusive' => false],
        ['category' => 'interior', 'brand' => 'Sabelt', 'part' => 'GT-160 Schalensitze', 'fields' => ['part' => 'seats', 'brand' => 'Sabelt', 'model' => 'GT-160'], 'months' => 14, 'priority' => ModPriority::Low, 'budget' => 2900, 'exclusive' => true],
        ['category' => 'other', 'brand' => null, 'part' => 'Lackschutzfolie Frontpartie', 'fields' => ['title' => 'Lackschutzfolie Frontpartie'], 'months' => 16, 'priority' => ModPriority::Low, 'budget' => 1400, 'exclusive' => false],
    ];

    /**
     * R5-5: the car threads, by slot: a question from the first sample member of the list who is not the owner, and the owner's answer.
     *
     * @var array<string, array{authors: list<string>, question: string, answer: string, days: int}>
     */
    private const CAR_COMMENTS = [
        'hero-main' => ['authors' => ['felix.gt3', 'david.supra'], 'question' => 'Die Felgenfarbe passt richtig gut zum Lack. Welche ET fährst du vorne?', 'answer' => 'Danke dir! Vorne ET 35, hinten ET 42, dazu 5-mm-Distanzscheiben.', 'days' => 9],
        'featured-0' => ['authors' => ['sarah.fk8', 'luca.r35'], 'question' => 'Sauber aufgebaut. Wie laut ist die Anlage im Alltag?', 'answer' => 'Beim Kaltstart deutlich, auf der Autobahn angenehm ruhig.', 'days' => 6],
        'featured-1' => ['authors' => ['emma.typer', 'niklas.z33'], 'question' => 'Der Innenraum ist richtig stimmig geworden. Sind das die originalen Sitze?', 'answer' => 'Ja, original, nur beim Sattler neu bezogen.', 'days' => 4],
    ];

    /** A build's mods stay within the showcase's 5–15 (DemoShowcaseSeederTest): plans are added only below this. */
    private const MAX_MODS = 14;

    private CarbonImmutable $clock;

    /** @var array<string, int> */
    private array $written = [];

    public function __construct(
        private readonly SaveStickerDesign $saveDesign,
        private readonly ValidateStickerDesign $validateDesign,
        private readonly RequestStickerOrderLink $orderLink,
        private readonly SaveModification $saveModification,
        private readonly ReorderPlans $reorderPlans,
        private readonly CheckInToEvent $checkIn,
        private readonly EventCheckins $checkins,
        private readonly PostComment $postComment,
    ) {}

    /**
     * @return array<string, int> what this run wrote or found in place, by item
     */
    public function seed(CarbonImmutable $clock): array
    {
        Showcase::assertEnvironment('ShowcasePhase5');
        $this->clock = $clock;
        $this->written = ['sticker_designs' => 0, 'plans' => 0, 'event_checkins' => 0, 'view_days' => 0, 'car_comments' => 0];

        $builds = $this->builds();

        foreach ($builds as $slot => $vehicle) {
            $this->seedStickers($vehicle, $this->stickerScript($slot));
            $this->seedPlans($vehicle);
        }

        foreach (self::CLASSIC_STICKERS as $username) {
            $vehicle = $this->mainBuild($username, sample: false);

            if ($vehicle instanceof Vehicle) {
                $this->seedStickers($vehicle, $this->stickerScript('classic'));
            }
        }

        $this->seedPrintDownload($builds['hero-main'] ?? null);
        $this->seedCheckins();
        $this->seedCarComments($builds);
        // Before the gift demo: its badges count views by the real rules (views_received), the same on every run.
        $this->written['view_days'] = $this->seedViewDays();

        return $this->written;
    }

    /**
     * Removes what the purge would not reach through the sample members and builds: the designs on classic demo builds, the check-ins
     * on the past classic demo meets and every sample gallery photo (with its files).
     *
     * @return array<string, int>
     */
    public function purge(): array
    {
        $designs = StickerDesign::query()->whereKey($this->classicDesignIds())->delete();
        $checkins = EventCheckin::query()->whereIn('event_id', $this->pastMemberEventIds())->delete();
        $photos = 0;

        foreach (EventPhoto::withTrashed()->with('media')->where('is_sample', true)->get() as $photo) {
            $media = $photo->media;
            $photo->forceDelete();
            app(MediaService::class)->purge($media);

            $photos++;
        }

        return ['sticker_designs' => $designs, 'event_checkins' => $checkins, 'event_gallery_photos' => $photos];
    }

    /**
     * @return array{sticker_designs: int, plans: int, view_days: int, event_checkins: int, event_gallery_photos: int}
     */
    public function counts(): array
    {
        $sampleVehicles = DB::table('vehicles')->where('is_sample', true)->select('id');
        $sampleUsers = DB::table('users')->where('is_sample', true)->select('id');

        return [
            'sticker_designs' => StickerDesign::query()->whereIn('vehicle_id', $sampleVehicles)->count() + count($this->classicDesignIds()),
            'plans' => Modification::query()->whereIn('vehicle_id', $sampleVehicles)->where('status', ModStatus::Planned->value)->whereNotNull('target_month')->count(),
            'view_days' => DB::table('view_days')->whereIn('owner_id', $sampleUsers)->count(),
            'event_checkins' => EventCheckin::query()->where(fn (Builder $query) => $query->whereIn('event_id', $this->pastMemberEventIds())->orWhereIn('user_id', $sampleUsers))->count(),
            'event_gallery_photos' => EventPhoto::withTrashed()->where('is_sample', true)->count(),
        ];
    }

    /**
     * Titles of the plans this class adds: seedMods leaves them on a build although the showcase data does not name them.
     *
     * @return list<string>
     */
    public static function planTitles(): array
    {
        return array_map(fn (array $plan): string => self::planTitle($plan), self::PLANS);
    }

    /**
     * "SD" and eight Crockford characters from the car and the version: the same design id on every run and every host.
     */
    public static function reference(string $vehicleId, int $version): string
    {
        $bytes = hash('sha256', 'speedclub-showcase:sticker:'.strtolower($vehicleId).':'.$version, true);
        $code = '';

        for ($i = 0; $i < Codes::LENGTH; $i++) {
            $code .= Codes::ALPHABET[ord($bytes[$i]) % strlen(Codes::ALPHABET)];
        }

        return 'SD'.$code;
    }

    // ---------------------------------------------------------------------------------------------------------------------------
    // Builds

    /**
     * hero-main, hero-2, hero-3 (the showcase account's published builds, main first), then featured-0 … featured-3.
     *
     * @return array<string, Vehicle>
     */
    private function builds(): array
    {
        $builds = [];
        $hero = User::query()->where('username', Showcase::SHOWCASE_USERNAME)->where('is_sample', true)->first();

        if ($hero instanceof User) {
            $own = $this->published($hero)->limit(3)->get()->values();

            foreach (['hero-main', 'hero-2', 'hero-3'] as $index => $slot) {
                if ($own->get($index) instanceof Vehicle) {
                    $builds[$slot] = $own->get($index);
                }
            }
        }

        $featured = 0;

        foreach (self::FEATURED as $username) {
            if ($featured >= self::FEATURED_COUNT) {
                break;
            }

            $vehicle = $this->mainBuild($username, sample: true);

            if ($vehicle instanceof Vehicle) {
                $builds['featured-'.$featured++] = $vehicle;
            }
        }

        return $builds;
    }

    private function mainBuild(string $username, bool $sample): ?Vehicle
    {
        $owner = User::query()->where('username', $username)->where('is_sample', $sample)->first();

        return $owner instanceof User ? $this->published($owner)->first() : null;
    }

    /**
     * @return Builder<Vehicle>
     */
    private function published(User $owner): Builder
    {
        return Vehicle::query()->where('owner_id', $owner->id)->where('status', VehicleStatus::Published->value)
            ->orderByDesc('is_main')->orderBy('sort')->orderBy('id');
    }

    /**
     * The moment a build's story may start at: after its publishing, never after the showcase clock.
     */
    private function after(Vehicle $vehicle, int $daysBeforeClock, int $hour): CarbonImmutable
    {
        $published = $vehicle->published_at === null ? null : CarbonImmutable::parse((string) $vehicle->published_at);
        $at = $this->clock->subDays($daysBeforeClock)->setTime($hour, 0);

        if ($published !== null && $at->lessThan($published)) {
            $at = $published->addDay()->setTime($hour, 0);
        }

        return $at->min($this->clock->subHour());
    }

    // ---------------------------------------------------------------------------------------------------------------------------
    // Sticker designs

    /**
     * The versions a slot's build goes through, oldest first; all six templates across the slots.
     *
     * @return array{steps: list<StickerStep>, order: bool}
     */
    private function stickerScript(string $slot): array
    {
        $step = fn (StickerTemplate $template, array $options, bool $validate = true): array => ['template' => $template, 'options' => $options, 'validate' => $validate];

        return match ($slot) {
            // Version history: the first design was tested and frozen, the second (with its own line) replaced it and was ordered.
            'hero-main' => ['steps' => [
                $step(StickerTemplate::Classic, ['size' => 'm', 'colourway' => 'white', 'material' => 'transparent', 'qr' => true, 'username' => true, 'car_name' => true]),
                $step(StickerTemplate::Banner, ['size' => 'l', 'colourway' => 'white_red', 'material' => 'transparent', 'qr' => true, 'username' => true, 'car_name' => true, 'custom_line' => 'Seit 2019 in der Garage']),
            ], 'order' => true],
            'hero-2' => ['steps' => [$step(StickerTemplate::Plate, ['size' => 'l', 'colourway' => 'black', 'material' => 'white_vinyl', 'qr' => true, 'username' => true, 'car_name' => true])], 'order' => false],
            // A draft that has not been through the Scan-Test yet (STK-06 "Erst der Scan-Test").
            'hero-3' => ['steps' => [$step(StickerTemplate::Round, ['size' => 'm', 'colourway' => 'white', 'material' => 'transparent', 'qr' => true, 'username' => true], false)], 'order' => false],
            'featured-0' => ['steps' => [$step(StickerTemplate::Minimal, ['size' => 'm', 'colourway' => 'white', 'material' => 'transparent', 'qr' => true, 'mirrored' => true])], 'order' => false],
            'featured-1' => ['steps' => [$step(StickerTemplate::VerticalJdm, ['size' => 'l', 'colourway' => 'black', 'material' => 'transparent', 'qr' => true, 'username' => true])], 'order' => false],
            'featured-2' => ['steps' => [
                $step(StickerTemplate::Classic, ['size' => 'm', 'colourway' => 'white_red', 'material' => 'transparent', 'qr' => true, 'username' => true, 'car_name' => true]),
                $step(StickerTemplate::Round, ['size' => 'l', 'colourway' => 'white_red', 'material' => 'transparent', 'qr' => true, 'username' => true], false),
            ], 'order' => false],
            'featured-3' => ['steps' => [$step(StickerTemplate::Banner, ['size' => 'm', 'colourway' => 'white', 'material' => 'transparent', 'qr' => true, 'username' => true, 'custom_line' => 'Saison 2027'])], 'order' => false],
            'classic' => ['steps' => [
                $step(StickerTemplate::Classic, ['size' => 'm', 'colourway' => 'white', 'material' => 'transparent', 'qr' => true, 'username' => true, 'car_name' => true]),
                $step(StickerTemplate::VerticalJdm, ['size' => 'l', 'colourway' => 'white_red', 'material' => 'transparent', 'qr' => true, 'username' => true, 'car_name' => true]),
            ], 'order' => true],
            default => ['steps' => [], 'order' => false],
        };
    }

    /**
     * A build that has designs already keeps them (also a classic demo member's own); only a frozen version of this class whose code was
     * replaced since (speedclub:qr:rotate-samples) is tested again with the active code, which opens the next version as the app would.
     *
     * @param  array{steps: list<StickerStep>, order: bool}  $script
     */
    private function seedStickers(Vehicle $vehicle, array $script): void
    {
        if ($script['steps'] === [] || ! $vehicle->activeQrCode()->exists()) {
            return;
        }

        /** @var StickerDesign|null $current */
        $current = $vehicle->stickerDesigns()->with('qrCode')->orderByDesc('version')->first();

        if ($current !== null) {
            // Only a design of this class (its derived id): a member's own designs are never touched.
            if ($current->reference === self::reference($vehicle->id, $current->version)
                && $current->isValidated() && $current->stickerOptions()->qr && $current->qrCode?->status !== QrStatus::Active) {
                $this->validate($vehicle, $current->version, $this->clock->subHour());
            }

            $this->written['sticker_designs'] += $vehicle->stickerDesigns()->count();

            return;
        }

        $count = count($script['steps']);
        $design = null;

        foreach ($script['steps'] as $index => $step) {
            // The first version about six weeks back, each later one closer to the clock.
            $at = $this->after($vehicle, 42 - intdiv(30 * $index, max(1, $count - 1)), 19)->addMinutes(self::pick('sticker:'.$vehicle->id.':'.$index, 0, 50));
            $base = $vehicle->stickerDesigns()->orderByDesc('version')->first();
            $design = SeedClock::at($at, fn (): StickerDesign => $this->saveDesign->handle($vehicle, $base === null ? 0 : $base->version, $base === null ? 0 : $base->revision, $step['template'], $step['options']));
            $this->stamp($design, $at);

            if ($step['validate']) {
                $design = $this->validate($vehicle, $design->version, $at->addMinutes(4)) ?? $design;
            }
        }

        if ($script['order'] && $design->isValidated()) {
            SeedClock::at($this->after($vehicle, 5, 20), fn (): ?string => $this->orderLink->handle($design, $vehicle));
        }

        $this->written['sticker_designs'] += $vehicle->stickerDesigns()->count();
    }

    private function validate(Vehicle $vehicle, int $version, CarbonImmutable $at): ?StickerDesign
    {
        try {
            $design = SeedClock::at($at, fn (): StickerDesign => $this->validateDesign->handle($vehicle, $version, StickerClientScanTest::Passed));
        } catch (ApiException $exception) {
            // A failed Scan-Test stays on the draft, as in the app; the showcase shows it rather than forcing a pass.
            report($exception);

            return null;
        }

        // A code replaced since opened a new version: it gets its derived design id too.
        $this->stamp($design, $at);

        return $design;
    }

    /**
     * The derived design id (reference()), unless another design holds it already.
     */
    private function stamp(StickerDesign $design, CarbonImmutable $at): void
    {
        $reference = self::reference($design->vehicle_id, $design->version);

        if ($design->reference === $reference || StickerDesign::query()->where('reference', $reference)->exists()) {
            return;
        }

        SeedClock::at($at, fn () => $design->forceFill(['reference' => $reference])->save());
    }

    /**
     * The print partner downloads the ordered design of the showcase account's main build once (ADM-65, audited like every download).
     */
    private function seedPrintDownload(?Vehicle $vehicle): void
    {
        if (! $vehicle instanceof Vehicle) {
            return;
        }

        $staff = Staff::query()->where('is_sample', true)->whereNull('anonymised_at')->where('status', StaffStatus::Active)->first();
        /** @var StickerDesign|null $design */
        $design = $vehicle->stickerDesigns()->whereNotNull('validated_at')->orderByDesc('version')->first();

        if (! $staff instanceof Staff || ! $design instanceof StickerDesign || RequestStickerOrderLink::printRefusal($design) !== null
            || DB::table('audit_events')->where('action', DownloadStickerPrintFile::EVENT)->where('target_id', $design->id)->exists()) {
            return;
        }

        SeedClock::at($this->after($vehicle, 3, 10), fn () => app(DownloadStickerPrintFile::class)->handle($staff, $design, 'pdf'));
    }

    /**
     * @return list<string> ids of the designs this class made on classic demo builds (their derived design id tells them apart)
     */
    private function classicDesignIds(): array
    {
        $vehicles = Vehicle::withTrashed()->where('is_sample', false)
            ->whereIn('owner_id', User::withTrashed()->whereIn('username', self::CLASSIC_STICKERS)->where('is_sample', false)->select('id'))
            ->select('id');

        return array_values(StickerDesign::query()->whereIn('vehicle_id', $vehicles)->get(['id', 'vehicle_id', 'version', 'reference'])
            ->filter(fn (StickerDesign $design): bool => $design->reference === self::reference($design->vehicle_id, $design->version))
            ->map(fn (StickerDesign $design): string => $design->id)->all());
    }

    // ---------------------------------------------------------------------------------------------------------------------------
    // Plans

    /**
     * The build's own plan from the showcase data gets a target month, priority and budget; up to two (the showcase account's main
     * build three) of PLANS join it, never past MAX_MODS and never a second set of seats. The owner's order: priority, then month.
     */
    private function seedPlans(Vehicle $vehicle): void
    {
        $mods = Modification::query()->with('category')->where('vehicle_id', $vehicle->id)->get();
        $titles = $mods->pluck('title')->all();
        $wanted = $vehicle->owner_id === User::query()->where('username', Showcase::SHOWCASE_USERNAME)->value('id') && $vehicle->is_main ? 3 : 2;
        $offset = self::pick('plans:'.$vehicle->id, 0, count(self::PLANS) - 1);
        $count = $mods->count();

        for ($i = 0, $added = 0; $i < count(self::PLANS) && $added < $wanted; $i++) {
            $plan = self::PLANS[($offset + $i) % count(self::PLANS)];
            $title = self::planTitle($plan);

            if (in_array($title, $titles, true)) {
                $added++;

                continue;
            }

            $category = ModCategory::query()->where('key', $plan['category'])->first();

            if (! $category instanceof ModCategory || $count >= self::MAX_MODS
                || ($plan['exclusive'] && $mods->contains(fn (Modification $mod): bool => $mod->category->key === $plan['category']))) {
                continue;
            }

            $brand = $plan['brand'] === null ? null : Brand::query()->where('name', $plan['brand'])->value('id');
            $at = $this->after($vehicle, self::pick('plan-at:'.$vehicle->id.':'.$title, 8, 40), 21);
            SeedClock::at($at, fn (): Modification => $this->saveModification->add($vehicle, $category, [
                'title' => $title,
                ...($brand === null ? [] : ['brand_id' => $brand]),
                'part_name' => $plan['part'],
                'status' => ModStatus::Planned,
                'installed_on' => null,
                'target_month' => $this->clock->startOfMonth()->addMonthsNoOverflow($plan['months'])->format('Y-m'),
                'priority' => $plan['priority'],
                'budget_cents' => $plan['budget'] * 100,
                'fields' => $plan['fields'],
            ]));
            $count++;
            $added++;
        }

        // The build's own plan (vehicles.json): the next spring, high priority, its estimate as the budget.
        $plans = Modification::query()->where('vehicle_id', $vehicle->id)->where('status', ModStatus::Planned->value)->get();

        foreach ($plans as $plan) {
            if ($plan->getAttribute('target_month') !== null) {
                continue;
            }

            $budget = $plan->getAttribute('budget_cents') ?? $plan->getAttribute('cost_cents');
            SeedClock::at($this->after($vehicle, 20, 20), fn () => $this->saveModification->change($plan, [
                'target_month' => $this->clock->startOfMonth()->addMonthsNoOverflow(3)->format('Y-m'),
                'priority' => ModPriority::High,
                'budget_cents' => is_numeric($budget) ? (int) $budget : null,
            ]));
        }

        $priority = [ModPriority::High->value => 0, ModPriority::Normal->value => 1, ModPriority::Low->value => 2];
        $ordered = Modification::query()->where('vehicle_id', $vehicle->id)->where('status', ModStatus::Planned->value)->get()
            ->sortBy(fn (Modification $mod): string => ($priority[$mod->getAttribute('priority')->value ?? 'low'] ?? 2)
                .'|'.CarbonImmutable::parse((string) ($mod->getAttribute('target_month') ?? '2999-12-01'))->format('Y-m')
                .'|'.str_pad((string) $mod->sort, 6, '0', STR_PAD_LEFT).'|'.$mod->id)
            ->pluck('id')->map(fn (mixed $id): string => (string) $id)->all();
        $ordered = array_values($ordered);

        if ($ordered !== []) {
            $this->reorderPlans->handle($vehicle, $ordered);
        }

        $this->written['plans'] += count($ordered);
    }

    /**
     * @param  PlanData  $plan
     */
    private static function planTitle(array $plan): string
    {
        return $plan['brand'] === null ? $plan['part'] : $plan['brand'].' '.$plan['part'];
    }

    // ---------------------------------------------------------------------------------------------------------------------------
    // View history

    /**
     * view_days of every sample member's profile and published builds but the Editorial account's, upserted on their key; days that fell
     * out of the window go.
     */
    private function seedViewDays(): int
    {
        $zone = config()->string('speedclub.insights.timezone');
        $today = CarbonImmutable::now($zone)->startOfDay();
        $first = $today->subDays(self::VIEW_DAYS - 1);
        $hero = User::query()->where('username', Showcase::SHOWCASE_USERNAME)->value('id');
        $featured = User::query()->whereIn('username', self::FEATURED)->where('is_sample', true)->pluck('id')->map(fn (mixed $id): string => (string) $id)->all();
        $members = User::query()->where('is_sample', true)->where('is_editorial', false)->orderBy('id')->get(['id', 'created_at']);
        $vehicles = Vehicle::query()->whereIn('owner_id', $members->pluck('id'))->where('status', VehicleStatus::Published->value)
            ->orderBy('id')->get(['id', 'owner_id', 'is_main', 'published_at']);

        $updates = [];

        // Build progress (parts, specs, photos), not notes or posts: the gift demo adds those after this step.
        $progress = [BuildUpdateType::ModAdded->value, BuildUpdateType::ModChanged->value, BuildUpdateType::SpecsChanged->value, BuildUpdateType::PhotosAdded->value];

        foreach (DB::table('build_updates')->whereIn('vehicle_id', $vehicles->pluck('id'))->whereIn('type', $progress)->where('created_at', '>=', $first->subDays(3)->utc())->get(['vehicle_id', 'created_at']) as $row) {
            $day = CarbonImmutable::parse((string) $row->created_at, 'UTC')->setTimezone($zone)->toDateString();
            $updates[(string) $row->vehicle_id][$day] = true;
        }

        $scans = [];

        foreach (DB::table('qr_scan_daily')->join('qr_codes', 'qr_codes.id', '=', 'qr_scan_daily.qr_code_id')->whereIn('qr_codes.vehicle_id', $vehicles->pluck('id'))
            ->where('qr_scan_daily.day', '>=', $first->toDateString())->groupBy('qr_codes.vehicle_id', 'qr_scan_daily.day')
            ->selectRaw('qr_codes.vehicle_id as vehicle_id, qr_scan_daily.day as day, SUM(qr_scan_daily.count) as total')->get() as $row) {
            $scans[(string) $row->vehicle_id][substr((string) $row->day, 0, 10)] = (int) $row->total;
        }

        $rows = [];

        foreach ($members as $member) {
            $id = (string) $member->id;
            $level = $id === $hero ? 12 : (in_array($id, $featured, true) ? self::pick('views-profile:'.$id, 3, 6) : self::pick('views-profile:'.$id, 1, 4));
            $own = $vehicles->where('owner_id', $id);
            $spikes = [];

            foreach ($own as $vehicle) {
                $spikes += $updates[(string) $vehicle->id] ?? [];
            }

            $this->subjectDays($rows, ViewSubject::Profile, $id, $id, null, $level, $this->since($member->created_at, $first, $zone), $today, $spikes, []);
        }

        foreach ($vehicles as $vehicle) {
            $id = (string) $vehicle->id;
            $owner = (string) $vehicle->owner_id;
            $level = match (true) {
                $owner === $hero => $vehicle->is_main ? 22 : 9,
                in_array($owner, $featured, true) && $vehicle->is_main => self::pick('views-vehicle:'.$id, 6, 10),
                default => self::pick('views-vehicle:'.$id, 1, 6),
            };

            $this->subjectDays($rows, ViewSubject::Vehicle, $id, $owner, $id, $level, $this->since($vehicle->published_at, $first, $zone), $today, $updates[$id] ?? [], $scans[$id] ?? []);
        }

        DB::table('view_days')->whereIn('owner_id', $members->pluck('id'))->where('day', '<', $first->toDateString())->delete();

        foreach (array_chunk($rows, 500) as $chunk) {
            DB::table('view_days')->upsert($chunk, ['subject_type', 'subject_id', 'day', 'source'], ['owner_id', 'vehicle_id', 'views']);
        }

        return count($rows);
    }

    private function since(mixed $date, CarbonImmutable $first, string $zone): CarbonImmutable
    {
        $start = $date === null ? $first : CarbonImmutable::parse((string) $date)->setTimezone($zone)->startOfDay();

        return $start->max($first);
    }

    /**
     * One subject's days: level × weekday × season × a ±30 % pick, ×3 / ×2 / ×1.4 on the day of a Verlauf entry and the two after it, a
     * quiet day now and then for a small subject; split into the sources, sticker-scan views (vehicles) never above that day's scans.
     *
     * @param  list<array{subject_type: string, subject_id: string, owner_id: string, vehicle_id: string|null, day: string, source: string, views: int}>  $rows
     * @param  array<string, true>  $updates  Berlin days with a Verlauf entry
     * @param  array<string, int>  $scans  Berlin day => sticker scans
     */
    private function subjectDays(array &$rows, ViewSubject $type, string $id, string $owner, ?string $vehicle, int $level, CarbonImmutable $from, CarbonImmutable $today, array $updates, array $scans): void
    {
        $weekday = [1 => 0.85, 2 => 0.8, 3 => 0.9, 4 => 0.95, 5 => 1.1, 6 => 1.45, 7 => 1.35];
        $season = [1 => 0.7, 2 => 0.7, 3 => 0.9, 4 => 1.1, 5 => 1.15, 6 => 1.15, 7 => 1.15, 8 => 1.15, 9 => 1.1, 10 => 1.0, 11 => 0.8, 12 => 0.75];

        for ($day = $from; $day->lessThanOrEqualTo($today); $day = $day->addDay()) {
            $date = $day->toDateString();
            $seed = $type->value.':'.$id.':'.$date;
            $spike = match (true) {
                isset($updates[$date]) => 3.0,
                isset($updates[$day->subDay()->toDateString()]) => 2.0,
                isset($updates[$day->subDays(2)->toDateString()]) => 1.4,
                default => 1.0,
            };
            $quiet = $level < 5 && $spike === 1.0 && self::pick('quiet:'.$seed, 0, 99) < 12;
            $total = $quiet ? 0 : (int) round($level * $weekday[$day->isoWeekday()] * $season[$day->month] * self::pick('noise:'.$seed, 70, 130) / 100 * $spike);
            $shared = (int) round($total * self::pick('shared:'.$seed, $type === ViewSubject::Profile ? 4 : 5, $type === ViewSubject::Profile ? 10 : 12) / 100);
            $web = (int) round($total * self::pick('web:'.$seed, $type === ViewSubject::Profile ? 25 : 22, $type === ViewSubject::Profile ? 40 : 34) / 100);
            $sources = [
                ViewSource::App->value => max(0, $total - $shared - $web),
                ViewSource::Web->value => $web,
                ViewSource::SharedLink->value => $shared,
                // A scan opens the build's page: some of that day's scans, never more than there were.
                ViewSource::StickerScan->value => isset($scans[$date]) ? max(0, $scans[$date] - self::pick('scan-views:'.$seed, 0, 1)) : 0,
            ];

            foreach ($sources as $source => $views) {
                if ($views > 0) {
                    $rows[] = ['subject_type' => $type->value, 'subject_id' => $id, 'owner_id' => $owner, 'vehicle_id' => $vehicle, 'day' => $date, 'source' => $source, 'views' => $views];
                }
            }
        }
    }

    // ---------------------------------------------------------------------------------------------------------------------------
    // Check-ins

    /**
     * The going classic demo members of each past demo meet and its first interested one (a walk-in) check in with the organiser's code
     * during the meet; one of them keeps it off their profile. A re-run on another day finds the meet moved (ShowcaseEvents dates it
     * from now) and moves the check-in times with it. The codes asked for are gone again afterwards.
     */
    private function seedCheckins(): void
    {
        foreach ($this->pastMemberEvents() as [$event, $row]) {
            $organiser = $event->organiser_id;
            $names = [...(is_array($row['going'] ?? null) ? $row['going'] : []), ...array_slice(is_array($row['interested'] ?? null) ? $row['interested'] : [], 0, 1)];
            $starts = $event->starts_at === null ? null : CarbonImmutable::parse((string) $event->starts_at);

            if ($starts === null) {
                continue;
            }

            foreach (array_values($names) as $index => $username) {
                $member = User::query()->where('username', (string) $username)->where('is_sample', false)->first();

                if (! $member instanceof User || $member->id === $organiser) {
                    continue;
                }

                $at = $starts->addMinutes(12 + 9 * $index);
                $existing = $this->checkins->of($event, $member);

                if ($existing instanceof EventCheckin) {
                    if (! $existing->checked_in_at->equalTo($at)) {
                        $existing->forceFill(['checked_in_at' => $at])->save();
                    }
                } else {
                    SeedClock::at($at, function () use ($event, $member, $index): void {
                        $code = $this->checkins->currentCode($event);
                        $this->checkIn->handle($member, $event, $code->code, profileVisible: $index !== 1);
                    });
                }

                $this->written['event_checkins']++;
            }

            EventCheckinCode::query()->where('event_id', $event->id)->where('expires_at', '<', SeedClock::host())->delete();
        }
    }

    /**
     * R5-5: CAR_COMMENTS on the sample builds of their slots, the question first and the owner's answer two hours later. A sample owner and
     * a sample author only; a text already there is left as it is.
     *
     * @param  array<string, Vehicle>  $builds
     */
    private function seedCarComments(array $builds): void
    {
        foreach (self::CAR_COMMENTS as $slot => $thread) {
            $vehicle = $builds[$slot] ?? null;
            $owner = $vehicle?->owner;

            if (! $vehicle instanceof Vehicle || ! $vehicle->getAttribute('is_sample') || ! $owner instanceof User || ! $owner->getAttribute('is_sample')) {
                continue;
            }

            $candidates = User::query()->whereIn('username', $thread['authors'])->where('is_sample', true)->whereKeyNot($owner->id)->get()->keyBy('username');
            $author = collect($thread['authors'])->map(fn (string $username): ?User => $candidates->get($username))->first(fn (?User $user): bool => $user instanceof User);

            if (! $author instanceof User) {
                continue;
            }

            $at = $this->after($vehicle, $thread['days'], 18);
            $question = $this->carComment($vehicle, $author, $thread['question'], null, $at);
            $this->carComment($vehicle, $owner, $thread['answer'], $question, $at->addHours(2)->min($this->clock->subMinutes(30)));
        }
    }

    private function carComment(Vehicle $vehicle, User $author, string $body, ?Comment $parent, CarbonImmutable $at): Comment
    {
        $this->written['car_comments']++;
        $existing = Comment::withTrashed()->where('vehicle_id', $vehicle->id)->where('user_id', $author->id)->where('body', $body)->first();

        return $existing instanceof Comment
            ? $existing
            : SeedClock::at($at, fn (): Comment => $this->postComment->handle($author, $vehicle, $body, $parent));
    }

    /**
     * @return list<array{0: Event, 1: array<string, mixed>}> the classic demo meets of events.json that are over, with their data
     */
    private function pastMemberEvents(): array
    {
        $data = json_decode((string) file_get_contents(database_path('data/showcase/events.json')), true);
        $events = [];

        foreach (is_array($data) && is_array($data['member_events'] ?? null) ? $data['member_events'] : [] as $row) {
            if (! is_array($row) || (int) ($row['days'] ?? 0) >= 0) {
                continue;
            }

            $event = Event::query()->where('slug', ShowcaseEvents::slug((string) $row['key'], (string) $row['title']))->where('is_sample', false)->first();

            if ($event instanceof Event) {
                $events[] = [$event, $row];
            }
        }

        return $events;
    }

    /**
     * @return list<string>
     */
    private function pastMemberEventIds(): array
    {
        return array_map(fn (array $pair): string => (string) $pair[0]->id, $this->pastMemberEvents());
    }

    /**
     * A number in [$min, $max] from $seed: the same on every machine and every run (DemoShowcaseSeeder::pick()).
     */
    private static function pick(string $seed, int $min, int $max): int
    {
        return $max <= $min ? $min : $min + crc32($seed) % ($max - $min + 1);
    }
}
