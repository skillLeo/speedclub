<?php

use App\Enums\VerificationPurpose;
use App\Mail\AccountExistsMail;
use App\Mail\PasswordResetCodeMail;
use App\Mail\SecurityNoticeMail;
use App\Mail\VerificationCodeMail;
use App\Models\Media;
use App\Models\Staff;
use App\Models\User;
use App\Models\VerificationCode;
use App\Services\Auth\VerificationCodes;
use App\Services\Media\MediaService;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Hashing\HashManager;
use Illuminate\Http\UploadedFile;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Symfony\Component\Process\Process;
use Tests\Support\TestImages;

/**
 * Security regression tests for M1.5 (docs/07_QA_AND_RELEASE.md §6). They add to tests/Feature/Api/AuthEndpointsTest.php and
 * ProfileEndpointsTest.php what those do not prove.
 */

/**
 * Laravel skips the CSRF check during unit tests. This one does not, so the 419 can be proven without a running server.
 */
class CsrfEnforcedInTests extends ValidateCsrfToken
{
    protected function runningUnitTests(): bool
    {
        return false;
    }
}

const SEC_PASSWORD = 'Lackierung-92-rot';

const SEC_ORIGIN = 'http://localhost:8080';

function secRegistration(string $email, array $overrides = []): array
{
    return [
        'email' => $email,
        'password' => SEC_PASSWORD,
        'accepted_age_16' => true,
        'accepted_terms' => true,
        'accepted_privacy' => true,
        ...$overrides,
    ];
}

function secForgetAuth(): void
{
    app('auth')->forgetGuards();
    app()->forgetInstance('auth.driver');
    app('session')->forgetDrivers();
    app()->forgetInstance('session.store');
}

/**
 * @return array{session: string, xsrf: string}
 */
function secOpenSpaSession(): array
{
    config(['session.driver' => 'database']);
    app()->forgetInstance('session.store');

    $response = test()->withHeaders(['Origin' => SEC_ORIGIN])->get('/sanctum/csrf-cookie')->assertNoContent();

    return [
        'session' => $response->getCookie(config()->string('session.cookie'))->getValue(),
        'xsrf' => $response->getCookie('XSRF-TOKEN', decrypt: false)->getValue(),
    ];
}

function secSpa(string $session, ?string $xsrf = null): mixed
{
    secForgetAuth();

    return test()->flushHeaders()
        ->withCredentials()
        ->withCookie(config()->string('session.cookie'), $session)
        ->withHeaders(['Origin' => SEC_ORIGIN, 'Accept' => 'application/json', ...($xsrf === null ? [] : ['X-XSRF-TOKEN' => $xsrf])]);
}

function secLastCode(string $mailable): string
{
    return Mail::sent($mailable)->last()->code;
}

function secWrongCode(string $code): string
{
    return $code === '000000' ? '000001' : '000000';
}

/**
 * @return list<array{0: string, 1: string}>
 */
function secProtectedRoutes(): array
{
    return [
        'auth/me' => ['GET', '/api/v1/auth/me'],
        'auth/logout' => ['POST', '/api/v1/auth/logout'],
        'auth/token/rotate' => ['POST', '/api/v1/auth/token/rotate'],
        'GET me/profile' => ['GET', '/api/v1/me/profile'],
        'PATCH me/profile' => ['PATCH', '/api/v1/me/profile'],
        'me/username' => ['PUT', '/api/v1/me/username'],
        'me/avatar' => ['POST', '/api/v1/me/avatar'],
        'me/cover' => ['POST', '/api/v1/me/cover'],
        'GET me/settings' => ['GET', '/api/v1/me/settings'],
        'PATCH me/settings' => ['PATCH', '/api/v1/me/settings'],
    ];
}

describe('enumeration', function () {
    beforeEach(function () {
        Mail::fake();
    });

    it('answers register, forgot and resend identically for a known and an unknown address', function (string $path, array $extra, int $status) {
        User::factory()->registered()->create(['email' => 'da@example.de']);

        $known = $this->postJson($path, ['email' => 'da@example.de', ...$extra])->assertStatus($status);
        $unknown = $this->postJson($path, ['email' => 'xy@example.de', ...$extra])->assertStatus($status);

        $body = fn ($response) => str_replace(['da@example.de', 'xy@example.de'], 'E', (string) $response->getContent());

        expect($body($known))->toBe($body($unknown))
            ->and(array_keys($known->headers->all()))->toEqualCanonicalizing(array_keys($unknown->headers->all()));
    })->with([
        'register' => ['/api/v1/auth/register', ['password' => SEC_PASSWORD, 'accepted_age_16' => true, 'accepted_terms' => true, 'accepted_privacy' => true], 202],
        'forgot' => ['/api/v1/auth/password/forgot', [], 202],
        'resend' => ['/api/v1/auth/email/resend', [], 202],
    ]);

    it('answers a wrong password the same for every account state and for an unknown address', function () {
        User::factory()->create(['email' => 'aktiv@example.de']);
        User::factory()->registered()->create(['email' => 'neu@example.de']);
        User::factory()->suspended()->create(['email' => 'gesperrt@example.de']);
        User::factory()->deactivated()->create(['email' => 'inaktiv@example.de']);
        User::factory()->create(['email' => 'pflicht@example.de', 'force_password_change' => true]);
        User::factory()->create(['email' => 'weg@example.de'])->delete();

        $answers = collect(['aktiv', 'neu', 'gesperrt', 'inaktiv', 'pflicht', 'weg', 'unbekannt'])
            ->map(fn (string $name) => $this->postJson('/api/v1/auth/login', ['email' => "$name@example.de", 'password' => 'falsch-falsch', 'device_name' => 'P'])->assertUnauthorized()->json());

        expect($answers->unique()->count())->toBe(1);
    });

    it('does the same password hashing work on register and login for a known and an unknown address', function () {
        $hash = new class(app()) extends HashManager
        {
            public int $makes = 0;

            /** @var list<string> */
            public array $checked = [];

            public function make(#[SensitiveParameter] $value, array $options = []): string
            {
                $this->makes++;

                return parent::make($value, $options);
            }

            public function check(#[SensitiveParameter] $value, $hashedValue, array $options = []): bool
            {
                $this->checked[] = (string) $hashedValue;

                return parent::check($value, $hashedValue, $options);
            }
        };

        $known = User::factory()->create(['email' => 'da@example.de', 'password' => Hash::make(SEC_PASSWORD)]);
        Hash::swap($hash);

        $this->postJson('/api/v1/auth/register', secRegistration('da@example.de'))->assertStatus(202);
        $afterKnown = $hash->makes;
        $this->postJson('/api/v1/auth/register', secRegistration('xy@example.de'))->assertStatus(202);

        expect($afterKnown)->toBe(1)->and($hash->makes)->toBe(2);

        $this->postJson('/api/v1/auth/login', ['email' => 'da@example.de', 'password' => 'falsch-falsch', 'device_name' => 'P'])->assertUnauthorized();
        $this->postJson('/api/v1/auth/login', ['email' => 'unbekannt@example.de', 'password' => 'falsch-falsch', 'device_name' => 'P'])->assertUnauthorized();

        // The check on an unknown address runs against a real hash with the same algorithm and cost as a member's.
        expect($hash->checked)->toHaveCount(2)
            ->and(Hash::info($hash->checked[1]))->toBe(Hash::info($known->password));
    });

    it('treats an accented variant of an address as a different address when asked for a code', function () {
        User::factory()->create(['email' => 'max@example.de']);

        $this->postJson('/api/v1/auth/password/forgot', ['email' => 'máx@example.de'])->assertStatus(202);

        Mail::assertNothingSent();
    });
});

describe('codes', function () {
    beforeEach(function () {
        Mail::fake();
        $this->codes = app(VerificationCodes::class);
    });

    it('does not accept a verification code for a password reset', function () {
        $member = User::factory()->registered()->create(['email' => 'da@example.de', 'password' => SEC_PASSWORD]);
        $code = $this->codes->issue($member, VerificationPurpose::EmailVerification);

        $this->postJson('/api/v1/auth/password/reset', ['email' => 'da@example.de', 'code' => $code, 'password' => 'Neues-Passwort-77'])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'invalid_code');

        expect(Hash::check(SEC_PASSWORD, $member->refresh()->password))->toBeTrue();
    });

    it('does not accept the code of one member for another', function () {
        $first = User::factory()->registered()->create(['email' => 'eins@example.de']);
        $second = User::factory()->registered()->create(['email' => 'zwei@example.de']);
        $code = $this->codes->issue($first, VerificationPurpose::EmailVerification);
        $this->codes->issue($second, VerificationPurpose::EmailVerification);

        $this->postJson('/api/v1/auth/email/verify', ['email' => 'zwei@example.de', 'code' => $code, 'password' => 'password', 'device_name' => 'P'])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'invalid_code');

        expect($second->refresh()->hasVerifiedEmail())->toBeFalse();
    });

    it('binds the hash to the application key, the member and the purpose', function () {
        $first = User::factory()->registered()->create();
        $second = User::factory()->registered()->create();
        $code = $this->codes->issue($first, VerificationPurpose::EmailVerification);
        $stored = VerificationCode::query()->where('user_id', $first->id)->sole()->code_hash;

        VerificationCode::query()->where('user_id', $first->id)->delete();
        DB::table('verification_codes')->insert([
            'id' => (string) str()->ulid(), 'user_id' => $second->id, 'purpose' => VerificationPurpose::EmailVerification->value,
            'code_hash' => $stored, 'attempts' => 0, 'expires_at' => now()->addMinutes(10), 'created_at' => now(), 'updated_at' => now(),
        ]);

        // The same stored hash under another account does not verify: the member is part of what was hashed.
        $this->postJson('/api/v1/auth/email/verify', ['email' => $second->email, 'code' => $code, 'password' => 'password', 'device_name' => 'P'])->assertUnprocessable();

        expect($stored)->not->toBe(hash('sha256', $code))
            ->and($stored)->not->toContain($code);
    });

    it('accepts a code until ten minutes have passed and not after', function () {
        // A running clock would let a second of real time on a loaded machine cross the limit this test stands one second from.
        $this->freezeTime();

        $early = User::factory()->registered()->create(['email' => 'frueh@example.de']);
        $late = User::factory()->registered()->create(['email' => 'spaet@example.de']);
        $earlyCode = $this->codes->issue($early, VerificationPurpose::EmailVerification);
        $lateCode = $this->codes->issue($late, VerificationPurpose::EmailVerification);

        $this->travel(9)->minutes();
        $this->travel(59)->seconds();
        $this->postJson('/api/v1/auth/email/verify', ['email' => 'frueh@example.de', 'code' => $earlyCode, 'password' => 'password', 'device_name' => 'P'])->assertOk();

        $this->travel(2)->seconds();
        $this->postJson('/api/v1/auth/email/verify', ['email' => 'spaet@example.de', 'code' => $lateCode, 'password' => 'password', 'device_name' => 'P'])->assertUnprocessable();
    });

    it('caps reset guesses at 25 per account per hour, however many times the attacker asks for a code', function () {
        $member = User::factory()->create(['email' => 'ziel@example.de', 'password' => SEC_PASSWORD]);
        $reset = fn (string $code) => $this->postJson('/api/v1/auth/password/reset', ['email' => 'ziel@example.de', 'code' => $code, 'password' => 'Neues-Passwort-77']);

        foreach (range(1, 5) as $round) {
            Mail::fake();
            $this->postJson('/api/v1/auth/password/forgot', ['email' => 'ziel@example.de'])->assertStatus(202);
            $code = secLastCode(PasswordResetCodeMail::class);

            foreach (range(1, 5) as $guess) {
                $reset(secWrongCode($code))->assertUnprocessable();
            }

            // Spent: even the right code does not count any more.
            $reset($code)->assertUnprocessable();
            $this->travel(61)->seconds();
        }

        $counted = fn () => (int) VerificationCode::query()->where('user_id', $member->id)->sum('attempts');

        expect($counted())->toBe(25)
            ->and(VerificationCode::query()->where('user_id', $member->id)->count())->toBe(5);

        // The hour holds: no sixth code, so no further guess is even counted.
        Mail::fake();
        $this->postJson('/api/v1/auth/password/forgot', ['email' => 'ziel@example.de'])->assertStatus(202);
        Mail::assertNothingSent();
        $reset('123456')->assertUnprocessable();

        expect($counted())->toBe(25)
            ->and(Hash::check(SEC_PASSWORD, $member->refresh()->password))->toBeTrue();
    });

    it('does not reveal a spent attempt limit: the answer stays the same', function () {
        $member = User::factory()->registered()->create(['email' => 'da@example.de']);
        $code = $this->codes->issue($member, VerificationPurpose::EmailVerification);
        $verify = fn (string $value) => $this->postJson('/api/v1/auth/email/verify', ['email' => 'da@example.de', 'code' => $value, 'password' => 'password', 'device_name' => 'P']);

        $first = $verify(secWrongCode($code))->assertUnprocessable()->json();

        foreach (range(1, 4) as $round) {
            $verify(secWrongCode($code));
        }

        expect($verify(secWrongCode($code))->assertUnprocessable()->json())->toBe($first)
            ->and($verify($code)->assertUnprocessable()->json())->toBe($first);
    });
});

describe('login limits', function () {
    beforeEach(function () {
        Mail::fake();
        $this->member = User::factory()->create(['email' => 'max@example.de', 'password' => SEC_PASSWORD]);
    });

    it('does not let X-Forwarded-For get around the per-IP limit', function () {
        foreach (range(1, 10) as $round) {
            $this->withHeaders(['X-Forwarded-For' => "198.51.100.$round"])
                ->postJson('/api/v1/auth/login', ['email' => "wer$round@example.de", 'password' => 'falsch-falsch', 'device_name' => 'P'])
                ->assertUnauthorized();
        }

        $this->withHeaders(['X-Forwarded-For' => '198.51.100.99'])
            ->postJson('/api/v1/auth/login', ['email' => 'wer99@example.de', 'password' => 'falsch-falsch', 'device_name' => 'P'])
            ->assertStatus(429);
    });

    it('delays per account across IP addresses and upper and lower case', function () {
        foreach (['max@example.de', 'MAX@example.de', ' Max@Example.de ', 'max@EXAMPLE.DE', 'mAx@example.de'] as $index => $email) {
            $this->withServerVariables(['REMOTE_ADDR' => "203.0.113.$index"])
                ->postJson('/api/v1/auth/login', ['email' => $email, 'password' => 'falsch-falsch', 'device_name' => 'P'])
                ->assertUnauthorized();
        }

        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.200'])
            ->postJson('/api/v1/auth/login', ['email' => 'max@example.de', 'password' => SEC_PASSWORD, 'device_name' => 'P'])
            ->assertStatus(429)
            ->assertHeader('Retry-After');
    });

    it('caps the delay at a minute and never locks the account for good', function () {
        $delays = [];

        foreach (range(1, 12) as $round) {
            $response = $this->withServerVariables(['REMOTE_ADDR' => "203.0.113.$round"])
                ->postJson('/api/v1/auth/login', ['email' => 'max@example.de', 'password' => 'falsch-falsch', 'device_name' => 'P'])
                ->assertUnauthorized();

            $retry = $this->withServerVariables(['REMOTE_ADDR' => "203.0.114.$round"])
                ->postJson('/api/v1/auth/login', ['email' => 'max@example.de', 'password' => 'falsch-falsch', 'device_name' => 'P']);

            if ($retry->status() === 429) {
                $delays[] = (int) $retry->headers->get('Retry-After');
                $this->travel((int) $retry->headers->get('Retry-After') + 1)->seconds();
            }
        }

        expect($delays)->not->toBeEmpty()
            ->and(max($delays))->toBeLessThanOrEqual(60);

        $this->travel(61)->seconds();
        $this->postJson('/api/v1/auth/login', ['email' => 'max@example.de', 'password' => SEC_PASSWORD, 'device_name' => 'P'])->assertOk();
    });
});

describe('CSRF and sessions with the real middleware', function () {
    beforeEach(function () {
        Mail::fake();
        config(['sanctum.middleware.validate_csrf_token' => CsrfEnforcedInTests::class]);
        $this->member = User::factory()->create(['email' => 'max@example.de', 'password' => SEC_PASSWORD]);
    });

    it('answers 419 for a SPA login without the XSRF token, and lets it in with the token', function () {
        $spa = secOpenSpaSession();
        $body = ['email' => 'max@example.de', 'password' => SEC_PASSWORD];

        secSpa($spa['session'])->postJson('/api/v1/auth/login', $body)->assertStatus(419);
        secSpa($spa['session'], 'gefaelscht')->postJson('/api/v1/auth/login', $body)->assertStatus(419);
        secSpa($spa['session'], $spa['xsrf'])->postJson('/api/v1/auth/login', $body)->assertOk()->assertJsonPath('data.token', null);
    });

    it('spends no code on a SPA verify without the XSRF token', function () {
        $member = User::factory()->registered()->create(['email' => 'neu@example.de']);
        $code = app(VerificationCodes::class)->issue($member, VerificationPurpose::EmailVerification);
        $spa = secOpenSpaSession();

        secSpa($spa['session'])->postJson('/api/v1/auth/email/verify', ['email' => 'neu@example.de', 'code' => secWrongCode($code), 'password' => 'password'])->assertStatus(419);

        expect(VerificationCode::query()->where('user_id', $member->id)->sole()->attempts)->toBe(0)
            ->and($member->refresh()->hasVerifiedEmail())->toBeFalse();
    });

    it('protects every state-changing route of a signed-in SPA session', function (string $method, string $path) {
        $spa = secOpenSpaSession();
        $signedIn = secSpa($spa['session'], $spa['xsrf'])->postJson('/api/v1/auth/login', ['email' => 'max@example.de', 'password' => SEC_PASSWORD])->assertOk()
            ->getCookie(config()->string('session.cookie'))->getValue();

        secSpa($signedIn)->json($method, $path, [])->assertStatus(419);
    })->with([
        'logout' => ['POST', '/api/v1/auth/logout'],
        'profile' => ['PATCH', '/api/v1/me/profile'],
        'username' => ['PUT', '/api/v1/me/username'],
        'avatar' => ['POST', '/api/v1/me/avatar'],
        'settings' => ['PATCH', '/api/v1/me/settings'],
    ]);

    it('ends a real SPA session through the password reset', function () {
        $spa = secOpenSpaSession();
        $login = secSpa($spa['session'], $spa['xsrf'])->postJson('/api/v1/auth/login', ['email' => 'max@example.de', 'password' => SEC_PASSWORD])->assertOk();
        $signedIn = $login->getCookie(config()->string('session.cookie'))->getValue();

        expect($signedIn)->not->toBe($spa['session'])
            ->and(DB::table('sessions')->where('id', $spa['session'])->exists())->toBeFalse()
            ->and(DB::table('sessions')->where('id', $signedIn)->value('user_id'))->toBe($this->member->id);

        secSpa($signedIn)->getJson('/api/v1/auth/me')->assertOk();

        secForgetAuth();
        $this->flushHeaders();
        $this->postJson('/api/v1/auth/password/forgot', ['email' => 'max@example.de'])->assertStatus(202);
        $this->postJson('/api/v1/auth/password/reset', ['email' => 'max@example.de', 'code' => secLastCode(PasswordResetCodeMail::class), 'password' => 'Neues-Passwort-77'])->assertOk();

        expect(DB::table('sessions')->where('user_id', $this->member->id)->exists())->toBeFalse();

        secSpa($signedIn)->getJson('/api/v1/auth/me')->assertUnauthorized();
    });
});

describe('who reaches the member routes', function () {
    it('refuses a guest, an expired token and a staff session on every route', function (string $method, string $path) {
        $this->json($method, $path)->assertUnauthorized()->assertJsonPath('code', 'unauthenticated');

        $member = User::factory()->create();
        $expired = $member->createToken('Phone', ['member'], now()->subSecond())->plainTextToken;

        secForgetAuth();
        $this->withToken($expired)->json($method, $path)->assertUnauthorized()->assertJsonPath('code', 'unauthenticated');
        $this->flushHeaders();

        foreach (['sc_staff_session', config()->string('session.cookie')] as $cookie) {
            $session = databaseSessionFor(Staff::factory()->create(), 'staff');

            $this->withCredentials()->withCookie($cookie, $session)
                ->withHeaders(['Origin' => SEC_ORIGIN, 'Accept' => 'application/json'])
                ->json($method, $path)
                ->assertUnauthorized()
                ->assertJsonPath('code', 'unauthenticated');
            secForgetAuth();
            $this->flushHeaders();
        }
    })->with(secProtectedRoutes());

    it('does not rotate an expired token back to life', function () {
        $member = User::factory()->create();
        $token = $member->createToken('Phone', ['member'], now()->addDay());
        $token->accessToken->forceFill(['created_at' => now()->subDays(100), 'expires_at' => now()->subDay()])->save();

        $this->withToken($token->plainTextToken)->postJson('/api/v1/auth/token/rotate')->assertUnauthorized();

        expect($member->tokens()->count())->toBe(1);
    });

    it('does not let a member token or a member session past the staff login', function () {
        $member = User::factory()->create();
        $token = $member->createToken('Phone', ['member'])->plainTextToken;

        $this->withToken($token)->get('/admin/')->assertRedirect('/admin/login');
        $this->flushHeaders();
        $this->get('/admin/login')->assertOk();
    });
});

describe('fields a client cannot set', function () {
    $forbidden = [
        'status' => 'suspended',
        'email_verified_at' => '2020-01-01 00:00:00',
        'restrictions' => ['messaging' => ['until' => null]],
        'force_password_change' => true,
        'previous_username' => 'alt',
        'username_changed_at' => '2020-01-01 00:00:00',
        'two_factor_secret' => 'x',
        'two_factor_confirmed_at' => '2020-01-01 00:00:00',
        'avatar_media_id' => '01HZZZZZZZZZZZZZZZZZZZZZZZ',
        'cover_media_id' => '01HZZZZZZZZZZZZZZZZZZZZZZZ',
        'deletion_requested_at' => '2020-01-01 00:00:00',
        'deleted_at' => '2020-01-01 00:00:00',
        'remember_token' => 'x',
    ];

    it('ignores them on register', function () use ($forbidden) {
        Mail::fake();

        $this->postJson('/api/v1/auth/register', secRegistration('neu@example.de', [...$forbidden, 'id' => '01HZZZZZZZZZZZZZZZZZZZZZZZ', 'username' => 'gewaehlt', 'display_name' => 'Name']))->assertStatus(202);

        $member = User::query()->where('email', 'neu@example.de')->sole();

        expect($member->status->value)->toBe('active')
            ->and($member->email_verified_at)->toBeNull()
            ->and($member->restrictions)->toBeNull()
            ->and($member->force_password_change)->toBeFalse()
            ->and($member->id)->not->toBe('01HZZZZZZZZZZZZZZZZZZZZZZZ')
            ->and($member->username)->toBeNull()
            ->and($member->getAttribute('display_name'))->toBeNull()
            ->and($member->getAttribute('avatar_media_id'))->toBeNull();
    });

    it('ignores them on profile and settings', function (string $path) use ($forbidden) {
        $member = User::factory()->registered()->create(['username' => 'bleibt', 'email' => 'bleibt@example.de']);
        $password = $member->password;
        Sanctum::actingAs($member);

        $this->patchJson($path, [...$forbidden, 'id' => '01HZZZZZZZZZZZZZZZZZZZZZZZ', 'email' => 'x@example.de', 'password' => 'Neues-Passwort-77', 'username' => 'anders'])->assertOk();

        $member->refresh();

        expect($member->status->value)->toBe('active')
            ->and($member->email_verified_at)->toBeNull()
            ->and($member->restrictions)->toBeNull()
            ->and($member->force_password_change)->toBeFalse()
            ->and($member->email)->toBe('bleibt@example.de')
            ->and($member->username)->toBe('bleibt')
            ->and($member->password)->toBe($password)
            ->and($member->getAttribute('previous_username'))->toBeNull()
            ->and($member->getAttribute('avatar_media_id'))->toBeNull()
            ->and($member->trashed())->toBeFalse();
    })->with(['/api/v1/me/profile', '/api/v1/me/settings']);

    it('changes only the signed-in member, whatever target the body names', function () {
        $me = User::factory()->create(['username' => null]);
        $other = User::factory()->create(['username' => 'anderer', 'display_name' => 'Anderer']);
        Sanctum::actingAs($me);

        $this->patchJson('/api/v1/me/profile', ['id' => $other->id, 'user_id' => $other->id, 'display_name' => 'Ich'])->assertOk()->assertJsonPath('data.id', $me->id);

        expect($other->refresh()->getAttribute('display_name'))->toBe('Anderer');
    });
});

describe('username lookalikes', function () {
    it('refuses unicode, invisible and mixed-case forms of a reserved name', function (string $username, string $reason) {
        $this->getJson('/api/v1/usernames/check?username='.rawurlencode($username))
            ->assertOk()
            ->assertJsonPath('data.available', false)
            ->assertJsonPath('data.reason', $reason);

        Sanctum::actingAs(User::factory()->create(['username' => null]));

        $this->putJson('/api/v1/me/username', ['username' => $username])->assertUnprocessable()->assertJsonValidationErrors('username');
    })->with([
        'upper case' => ['ADMIN', 'reserved'],
        'mixed case' => ['SpEeDcLuB', 'reserved'],
        'spaces around' => ['  admin  ', 'reserved'],
        'cyrillic a' => ['аdmin', 'characters'],
        'dotless i' => ['admın', 'characters'],
        'turkish dotted i' => ['ADMİN', 'characters'],
        'fullwidth' => ['ａｄｍｉｎ', 'characters'],
        'zero width space' => ["ad\u{200B}min", 'characters'],
        'combining mark' => ["admi\u{0301}n", 'characters'],
        'right-to-left override' => ["\u{202E}admin", 'characters'],
        'non-breaking space, trimmed by the middleware' => ["admin\u{A0}", 'reserved'],
    ]);

    it('stores only plain lowercase ASCII, even for characters that lowercase to ASCII', function () {
        $member = User::factory()->create(['username' => null]);
        Sanctum::actingAs($member);

        // U+212A KELVIN SIGN lowercases to a plain k.
        $this->putJson('/api/v1/me/username', ['username' => "\u{212A}urt.SC"])->assertOk();

        expect($member->refresh()->username)->toBe('kurt.sc');
    });

    it('holds an old name for others for 14 days, in any case', function () {
        User::factory()->create(['username' => 'neu.name', 'previous_username' => 'alt.name', 'username_changed_at' => now()]);
        $other = User::factory()->create(['username' => null]);
        Sanctum::actingAs($other);

        $this->travel(13)->days();
        $this->putJson('/api/v1/me/username', ['username' => 'ALT.Name'])->assertUnprocessable();

        $this->travel(2)->days();
        $this->putJson('/api/v1/me/username', ['username' => 'ALT.Name'])->assertOk();

        expect($other->refresh()->username)->toBe('alt.name');
    });
});

describe('avatar and cover go through the media pipeline', function () {
    beforeEach(function () {
        Storage::fake('public');
        Storage::fake('local');
        $this->member = User::factory()->create();
        Sanctum::actingAs($this->member);
    });

    it('removes EXIF and GPS from every public file', function (string $slot) {
        $source = TestImages::jpegWithGps(800, 600);

        expect($source)->toContain('Exif');

        $this->post("/api/v1/me/$slot", ['file' => UploadedFile::fake()->createWithContent('a.jpg', $source)], ['Accept' => 'application/json'])->assertOk();

        $files = Storage::disk('public')->allFiles();

        expect($files)->not->toBeEmpty();

        foreach ($files as $file) {
            expect(Storage::disk('public')->get($file))->not->toContain('Exif');
        }
    })->with(['avatar', 'cover']);

    it('refuses what is not a real image, whatever the name says', function (string $name, string $bytes) {
        $this->post('/api/v1/me/avatar', ['file' => UploadedFile::fake()->createWithContent($name, $bytes)], ['Accept' => 'application/json'])
            ->assertStatus(415)
            ->assertJsonPath('code', 'unsupported_media_type');

        expect(Media::query()->count())->toBe(0)
            ->and($this->member->refresh()->getAttribute('avatar_media_id'))->toBeNull();
    })->with([
        'svg as jpg' => ['a.jpg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
        'php with an image header' => ['a.php.jpg', "\xFF\xD8\xFF\xE0<?php echo 1; ?>"],
        'html' => ['a.png', '<html><script>alert(1)</script></html>'],
        'gif' => ['a.gif', TestImages::gif()],
    ]);

    it('refuses an oversized file', function () {
        $bytes = TestImages::jpeg(40, 30).str_repeat("\0", (config()->integer('speedclub.media.max_upload_mb') * 1024 * 1024) + 1);

        $this->post('/api/v1/me/avatar', ['file' => UploadedFile::fake()->createWithContent('a.jpg', $bytes)], ['Accept' => 'application/json'])->assertStatus(413);
    });

    it('never uses the client file name for a stored path', function () {
        $this->post('/api/v1/me/cover', ['file' => UploadedFile::fake()->createWithContent('..\\..\\boese.php.jpg', TestImages::jpeg(400, 300))], ['Accept' => 'application/json'])->assertOk();

        foreach ([...Storage::disk('public')->allFiles(), ...Storage::disk('local')->allFiles()] as $file) {
            expect($file)->not->toContain('boese')->not->toContain('..');
        }
    });
});

it('does not register the mail preview on staging either', function () {
    $process = new Process([PHP_BINARY, 'artisan', 'route:list', '--json'], base_path(), ['APP_ENV' => 'staging']);
    $process->mustRun();

    expect(array_column(json_decode($process->getOutput(), true, 512, JSON_THROW_ON_ERROR), 'uri'))
        ->not->toContain('dev/mail')
        ->not->toContain('dev/mail/latest');
});

describe('logs', function () {
    it('holds no code, password or token after a whole auth flow, including failures', function () {
        Mail::fake();
        $lines = [];
        Event::listen(MessageLogged::class, function (MessageLogged $event) use (&$lines): void {
            $lines[] = $event->level.' '.$event->message.' '.json_encode($event->context);
        });

        $this->postJson('/api/v1/auth/register', secRegistration('neu@example.de'))->assertStatus(202);
        $code = secLastCode(VerificationCodeMail::class);
        $this->postJson('/api/v1/auth/email/verify', ['email' => 'neu@example.de', 'code' => secWrongCode($code), 'password' => SEC_PASSWORD, 'device_name' => 'P'])->assertUnprocessable();
        $token = $this->postJson('/api/v1/auth/email/verify', ['email' => 'neu@example.de', 'code' => $code, 'password' => SEC_PASSWORD, 'device_name' => 'P'])->assertOk()->json('data.token');
        $this->postJson('/api/v1/auth/login', ['email' => 'neu@example.de', 'password' => 'Falsches-Passwort-55', 'device_name' => 'P'])->assertUnauthorized();
        $this->postJson('/api/v1/auth/password/forgot', ['email' => 'neu@example.de'])->assertStatus(202);
        $resetCode = secLastCode(PasswordResetCodeMail::class);
        $this->postJson('/api/v1/auth/password/reset', ['email' => 'neu@example.de', 'code' => $resetCode, 'password' => 'Neues-Passwort-77'])->assertOk();

        $log = implode("\n", $lines);

        expect($log)->not->toContain($code)
            ->not->toContain($resetCode)
            ->not->toContain(SEC_PASSWORD)
            ->not->toContain('Falsches-Passwort-55')
            ->not->toContain('Neues-Passwort-77')
            ->not->toContain($token)
            ->not->toContain('neu@example.de');
    });

    it('logs only the class when the mail transport fails, even if its message quotes the code', function () {
        $lines = [];
        Event::listen(MessageLogged::class, function (MessageLogged $event) use (&$lines): void {
            $lines[] = $event->message.' '.json_encode($event->context);
        });
        Mail::shouldReceive('to')->andThrow(new RuntimeException('550 neu@example.de Lackierung-92-rot 123456'));

        $this->postJson('/api/v1/auth/register', secRegistration('neu@example.de'))->assertStatus(202);

        expect($lines)->not->toBeEmpty()
            ->and(implode("\n", $lines))->not->toContain('neu@example.de')->not->toContain(SEC_PASSWORD)->not->toContain('123456');
    });
});

describe('mail content', function () {
    it('never puts a display name into an auth mail, in any form', function () {
        Mail::fake();
        User::factory()->create(['email' => 'da@example.de', 'password' => SEC_PASSWORD, 'display_name' => '<script>alert(1)</script>Dieter']);

        $this->postJson('/api/v1/auth/register', secRegistration('da@example.de'))->assertStatus(202);
        $this->postJson('/api/v1/auth/password/forgot', ['email' => 'da@example.de'])->assertStatus(202);
        $this->postJson('/api/v1/auth/login', ['email' => 'da@example.de', 'password' => SEC_PASSWORD, 'device_name' => 'Eins'])->assertOk();
        $this->postJson('/api/v1/auth/login', ['email' => 'da@example.de', 'password' => SEC_PASSWORD, 'device_name' => 'Zwei'])->assertOk();

        foreach ([AccountExistsMail::class, PasswordResetCodeMail::class, SecurityNoticeMail::class] as $class) {
            $mail = Mail::sent($class)->last();

            app()->setLocale('de');

            expect($mail)->not->toBeNull()
                ->and($mail->render())->not->toContain('Dieter')->not->toContain('<script>')
                ->and($mail->envelope()->subject)->not->toContain('Dieter');
        }
    });

    it('keeps a device name with line breaks out of the mail headers, and escapes it in the HTML', function () {
        Storage::fake('local');
        User::factory()->create(['email' => 'da@example.de', 'password' => SEC_PASSWORD]);
        $login = fn (string $device) => $this->postJson('/api/v1/auth/login', ['email' => 'da@example.de', 'password' => SEC_PASSWORD, 'device_name' => $device])->assertOk();

        $login('Erstes');
        $login("Pixel\r\nBcc: boese@example.de\r\nSubject: Boese <img src=x onerror=alert(1)>");

        $message = app('mailer')->getSymfonyTransport()->messages()->last()->getOriginalMessage();
        $headers = explode("\r\n\r\n", $message->toString(), 2)[0];

        expect($message->getBcc())->toBe([])
            ->and($message->getCc())->toBe([])
            ->and(array_map(fn ($address) => $address->getAddress(), $message->getTo()))->toBe(['da@example.de'])
            ->and($headers)->not->toContain('Bcc')->not->toContain('boese@example.de')->not->toContain('Boese')
            ->and((string) $message->getHtmlBody())->not->toContain('<img src=x');
    });

    it('cannot get a header in through the address', function (string $email) {
        Storage::fake('local');

        $this->postJson('/api/v1/auth/password/forgot', ['email' => $email])->assertUnprocessable()->assertJsonValidationErrors('email');
        $this->postJson('/api/v1/auth/register', secRegistration($email))->assertUnprocessable()->assertJsonValidationErrors('email');

        expect(app('mailer')->getSymfonyTransport()->messages())->toHaveCount(0)
            ->and(User::query()->where('email', 'like', '%boese%')->exists())->toBeFalse();
    })->with([
        'after the address' => ["a@example.de\r\nBcc: boese@example.de"],
        'in a quoted local part' => ["\"a\r\nBcc: boese@example.de\"@example.de"],
        'in the local part' => ["a\r\nBcc:boese@example.de"],
    ]);
});

describe('an account belongs to whoever proves both the password and the address (ADR-135)', function () {
    beforeEach(function () {
        Mail::fake();
        $this->attackerPassword = 'Angreifer-Passwort-11';
        $this->ownerPassword = 'Eigentuemer-Passwort-22';
    });

    it('stops the pre-hijack: the attacker has nothing left once the real owner takes the account', function () {
        Storage::fake('public');
        Storage::fake('local');

        $this->postJson('/api/v1/auth/register', secRegistration('opfer@example.de', ['password' => $this->attackerPassword, 'marketing_consent' => true]))->assertStatus(202);
        $attacker = $this->postJson('/api/v1/auth/login', ['email' => 'opfer@example.de', 'password' => $this->attackerPassword, 'device_name' => 'Angreifer'])->assertOk()->json('data.token');

        secForgetAuth();
        $this->withToken($attacker)->putJson('/api/v1/me/username', ['username' => 'hijack.name'])->assertOk();
        secForgetAuth();
        $this->withToken($attacker)->patchJson('/api/v1/me/profile', ['display_name' => 'Falscher Name'])->assertOk();
        secForgetAuth();
        $this->withToken($attacker)->post('/api/v1/me/avatar', ['file' => UploadedFile::fake()->createWithContent('a.jpg', TestImages::jpeg(400, 300))], ['Accept' => 'application/json', 'Idempotency-Key' => (string) str()->ulid()])->assertOk();
        secForgetAuth();
        $this->flushHeaders();

        // The real owner registers, gets only the notice, asks for a code and types it with their own password.
        $this->travel(61)->seconds();
        $this->postJson('/api/v1/auth/register', secRegistration('opfer@example.de', ['password' => $this->ownerPassword]))->assertStatus(202);
        Mail::assertSent(AccountExistsMail::class, fn ($mail) => $mail->hasTo('opfer@example.de'));

        $this->postJson('/api/v1/auth/email/resend', ['email' => 'opfer@example.de'])->assertStatus(202);
        $code = secLastCode(VerificationCodeMail::class);

        $this->postJson('/api/v1/auth/email/verify', ['email' => 'opfer@example.de', 'code' => $code, 'password' => $this->ownerPassword, 'device_name' => 'Opfer'])
            ->assertUnprocessable()
            ->assertExactJson(['message' => __('errors.invalid_code'), 'code' => 'invalid_code', 'errors' => ['code' => [__('errors.invalid_code')]]]);

        $member = User::query()->where('email', 'opfer@example.de')->sole();

        expect($member->hasVerifiedEmail())->toBeFalse()
            ->and(Hash::check($this->attackerPassword, $member->password))->toBeTrue();

        // Forgot password is the owner's way in: it replaces the password and everything set before the address was proven.
        $this->postJson('/api/v1/auth/password/forgot', ['email' => 'opfer@example.de'])->assertStatus(202);
        $this->postJson('/api/v1/auth/password/reset', ['email' => 'opfer@example.de', 'code' => secLastCode(PasswordResetCodeMail::class), 'password' => $this->ownerPassword])->assertOk();

        secForgetAuth();
        $this->withToken($attacker)->getJson('/api/v1/auth/me')->assertUnauthorized();
        secForgetAuth();
        $this->flushHeaders();
        $this->postJson('/api/v1/auth/login', ['email' => 'opfer@example.de', 'password' => $this->attackerPassword, 'device_name' => 'Angreifer'])->assertUnauthorized();

        $member->refresh();

        expect($member->hasVerifiedEmail())->toBeTrue()
            ->and($member->getAttribute('marketing_consent_at'))->toBeNull()
            ->and($member->username)->toBeNull()
            ->and($member->getAttribute('previous_username'))->toBeNull()
            ->and($member->getAttribute('username_changed_at'))->toBeNull()
            ->and($member->getAttribute('display_name'))->toBeNull()
            ->and($member->getAttribute('avatar_media_id'))->toBeNull()
            ->and(Media::query()->where('owner_id', $member->id)->count())->toBe(0)
            ->and(Storage::disk('public')->allFiles())->toBe([]);

        $this->postJson('/api/v1/auth/login', ['email' => 'opfer@example.de', 'password' => $this->ownerPassword, 'device_name' => 'Opfer'])->assertOk();
    });

    it('keeps what a verified member set when they use forgot password', function () {
        $member = User::factory()->create(['email' => 'da@example.de', 'username' => 'bleibt.hier', 'display_name' => 'Bleibt', 'marketing_consent_at' => now()]);

        $this->postJson('/api/v1/auth/password/forgot', ['email' => 'da@example.de'])->assertStatus(202);
        $this->postJson('/api/v1/auth/password/reset', ['email' => 'da@example.de', 'code' => secLastCode(PasswordResetCodeMail::class), 'password' => 'Neues-Passwort-77'])->assertOk();

        $member->refresh();

        expect($member->username)->toBe('bleibt.hier')
            ->and($member->getAttribute('display_name'))->toBe('Bleibt')
            ->and($member->getAttribute('marketing_consent_at'))->not->toBeNull();
    });

    it('revokes every earlier token and session when the right password and code arrive', function () {
        $member = User::factory()->registered()->create(['email' => 'neu@example.de', 'password' => SEC_PASSWORD]);
        $earlier = $member->createToken('Altes Telefon', ['member'])->plainTextToken;
        $session = databaseSessionFor($member, 'web');
        DB::table('sessions')->where('id', $session)->update(['user_id' => $member->id]);
        $code = app(VerificationCodes::class)->issue($member, VerificationPurpose::EmailVerification);
        secForgetAuth();

        $new = $this->postJson('/api/v1/auth/email/verify', ['email' => 'neu@example.de', 'code' => $code, 'password' => SEC_PASSWORD, 'device_name' => 'Neu'])
            ->assertOk()
            ->assertJsonPath('data.member.email_verified', true)
            ->json('data.token');

        expect(DB::table('sessions')->where('user_id', $member->id)->exists())->toBeFalse()
            ->and($member->tokens()->count())->toBe(1);

        secForgetAuth();
        $this->withToken($earlier)->getJson('/api/v1/auth/me')->assertUnauthorized();
        secForgetAuth();
        $this->withToken($new)->getJson('/api/v1/auth/me')->assertOk();
    });

    it('does not ask a request signed in as that account for the password: token', function () {
        $member = User::factory()->registered()->create(['email' => 'neu@example.de', 'password' => SEC_PASSWORD]);
        $token = $this->postJson('/api/v1/auth/login', ['email' => 'neu@example.de', 'password' => SEC_PASSWORD, 'device_name' => 'Telefon'])->assertOk()->json('data.token');
        $code = app(VerificationCodes::class)->issue($member, VerificationPurpose::EmailVerification);
        secForgetAuth();

        $new = $this->withToken($token)->postJson('/api/v1/auth/email/verify', ['email' => 'neu@example.de', 'code' => $code, 'device_name' => 'Telefon'])->assertOk()->json('data.token');

        expect($new)->not->toBe($token)
            ->and($member->tokens()->count())->toBe(1);

        secForgetAuth();
        $this->withToken($token)->getJson('/api/v1/auth/me')->assertUnauthorized();
        secForgetAuth();
        $this->withToken($new)->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('data.email_verified', true);
    });

    it('does not ask a request signed in as that account for the password: SPA session', function () {
        config(['sanctum.middleware.validate_csrf_token' => CsrfEnforcedInTests::class]);
        $member = User::factory()->registered()->create(['email' => 'neu@example.de', 'password' => SEC_PASSWORD]);
        $code = app(VerificationCodes::class)->issue($member, VerificationPurpose::EmailVerification);
        $spa = secOpenSpaSession();
        $login = secSpa($spa['session'], $spa['xsrf'])->postJson('/api/v1/auth/login', ['email' => 'neu@example.de', 'password' => SEC_PASSWORD])->assertOk();
        $signedIn = $login->getCookie(config()->string('session.cookie'))->getValue();
        $xsrf = $login->getCookie('XSRF-TOKEN', decrypt: false)->getValue();

        $verified = secSpa($signedIn, $xsrf)->postJson('/api/v1/auth/email/verify', ['email' => 'neu@example.de', 'code' => $code])->assertOk();
        $after = $verified->getCookie(config()->string('session.cookie'))->getValue();

        expect($after)->not->toBe($signedIn)
            ->and(DB::table('sessions')->where('id', $signedIn)->exists())->toBeFalse();

        secSpa($after)->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('data.email_verified', true);
    });

    it('does not let another account stand in for the password', function () {
        $target = User::factory()->registered()->create(['email' => 'ziel@example.de', 'password' => SEC_PASSWORD]);
        $code = app(VerificationCodes::class)->issue($target, VerificationPurpose::EmailVerification);
        $other = User::factory()->create()->createToken('Telefon', ['member'])->plainTextToken;

        $this->withToken($other)->postJson('/api/v1/auth/email/verify', ['email' => 'ziel@example.de', 'code' => $code, 'device_name' => 'P'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('password');

        secForgetAuth();
        $this->withToken($other)->postJson('/api/v1/auth/email/verify', ['email' => 'ziel@example.de', 'code' => $code, 'password' => 'Falsches-Passwort-55', 'device_name' => 'P'])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'invalid_code');

        expect($target->refresh()->hasVerifiedEmail())->toBeFalse();
    });

    it('answers a missing password the same for every address, before any account is looked at', function () {
        User::factory()->registered()->create(['email' => 'neu@example.de']);
        User::factory()->create(['email' => 'da@example.de']);

        $answers = collect(['neu@example.de', 'da@example.de', 'wer@example.de'])
            ->map(fn (string $email) => $this->postJson('/api/v1/auth/email/verify', ['email' => $email, 'code' => '123456', 'device_name' => 'P'])->assertUnprocessable()->assertJsonValidationErrors('password')->json());

        expect($answers->unique()->count())->toBe(1);
    });

    it('answers a wrong password like a wrong code, without spending an attempt of the owner', function () {
        $member = User::factory()->registered()->create(['email' => 'neu@example.de', 'password' => SEC_PASSWORD]);
        User::factory()->create(['email' => 'da@example.de', 'password' => SEC_PASSWORD]);
        $code = app(VerificationCodes::class)->issue($member, VerificationPurpose::EmailVerification);
        $verify = fn (string $email, string $value, string $password) => $this->postJson('/api/v1/auth/email/verify', ['email' => $email, 'code' => $value, 'password' => $password, 'device_name' => 'P'])->assertUnprocessable()->json();

        $rightCodeWrongPassword = $verify('neu@example.de', $code, 'Falsches-Passwort-55');

        foreach (range(1, 6) as $round) {
            $verify('neu@example.de', secWrongCode($code), 'Falsches-Passwort-55');
        }

        expect(VerificationCode::query()->where('user_id', $member->id)->sole()->attempts)->toBe(0)
            ->and($verify('neu@example.de', secWrongCode($code), SEC_PASSWORD))->toBe($rightCodeWrongPassword)
            ->and($verify('wer@example.de', '123456', SEC_PASSWORD))->toBe($rightCodeWrongPassword)
            ->and($verify('da@example.de', '123456', SEC_PASSWORD))->toBe($rightCodeWrongPassword)
            ->and(VerificationCode::query()->where('user_id', $member->id)->sole()->attempts)->toBe(1);

        $this->postJson('/api/v1/auth/email/verify', ['email' => 'neu@example.de', 'code' => $code, 'password' => SEC_PASSWORD, 'device_name' => 'P'])->assertOk();
    });

    it('does the same password work for an open, a verified and an unknown address', function () {
        $hash = new class(app()) extends HashManager
        {
            /** @var list<string> */
            public array $checked = [];

            public function check(#[SensitiveParameter] $value, $hashedValue, array $options = []): bool
            {
                $this->checked[] = (string) $hashedValue;

                return parent::check($value, $hashedValue, $options);
            }
        };

        $open = User::factory()->registered()->create(['email' => 'neu@example.de']);
        User::factory()->create(['email' => 'da@example.de']);
        Hash::swap($hash);

        foreach (['neu@example.de', 'da@example.de', 'wer@example.de'] as $email) {
            $this->postJson('/api/v1/auth/email/verify', ['email' => $email, 'code' => '123456', 'password' => 'Falsches-Passwort-55', 'device_name' => 'P'])->assertUnprocessable();
        }

        expect($hash->checked)->toHaveCount(3)
            ->and(Hash::info($hash->checked[1]))->toBe(Hash::info($open->password))
            ->and(Hash::info($hash->checked[2]))->toBe(Hash::info($open->password));
    });

    describe('never-verified accounts expire', function () {
        beforeEach(function () {
            Storage::fake('public');
            Storage::fake('local');
        });

        it('removes the account with its tokens, sessions and files after the retention, and frees the address', function () {
            $old = User::factory()->registered()->create(['email' => 'alt@example.de', 'created_at' => now()->subDays(8)]);
            $old->createToken('Telefon', ['member']);
            $session = databaseSessionFor($old, 'web');
            DB::table('sessions')->where('id', $session)->update(['user_id' => $old->id]);
            app(MediaService::class)->storeFromUpload(UploadedFile::fake()->createWithContent('a.jpg', TestImages::jpeg(400, 300)), $old, $old);
            $trashed = User::factory()->registered()->create(['created_at' => now()->subDays(8)]);
            $trashed->delete();

            expect(Storage::disk('local')->allFiles())->not->toBeEmpty();

            $this->artisan('speedclub:prune-platform')->assertSuccessful();

            expect(User::withTrashed()->whereKey([$old->id, $trashed->id])->count())->toBe(0)
                ->and(DB::table('personal_access_tokens')->where('tokenable_id', $old->id)->exists())->toBeFalse()
                ->and(DB::table('sessions')->where('user_id', $old->id)->exists())->toBeFalse()
                ->and(Media::withTrashed()->count())->toBe(0)
                ->and(Storage::disk('public')->allFiles())->toBe([])
                ->and(Storage::disk('local')->allFiles())->toBe([]);

            $this->postJson('/api/v1/auth/register', secRegistration('alt@example.de'))->assertStatus(202);
            Mail::assertSent(VerificationCodeMail::class, fn ($mail) => $mail->hasTo('alt@example.de'));
        });

        it('keeps younger, verified and sanctioned accounts', function () {
            $young = User::factory()->registered()->create(['created_at' => now()->subDays(6)]);
            $verified = User::factory()->create(['created_at' => now()->subYear()]);
            $suspended = User::factory()->registered()->suspended()->create(['created_at' => now()->subYear()]);
            $deactivated = User::factory()->registered()->deactivated()->create(['created_at' => now()->subYear()]);

            $this->artisan('speedclub:prune-platform')->assertSuccessful();

            expect(User::query()->whereKey([$young->id, $verified->id, $suspended->id, $deactivated->id])->count())->toBe(4);
        });
    });
});

describe('an address is compared byte for byte (ADR-136)', function () {
    beforeEach(function () {
        Mail::fake();
        $this->member = User::factory()->create(['email' => 'max@example.de', 'password' => SEC_PASSWORD]);
    });

    it('stores the address in a binary collation with its unique index intact', function () {
        $column = collect(Schema::getColumns('users'))->firstWhere('name', 'email');
        $index = collect(Schema::getIndexes('users'))->first(fn (array $index): bool => $index['columns'] === ['email']);

        expect($column['collation'])->toBe('utf8mb4_bin')
            ->and($index['unique'])->toBeTrue();
    });

    it('does not sign anyone in through an accented spelling, even with the right password', function (string $variant) {
        $this->postJson('/api/v1/auth/login', ['email' => $variant, 'password' => SEC_PASSWORD, 'device_name' => 'P'])
            ->assertUnauthorized()
            ->assertJsonPath('code', 'invalid_credentials');

        expect($this->member->tokens()->count())->toBe(0);
    })->with(['máx@example.de', 'mäx@example.de', 'max@exämple.de']);

    it('has no counters to shop around: spellings cannot reach the account, and the real one still gets its delay', function () {
        foreach (['máx', 'mäx', 'màx', 'mâx', 'mãx'] as $spelling) {
            $this->postJson('/api/v1/auth/login', ['email' => "$spelling@example.de", 'password' => SEC_PASSWORD, 'device_name' => 'P'])->assertUnauthorized();
        }

        foreach (range(1, 5) as $round) {
            $this->withServerVariables(['REMOTE_ADDR' => "203.0.113.$round"])
                ->postJson('/api/v1/auth/login', ['email' => 'max@example.de', 'password' => 'falsch-falsch', 'device_name' => 'P'])
                ->assertUnauthorized();
        }

        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.200'])
            ->postJson('/api/v1/auth/login', ['email' => 'max@example.de', 'password' => SEC_PASSWORD, 'device_name' => 'P'])
            ->assertStatus(429)
            ->assertHeader('Retry-After');
    });

    it('keeps the delay on the account when its address changes', function () {
        foreach (range(1, 5) as $round) {
            $this->postJson('/api/v1/auth/login', ['email' => 'max@example.de', 'password' => 'falsch-falsch', 'device_name' => 'P'])->assertUnauthorized();
        }

        $this->member->forceFill(['email' => 'neu.max@example.de'])->save();

        $this->postJson('/api/v1/auth/login', ['email' => 'neu.max@example.de', 'password' => SEC_PASSWORD, 'device_name' => 'P'])->assertStatus(429);
    });

    it('lets the owner of an address register although a lookalike domain came first', function () {
        $this->member->forceDelete();

        $this->postJson('/api/v1/auth/register', secRegistration('max@exämple.de'))->assertStatus(202);
        Mail::fake();

        $this->postJson('/api/v1/auth/register', secRegistration('max@example.de'))->assertStatus(202);

        Mail::assertSent(VerificationCodeMail::class, fn ($mail) => $mail->hasTo('max@example.de'));
        Mail::assertNotSent(AccountExistsMail::class);

        // The lookalike is stored with its domain in ASCII (recheck round 3), still a mailbox of its own.
        expect(User::query()->where('email', 'max@example.de')->exists())->toBeTrue()
            ->and(User::query()->where('email', 'max@xn--exmple-cua.de')->exists())->toBeTrue();
    });

    it('treats a spelling as another address on verify, resend and reset', function () {
        $open = User::factory()->registered()->create(['email' => 'offen@example.de', 'password' => SEC_PASSWORD]);
        $code = app(VerificationCodes::class)->issue($open, VerificationPurpose::EmailVerification);
        $reset = app(VerificationCodes::class)->issue($this->member, VerificationPurpose::PasswordReset);

        $this->postJson('/api/v1/auth/email/verify', ['email' => 'öffen@example.de', 'code' => $code, 'password' => SEC_PASSWORD, 'device_name' => 'P'])->assertUnprocessable()->assertJsonPath('code', 'invalid_code');
        $this->postJson('/api/v1/auth/password/reset', ['email' => 'máx@example.de', 'code' => $reset, 'password' => 'Neues-Passwort-77'])->assertUnprocessable()->assertJsonPath('code', 'invalid_code');

        $this->travel(61)->seconds();
        $this->postJson('/api/v1/auth/email/resend', ['email' => 'öffen@example.de'])->assertStatus(202);

        Mail::assertNothingSent();
        expect($open->refresh()->hasVerifiedEmail())->toBeFalse()
            ->and(Hash::check(SEC_PASSWORD, $this->member->refresh()->password))->toBeTrue();
    });
});

describe('input that is not a string', function () {
    it('answers 422, never 500, for an array or an object in any field', function (string $path, array $body, string $field) {
        foreach ([['a@example.de'], ['x' => 1]] as $value) {
            $response = $this->postJson($path, [...$body, $field => $value]);

            expect($response->status())->toBe(422)
                ->and($response->json('errors'))->toHaveKey($field);
        }
    })->with(function () {
        $register = ['email' => 'neu@example.de', 'password' => SEC_PASSWORD, 'accepted_age_16' => true, 'accepted_terms' => true, 'accepted_privacy' => true];
        $endpoints = [
            'register' => ['/api/v1/auth/register', $register, ['email', 'password', 'marketing_consent', 'locale']],
            'verify' => ['/api/v1/auth/email/verify', ['email' => 'neu@example.de', 'code' => '123456', 'password' => SEC_PASSWORD, 'device_name' => 'P'], ['email', 'code', 'password', 'device_name', 'platform', 'app_version', 'device_id']],
            'resend' => ['/api/v1/auth/email/resend', ['email' => 'neu@example.de'], ['email']],
            'login' => ['/api/v1/auth/login', ['email' => 'neu@example.de', 'password' => SEC_PASSWORD, 'device_name' => 'P'], ['email', 'password', 'device_name', 'platform', 'app_version', 'device_id']],
            'forgot' => ['/api/v1/auth/password/forgot', ['email' => 'neu@example.de'], ['email']],
            'reset' => ['/api/v1/auth/password/reset', ['email' => 'neu@example.de', 'code' => '123456', 'password' => SEC_PASSWORD], ['email', 'code', 'password']],
        ];

        foreach ($endpoints as $name => [$path, $body, $fields]) {
            foreach ($fields as $field) {
                yield "$name $field" => [$path, $body, $field];
            }
        }
    });
});
