<?php

use App\Models\Follow;
use App\Models\User;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/SocialTestHelpers.php';

/**
 * M2.1 PROF-04: GET public/users/{username}/followers and /following, DELETE me/followers/{username} (contract §2).
 */
beforeEach(function () {
    $this->member = User::factory()->create(['username' => 'lukas.sc', 'display_name' => 'Lukas Scholz']);
});

describe('GET public/users/{username}/followers and /following', function () {
    it('lists followers newest first, as MemberSummaryResource plus is_self and is_following, with the count of the stats', function () {
        $old = User::factory()->create(['username' => 'alt.fan']);
        $new = User::factory()->create(['username' => 'neu.fan', 'display_name' => 'Neu Fan', 'city' => 'Ulm']);
        socFollow($old, $this->member, '2026-10-01 10:00:00');
        socFollow($new, $this->member, '2026-10-05 10:00:00');

        $response = $this->getJson('/api/v1/public/users/lukas.sc/followers')->assertOk()->assertHeader('ETag');

        expect(array_column($response->json('data'), 'username'))->toBe(['neu.fan', 'alt.fan'])
            ->and($response->json('data.0'))->toBe([
                'username' => 'neu.fan', 'display_name' => 'Neu Fan', 'city' => 'Ulm', 'avatar' => null, 'is_self' => false, 'is_following' => false,
            ])
            ->and($response->json('meta.next_cursor'))->toBeNull();

        $this->getJson('/api/v1/public/users/lukas.sc')->assertJsonPath('data.stats.followers', 2);
    });

    it('lists whom the member follows, newest first', function () {
        $first = User::factory()->create(['username' => 'erster']);
        $second = User::factory()->create(['username' => 'zweiter']);
        socFollow($this->member, $first, '2026-09-01 10:00:00');
        socFollow($this->member, $second, '2026-09-02 10:00:00');
        socFollow($first, $this->member);

        expect(array_column($this->getJson('/api/v1/public/users/lukas.sc/following')->assertOk()->json('data'), 'username'))->toBe(['zweiter', 'erster']);
    });

    it('breaks a tie of the same second by the newer follow', function () {
        $at = '2026-10-05 10:00:00';
        $a = socFollow(User::factory()->create(['username' => 'a.zuerst']), $this->member, $at);
        $b = socFollow(User::factory()->create(['username' => 'b.danach']), $this->member, $at);

        expect($b->id)->toBeGreaterThan($a->id)
            ->and(array_column($this->getJson('/api/v1/public/users/lukas.sc/followers')->json('data'), 'username'))->toBe(['b.danach', 'a.zuerst']);
    });

    it('pages with a cursor, 30 by default and at most 50, without repeating or losing a row', function () {
        foreach (range(1, 5) as $i) {
            socFollow(User::factory()->create(['username' => "fan.$i"]), $this->member, "2026-10-0{$i} 10:00:00");
        }

        $first = $this->getJson('/api/v1/public/users/lukas.sc/followers?per_page=2')->assertOk();
        $second = $this->getJson('/api/v1/public/users/lukas.sc/followers?per_page=2&cursor='.$first->json('meta.next_cursor'))->assertOk();
        $third = $this->getJson('/api/v1/public/users/lukas.sc/followers?per_page=2&cursor='.$second->json('meta.next_cursor'))->assertOk();

        expect([...array_column($first->json('data'), 'username'), ...array_column($second->json('data'), 'username'), ...array_column($third->json('data'), 'username')])
            ->toBe(['fan.5', 'fan.4', 'fan.3', 'fan.2', 'fan.1'])
            ->and($third->json('meta.next_cursor'))->toBeNull()
            ->and($this->getJson('/api/v1/public/users/lukas.sc/followers')->json('meta.per_page'))->toBe(30);
    });

    it('refuses a bad page size, a forged cursor and a long query', function (string $query, string $field) {
        $this->getJson('/api/v1/public/users/lukas.sc/followers?'.$query)->assertUnprocessable()
            ->assertJsonPath('code', 'validation_failed')
            ->assertJsonValidationErrorFor($field);
    })->with([
        'per_page 51' => ['per_page=51', 'per_page'],
        'per_page 0' => ['per_page=0', 'per_page'],
        'cursor of another list' => ['cursor='.rtrim(strtr(base64_encode((string) json_encode(['created_at' => '2026-01-01', 'id' => 1, '_pointsToNextItems' => true])), '+/', '-_'), '='), 'cursor'],
        'cursor not a cursor' => ['cursor=kaputt', 'cursor'],
        'q of 65 characters' => ['q='.str_repeat('a', 65), 'q'],
        'q as an array' => ['q[]=a', 'q'],
    ]);

    it('takes a query of 64 characters', function () {
        $this->getJson('/api/v1/public/users/lukas.sc/followers?q='.str_repeat('a', 64))->assertOk()->assertJsonCount(0, 'data');
    });

    it('searches by word prefix of username or display name, in any case, as member search does', function (string $q, array $expected) {
        socFollow(User::factory()->create(['username' => 'max.e46', 'display_name' => 'Max Krüger']), $this->member, '2026-10-03 10:00:00');
        socFollow(User::factory()->create(['username' => 'sara_gti', 'display_name' => 'Sara Yildiz-Brandt']), $this->member, '2026-10-02 10:00:00');
        socFollow(User::factory()->create(['username' => 'kenji.r34', 'display_name' => 'Kenji Tanaka']), $this->member, '2026-10-01 10:00:00');

        expect(array_column($this->getJson('/api/v1/public/users/lukas.sc/followers?q='.urlencode($q))->assertOk()->json('data'), 'username'))->toBe($expected);
    })->with([
        'username start' => ['MAX', ['max.e46']],
        'username part after a dot' => ['r34', ['kenji.r34']],
        'username part after an underscore' => ['gti', ['sara_gti']],
        'display name word' => ['tanaka', ['kenji.r34']],
        'display name part after a hyphen' => ['brandt', ['sara_gti']],
        'with @' => ['@kenji', ['kenji.r34']],
        'two words must both match' => ['max krüger', ['max.e46']],
        'no prefix inside a word' => ['ax', []],
        'nothing but punctuation finds nobody' => ['!!!', []],
        'a LIKE wildcard is a plain character' => ['%', []],
        'an empty query lists everybody' => ['', ['max.e46', 'sara_gti', 'kenji.r34']],
    ]);

    it('tells a signed-in viewer which rows they follow and which row is them', function () {
        $viewer = User::factory()->create(['username' => 'ich.selbst']);
        $followed = User::factory()->create(['username' => 'gefolgt']);
        $other = User::factory()->create(['username' => 'fremd']);
        socFollow($viewer, $this->member, '2026-10-03 10:00:00');
        socFollow($followed, $this->member, '2026-10-02 10:00:00');
        socFollow($other, $this->member, '2026-10-01 10:00:00');
        socFollow($viewer, $followed);
        Sanctum::actingAs($viewer);

        $rows = collect($this->getJson('/api/v1/public/users/lukas.sc/followers')->assertOk()->json('data'))->keyBy('username');

        expect($rows['ich.selbst'])->toMatchArray(['is_self' => true, 'is_following' => false])
            ->and($rows['gefolgt'])->toMatchArray(['is_self' => false, 'is_following' => true])
            ->and($rows['fremd'])->toMatchArray(['is_self' => false, 'is_following' => false]);
    });

    it('lists only publicly visible members, and counts the same set in the stats', function () {
        socFollow(User::factory()->create(['username' => 'sichtbar']), $this->member);
        socFollow(User::factory()->unverified()->create(), $this->member);
        socFollow(User::factory()->suspended()->create(), $this->member);
        socFollow(User::factory()->deactivated()->create(), $this->member);
        // Verified but without a username (M2.1 review #2): not in the list, so not in the count.
        socFollow(User::factory()->create(['username' => null]), $this->member);
        $deleted = User::factory()->create();
        socFollow($deleted, $this->member);
        $deleted->delete();

        expect(array_column($this->getJson('/api/v1/public/users/lukas.sc/followers')->json('data'), 'username'))->toBe(['sichtbar']);
        $this->getJson('/api/v1/public/users/lukas.sc')->assertJsonPath('data.stats.followers', 1);
    });

    it('leaves out rows across a block with the viewer, keeps the count and tells nothing about who is missing', function (string $direction) {
        $viewer = User::factory()->create();
        $hidden = User::factory()->create(['username' => 'versteckt']);
        socFollow($hidden, $this->member);
        socFollow(User::factory()->create(['username' => 'sichtbar']), $this->member);
        $direction === 'viewer blocked the row' ? socBlock($viewer, $hidden) : socBlock($hidden, $viewer);
        Sanctum::actingAs($viewer);

        $list = $this->getJson('/api/v1/public/users/lukas.sc/followers')->assertOk();

        expect(array_column($list->json('data'), 'username'))->toBe(['sichtbar'])
            ->and(json_encode($list->json()))->not->toContain('versteckt');
        $this->getJson('/api/v1/public/users/lukas.sc')->assertJsonPath('data.stats.followers', 2);

        // Anybody else still sees the row.
        app('auth')->forgetGuards();
        Sanctum::actingAs(User::factory()->create());
        expect(array_column($this->getJson('/api/v1/public/users/lukas.sc/followers')->json('data'), 'username'))->toContain('versteckt');
    })->with(['viewer blocked the row', 'the row blocked the viewer']);

    it('answers 404 member_unavailable when the profile is not visible to the viewer', function (string $list, Closure $state) {
        $viewer = $state($this->member);
        socActAs($viewer);

        $this->getJson("/api/v1/public/users/lukas.sc/$list")->assertNotFound()->assertJsonPath('code', 'member_unavailable');
    })->with(['followers', 'following'])->with([
        'nobody has the name' => [function (User $m) {
            $m->forceFill(['username' => 'anders'])->save();

            return null;
        }],
        'unverified' => [function (User $m) {
            $m->forceFill(['email_verified_at' => null])->save();

            return null;
        }],
        'suspended' => [function (User $m) {
            $m->forceFill(['status' => 'suspended', 'restrictions' => ['suspension' => ['until' => null]]])->save();

            return null;
        }],
        'deactivated' => [function (User $m) {
            $m->forceFill(['status' => 'deactivated'])->save();

            return null;
        }],
        'the member blocked the viewer' => [function (User $m) {
            $viewer = User::factory()->create();
            socBlock($m, $viewer);

            return $viewer;
        }],
        'the viewer blocked the member' => [function (User $m) {
            $viewer = User::factory()->create();
            socBlock($viewer, $m);

            return $viewer;
        }],
    ]);

    it('reads by who asks', function (Closure $viewer, int $status, ?string $code) {
        socFollow(User::factory()->create(), $this->member);
        socActAs($viewer($this->member));

        $response = $this->getJson('/api/v1/public/users/lukas.sc/followers')->assertStatus($status);

        if ($code !== null) {
            $response->assertJsonPath('code', $code);
        }
    })->with(socMatrix([
        'guest' => [200, null],
        'other member' => [200, null],
        'unverified member' => [200, null],
        'member restricted from publishing' => [200, null],
        'member restricted from messaging' => [200, null],
        'suspended member' => [200, null],
        'deactivated member' => [200, null],
        'member who blocked the other' => [404, 'member_unavailable'],
        'member the other blocked' => [404, 'member_unavailable'],
    ]));

    it('shows the member their own lists', function () {
        $fan = User::factory()->create(['username' => 'fan']);
        socFollow($fan, $this->member);
        Sanctum::actingAs($this->member);

        $this->getJson('/api/v1/public/users/lukas.sc/followers')->assertOk()->assertJsonPath('data.0.username', 'fan')->assertJsonPath('data.0.is_self', false);
    });

    it('follows an old username for 14 days', function () {
        $this->member->forceFill(['username' => 'lukas.neu', 'previous_username' => 'lukas.sc', 'username_changed_at' => now()->subDays(3)])->save();
        socFollow(User::factory()->create(['username' => 'fan']), $this->member);

        $this->getJson('/api/v1/public/users/lukas.sc/followers')->assertOk()->assertJsonPath('data.0.username', 'fan');
    });

    it('sits with the public routes: guests allowed, throttle:public-read, ETag, no member group', function (string $name) {
        $middleware = Route::getRoutes()->getByName($name)?->gatherMiddleware();

        expect($middleware)->toContain('throttle:public-read', 'etag')->not->toContain('member');
    })->with(['api.v1.public.users.followers', 'api.v1.public.users.following']);

    it('is limited per address', function () {
        socLimit('public_read');

        $this->getJson('/api/v1/public/users/lukas.sc/followers')->assertOk();
        $this->getJson('/api/v1/public/users/lukas.sc/following')->assertTooManyRequests()->assertJsonPath('code', 'rate_limited')->assertHeader('Retry-After');
    });

    it('answers 304 to a matching If-None-Match', function () {
        $etag = $this->getJson('/api/v1/public/users/lukas.sc/followers')->headers->get('ETag');

        $this->getJson('/api/v1/public/users/lukas.sc/followers', ['If-None-Match' => (string) $etag])->assertStatus(304);
    });

    it('speaks English', function () {
        $this->withHeader('Accept-Language', 'en')->getJson('/api/v1/public/users/niemand/followers')
            ->assertNotFound()->assertJsonPath('message', 'Profile not available.');
    });
});

describe('DELETE me/followers/{username}', function () {
    it('removes a follower, idempotently, and answers the name and follows_you false', function () {
        $fan = User::factory()->create(['username' => 'fan']);
        socFollow($fan, $this->member);
        socFollow($this->member, $fan);
        Sanctum::actingAs($this->member);

        $this->deleteJson('/api/v1/me/followers/FAN')->assertOk()->assertExactJson(['data' => ['username' => 'fan', 'follows_you' => false]]);
        $this->deleteJson('/api/v1/me/followers/fan')->assertOk()->assertJsonPath('data.follows_you', false);

        // Only the follower's follow goes: the member still follows the fan.
        expect(Follow::query()->where('follower_id', $fan->id)->exists())->toBeFalse()
            ->and(Follow::query()->where('follower_id', $this->member->id)->where('followee_id', $fan->id)->exists())->toBeTrue();
    });

    it('answers the same for any name, so it tells nothing about who exists', function (Closure $state) {
        $name = $state($this->member);
        Sanctum::actingAs($this->member);

        $this->deleteJson("/api/v1/me/followers/$name")->assertOk()->assertExactJson(['data' => ['username' => $name, 'follows_you' => false]]);

        expect(Follow::query()->where('followee_id', $this->member->id)->count())->toBe(0);
    })->with([
        'nobody' => [fn () => 'niemand'],
        'a member who does not follow' => [fn () => User::factory()->create(['username' => 'fremd'])->username],
        'a suspended follower' => [function (User $m) {
            $fan = User::factory()->suspended()->create(['username' => 'gesperrt']);
            socFollow($fan, $m);

            return 'gesperrt';
        }],
        'a follower across a block' => [function (User $m) {
            $fan = User::factory()->create(['username' => 'blockiert']);
            socFollow($fan, $m);
            socBlock($fan, $m);

            return 'blockiert';
        }],
    ]);

    it('removes only the follow to the signed-in member', function () {
        $fan = User::factory()->create(['username' => 'fan']);
        $other = User::factory()->create();
        socFollow($fan, $other);
        Sanctum::actingAs($this->member);

        $this->deleteJson('/api/v1/me/followers/fan')->assertOk();

        expect(Follow::query()->where('follower_id', $fan->id)->where('followee_id', $other->id)->exists())->toBeTrue();
    });

    it('lets the follower follow again', function () {
        $fan = User::factory()->create(['username' => 'fan']);
        socFollow($fan, $this->member);
        Sanctum::actingAs($this->member);
        $this->deleteJson('/api/v1/me/followers/fan')->assertOk();

        app('auth')->forgetGuards();
        Sanctum::actingAs($fan);
        $this->postJson('/api/v1/users/lukas.sc/follow')->assertOk()->assertJsonPath('data.is_following', true);
    });

    it('is open by who asks', function (Closure $viewer, int $status, ?string $code) {
        $fan = User::factory()->create(['username' => 'fan']);
        $actor = $viewer($fan);

        if ($actor !== null) {
            socFollow($fan, $actor);
        }

        socActAs($actor);

        $response = $this->deleteJson('/api/v1/me/followers/fan')->assertStatus($status);

        if ($code !== null) {
            $response->assertJsonPath('code', $code);
        }

        if ($actor !== null && $status === 200) {
            expect(Follow::query()->where('follower_id', $fan->id)->where('followee_id', $actor->id)->exists())->toBeFalse();
        }
    })->with(socMatrix([
        'guest' => [401, 'unauthenticated'],
        'other member' => [200, null],
        'unverified member' => [200, null],
        'member restricted from publishing' => [200, null],
        'member restricted from messaging' => [200, null],
        'suspended member' => [200, null],
        // M2.1 review #9: as block and save.
        'deactivated member' => [403, 'forbidden'],
        'member who blocked the other' => [200, null],
        'member the other blocked' => [200, null],
    ]));

    it('refuses a deactivated member also when nobody follows them', function () {
        Sanctum::actingAs(User::factory()->deactivated()->create());

        $this->deleteJson('/api/v1/me/followers/niemand')->assertForbidden()->assertJsonPath('code', 'forbidden');
    });

    it('shares the 200 unfollows a day', function () {
        socLimit('unfollows');
        Sanctum::actingAs($this->member);

        $this->deleteJson('/api/v1/me/followers/a')->assertOk();
        $this->deleteJson('/api/v1/users/b/follow')->assertTooManyRequests()->assertJsonPath('code', 'rate_limited');
    });

    it('carries member and throttle:unfollows, not verified-member', function () {
        $middleware = Route::getRoutes()->getByName('api.v1.me.followers.destroy')?->gatherMiddleware();

        expect($middleware)->toContain('member', 'throttle:unfollows')->not->toContain('verified-member');
    });
});
