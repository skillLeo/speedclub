<?php

use App\Enums\RestrictionType;
use App\Models\Staff;
use App\Models\User;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\Sanctum;

// R4-1.4 (INTRO-01…04): GET me carries intro_seen_at; POST me/intro/seen sets it once per account.

describe('GET me', function () {
    it('answers the signed-in member with intro_seen_at null before the introduction', function () {
        $member = User::factory()->create();
        Sanctum::actingAs($member);

        $this->getJson('/api/v1/me')
            ->assertOk()
            ->assertJsonPath('data.id', $member->id)
            ->assertJsonPath('data.intro_seen_at', null);
    });

    it('carries the same intro_seen_at in auth/me and me/profile', function () {
        $member = User::factory()->create();
        $member->forceFill(['intro_seen_at' => now()->subDay()])->save();
        Sanctum::actingAs($member);

        $expected = $member->fresh()?->getAttribute('intro_seen_at');
        $iso = Carbon::parse($expected)->toIso8601String();

        $this->getJson('/api/v1/me')->assertOk()->assertJsonPath('data.intro_seen_at', $iso);
        $this->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('data.intro_seen_at', $iso);
        $this->getJson('/api/v1/me/profile')->assertOk()->assertJsonPath('data.intro_seen_at', $iso);
    });

    it('never asks sample or editorial accounts for the introduction', function (array $state) {
        Sanctum::actingAs(User::factory()->create($state));

        expect($this->getJson('/api/v1/me')->assertOk()->json('data.intro_seen_at'))->toBeString();
    })->with([
        'sample' => [['is_sample' => true]],
        'editorial' => [['is_sample' => true, 'is_editorial' => true]],
    ]);

    it('answers 401 to a guest', function () {
        $this->getJson('/api/v1/me')->assertUnauthorized()->assertJsonPath('code', 'unauthenticated');
    });
});

describe('POST me/intro/seen', function () {
    it('marks the introduction as seen and stays idempotent', function () {
        $this->freezeSecond();
        $member = User::factory()->create();
        Sanctum::actingAs($member);

        $this->postJson('/api/v1/me/intro/seen')->assertNoContent();
        $first = $member->fresh()?->getAttribute('intro_seen_at');
        expect($first)->not->toBeNull();

        $this->travel(2)->days();
        $this->postJson('/api/v1/me/intro/seen')->assertNoContent();

        expect($member->fresh()?->getAttribute('intro_seen_at'))->toBe($first);
        $this->getJson('/api/v1/me')->assertJsonPath('data.intro_seen_at', Carbon::parse($first)->toIso8601String());
    });

    it('lets every signed-in member through and stops the rest', function (Closure $actor, int $status, ?string $code) {
        $actor();

        $response = $this->postJson('/api/v1/me/intro/seen')->assertStatus($status);

        if ($code !== null) {
            $response->assertJsonPath('code', $code);
        }
    })->with([
        'guest' => [fn () => null, 401, 'unauthenticated'],
        'member' => [fn () => Sanctum::actingAs(User::factory()->create()), 204, null],
        'unverified' => [fn () => Sanctum::actingAs(User::factory()->registered()->create()), 204, null],
        'restricted from publishing' => [fn () => Sanctum::actingAs(User::factory()->restrictedFrom(RestrictionType::Publishing)->create()), 204, null],
        'deactivated' => [fn () => Sanctum::actingAs(User::factory()->deactivated()->create()), 403, 'forbidden'],
        'staff session' => [fn () => test()->withCredentials()->withCookie('sc_staff_session', databaseSessionFor(Staff::factory()->create(), 'staff'))->withHeader('Origin', 'http://localhost:8080'), 401, 'unauthenticated'],
    ]);

    it('only touches the caller', function () {
        $member = User::factory()->create();
        $other = User::factory()->create();
        Sanctum::actingAs($member);

        $this->postJson('/api/v1/me/intro/seen')->assertNoContent();

        expect($other->fresh()?->getAttribute('intro_seen_at'))->toBeNull();
    });

    it('is rate limited with the account edits', function () {
        $member = User::factory()->create();
        Sanctum::actingAs($member);
        $max = config()->integer('speedclub.rate_limits.account_edits.max');

        for ($i = 0; $i < $max; $i++) {
            $this->postJson('/api/v1/me/intro/seen')->assertNoContent();
        }

        $this->postJson('/api/v1/me/intro/seen')->assertStatus(429)->assertJsonPath('code', 'rate_limited');
    });
});
