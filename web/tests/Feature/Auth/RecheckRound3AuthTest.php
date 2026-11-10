<?php

use App\Enums\MemberSecurityEvent;
use App\Mail\AccountExistsMail;
use App\Mail\PasswordResetCodeMail;
use App\Mail\SecurityNoticeMail;
use App\Mail\VerificationCodeMail;
use App\Models\AuditEvent;
use App\Models\PersonalAccessToken;
use App\Models\Staff;
use App\Models\User;
use App\Support\EmailAddress;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

/**
 * The account findings of the third re-check round (docs/reports/logs/recheck-final.md, RESULT 6 new bugs 1 and 5).
 */
const R3_PASSWORD = 'Lackierung-92-rot';

const R3_PHONE_A = '6f1c2b0e-8d4a-4f7e-9a51-0c3e1d2b4a01';

const R3_PHONE_B = '0b9e7d55-21c4-4a8f-b6e2-7f3a9c1d5e02';

beforeEach(function () {
    Mail::fake();
});

function r3Forget(): void
{
    app('auth')->forgetGuards();
}

/**
 * @param  array<string, mixed>  $extra
 */
function r3SignIn(string $email, ?string $deviceId, string $device = 'Pixel 8', string $platform = 'android', array $extra = []): string
{
    r3Forget();

    return test()->postJson('/api/v1/auth/login', array_filter([
        'email' => $email,
        'password' => R3_PASSWORD,
        'device_name' => $device,
        'platform' => $platform,
        'app_version' => '0.1.0',
        'device_id' => $deviceId,
        ...$extra,
    ], fn ($value) => $value !== null))->assertOk()->json('data.token');
}

function r3Call(string $token, string $method = 'GET', string $path = '/api/v1/auth/me', array $body = []): mixed
{
    r3Forget();

    return test()->withToken($token)->json($method, $path, $body);
}

function r3Registration(string $email): array
{
    return ['email' => $email, 'password' => R3_PASSWORD, 'accepted_age_16' => true, 'accepted_terms' => true, 'accepted_privacy' => true];
}

describe('an umlaut domain is one account however it is written', function () {
    it('normalises an address to lowercase with the domain in ASCII', function (string $input, string $stored) {
        expect(EmailAddress::normalize($input))->toBe($stored);
    })->with([
        'umlaut domain' => ['max@müller.de', 'max@xn--mller-kva.de'],
        'capitals' => ['MAX@MÜLLER.DE', 'max@xn--mller-kva.de'],
        'already ASCII' => ['max@xn--mller-kva.de', 'max@xn--mller-kva.de'],
        'punycode in capitals' => ['Max@XN--MLLER-KVA.DE', 'max@xn--mller-kva.de'],
        'sharp s stays (non-transitional)' => ['max@straße.de', 'max@xn--strae-oqa.de'],
        'subdomain' => ['max@post.müller-e2e.test', 'max@post.xn--mller-e2e-q9a.test'],
        'trimmed' => ['  lukas@example.de ', 'lukas@example.de'],
        'split at the last @' => ['"a@b"@müller.de', '"a@b"@xn--mller-kva.de'],
        'not an address' => ['keine-adresse', 'keine-adresse'],
        'IDNA refuses the domain' => ['max@ü..de', 'max@ü..de'],
        'umlaut in the local part stays' => ['Jürgen@example.de', 'jürgen@example.de'],
    ]);

    it('stores what the app sends in ASCII, and the browser\'s form signs in to it', function (string $registered, string $typed) {
        $this->postJson('/api/v1/auth/register', r3Registration($registered))->assertStatus(202)->assertJsonPath('data.email', 'max@xn--mller-kva.de');

        $member = User::query()->sole();
        expect($member->email)->toBe('max@xn--mller-kva.de');

        Mail::assertSent(VerificationCodeMail::class, fn (VerificationCodeMail $mail): bool => $mail->hasTo('max@xn--mller-kva.de'));
        $member->forceFill(['email_verified_at' => now()])->save();

        r3SignIn($typed, R3_PHONE_A);
    })->with([
        'app then web' => ['max@müller.de', 'max@xn--mller-kva.de'],
        'web then app' => ['max@xn--mller-kva.de', 'max@müller.de'],
        'app then app in capitals' => ['max@müller.de', 'MAX@MÜLLER.DE'],
    ]);

    it('does not open a second account for the other form', function () {
        $this->postJson('/api/v1/auth/register', r3Registration('max@müller.de'))->assertStatus(202);
        $this->postJson('/api/v1/auth/register', r3Registration('max@xn--mller-kva.de'))->assertStatus(202);

        expect(User::query()->count())->toBe(1);
        Mail::assertSent(AccountExistsMail::class, 1);
    });

    it('verifies, resends, and resets with the other form', function () {
        $this->postJson('/api/v1/auth/register', r3Registration('max@müller.de'))->assertStatus(202);

        $this->travel(2)->minutes();
        $this->postJson('/api/v1/auth/email/resend', ['email' => 'max@xn--mller-kva.de'])->assertStatus(202);
        // The registration's code and the resent one, both to the ASCII form.
        Mail::assertSent(VerificationCodeMail::class, 2);
        Mail::assertSent(VerificationCodeMail::class, fn (VerificationCodeMail $mail): bool => $mail->hasTo('max@xn--mller-kva.de'));
        $code = Mail::sent(VerificationCodeMail::class)->last()->code;

        $this->postJson('/api/v1/auth/email/verify', [
            'email' => 'max@xn--mller-kva.de', 'code' => $code, 'password' => R3_PASSWORD, 'device_name' => 'Pixel 8', 'platform' => 'android',
        ])->assertOk();

        expect(User::query()->sole()->hasVerifiedEmail())->toBeTrue();

        $this->postJson('/api/v1/auth/password/forgot', ['email' => 'MAX@MÜLLER.DE'])->assertStatus(202);
        Mail::assertSent(PasswordResetCodeMail::class, fn (PasswordResetCodeMail $mail): bool => $mail->hasTo('max@xn--mller-kva.de'));
        $reset = Mail::sent(PasswordResetCodeMail::class)->last()->code;

        r3Forget();
        $this->postJson('/api/v1/auth/password/reset', ['email' => 'max@müller.de', 'code' => $reset, 'password' => 'Ganz-neues-Passwort-77'])->assertOk();

        r3Forget();
        $this->postJson('/api/v1/auth/login', ['email' => 'max@xn--mller-kva.de', 'password' => 'Ganz-neues-Passwort-77', 'device_name' => 'Pixel 8'])->assertOk();
    });

    it('answers a domain IDNA refuses with the normal e-mail error', function () {
        $this->withHeader('Accept-Language', 'de');
        $normal = $this->postJson('/api/v1/auth/register', r3Registration('keine-adresse'))->assertUnprocessable()->json('errors.email.0');

        $this->postJson('/api/v1/auth/register', r3Registration('max@ü..de'))
            ->assertUnprocessable()
            ->assertJsonPath('errors.email.0', $normal);

        expect(User::query()->count())->toBe(0);
    });

    it('stores ASCII whichever way a member row is written', function () {
        $member = User::factory()->create(['email' => 'Lena@Müller.de']);

        expect($member->refresh()->email)->toBe('lena@xn--mller-kva.de');
    });

    describe('the migration of existing rows', function () {
        function r3RunEmailMigration(): void
        {
            $migration = require database_path('migrations/2026_11_07_100000_convert_member_email_domains_to_ascii.php');
            $migration->up();
        }

        function r3StoreRaw(User $member, string $email): void
        {
            DB::table('users')->where('id', $member->id)->update(['email' => $email]);
        }

        it('converts a unicode domain, and leaves ASCII rows alone', function () {
            $old = User::factory()->create();
            $plain = User::factory()->create(['email' => 'lukas@example.de']);
            r3StoreRaw($old, 'max@müller.de');

            r3RunEmailMigration();

            expect(DB::table('users')->where('id', $old->id)->value('email'))->toBe('max@xn--mller-kva.de')
                ->and(DB::table('users')->where('id', $plain->id)->value('email'))->toBe('lukas@example.de');

            Mail::fake();
            r3SignIn('max@müller.de', null, extra: ['password' => 'password']);
        });

        it('skips a row whose ASCII form is taken, logs only its id, and converts the rest', function () {
            $app = User::factory()->create();
            $web = User::factory()->create(['email' => 'max@xn--mller-kva.de']);
            $other = User::factory()->create();
            r3StoreRaw($app, 'max@müller.de');
            r3StoreRaw($other, 'anna@straße.de');
            Log::spy();

            r3RunEmailMigration();

            expect(DB::table('users')->where('id', $app->id)->value('email'))->toBe('max@müller.de')
                ->and(DB::table('users')->where('id', $web->id)->value('email'))->toBe('max@xn--mller-kva.de')
                ->and(DB::table('users')->where('id', $other->id)->value('email'))->toBe('anna@xn--strae-oqa.de');

            Log::shouldHaveReceived('warning')->once()->withArgs(fn (string $message, array $context): bool => $context === ['user_id' => $app->id]
                && ! str_contains($message, 'müller'));
        });
    });
});

describe('two phones of the same model', function () {
    beforeEach(function () {
        $this->member = User::factory()->create(['email' => 'lukas@example.de', 'password' => R3_PASSWORD]);
    });

    it('keep their own tokens when each sends its device_id', function () {
        $a = r3SignIn('lukas@example.de', R3_PHONE_A);
        $b = r3SignIn('lukas@example.de', R3_PHONE_B);

        r3Call($a)->assertOk();
        r3Call($b)->assertOk();
        expect($this->member->tokens()->pluck('device_id')->sort()->values()->all())->toBe([R3_PHONE_B, R3_PHONE_A]);
    });

    it('still keep one token per install: a second sign-in on the same phone replaces its token', function () {
        $first = r3SignIn('lukas@example.de', R3_PHONE_A);
        $second = r3SignIn('lukas@example.de', R3_PHONE_A, 'Pixel 8 (neu benannt)');

        r3Call($first)->assertUnauthorized();
        r3Call($second)->assertOk();
        expect($this->member->tokens()->count())->toBe(1);
    });

    it('fall back to the name rule without a device_id, as older app builds send', function () {
        $first = r3SignIn('lukas@example.de', null);
        $second = r3SignIn('lukas@example.de', null);

        r3Call($first)->assertUnauthorized();
        r3Call($second)->assertOk();
    });

    it('do not end each other when one runs an older app build', function (bool $olderFirst) {
        $older = $olderFirst ? r3SignIn('lukas@example.de', null) : null;
        $newer = r3SignIn('lukas@example.de', R3_PHONE_A);
        $older ??= r3SignIn('lukas@example.de', null);

        r3Call($older)->assertOk();
        r3Call($newer)->assertOk();

        r3Call($older, 'POST', '/api/v1/auth/logout')->assertNoContent();
        r3Call($newer)->assertOk();
    })->with(['older app signs in first' => true, 'newer app signs in first' => false]);

    it('sign out only themselves', function () {
        $a = r3SignIn('lukas@example.de', R3_PHONE_A, 'iPhone 15', 'ios');
        $b = r3SignIn('lukas@example.de', R3_PHONE_B, 'iPhone 15', 'ios');

        r3Call($a, 'POST', '/api/v1/auth/logout')->assertNoContent();

        r3Call($a)->assertUnauthorized();
        r3Call($b)->assertOk();
    });

    it('count as a new device for the owner\'s notice', function () {
        r3SignIn('lukas@example.de', R3_PHONE_A);
        Mail::assertNotSent(SecurityNoticeMail::class);

        r3SignIn('lukas@example.de', R3_PHONE_B);

        Mail::assertSent(SecurityNoticeMail::class, 1);
        expect(AuditEvent::query()->where('action', MemberSecurityEvent::LoginNewDevice->value)->count())->toBe(1);
    });

    it('take the device_id on the e-mail verify sign-in', function () {
        $this->postJson('/api/v1/auth/register', r3Registration('neu@example.de'))->assertStatus(202);
        $code = Mail::sent(VerificationCodeMail::class)->last()->code;
        $other = r3SignIn('lukas@example.de', R3_PHONE_B);

        r3Forget();
        $token = $this->postJson('/api/v1/auth/email/verify', [
            'email' => 'neu@example.de', 'code' => $code, 'password' => R3_PASSWORD, 'device_name' => 'Pixel 8', 'platform' => 'android', 'device_id' => R3_PHONE_A,
        ])->assertOk()->json('data.token');

        expect(PersonalAccessToken::findToken($token)?->device_id)->toBe(R3_PHONE_A);
        r3Call($other)->assertOk();
    });

    it('refuses a device_id that is not a plain id', function (string $path, mixed $value) {
        $body = match ($path) {
            'login' => ['email' => 'lukas@example.de', 'password' => R3_PASSWORD, 'device_name' => 'Pixel 8'],
            'email/verify' => ['email' => 'lukas@example.de', 'code' => '123456', 'password' => R3_PASSWORD, 'device_name' => 'Pixel 8'],
        };

        $this->postJson("/api/v1/auth/{$path}", [...$body, 'device_id' => $value])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('device_id');

        expect($this->member->tokens()->count())->toBe(0);
    })->with(['login', 'email/verify'])->with([
        'too short' => '1234567',
        'too long' => str_repeat('a', 65),
        'space' => 'abc def ghi',
        'markup' => '<script>x</script>',
        'not a string' => [['a']],
    ]);
});

describe('token rotation with a device_id', function () {
    beforeEach(function () {
        $this->member = User::factory()->create(['email' => 'lukas@example.de', 'password' => R3_PASSWORD]);
    });

    it('keeps the device_id, and a sign-out in the grace ends both tokens of that phone only', function (string $who) {
        $old = r3SignIn('lukas@example.de', R3_PHONE_A);
        $this->travel(8)->days();
        $other = r3SignIn('lukas@example.de', R3_PHONE_B);

        $new = r3Call($old, 'POST', '/api/v1/auth/token/rotate', ['device_id' => R3_PHONE_A])->assertOk()->json('data.token');

        expect(PersonalAccessToken::findToken($new)?->device_id)->toBe(R3_PHONE_A);

        r3Call($who === 'new' ? $new : $old, 'POST', '/api/v1/auth/logout')->assertNoContent();

        r3Call($old)->assertUnauthorized();
        r3Call($new)->assertUnauthorized();
        r3Call($other)->assertOk();
    })->with(['new', 'old']);

    it('stamps a legacy token with the device_id it now sends, and only that phone signs out', function (string $who) {
        $old = $this->member->createToken('Pixel 8')->plainTextToken;
        $other = $this->member->createToken('Pixel 8')->plainTextToken;
        PersonalAccessToken::query()->update(['device_name' => 'Pixel 8', 'platform' => 'android']);
        $this->travel(8)->days();

        $new = r3Call($old, 'POST', '/api/v1/auth/token/rotate', ['device_id' => R3_PHONE_A])->assertOk()->json('data.token');

        expect(PersonalAccessToken::findToken($old)?->device_id)->toBe(R3_PHONE_A)
            ->and(PersonalAccessToken::findToken($new)?->device_id)->toBe(R3_PHONE_A)
            ->and(PersonalAccessToken::findToken($other)?->device_id)->toBeNull();

        r3Call($who === 'new' ? $new : $old, 'POST', '/api/v1/auth/logout')->assertNoContent();

        r3Call($old)->assertUnauthorized();
        r3Call($new)->assertUnauthorized();
        r3Call($other)->assertOk();
    })->with(['new', 'old']);

    it('does not let a rotation change the device_id a token already has', function () {
        $old = r3SignIn('lukas@example.de', R3_PHONE_A);
        $this->travel(8)->days();

        $new = r3Call($old, 'POST', '/api/v1/auth/token/rotate', ['device_id' => R3_PHONE_B])->assertOk()->json('data.token');

        expect(PersonalAccessToken::findToken($new)?->device_id)->toBe(R3_PHONE_A)
            ->and(PersonalAccessToken::findToken($old)?->device_id)->toBe(R3_PHONE_A);
    });

    it('still takes a lost answer back by device_id, and leaves the other phone of that model alone', function () {
        $old = r3SignIn('lukas@example.de', R3_PHONE_A);
        $this->travel(8)->days();
        $other = r3SignIn('lukas@example.de', R3_PHONE_B);

        $lost = r3Call($old, 'POST', '/api/v1/auth/token/rotate', ['device_id' => R3_PHONE_A])->assertOk()->json('data.token');
        $retry = r3Call($old, 'POST', '/api/v1/auth/token/rotate', ['device_id' => R3_PHONE_A])->assertOk()->json('data.token');

        r3Call($lost)->assertUnauthorized();
        r3Call($retry)->assertOk();
        r3Call($other)->assertOk();
        expect(AuditEvent::query()->where('action', MemberSecurityEvent::TokenRotationRetried->value)->count())->toBe(1);

        // Claimed: a replay on the old token is refused and ends it, the other phone stays.
        r3Call($old, 'POST', '/api/v1/auth/token/rotate', ['device_id' => R3_PHONE_A])->assertStatus(409)->assertJsonPath('code', 'conflict');
        r3Call($other)->assertOk();
        r3Call($retry)->assertOk();
    });

    it('works without a device_id as before', function () {
        $old = r3SignIn('lukas@example.de', R3_PHONE_A);
        $this->travel(8)->days();

        $new = r3Call($old, 'POST', '/api/v1/auth/token/rotate')->assertOk()->json('data.token');

        expect(PersonalAccessToken::findToken($new)?->device_id)->toBe(R3_PHONE_A);
    });

    it('refuses a device_id that is not a plain id, and leaves the token as it was', function (mixed $value) {
        $old = r3SignIn('lukas@example.de', null);
        $this->travel(8)->days();

        r3Call($old, 'POST', '/api/v1/auth/token/rotate', ['device_id' => $value])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('device_id');

        expect($this->member->tokens()->sole()->device_id)->toBeNull();
    })->with(['too short' => 'abc', 'too long' => str_repeat('a', 65), 'underscore' => 'abc_defgh', 'not a string' => [['a']]]);

    it('answers the authorisation matrix with a device_id', function (string $who, int $status) {
        $body = ['device_id' => R3_PHONE_A];

        $response = match ($who) {
            'guest' => $this->postJson('/api/v1/auth/token/rotate', $body),
            'staff session' => $this->withCredentials()
                ->withCookie(config()->string('session.cookie'), databaseSessionFor(Staff::factory()->create(), 'staff'))
                ->withHeaders(['Origin' => 'http://localhost:8080', 'Accept' => 'application/json'])
                ->postJson('/api/v1/auth/token/rotate', $body),
            'suspended member' => (function () use ($body) {
                $old = r3SignIn('lukas@example.de', null);
                $this->travel(8)->days();
                $this->member->forceFill(['status' => 'suspended'])->save();

                return r3Call($old, 'POST', '/api/v1/auth/token/rotate', $body);
            })(),
            'member with a young token' => r3Call(r3SignIn('lukas@example.de', R3_PHONE_A), 'POST', '/api/v1/auth/token/rotate', $body),
            'member' => (function () use ($body) {
                $old = r3SignIn('lukas@example.de', null);
                $this->travel(8)->days();

                return r3Call($old, 'POST', '/api/v1/auth/token/rotate', $body);
            })(),
        };

        $response->assertStatus($status);
    })->with([
        ['guest', 401],
        ['staff session', 401],
        ['suspended member', 403],
        ['member with a young token', 409],
        ['member', 200],
    ]);
});
