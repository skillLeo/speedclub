<?php

use App\Actions\Admin\Moderation\RemoveSpots;
use App\Enums\RestrictionType;
use App\Enums\XpType;
use App\Jobs\BuildScore\RecomputeBuildScore;
use App\Models\Spot;
use App\Models\User;
use App\Models\XpEvent;
use App\Services\BuildScore\BuildScores;
use App\Services\Progress\Levels;
use App\Services\Progress\Xp;
use App\Services\Progress\XpHooks;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/GiftTestHelpers.php';
require_once __DIR__.'/../BuildScore/BuildScoreTestHelpers.php';
require_once __DIR__.'/../Admin/Support/helpers.php';

/**
 * M5.9d XP and levels (m5.9d contract §1, §9, §10.1): one event per source, the daily cap with capped rows, per-type day maxima, the
 * hooks of the real actions, never for likes, reactions or sign-ins, never for samples; the level ladder and GET me/level.
 */
beforeEach(fn () => $this->travelTo(Carbon::parse('2026-07-10 12:00', 'Europe/Berlin')));

describe('the ledger', function () {
    it('awards a source once', function () {
        $member = giftMember();
        $xp = app(Xp::class);

        expect($xp->award($member, XpType::DocumentedMod, 'modification', 'm1'))->not->toBeNull()
            ->and($xp->award($member, XpType::DocumentedMod, 'modification', 'm1'))->toBeNull()
            ->and(XpEvent::query()->count())->toBe(1)
            ->and($member->fresh()->xp)->toBe(20);
    });

    it('caps a Berlin day at 200 XP and keeps capped events auditable with what was left', function () {
        $member = giftMember();
        $xp = app(Xp::class);

        foreach (range(1, 9) as $i) {
            $xp->award($member, XpType::DocumentedMod, 'modification', "m$i");
        }

        // 180 so far: the tenth gets the 20 that are left, the eleventh nothing.
        $tenth = $xp->award($member, XpType::DocumentedMod, 'modification', 'm10');
        $eleventh = $xp->award($member, XpType::SetCompleted, 'dex_set', 'saison:2026');

        expect($tenth->points)->toBe(20)->and($tenth->capped)->toBeFalse()
            ->and($eleventh->points)->toBe(0)->and($eleventh->capped)->toBeTrue()
            ->and($xp->today($member))->toBe(200)
            ->and($member->fresh()->xp)->toBe(200);

        // A capped source never earns again, the next Berlin day starts at 0.
        $this->travelTo(Carbon::parse('2026-07-11 00:30', 'Europe/Berlin'));
        expect($xp->award($member, XpType::SetCompleted, 'dex_set', 'saison:2026'))->toBeNull()
            ->and($xp->award($member, XpType::SetCompleted, 'dex_set', 'jdm-legends')->points)->toBe(100);
    });

    it('cuts an award to the rest of the cap and marks it capped', function () {
        $member = giftMember();
        $xp = app(Xp::class);

        foreach (range(1, 19) as $i) {
            $xp->award($member, XpType::NewSpot, 'spot', "s$i");
        }

        $event = $xp->award($member, XpType::SetCompleted, 'dex_set', 'stadtkenner');

        expect($event->points)->toBe(10)->and($event->capped)->toBeTrue()->and($xp->today($member))->toBe(200);
    });

    it('lets one build update a day earn and "Hilfreich" at most 20 XP a day', function () {
        $member = giftMember();
        $xp = app(Xp::class);

        expect($xp->award($member, XpType::BuildUpdate, 'build_update', 'u1')->points)->toBe(15)
            ->and($xp->award($member, XpType::BuildUpdate, 'build_update', 'u2')->points)->toBe(0);

        foreach (range(1, 12) as $i) {
            $xp->award($member, XpType::HelpfulReceived, 'forum_vote', "v$i");
        }

        expect((int) XpEvent::query()->where('type', XpType::HelpfulReceived->value)->sum('points'))->toBe(20)
            ->and(XpEvent::query()->where('type', XpType::HelpfulReceived->value)->where('capped', true)->count())->toBe(2);
    });

    it('gives samples, unverified, pending, suspended and deleted members nothing', function (Closure $member) {
        expect(app(Xp::class)->award($member(), XpType::FirstVehicle, 'user', 'x'))->toBeNull()
            ->and(XpEvent::query()->count())->toBe(0);
    })->with([
        'sample' => [fn () => giftMember(['is_sample' => true])],
        'unverified' => [fn () => User::factory()->unverified()->create()],
        'terms pending' => [fn () => giftMember(['onboarding_state' => 'pending_terms'])],
        'suspended' => [fn () => User::factory()->suspended()->create()],
        'deleted' => [function () {
            $user = giftMember();
            $user->delete();

            return $user;
        }],
    ]);

    it('takes back only the event of a source staff removed', function () {
        $member = giftMember();
        $xp = app(Xp::class);
        $xp->award($member, XpType::NewSpot, 'spot', 'a');
        $xp->award($member, XpType::NewSpot, 'spot', 'b');

        expect($xp->revoke(XpType::NewSpot, 'spot', 'a'))->toBe(1)
            ->and($member->fresh()->xp)->toBe(10)
            ->and(XpEvent::query()->pluck('ref_id')->all())->toBe(['b']);
    });
});

describe('the hooks', function () {
    it('gives 50 XP for the first published car, once per member', function () {
        $owner = giftMember();
        Sanctum::actingAs($owner);

        foreach ([completeDraft($owner), completeDraft($owner)] as $draft) {
            $this->postJson("/api/v1/vehicles/{$draft->id}/publish", [], ['Idempotency-Key' => (string) Str::uuid()])->assertOk();
        }

        expect(XpEvent::query()->where('type', 'first_vehicle')->count())->toBe(1)->and($owner->fresh()->xp)->toBe(50);
    });

    it('gives 20 XP per documented mod of a published car, by the Build Score rule', function () {
        $owner = giftMember();
        $car = bsCar($owner);
        $documented = bsMod($car);
        bsMod($car, ['brand_text' => null]);
        bsMod($car, ['installed_on' => null]);
        bsMod($car, [], photo: false);
        bsMod($car, ['status' => 'planned']);

        (new RecomputeBuildScore($car->id))->handle(app(BuildScores::class));
        (new RecomputeBuildScore($car->id))->handle(app(BuildScores::class));

        expect(XpEvent::query()->where('type', 'documented_mod')->pluck('ref_id')->all())->toBe([$documented->id])
            ->and(bsFacts($car)->documentedMods)->toBe(1);
    });

    it('gives a documented mod of a draft or a sample car nothing', function () {
        $draft = bsCar(null, ['status' => 'draft', 'published_at' => null]);
        bsMod($draft);
        $sample = bsCar(null, ['is_sample' => true]);
        bsMod($sample);

        app(XpHooks::class)->documentedMods($draft->id);
        app(XpHooks::class)->documentedMods($sample->id);

        expect(XpEvent::query()->count())->toBe(0);
    });

    it('gives 15 XP for a build update and caps posting volume at one a day', function () {
        $owner = giftMember();
        $car = bsCar($owner);
        Sanctum::actingAs($owner);

        foreach (['Neue Felgen montiert.', 'Fahrwerk eingestellt.'] as $text) {
            $this->postJson("/api/v1/vehicles/{$car->id}/updates", ['note' => $text], ['Idempotency-Key' => (string) Str::uuid()])->assertCreated();
        }

        expect(XpEvent::query()->where('type', 'build_update')->count())->toBe(2)->and($owner->fresh()->xp)->toBe(15);
    });

    it('gives 10 XP for the first counted spot of a car and none for a later one; staff removal takes it back', function () {
        [$car, $code] = dexCar(giftMember());
        $spotter = giftMember();

        dexSpot($spotter, $code)->assertCreated();
        $this->travel(2)->days();
        dexSpot($spotter, $code)->assertCreated();

        expect(XpEvent::query()->where('type', 'new_spot')->count())->toBe(1)->and($spotter->fresh()->xp)->toBe(10);

        seedStaffRoles();
        $first = Spot::query()->orderBy('created_at')->firstOrFail();
        app(RemoveSpots::class)->one(staffWithRole('moderator'), $first->id, 'Missbrauch: Spot ohne Auto vor Ort.');

        expect(XpEvent::query()->where('type', 'new_spot')->count())->toBe(0)->and($spotter->fresh()->xp)->toBe(0);
    });

    it('gives an uncounted spot, a sample car and a young account nothing', function () {
        [, $sampleCode] = dexCar(giftMember(), ['is_sample' => true]);
        [, $code] = dexCar(giftMember());
        bsFlags(['editorial_samples' => true]);

        dexSpot(User::factory()->create(['created_at' => now()->subHour()]), $code)->assertCreated();
        dexSpot(giftMember(), $sampleCode);

        expect(XpEvent::query()->where('type', 'new_spot')->count())->toBe(0);
    });

    it('gives 100 XP when a Dex set completes, once per set and period', function () {
        $member = giftMember();
        app(XpHooks::class)->setCompleted($member, 'saison', '2026');
        app(XpHooks::class)->setCompleted($member, 'saison', '2026');
        app(XpHooks::class)->setCompleted($member, 'saison', '2027');

        expect(XpEvent::query()->where('type', 'set_completed')->pluck('ref_id')->sort()->values()->all())->toBe(['saison:2026', 'saison:2027']);
    });

    it('never awards XP for reactions, follows or signing in', function () {
        bsFlags();
        $owner = giftMember();
        $car = bsCar($owner);
        $fan = giftMember();
        Sanctum::actingAs($fan);
        $this->postJson("/api/v1/vehicles/{$car->id}/reactions", ['type' => 'stark'], ['Idempotency-Key' => (string) Str::uuid()]);
        $this->postJson("/api/v1/vehicles/{$car->id}/follow", [], ['Idempotency-Key' => (string) Str::uuid()]);
        $this->postJson('/api/v1/auth/login', ['email' => $owner->email, 'password' => 'password', 'device_name' => 'Pixel 8']);

        expect(XpEvent::query()->count())->toBe(0)->and(collect(XpType::cases())->map->value->all())
            ->not->toContain('reaction', 'like', 'login', 'follow', 'post');
    });
});

describe('levels', function () {
    it('climbs the ten levels from Street Rookie to Kaido Legend', function (int $xp, int $level, string $title, ?int $next) {
        app()->setLocale('en');
        $read = app(Levels::class)->for($xp);

        expect($read['level'])->toBe($level)->and($read['title'])->toBe($title)->and($read['next_level_xp'])->toBe($next)
            ->and($read['progress'])->toBeGreaterThanOrEqual(0.0)->toBeLessThanOrEqual(1.0);
    })->with([
        [0, 1, 'Street Rookie', 100],
        [99, 1, 'Street Rookie', 100],
        [100, 2, 'Garage Regular', 250],
        [900, 5, 'Build Crafter', 1500],
        [7499, 9, 'Garage Legend', 7500],
        [7500, 10, 'Kaido Legend', null],
        [99999, 10, 'Kaido Legend', null],
    ]);

    it('names no level after speed or racing', function () {
        foreach (['de', 'en'] as $locale) {
            foreach (trans('levels.titles', [], $locale) as $title) {
                expect(mb_strtolower($title))->not->toMatch('/speed|race|racer|rennen|renn|tempo|schnell|fast|drift|drag|top ?speed|0-100/');
            }
        }
    });

    it('measures progress inside a level', function () {
        expect(app(Levels::class)->for(175)['progress'])->toBe(0.5);
    });
});

describe('GET me/level', function () {
    it('answers the member with level, title, XP, next level, progress, today and the rules', function () {
        $member = giftMember();
        app(Xp::class)->award($member, XpType::DocumentedMod, 'modification', 'm1');
        $member->forceFill(['xp' => 120])->save();
        Sanctum::actingAs($member);

        $this->getJson('/api/v1/me/level', ['Accept-Language' => 'de'])->assertOk()
            ->assertExactJson(['data' => [
                'level' => 2,
                'title' => 'Garagen-Stammgast',
                'xp' => 120,
                'next_level_xp' => 250,
                'progress' => 0.1333,
                'today' => ['earned' => 20, 'cap' => 200],
                'rules' => [
                    ['type' => 'first_vehicle', 'points' => 50, 'daily_max' => null],
                    ['type' => 'documented_mod', 'points' => 20, 'daily_max' => null],
                    ['type' => 'build_update', 'points' => 15, 'daily_max' => 15],
                    ['type' => 'new_spot', 'points' => 10, 'daily_max' => null],
                    ['type' => 'set_completed', 'points' => 100, 'daily_max' => null],
                    ['type' => 'event_checkin', 'points' => 40, 'daily_max' => null],
                    ['type' => 'forum_solution', 'points' => 30, 'daily_max' => null],
                    ['type' => 'helpful_received', 'points' => 2, 'daily_max' => 20],
                ],
                'ladder' => [
                    ['level' => 1, 'title' => 'Street Rookie', 'from_xp' => 0],
                    ['level' => 2, 'title' => 'Garagen-Stammgast', 'from_xp' => 100],
                    ['level' => 3, 'title' => 'Schrauber-Azubi', 'from_xp' => 250],
                    ['level' => 4, 'title' => 'Teilejäger', 'from_xp' => 500],
                    ['level' => 5, 'title' => 'Build-Handwerker', 'from_xp' => 900],
                    ['level' => 6, 'title' => 'Bekanntes Gesicht', 'from_xp' => 1500],
                    ['level' => 7, 'title' => 'Detail-Meister', 'from_xp' => 2400],
                    ['level' => 8, 'title' => 'Szene-Veteran', 'from_xp' => 3600],
                    ['level' => 9, 'title' => 'Garagen-Legende', 'from_xp' => 5200],
                    ['level' => 10, 'title' => 'Kaido Legend', 'from_xp' => 7500],
                ],
            ]]);
    });

    it('names the ladder in the request language and ends it at the top level', function () {
        $member = giftMember();
        $member->forceFill(['xp' => 9000])->save();
        Sanctum::actingAs($member);

        $data = $this->getJson('/api/v1/me/level', ['Accept-Language' => 'en'])->assertOk()->json('data');

        expect($data['level'])->toBe(10)
            ->and($data['next_level_xp'])->toBeNull()
            ->and($data['ladder'])->toHaveCount(10)
            ->and($data['ladder'][1])->toBe(['level' => 2, 'title' => 'Garage Regular', 'from_xp' => 100])
            ->and(array_column($data['ladder'], 'from_xp'))->toBe([0, 100, 250, 500, 900, 1500, 2400, 3600, 5200, 7500]);
    });

    it('is the member\'s own (guest 401, staff 401; restricted and unverified members read theirs)', function (Closure $who, int $status) {
        $viewer = $who();

        if ($viewer instanceof User) {
            Sanctum::actingAs($viewer);
        } elseif ($viewer !== null) {
            actingAsStaff($viewer);
        }

        $this->getJson('/api/v1/me/level')->assertStatus($status);
    })->with([
        'guest' => [fn () => null, 401],
        'member' => [fn () => giftMember(), 200],
        'restricted' => [fn () => giftMember()->forceFill(['restrictions' => [RestrictionType::Publishing->value => ['until' => null]]]), 200],
        'unverified' => [fn () => User::factory()->unverified()->create(), 200],
        'staff' => [function () {
            seedStaffRoles();

            return staffWithRole('admin');
        }, 401],
    ]);

    it('puts the quiet level and the founding number on the own and the public profile', function () {
        $member = giftMember(['xp' => 600, 'founding_number' => 42]);
        Sanctum::actingAs($member);

        $this->getJson('/api/v1/me/profile', ['Accept-Language' => 'en'])->assertOk()
            ->assertJsonPath('data.level', ['level' => 4, 'title' => 'Parts Hunter'])
            ->assertJsonPath('data.founding_number', 42);
        $this->getJson("/api/v1/public/users/{$member->username}", ['Accept-Language' => 'de'])->assertOk()
            ->assertJsonPath('data.level', ['level' => 4, 'title' => 'Teilejäger'])
            ->assertJsonPath('data.founding_number', 42);
    });
});
