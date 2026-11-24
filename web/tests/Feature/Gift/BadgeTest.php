<?php

use App\Actions\Admin\Badges\ApplyBadge;
use App\Actions\Admin\Badges\PreviewBadgeRule;
use App\Actions\Admin\Badges\SaveBadge;
use App\Actions\Admin\Badges\SetBadgeActive;
use App\Enums\AuditActorType;
use App\Enums\BadgeMetric;
use App\Enums\NotificationType;
use App\Enums\QrStatus;
use App\Enums\RestrictionType;
use App\Models\AuditEvent;
use App\Models\Badge;
use App\Models\InviteCode;
use App\Models\ModCategory;
use App\Models\Notification;
use App\Models\QrCode;
use App\Models\User;
use App\Models\UserBadge;
use App\Models\UserSetProgress;
use App\Models\VehicleSpotStat;
use App\Services\Badges\BadgeAwarder;
use App\Services\Badges\BadgeMetrics;
use App\Services\Badges\BadgeRules;
use App\Services\Badges\BadgesNightly;
use Database\Seeders\BadgeSeeder;
use Database\Seeders\DexSetSeeder;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/GiftTestHelpers.php';
require_once __DIR__.'/../BuildScore/BuildScoreTestHelpers.php';
require_once __DIR__.'/../Admin/Support/helpers.php';

/**
 * M5.9d badges (m5.9d contract §2, §9, §10.2): the seeded set, the rule DSL, every metric, hidden badges, the event and nightly
 * (retroactive, idempotent) awards, the API with its authorisation matrix and the admin badge manager's actions (atom, audit).
 */
beforeEach(function () {
    $this->seed(DexSetSeeder::class);
    giftBadges();
});

describe('the seeded badges', function () {
    it('has about 30 badges, 7 of them hidden with a hint, in every category and tier, with valid rules', function () {
        $badges = Badge::query()->get();

        expect($badges->count())->toBe(33)
            ->and($badges->where('hidden', true)->count())->toBe(7)
            ->and($badges->where('hidden', true)->every(fn (Badge $b): bool => $b->hint_de !== null && $b->hint_en !== null))->toBeTrue()
            ->and($badges->pluck('category')->map->value->unique()->sort()->values()->all())->toBe(['community', 'forum', 'founding', 'garage', 'mods', 'sets', 'spotting', 'sticker', 'treffen'])
            ->and($badges->pluck('tier')->map->value->unique()->sort()->values()->all())->toBe(['bronze', 'gold', 'silver']);

        foreach ($badges as $badge) {
            expect(app(BadgeRules::class)->read($badge->rule_json))->not->toBeNull();
        }
    });

    it('never rewards likes, followers, posting volume, sign-ins, speed or money', function () {
        foreach (Badge::query()->get() as $badge) {
            $text = str_replace(['speedclub', 'speed club'], 'club', mb_strtolower(implode(' ', [$badge->key, $badge->name_de, $badge->name_en, $badge->description_de, $badge->description_en, $badge->hint_de, $badge->hint_en])));
            expect($text)->not->toMatch('/\blike|follower|anmeld|login|sign-in|speed|tempo|schnell|rennen|race|euro|geld|money/');
        }

        expect(array_map(fn (BadgeMetric $m): string => $m->value, BadgeMetric::cases()))->not->toContain('reactions', 'likes', 'followers', 'posts', 'logins');
    });

    it('never rewards the hour of a spot: no time-of-day metric, rule or text (ADR-516 b)', function () {
        expect(BadgeMetric::tryFrom('night_spots'))->toBeNull()
            ->and(array_filter(array_map(fn (BadgeMetric $m): string => $m->value, BadgeMetric::cases()), fn (string $v): bool => (bool) preg_match('/night|nacht|hour|stunde|time|zeit|day_part/', $v)))->toBe([])
            ->and(Badge::query()->whereKey('nachtschicht')->exists())->toBeFalse();

        foreach (Badge::query()->get() as $badge) {
            $text = mb_strtolower(implode(' ', [$badge->key, json_encode($badge->rule_json), $badge->name_de, $badge->name_en, $badge->description_de, $badge->description_en, $badge->hint_de, $badge->hint_en]));
            expect($text)->not->toMatch('/night|nacht|\buhr\b|10 pm|6 am|laterne|street light|dunkel|dark/');
        }

        // The fixed queries read the night flag only to leave night spots out (cities of day spots), never to count them.
        $source = (string) file_get_contents(app_path('Services/Badges/BadgeMetrics.php'));
        expect($source)->not->toContain("'s.is_night', true")
            ->and($source)->not->toMatch('/\bHOUR\s*\(|spotted_at|created_at/i');
    });

    it('keeps staff edits when it runs again', function () {
        Badge::query()->whereKey('erster-build')->update(['name_de' => 'Geändert']);
        $this->seed(BadgeSeeder::class);

        expect(Badge::query()->findOrFail('erster-build')->name_de)->toBe('Geändert');
    });
});

describe('the rule DSL', function () {
    it('accepts the whitelisted forms', function (array $rule) {
        expect(app(BadgeRules::class)->validate($rule))->toEqual($rule);
    })->with([
        [['metric' => 'published_vehicles', 'gte' => 1]],
        [['metric' => 'sticker_active', 'eq' => true]],
        [['metric' => 'set_completed', 'set' => 'jdm-legends', 'eq' => true]],
    ]);

    it('refuses anything else', function (mixed $rule) {
        app(BadgeRules::class)->validate($rule);
    })->with([
        'not an object' => ['published_vehicles >= 1'],
        'a list' => [[['metric' => 'published_vehicles', 'gte' => 1]]],
        'unknown metric' => [['metric' => 'reactions', 'gte' => 1]],
        'sql' => [['metric' => 'published_vehicles; DROP TABLE users', 'gte' => 1]],
        'extra key' => [['metric' => 'published_vehicles', 'gte' => 1, 'sql' => 'SELECT 1']],
        'wrong operator' => [['metric' => 'published_vehicles', 'eq' => true]],
        'eq false' => [['metric' => 'founding_member', 'eq' => false]],
        'zero' => [['metric' => 'published_vehicles', 'gte' => 0]],
        'string value' => [['metric' => 'published_vehicles', 'gte' => '1']],
        'too large' => [['metric' => 'published_vehicles', 'gte' => 1_000_001]],
        'unknown set' => [['metric' => 'set_completed', 'set' => 'nope', 'eq' => true]],
        'set missing' => [['metric' => 'set_completed', 'eq' => true]],
        'the hour of a spot (ADR-516 b)' => [['metric' => 'night_spots', 'gte' => 10]],
    ])->throws(ValidationException::class);
});

describe('the metrics', function () {
    it('counts each whitelisted metric for a member', function () {
        bsFlags();
        $member = giftMember(['founding_number' => 7, 'activated_at' => now()->subDays(400), 'xp' => 950]);
        $car = bsCar($member);
        bsMod($car);
        bsMod($car, ['category_id' => ModCategory::factory()->create()->id]);
        bsMod($car, ['brand_text' => null]);
        giftScore($car, 640);
        QrCode::factory()->create(['vehicle_id' => $car->id, 'status' => QrStatus::Active]);
        (new VehicleSpotStat)->forceFill(['vehicle_id' => $car->id, 'total' => 12, 'unique_spotters' => 11, 'cities_count' => 2])->save();
        $other = bsCar();
        bsSpot($member, $other, ['counted' => true, 'is_night' => true, 'is_first_three' => true, 'city_id' => dexCity('Essen')->id]);
        bsSpot($member, bsCar(), ['counted' => true, 'city_id' => dexCity('Bochum')->id]);
        bsSpot($member, bsCar(), ['counted' => false]);
        (new UserSetProgress)->forceFill(['user_id' => $member->id, 'set_key' => 'jdm-legends', 'period' => '', 'progress' => 13, 'target' => 13, 'completed_at' => now()])->save();
        InviteCode::factory()->create(['inviter_id' => $member->id, 'accepted_by' => giftMember()->id, 'accepted_at' => now()]);

        $value = fn (BadgeMetric $metric, ?string $set = null): int => app(BadgeMetrics::class)->values($metric, $set, [$member->id])[$member->id] ?? 0;

        expect($value(BadgeMetric::PublishedVehicles))->toBe(1)
            ->and($value(BadgeMetric::DocumentedMods))->toBe(2)
            ->and($value(BadgeMetric::DocumentedMods))->toBe(bsFacts($car)->documentedMods)
            ->and($value(BadgeMetric::ModCategories))->toBe(2)
            ->and($value(BadgeMetric::BuildScore))->toBe(640)
            ->and($value(BadgeMetric::CarsSpotted))->toBe(2)
            ->and($value(BadgeMetric::CitiesSpotted))->toBe(1)
            ->and($value(BadgeMetric::FirstSpotterFoils))->toBe(1)
            ->and($value(BadgeMetric::UniqueSpottersOfMyCars))->toBe(11)
            ->and($value(BadgeMetric::SetsCompleted))->toBe(1)
            ->and($value(BadgeMetric::SetCompleted, 'jdm-legends'))->toBe(1)
            ->and($value(BadgeMetric::SetCompleted, 'saison'))->toBe(0)
            ->and($value(BadgeMetric::StickerActive))->toBe(1)
            ->and($value(BadgeMetric::FoundingMember))->toBe(1)
            ->and($value(BadgeMetric::InvitesAccepted))->toBe(1)
            ->and($value(BadgeMetric::MemberDays))->toBeGreaterThanOrEqual(399)
            ->and($value(BadgeMetric::Level))->toBe(5)
            ->and($value(BadgeMetric::EventsAttended))->toBe(0)
            ->and($value(BadgeMetric::MaintenanceLogs))->toBe(0);
    });
});

describe('awarding', function () {
    it('awards on an event, once, with an in-app row and no push by default', function () {
        $member = giftMember();
        bsCar($member);

        expect(app(BadgeAwarder::class)->evaluate($member))->toContain('erster-build')
            ->and(app(BadgeAwarder::class)->evaluate($member))->toBe([])
            ->and(UserBadge::query()->where('user_id', $member->id)->where('badge_key', 'erster-build')->count())->toBe(1)
            ->and(Notification::query()->where('notifiable_id', $member->id)->where('type', NotificationType::BadgeUnlocked->value)->count())->toBe(1);
    });

    it('awards nothing to samples, unverified or suspended members, nor inactive badges', function () {
        foreach ([giftMember(['is_sample' => true]), User::factory()->unverified()->create(), User::factory()->suspended()->create()] as $member) {
            bsCar($member);
            expect(app(BadgeAwarder::class)->evaluate($member))->toBe([]);
        }

        $member = giftMember();
        Badge::query()->whereKey('erster-build')->update(['active' => false]);
        bsCar($member);
        expect(app(BadgeAwarder::class)->evaluate($member))->not->toContain('erster-build');
    });

    it('queues the check after a real action (a published car)', function () {
        $owner = giftMember();
        Sanctum::actingAs($owner);
        $draft = completeDraft($owner);
        $this->postJson("/api/v1/vehicles/{$draft->id}/publish", [], ['Idempotency-Key' => (string) Str::uuid()])->assertOk();

        expect(UserBadge::query()->where('user_id', $owner->id)->pluck('badge_key')->all())->toContain('erster-build');
    });

    it('awards retroactively at night, resumes after its time budget and stays idempotent', function () {
        config(['speedclub.badges.chunk' => 2, 'speedclub.badges.seconds' => 0]);
        $members = collect(range(1, 5))->map(fn () => giftMember());
        $members->each(fn (User $m) => bsCar($m));
        UserBadge::query()->delete();
        Cache::flush();

        $runs = 0;

        do {
            $result = app(BadgesNightly::class)->run();
            $runs++;
        } while ($result !== null && ! $result['done'] && $runs < 20);

        expect($runs)->toBeGreaterThan(1)
            ->and(UserBadge::query()->where('badge_key', 'erster-build')->count())->toBe(5)
            ->and(Notification::query()->where('type', 'badge_unlocked')->whereNotNull('pushed_at')->count())->toBe(0);

        Cache::flush();
        app(BadgesNightly::class)->run();
        expect(UserBadge::query()->where('badge_key', 'erster-build')->count())->toBe(5);
    });
});

describe('GET me/badges', function () {
    it('lists every active badge, earned first in time, hidden ones as ??? with their hint', function () {
        $member = giftMember();
        bsCar($member);
        app(BadgeAwarder::class)->evaluate($member);
        Sanctum::actingAs($member);

        $data = collect($this->getJson('/api/v1/me/badges', ['Accept-Language' => 'de'])->assertOk()->json('data'))->keyBy('key');

        expect($data)->toHaveCount(Badge::query()->where('active', true)->count())
            ->and($data['erster-build'])->toMatchArray(['hidden' => false, 'name' => 'Erster Build', 'tier' => 'bronze', 'category' => 'garage'])
            ->and($data['erster-build']['earned_at'])->not->toBeNull()
            ->and($data['erstentdecker'])->toMatchArray(['hidden' => true, 'name' => null, 'description' => null, 'earned_at' => null])
            ->and($data['erstentdecker']['hint'])->toBe('Sei früh dran, wenn ein Sticker neu ist.')
            ->and($data->has('erstes-treffen'))->toBeFalse();
    });

    it('shows a hidden badge in full once earned', function () {
        $member = giftMember();
        UserBadge::factory()->create(['user_id' => $member->id, 'badge_key' => 'erstentdecker']);
        Sanctum::actingAs($member);

        $badge = collect($this->getJson('/api/v1/me/badges', ['Accept-Language' => 'en'])->json('data'))->firstWhere('key', 'erstentdecker');

        expect($badge)->toMatchArray(['hidden' => false, 'name' => 'First finder']);
    });

    it('lists unseen unlocks once; POST me/badges/seen ends them (204, idempotent)', function () {
        $member = giftMember();
        bsCar($member);
        app(BadgeAwarder::class)->evaluate($member);
        Sanctum::actingAs($member);

        $unseen = $this->getJson('/api/v1/me/badges?unseen=1')->assertOk()->json('data');
        expect(collect($unseen)->pluck('key')->all())->toBe(['erster-build']);

        $headers = ['Idempotency-Key' => (string) Str::uuid()];
        $this->postJson('/api/v1/me/badges/seen', ['keys' => ['erster-build', 'nicht-verdient']], $headers)->assertNoContent();
        $this->postJson('/api/v1/me/badges/seen', ['keys' => ['erster-build', 'nicht-verdient']], $headers)->assertNoContent();

        expect($this->getJson('/api/v1/me/badges?unseen=1')->json('data'))->toBe([])
            ->and(UserBadge::query()->where('user_id', $member->id)->whereNotNull('seen_at')->count())->toBe(1);
    });

    it('takes the unseen flag as 0 or 1 only, as the contract writes it', function () {
        Sanctum::actingAs(giftMember());

        $this->getJson('/api/v1/me/badges?unseen=0')->assertOk();
        $this->getJson('/api/v1/me/badges?unseen=yes')->assertUnprocessable()->assertJsonValidationErrors(['unseen']);
    });

    it('validates the seen body', function (array $body) {
        Sanctum::actingAs(giftMember());
        $this->postJson('/api/v1/me/badges/seen', $body, ['Idempotency-Key' => (string) Str::uuid()])->assertUnprocessable()->assertJsonValidationErrors(['keys']);
    })->with([[[]], [['keys' => []]], [['keys' => 'erster-build']]]);

    it('is the member\'s own (guest 401, staff 401, restricted and unverified members read theirs)', function (Closure $who, int $status) {
        $viewer = $who();
        $viewer instanceof User ? Sanctum::actingAs($viewer) : ($viewer !== null ? actingAsStaff($viewer) : null);

        $this->getJson('/api/v1/me/badges')->assertStatus($status);
        $this->postJson('/api/v1/me/badges/seen', ['keys' => ['erster-build']], ['Idempotency-Key' => (string) Str::uuid()])->assertStatus($status === 200 ? 204 : $status);
    })->with([
        'guest' => [fn () => null, 401],
        'member' => [fn () => giftMember(), 200],
        'restricted' => [fn () => giftMember(['restrictions' => [RestrictionType::Publishing->value => ['until' => null]]]), 200],
        'unverified' => [fn () => User::factory()->unverified()->create(), 200],
        'staff' => [function () {
            seedStaffRoles();

            return staffWithRole('admin');
        }, 401],
    ]);
});

describe('GET users/{username}/badges', function () {
    it('shows another member\'s earned badges only, to guests too', function () {
        $member = giftMember();
        UserBadge::factory()->create(['user_id' => $member->id, 'badge_key' => 'erster-build']);
        UserBadge::factory()->create(['user_id' => $member->id, 'badge_key' => 'erstentdecker']);

        $keys = collect($this->getJson("/api/v1/users/{$member->username}/badges")->assertOk()->json('data'))->pluck('key')->sort()->values()->all();

        expect($keys)->toBe(['erstentdecker', 'erster-build']);
    });

    it('answers by the profile\'s visibility', function (Closure $who, int $status) {
        $member = giftMember();
        UserBadge::factory()->create(['user_id' => $member->id, 'badge_key' => 'erster-build']);
        $viewer = $who($member);
        $viewer instanceof User ? Sanctum::actingAs($viewer) : null;

        $this->getJson("/api/v1/users/{$member->username}/badges")->assertStatus($status);
    })->with([
        'guest' => [fn (User $m) => null, 200],
        'owner' => [fn (User $m) => $m, 200],
        'other member' => [fn (User $m) => giftMember(), 200],
        'restricted member' => [fn (User $m) => giftMember(['restrictions' => [RestrictionType::Publishing->value => ['until' => null]]]), 200],
        'blocked member' => [function (User $m) {
            $viewer = giftMember();
            giftBlock($m, $viewer);

            return $viewer;
        }, 404],
    ]);

    it('answers 404 for an unknown, suspended or unverified member', function (Closure $member) {
        $this->getJson('/api/v1/users/'.$member().'/badges')->assertNotFound()->assertJsonPath('code', 'member_unavailable');
    })->with([
        'unknown' => [fn () => 'gibtsnicht'],
        'suspended' => [fn () => User::factory()->suspended()->create()->username],
        'unverified' => [fn () => User::factory()->unverified()->create()->username],
    ]);
});

describe('the admin badge manager actions', function () {
    beforeEach(fn () => seedStaffRoles());

    it('lets owner, admin and content editor manage badges, nobody else', function (string $role, bool $allowed) {
        $staff = staffWithRole($role);
        $input = ['key' => 'garagen-tour', 'name_de' => 'Garagen-Tour', 'name_en' => 'Garage tour', 'description_de' => 'Drei Autos.', 'description_en' => 'Three cars.', 'rule_json' => ['metric' => 'published_vehicles', 'gte' => 3], 'tier' => 'silver', 'category' => 'garage'];

        try {
            app(SaveBadge::class)->handle($staff, null, $input);
            expect($allowed)->toBeTrue();
        } catch (AuthorizationException) {
            expect($allowed)->toBeFalse();
        }
    })->with([['owner', true], ['admin', true], ['content_editor', true], ['moderator', false], ['support', false], ['analyst', false]]);

    it('audits create, update, deactivate, activate and apply with before and after', function () {
        $staff = staffWithRole('content_editor');
        $badge = app(SaveBadge::class)->handle($staff, null, ['key' => 'garagen-tour', 'name_de' => 'Garagen-Tour', 'name_en' => 'Garage tour', 'description_de' => 'Drei Autos.', 'description_en' => 'Three cars.', 'rule_json' => ['metric' => 'published_vehicles', 'gte' => 3], 'tier' => 'silver', 'category' => 'garage']);
        app(SaveBadge::class)->handle($staff, $badge, ['rule_json' => ['metric' => 'published_vehicles', 'gte' => 2]]);
        app(SetBadgeActive::class)->handle($staff, $badge, false, 'Saisonpause');
        app(SetBadgeActive::class)->handle($staff, $badge, true);
        app(ApplyBadge::class)->handle($staff, $badge->fresh());

        $events = AuditEvent::query()->where('target_id', 'garagen-tour')->orderBy('id')->get();

        expect($events->pluck('action')->all())->toBe(['badge.created', 'badge.updated', 'badge.deactivated', 'badge.activated', 'badge.applied'])
            ->and($events->every(fn (AuditEvent $e): bool => $e->getRawOriginal('actor_type') === AuditActorType::Staff->value))->toBeTrue()
            ->and($events[1]->before['rule_json'])->toEqual(['metric' => 'published_vehicles', 'gte' => 3])
            ->and($events[1]->after['rule_json'])->toEqual(['metric' => 'published_vehicles', 'gte' => 2]);
    });

    it('refuses an invalid rule, a taken key and a hidden badge without a hint', function (array $input, string $field) {
        try {
            app(SaveBadge::class)->handle(staffWithRole('admin'), null, ['key' => 'neu-1', 'name_de' => 'N', 'name_en' => 'N', 'description_de' => 'D', 'description_en' => 'D', 'rule_json' => ['metric' => 'published_vehicles', 'gte' => 1], 'tier' => 'gold', 'category' => 'garage', ...$input]);
            $this->fail('expected a validation error');
        } catch (ValidationException $exception) {
            expect($exception->errors())->toHaveKey($field);
        }
    })->with([
        [['rule_json' => ['metric' => 'raw_sql', 'gte' => 1]], 'rule_json'],
        [['key' => 'erster-build'], 'key'],
        [['hidden' => true], 'hint_de'],
        [['tier' => 'platinum'], 'tier'],
    ]);

    it('previews how many real members a rule would give the badge today', function () {
        bsCar(giftMember());
        bsCar(giftMember());
        bsCar(giftMember(['is_sample' => true]));

        expect(app(PreviewBadgeRule::class)->handle(staffWithRole('content_editor'), ['metric' => 'published_vehicles', 'gte' => 1]))->toBe(2)
            ->and(app(PreviewBadgeRule::class)->handle(staffWithRole('content_editor'), ['metric' => 'published_vehicles', 'gte' => 2]))->toBe(0);
    });

    it('applies a badge now in chunks, to everybody who reached it', function () {
        config(['speedclub.badges.chunk' => 1, 'speedclub.badges.seconds' => 0]);
        collect(range(1, 3))->each(fn () => bsCar(giftMember()));
        UserBadge::query()->delete();

        app(ApplyBadge::class)->handle(staffWithRole('admin'), Badge::query()->findOrFail('erster-build'));

        expect(UserBadge::query()->where('badge_key', 'erster-build')->count())->toBe(3);
    });
});
