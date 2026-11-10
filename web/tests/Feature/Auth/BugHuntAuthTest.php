<?php

use App\Actions\Auth\RotateMemberToken;
use App\Enums\MemberSecurityEvent;
use App\Http\RateLimits;
use App\Models\AuditEvent;
use App\Models\PersonalAccessToken;
use App\Models\User;
use Illuminate\Support\Facades\Mail;

require_once dirname(__DIR__).'/Garage/GarageTestHelpers.php';

/**
 * The account findings of the Phase 1 bug hunt (docs/reports/phase-1/bug-hunt.md).
 */
const BH_PASSWORD = 'Lackierung-92-rot';

beforeEach(function () {
    Mail::fake();
});

/**
 * A device's token, seen by the guard afresh on each request, as on the real stack.
 *
 * @return array{0: User, 1: string}
 */
function bhOldToken(): array
{
    $member = User::factory()->create();
    $response = test()->postJson('/api/v1/auth/login', ['email' => $member->email, 'password' => 'password', 'device_name' => 'Pixel 9', 'platform' => 'android', 'app_version' => '0.1.0']);
    $token = $response->assertOk()->json('data.token');
    app('auth')->forgetGuards();
    test()->travel(8)->days();

    return [$member, $token];
}

function bhCall(string $token, string $method = 'POST', string $path = '/api/v1/auth/token/rotate'): mixed
{
    app('auth')->forgetGuards();

    return test()->withToken($token)->json($method, $path);
}

/**
 * @return list<int>
 */
function bhTokenIds(User $member): array
{
    return $member->tokens()->orderBy('id')->pluck('id')->all();
}

describe('BH-06: sign-up refuses an address no mail can reach', function () {
    function bhRegistration(string $email): array
    {
        return ['email' => $email, 'password' => BH_PASSWORD, 'accepted_age_16' => true, 'accepted_terms' => true, 'accepted_privacy' => true];
    }

    it('refuses an umlaut in the local part with the normal e-mail error', function (string $email) {
        $this->withHeader('Accept-Language', 'de');
        $normal = $this->postJson('/api/v1/auth/register', bhRegistration('keine-adresse'))->assertUnprocessable()->json('errors.email.0');

        $this->postJson('/api/v1/auth/register', bhRegistration($email))
            ->assertUnprocessable()
            ->assertJsonPath('code', 'validation_failed')
            ->assertJsonPath('errors.email.0', $normal);

        expect(User::query()->where('email', mb_strtolower($email))->exists())->toBeFalse();
    })->with(['jürgen@gmail.com', 'JÜRGEN@gmail.com', 'жена@example.de', 'jürgen@müller.de']);

    it('still takes an umlaut in the domain, and one that is written out, storing the domain in ASCII (recheck round 3)', function (string $email, string $stored) {
        $this->postJson('/api/v1/auth/register', bhRegistration($email))->assertStatus(202);

        expect(User::query()->where('email', $stored)->exists())->toBeTrue();
    })->with([
        ['max@müller.de', 'max@xn--mller-kva.de'],
        ['max@xn--mller-kva.de', 'max@xn--mller-kva.de'],
        ['max.mustermann+garage@example.de', 'max.mustermann+garage@example.de'],
    ]);

    it('leaves the neutral answers of sign-in and forgot alone', function () {
        $this->postJson('/api/v1/auth/login', ['email' => 'jürgen@gmail.com', 'password' => BH_PASSWORD, 'device_name' => 'Pixel 9'])
            ->assertUnauthorized()
            ->assertJsonPath('code', 'invalid_credentials');

        $this->postJson('/api/v1/auth/password/forgot', ['email' => 'jürgen@gmail.com'])->assertStatus(202);
    });
});

describe('BH-29: the wall is the app\'s, not the server\'s', function () {
    it('lets an unverified member browse', function (string $path) {
        $vehicle = publishedVehicle();
        $member = User::factory()->unverified()->create();
        $token = $member->createToken('Pixel 9')->plainTextToken;

        bhCall($token, 'GET', str_replace('{slug}', $vehicle->canonicalSlug(), $path))->assertOk();
    })->with(['/api/v1/home/new-builds', '/api/v1/discover', '/api/v1/public/vehicles/{slug}']);

    it('still stops the same member from publishing', function () {
        $member = User::factory()->unverified()->create();
        $draft = completeDraft($member);

        bhCall($member->createToken('Pixel 9')->plainTextToken, 'POST', "/api/v1/vehicles/{$draft->id}/publish")
            ->assertForbidden()
            ->assertJsonPath('code', 'email_not_verified');
    });
});

describe('BH-33: logout can be sent again', function () {
    it('answers 204 once and 401 after that, so a retry can tell it is done', function () {
        $member = User::factory()->create();
        $token = $member->createToken('Pixel 9')->plainTextToken;

        bhCall($token, 'POST', '/api/v1/auth/logout')->assertNoContent();
        bhCall($token, 'POST', '/api/v1/auth/logout')->assertUnauthorized()->assertJsonPath('code', 'unauthenticated');
    });
});

describe('BH-36: a lost rotation answer does not end the session', function () {
    it('gives the replaced token a short grace instead of deleting it', function () {
        [$member, $old] = bhOldToken();

        $new = bhCall($old)->assertOk()->json('data.token');

        expect($new)->not->toBe($old)
            ->and($member->tokens()->count())->toBe(2);

        // The old one keeps working, for requests in flight and for the lost answer.
        bhCall($old, 'GET', '/api/v1/auth/me')->assertOk();
        bhCall($new, 'GET', '/api/v1/auth/me')->assertOk();

        $replaced = PersonalAccessToken::findToken($old);

        expect(now()->diffInSeconds($replaced->expires_at))->toBeGreaterThan(118)->toBeLessThanOrEqual(120);
    });

    it('holds the grace in a config value of two minutes', function () {
        expect(config('speedclub.tokens.rotation_grace_seconds'))->toBe(120);
    });

    it('lost answer, then retry: a fresh token, and the unclaimed one is gone', function () {
        [$member, $old] = bhOldToken();

        $lost = bhCall($old)->assertOk()->json('data.token');
        $this->travel(30)->seconds();
        $fresh = bhCall($old)->assertOk()->json('data.token');

        expect($fresh)->not->toBe($lost)->not->toBe($old)
            ->and(PersonalAccessToken::findToken($lost))->toBeNull()
            ->and($member->tokens()->count())->toBe(2);

        bhCall($lost, 'GET', '/api/v1/auth/me')->assertUnauthorized();
        bhCall($fresh, 'GET', '/api/v1/auth/me')->assertOk();
    });

    it('never extends a grace that is running', function () {
        [, $old] = bhOldToken();

        bhCall($old)->assertOk();
        $expires = PersonalAccessToken::findToken($old)->expires_at;
        $this->travel(90)->seconds();
        bhCall($old)->assertOk();

        expect(PersonalAccessToken::findToken($old)->expires_at->equalTo($expires))->toBeTrue();

        $this->travel(31)->seconds();
        bhCall($old, 'GET', '/api/v1/auth/me')->assertUnauthorized();
    });

    it('never gives a token that is about to expire more time than it has', function () {
        [$member, $old] = bhOldToken();
        $soon = now()->addSeconds(40);
        $member->tokens()->sole()->forceFill(['expires_at' => $soon])->save();

        bhCall($old)->assertOk();

        expect(PersonalAccessToken::findToken($old)->expires_at->timestamp)->toBe($soon->timestamp);
    });

    it('claimed token, then replay: 409, the old token goes at once, the new one stays', function () {
        [$member, $old] = bhOldToken();

        $new = bhCall($old)->assertOk()->json('data.token');
        bhCall($new, 'GET', '/api/v1/auth/me')->assertOk();

        bhCall($old)->assertStatus(409)->assertJsonPath('code', 'conflict');

        expect(PersonalAccessToken::findToken($old))->toBeNull()
            ->and($member->tokens()->count())->toBe(1);

        bhCall($old, 'GET', '/api/v1/auth/me')->assertUnauthorized();
        bhCall($new, 'GET', '/api/v1/auth/me')->assertOk();
    });

    it('records the replay as a security event, without the token', function () {
        [$member, $old] = bhOldToken();

        $new = bhCall($old)->assertOk()->json('data.token');
        bhCall($new, 'GET', '/api/v1/auth/me')->assertOk();
        bhCall($old)->assertStatus(409);

        $event = AuditEvent::query()->where('action', MemberSecurityEvent::TokenReplayed->value)->sole();

        expect($event->getAttribute('target_id'))->toBe($member->id)
            ->and((string) json_encode($event->toArray()))->not->toContain($old)->not->toContain($new);
    });

    it('expired grace: the old token fails as usual and leaves the new one alone', function () {
        [$member, $old] = bhOldToken();

        $new = bhCall($old)->assertOk()->json('data.token');
        $this->travel(121)->seconds();

        bhCall($old)->assertUnauthorized()->assertJsonPath('code', 'unauthenticated');
        bhCall($old, 'GET', '/api/v1/auth/me')->assertUnauthorized();
        bhCall($new, 'GET', '/api/v1/auth/me')->assertOk();

        expect($member->tokens()->count())->toBe(2);
    });

    it('two parallel calls: the one that waited at the lock replaces the other, and one new token stays', function () {
        [$member, $old] = bhOldToken();
        $token = PersonalAccessToken::findToken($old);
        // What a call read before the lock: both hold the same token, and neither sees what the other did until it has the lock.
        $first = User::query()->findOrFail($member->id)->withAccessToken($token);
        $second = User::query()->findOrFail($member->id)->withAccessToken($token);

        $one = app(RotateMemberToken::class)->handle($first);
        $two = app(RotateMemberToken::class)->handle($second);

        expect($two->token)->not->toBe($one->token)
            ->and(PersonalAccessToken::findToken($one->token))->toBeNull()
            ->and(PersonalAccessToken::findToken($two->token))->not->toBeNull()
            ->and($member->tokens()->count())->toBe(2);
    });

    it('keeps one token per device for everything else', function () {
        [$member, $old] = bhOldToken();
        $other = $member->createToken('iPad')->plainTextToken;
        $otherId = PersonalAccessToken::findToken($other)->id;

        bhCall($old)->assertOk();
        bhCall($old)->assertOk();

        expect(PersonalAccessToken::query()->whereKey($otherId)->exists())->toBeTrue()
            ->and($member->tokens()->count())->toBe(3);
    });

    it('writes down a retry that took a replacement away, and not a plain first rotation', function () {
        [$member, $old] = bhOldToken();
        $retried = fn (): int => AuditEvent::query()->where('action', MemberSecurityEvent::TokenRotationRetried->value)->count();

        $first = bhCall($old)->assertOk()->json('data.token');

        expect($retried())->toBe(0);

        $second = bhCall($old)->assertOk()->json('data.token');

        $event = AuditEvent::query()->where('action', MemberSecurityEvent::TokenRotationRetried->value)->sole();

        expect($event->getAttribute('target_id'))->toBe($member->id)
            ->and($event->getAttribute('actor_id'))->toBe($member->id)
            ->and(json_encode($event->getAttributes()))->not->toContain($first)->not->toContain($second);
    });

    it('bounds the calls per member, and a throttled retry keeps the old token', function () {
        config(['speedclub.rate_limits.token_rotate.max' => 2]);
        RateLimits::register();
        [$member, $old] = bhOldToken();

        bhCall($old)->assertOk();
        $last = bhCall($old)->assertOk()->json('data.token');
        $tokens = bhTokenIds($member);

        $this->withHeader('Accept-Language', 'de');
        bhCall($old)
            ->assertStatus(429)
            ->assertHeader('Retry-After')
            ->assertJsonPath('code', 'rate_limited')
            ->assertJsonPath('message', fn (string $message): bool => str_starts_with($message, 'Zu viele Versuche.'));

        expect(bhTokenIds($member))->toBe($tokens);
        bhCall($old, 'GET', '/api/v1/auth/me')->assertOk();
        bhCall($last, 'GET', '/api/v1/auth/me')->assertOk();
    });

    it('a rotation does not make the new token rotate early, and a young token stays refused', function () {
        [, $old] = bhOldToken();

        $new = bhCall($old)->assertOk()->json('data.token');

        bhCall($new)->assertStatus(409)->assertJsonPath('code', 'token_rotation_not_due');
    });

    it('a sign-out during the grace ends the old token too', function (string $who) {
        [$member, $old] = bhOldToken();

        $new = bhCall($old)->assertOk()->json('data.token');

        bhCall($who === 'new' ? $new : $old, 'POST', '/api/v1/auth/logout')->assertNoContent();

        expect($member->tokens()->count())->toBe(0);
        bhCall($old, 'GET', '/api/v1/auth/me')->assertUnauthorized();
        bhCall($new, 'GET', '/api/v1/auth/me')->assertUnauthorized();
    })->with(['new', 'old']);

    it('a sign-out during the grace ends a token that has only the name it was created with', function (string $who) {
        $member = User::factory()->create();
        $old = $member->createToken('Altgerät')->plainTextToken;
        test()->travel(8)->days();

        $new = bhCall($old)->assertOk()->json('data.token');

        expect(PersonalAccessToken::findToken($old)->device_name)->toBeNull();

        bhCall($who === 'new' ? $new : $old, 'POST', '/api/v1/auth/logout')->assertNoContent();

        expect($member->tokens()->count())->toBe(0);
        bhCall($old, 'GET', '/api/v1/auth/me')->assertUnauthorized();
        bhCall($new, 'GET', '/api/v1/auth/me')->assertUnauthorized();
    })->with(['new', 'old']);

    it('a rotation does not take a later token with the same name for its replacement', function (bool $used) {
        $member = User::factory()->create();
        $old = $member->createToken('Altgerät')->plainTextToken;
        $later = $member->createToken('Altgerät')->plainTextToken;
        test()->travel(8)->days();

        if ($used) {
            bhCall($later, 'GET', '/api/v1/auth/me')->assertOk();
        }

        bhCall($old)->assertOk();

        bhCall($later, 'GET', '/api/v1/auth/me')->assertOk();
        expect($member->tokens()->count())->toBe(3)
            ->and(AuditEvent::query()->whereIn('action', [MemberSecurityEvent::TokenReplayed->value, MemberSecurityEvent::TokenRotationRetried->value])->count())->toBe(0);
    })->with(['never used' => false, 'in use' => true]);

    it('a sign-out leaves the other devices alone', function () {
        $member = User::factory()->create();
        $phone = $member->createToken('Pixel 9')->plainTextToken;
        $tablet = $member->createToken('iPad')->plainTextToken;

        bhCall($phone, 'POST', '/api/v1/auth/logout')->assertNoContent();

        bhCall($tablet, 'GET', '/api/v1/auth/me')->assertOk();
    });

    it('still refuses a suspended member during the grace', function () {
        [$member, $old] = bhOldToken();

        bhCall($old)->assertOk();
        $member->forceFill(['status' => 'suspended'])->save();

        bhCall($old)->assertForbidden();
    });
});
