<?php

use App\Enums\MemberSecurityEvent;
use App\Enums\RestrictionType;
use App\Enums\VerificationPurpose;
use App\Mail\AccountExistsMail;
use App\Mail\PasswordResetCodeMail;
use App\Mail\SecurityNoticeMail;
use App\Mail\VerificationCodeMail;
use App\Models\KnownDevice;
use App\Models\LegalDocument;
use App\Models\PersonalAccessToken;
use App\Models\Staff;
use App\Models\User;
use App\Models\VerificationCode;
use App\Services\Auth\VerificationCodes;
use App\Support\CommonPasswords;
use Illuminate\Hashing\HashManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\RateLimiter;

const AUTH_PASSWORD = 'Lackierung-92-rot';

const SPA_ORIGIN = 'http://localhost:8080';

beforeEach(function () {
    Mail::fake();
});

/**
 * @return array<string, mixed>
 */
function registration(array $overrides = []): array
{
    return [
        'email' => 'neu@example.de',
        'password' => AUTH_PASSWORD,
        'accepted_age_16' => true,
        'accepted_terms' => true,
        'accepted_privacy' => true,
        ...$overrides,
    ];
}

function codeFromMail(string $mailable = VerificationCodeMail::class): string
{
    $mail = Mail::sent($mailable)->last();

    return $mail->code;
}

function otherCode(string $code): string
{
    return $code === '000000' ? '000001' : '000000';
}

function issueCode(User $user, VerificationPurpose $purpose = VerificationPurpose::EmailVerification): string
{
    return app(VerificationCodes::class)->issue($user, $purpose);
}

function signInOnDevice(User $user, string $device = 'Pixel 9', string $password = 'password'): string
{
    return test()->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => $password, 'device_name' => $device, 'platform' => 'android', 'app_version' => '0.1.0'])
        ->assertOk()
        ->json('data.token');
}

/**
 * A request as a browser on the SPA origin sends it, with the given session cookie.
 */
function spa(string $cookie): mixed
{
    return test()->withCredentials()->withCookie(config()->string('session.cookie'), $cookie)->withHeaders(['Origin' => SPA_ORIGIN, 'Accept' => 'application/json']);
}

function freshSpaSession(): string
{
    config(['session.driver' => 'database']);
    app()->forgetInstance('session.store');

    $response = test()->withHeaders(['Origin' => SPA_ORIGIN])->get('/sanctum/csrf-cookie')->assertNoContent();

    return $response->getCookie(config()->string('session.cookie'))->getValue();
}

/**
 * A new PHP process per request in real life: nothing of the last request's guard or session may carry over.
 */
function forgetAuth(): void
{
    app('auth')->forgetGuards();
    app('session')->forgetDrivers();
    app()->forgetInstance('session.store');
}

describe('POST auth/register', function () {
    it('creates an unverified member and sends a code, without any auth', function () {
        LegalDocument::factory()->create(['key' => 'terms', 'locale' => 'de', 'version' => 'T3', 'published_at' => now()->subDay()]);
        LegalDocument::factory()->create(['key' => 'privacy', 'locale' => 'de', 'version' => 'P7', 'published_at' => now()->subDay()]);

        $response = $this->postJson('/api/v1/auth/register', registration())
            ->assertStatus(202)
            ->assertExactJson(['data' => ['next' => 'verify_email', 'email' => 'neu@example.de', 'resend_after_seconds' => 60]]);

        expect($response->headers->getCookies())->toBe([]);

        $user = User::query()->where('email', 'neu@example.de')->sole();

        expect($user->email_verified_at)->toBeNull()
            ->and($user->username)->toBeNull()
            ->and($user->terms_version)->toBe('T3')
            ->and($user->privacy_version)->toBe('P7')
            ->and($user->consented_at)->not->toBeNull()
            ->and($user->marketing_consent_at)->toBeNull()
            ->and($user->tokens()->count())->toBe(0)
            ->and(Hash::check(AUTH_PASSWORD, $user->password))->toBeTrue();

        Mail::assertSent(VerificationCodeMail::class, fn ($mail) => $mail->hasTo('neu@example.de') && preg_match('/\A\d{6}\z/', $mail->code) === 1);
        $this->assertDatabaseHas('audit_events', ['action' => MemberSecurityEvent::Registered->value, 'actor_id' => $user->id]);
    });

    it('stores marketing consent and locale', function () {
        $this->postJson('/api/v1/auth/register', registration(['marketing_consent' => true, 'locale' => 'en']))->assertStatus(202);

        $user = User::query()->where('email', 'neu@example.de')->sole();

        expect($user->marketing_consent_at)->not->toBeNull()->and($user->locale)->toBe('en');
    });

    it('takes the locale from Accept-Language otherwise', function () {
        $this->withHeader('Accept-Language', 'en')->postJson('/api/v1/auth/register', registration())->assertStatus(202);

        expect(User::query()->where('email', 'neu@example.de')->sole()->locale)->toBe('en');
    });

    it('lowercases the address', function () {
        $this->postJson('/api/v1/auth/register', registration(['email' => ' Neu@Example.DE ']))
            ->assertStatus(202)
            ->assertJsonPath('data.email', 'neu@example.de');
    });

    it('answers the same for a known address, creates nothing and sends the owner a notice', function () {
        $owner = User::factory()->create(['email' => 'da@example.de', 'password' => 'Altes-Passwort-1', 'locale' => 'en']);

        $known = $this->postJson('/api/v1/auth/register', registration(['email' => 'da@example.de']))->assertStatus(202);
        $unknown = $this->postJson('/api/v1/auth/register', registration(['email' => 'frei@example.de']))->assertStatus(202);

        expect(json_encode($known->json()))->toBe(str_replace('frei@', 'da@', (string) json_encode($unknown->json())))
            ->and(User::query()->where('email', 'da@example.de')->count())->toBe(1)
            ->and(Hash::check('Altes-Passwort-1', $owner->refresh()->password))->toBeTrue();

        Mail::assertSent(AccountExistsMail::class, fn ($mail) => $mail->hasTo('da@example.de') && $mail->locale === 'en');
        Mail::assertNotSent(VerificationCodeMail::class, fn ($mail) => $mail->hasTo('da@example.de'));
    });

    it('does not let anyone flood an inbox with notices', function () {
        User::factory()->create(['email' => 'da@example.de']);
        RateLimiter::clear('member_register');

        foreach (range(1, 4) as $round) {
            $this->withServerVariables(['REMOTE_ADDR' => "203.0.113.$round"])->postJson('/api/v1/auth/register', registration(['email' => 'da@example.de']))->assertStatus(202);
            $this->withServerVariables(['REMOTE_ADDR' => "203.0.113.1$round"])->postJson('/api/v1/auth/register', registration(['email' => 'da@example.de']))->assertStatus(202);
        }

        Mail::assertSent(AccountExistsMail::class, 5);
    });

    it('names the broken password rule, never a score', function (string $password, string $message) {
        $this->withHeader('Accept-Language', 'de')->postJson('/api/v1/auth/register', registration(['password' => $password]))
            ->assertUnprocessable()
            ->assertJsonPath('code', 'validation_failed')
            ->assertJsonFragment([$message]);

        expect(User::query()->count())->toBe(0);
    })->with([
        'too short' => ['kurz-123', 'Dein Passwort muss mindestens 10 Zeichen lang sein.'],
        'common' => ['qwertyuiop', 'Dieses Passwort ist zu verbreitet. Wähl ein anderes.'],
        'common in any case' => ['QwertyuioP', 'Dieses Passwort ist zu verbreitet. Wähl ein anderes.'],
        'german common' => ['Passwort123', 'Dieses Passwort ist zu verbreitet. Wähl ein anderes.'],
        'the address' => ['neu@example.de', 'Dein Passwort darf nicht deine E-Mail-Adresse sein.'],
    ]);

    it('ships a list whose entries can all match at the minimum length', function () {
        $lines = file(database_path('data/common-passwords.txt'), FILE_IGNORE_NEW_LINES);
        $minimum = config()->integer('speedclub.passwords.min_length');

        expect(array_filter($lines, fn (string $line): bool => mb_strlen($line) >= $minimum))->toHaveCount(count($lines))
            ->and(count($lines))->toBeGreaterThanOrEqual(10000)
            ->and(CommonPasswords::reachableEntries())->toBe(count($lines))
            ->and(array_unique($lines))->toHaveCount(count($lines))
            ->and(array_filter($lines, fn (string $line): bool => $line !== mb_strtolower($line)))->toBe([]);
    });

    it('rejects the passwords people really use, by the common rule', function (string $password) {
        $this->postJson('/api/v1/auth/register', registration(['password' => $password]))
            ->assertUnprocessable()
            ->assertJsonPath('errors.password', [__('passwords.rules.common')]);

        expect(User::query()->count())->toBe(0);
    })->with([
        'password123', 'password1234', 'password12', 'passwort12', 'qwerty1234', 'qwerty12345', '1111111111', '0123456789',
        '12345678910', 'abcdefghij', '1qaz2wsx3edc', 'iloveyou12', 'iloveyou123', 'michael123', 'administrator', 'admin12345',
        'qwertz1234', 'Passwort123', 'PORSCHE1234', 'volkswagen', 'mercedes123', 'schalke0404',
    ]);

    it('refuses to register without the list, instead of accepting every password', function (string $state) {
        $path = storage_path('framework/testing/common-passwords-'.bin2hex(random_bytes(4)).'.txt');

        if ($state === 'empty') {
            File::ensureDirectoryExists(dirname($path));
            File::put($path, '');
        }

        config()->set('speedclub.passwords.common_list', $path);

        $this->postJson('/api/v1/auth/register', registration())->assertServerError();

        expect(User::query()->count())->toBe(0);

        File::delete($path);
    })->with(['absent', 'empty']);

    it('words the consent errors as sentences, in both languages', function (string $locale, string $field, string $message) {
        foreach ([false, null] as $value) {
            $this->withHeader('Accept-Language', $locale)
                ->postJson('/api/v1/auth/register', registration([$field => $value]))
                ->assertUnprocessable()
                ->assertJsonPath("errors.$field", [$message]);
        }
    })->with([
        ['de', 'accepted_age_16', 'Bestätige, dass du mindestens 16 Jahre alt bist.'],
        ['de', 'accepted_terms', 'Stimme den AGB zu, um weiterzumachen.'],
        ['de', 'accepted_privacy', 'Bestätige, dass du die Datenschutzerklärung gelesen hast.'],
        ['en', 'accepted_age_16', 'Confirm that you are at least 16 years old.'],
        ['en', 'accepted_terms', 'Accept the terms and conditions to continue.'],
        ['en', 'accepted_privacy', 'Confirm that you have read the privacy policy.'],
    ]);

    it('requires each consent and validates the input', function (array $overrides, string $field) {
        $this->postJson('/api/v1/auth/register', registration($overrides))
            ->assertUnprocessable()
            ->assertJsonValidationErrors($field);
    })->with([
        'no age' => [['accepted_age_16' => false], 'accepted_age_16'],
        'no terms' => [['accepted_terms' => false], 'accepted_terms'],
        'no privacy' => [['accepted_privacy' => false], 'accepted_privacy'],
        'bad address' => [['email' => 'keine-adresse'], 'email'],
        'address as an array' => [['email' => ['a@example.de']], 'email'],
        'address as an object' => [['email' => ['x' => 1]], 'email'],
        'no password' => [['password' => null], 'password'],
        'other locale' => [['locale' => 'fr'], 'locale'],
    ]);

    it('allows five registrations per hour per IP', function () {
        foreach (range(1, 5) as $round) {
            $this->postJson('/api/v1/auth/register', registration(['email' => "neu$round@example.de"]))->assertStatus(202);
        }

        $this->postJson('/api/v1/auth/register', registration(['email' => 'neu6@example.de']))
            ->assertStatus(429)
            ->assertJsonPath('code', 'rate_limited')
            ->assertHeader('Retry-After');
    });
});

describe('POST auth/email/verify', function () {
    beforeEach(function () {
        $this->member = User::factory()->registered()->create(['email' => 'neu@example.de']);
        $this->code = issueCode($this->member);
    });

    it('verifies, signs in with a token and records the event', function () {
        $response = $this->postJson('/api/v1/auth/email/verify', ['email' => 'neu@example.de', 'code' => $this->code, 'password' => 'password', 'device_name' => 'iPhone 16', 'platform' => 'ios', 'app_version' => '0.1.0'])
            ->assertOk()
            ->assertJsonPath('data.member.email_verified', true)
            ->assertJsonPath('data.member.next_step', 'choose_username');

        expect($response->json('data.token'))->toBeString()
            ->and($response->headers->get('Cache-Control'))->toContain('no-store')
            ->and($this->member->refresh()->email_verified_at)->not->toBeNull();

        $token = $this->member->tokens()->sole();

        expect($token->device_name)->toBe('iPhone 16')
            ->and($token->platform->value)->toBe('ios')
            ->and($token->app_version)->toBe('0.1.0')
            ->and($token->abilities)->toBe(['member'])
            ->and((int) round(now()->diffInDays($token->expires_at)))->toBe(90);

        $this->assertDatabaseHas('audit_events', ['action' => MemberSecurityEvent::EmailVerified->value, 'actor_id' => $this->member->id]);
        Mail::assertNotSent(SecurityNoticeMail::class);
    });

    it('signs in the SPA session without a device', function () {
        $session = freshSpaSession();

        $response = spa($session)->postJson('/api/v1/auth/email/verify', ['email' => 'neu@example.de', 'code' => $this->code, 'password' => 'password'])
            ->assertOk()
            ->assertJsonPath('data.token', null)
            ->assertJsonPath('data.token_expires_at', null);

        $newSession = $response->getCookie(config()->string('session.cookie'))->getValue();

        expect($newSession)->not->toBe($session);

        forgetAuth();
        spa($newSession)->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('data.email', 'neu@example.de');
    });

    it('answers 419 without a device and without a session, and keeps the code', function () {
        $this->postJson('/api/v1/auth/email/verify', ['email' => 'neu@example.de', 'code' => $this->code, 'password' => 'password'])
            ->assertStatus(419)
            ->assertJsonPath('code', 'session_expired');

        expect($this->member->refresh()->email_verified_at)->toBeNull();

        $this->postJson('/api/v1/auth/email/verify', ['email' => 'neu@example.de', 'code' => $this->code, 'password' => 'password', 'device_name' => 'Pixel'])->assertOk();
    });

    it('answers the same for wrong, unknown and expired', function () {
        $wrong = $this->postJson('/api/v1/auth/email/verify', ['email' => 'neu@example.de', 'code' => otherCode($this->code), 'password' => 'password', 'device_name' => 'P']);
        $unknown = $this->postJson('/api/v1/auth/email/verify', ['email' => 'wer@example.de', 'code' => '123456', 'password' => 'password', 'device_name' => 'P']);

        $this->travel(11)->minutes();
        $expired = $this->postJson('/api/v1/auth/email/verify', ['email' => 'neu@example.de', 'code' => $this->code, 'password' => 'password', 'device_name' => 'P']);

        foreach ([$wrong, $unknown, $expired] as $response) {
            $response->assertUnprocessable()
                ->assertExactJson([
                    'message' => __('errors.invalid_code'),
                    'code' => 'invalid_code',
                    'errors' => ['code' => [__('errors.invalid_code')]],
                ]);
        }

        expect($this->member->refresh()->email_verified_at)->toBeNull();
    });

    it('gives each code five attempts', function () {
        foreach (range(1, 5) as $attempt) {
            $this->postJson('/api/v1/auth/email/verify', ['email' => 'neu@example.de', 'code' => otherCode($this->code), 'password' => 'password', 'device_name' => 'P'])->assertUnprocessable();
        }

        expect(VerificationCode::query()->where('user_id', $this->member->id)->value('attempts'))->toBe(5);

        $this->postJson('/api/v1/auth/email/verify', ['email' => 'neu@example.de', 'code' => $this->code, 'password' => 'password', 'device_name' => 'P'])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'invalid_code');
    });

    it('does not accept a used code again', function () {
        $this->postJson('/api/v1/auth/email/verify', ['email' => 'neu@example.de', 'code' => $this->code, 'password' => 'password', 'device_name' => 'P'])->assertOk();

        $this->postJson('/api/v1/auth/email/verify', ['email' => 'neu@example.de', 'code' => $this->code, 'password' => 'password', 'device_name' => 'P'])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'invalid_code');
    });

    it('does not accept a code replaced by a newer one', function () {
        $this->travel(61)->seconds();
        $newer = issueCode($this->member);

        expect($newer)->not->toBeNull();

        if ($newer !== $this->code) {
            $this->postJson('/api/v1/auth/email/verify', ['email' => 'neu@example.de', 'code' => $this->code, 'password' => 'password', 'device_name' => 'P'])->assertUnprocessable();
        }

        $this->postJson('/api/v1/auth/email/verify', ['email' => 'neu@example.de', 'code' => $newer, 'password' => 'password', 'device_name' => 'P'])->assertOk();
    });

    it('does not accept a reset code here', function () {
        $reset = issueCode($this->member, VerificationPurpose::PasswordReset);

        if ($reset !== $this->code) {
            $this->postJson('/api/v1/auth/email/verify', ['email' => 'neu@example.de', 'code' => $reset, 'password' => 'password', 'device_name' => 'P'])->assertUnprocessable();
        }

        expect($this->member->refresh()->email_verified_at)->toBeNull();
    });

    it('keeps codes hashed at rest', function () {
        $row = VerificationCode::query()->where('user_id', $this->member->id)->sole();

        expect($row->code_hash)->not->toContain($this->code)
            ->and(strlen((string) $row->code_hash))->toBe(64)
            ->and($row->expires_at->diffInMinutes(now(), true))->toEqualWithDelta(10, 0.1);
    });

    it('verifies a suspended member but does not sign them in', function () {
        $this->member->forceFill(['status' => 'suspended', 'restrictions' => ['suspension' => ['until' => null]]])->save();

        $this->postJson('/api/v1/auth/email/verify', ['email' => 'neu@example.de', 'code' => $this->code, 'password' => 'password', 'device_name' => 'P'])
            ->assertForbidden()
            ->assertJsonPath('code', 'account_restricted');

        expect($this->member->tokens()->count())->toBe(0);
    });

    it('validates the input', function (array $body, string $field) {
        $this->postJson('/api/v1/auth/email/verify', [...['email' => 'neu@example.de', 'code' => '123456', 'password' => 'password', 'device_name' => 'P'], ...$body])
            ->assertUnprocessable()
            ->assertJsonValidationErrors($field);
    })->with([
        'short code' => [['code' => '12345'], 'code'],
        'letters' => [['code' => 'abcdef'], 'code'],
        'bad address' => [['email' => 'x'], 'email'],
        'platform' => [['platform' => 'beos'], 'platform'],
        'no password' => [['password' => null], 'password'],
        'password as an array' => [['password' => ['x']], 'password'],
    ]);
});

describe('POST auth/email/resend', function () {
    it('answers the same for an open, a verified and an unknown address', function () {
        User::factory()->registered()->create(['email' => 'offen@example.de']);
        User::factory()->create(['email' => 'fertig@example.de']);

        $bodies = [];

        foreach (['offen', 'fertig', 'wer'] as $name) {
            $body = $this->postJson('/api/v1/auth/email/resend', ['email' => "$name@example.de"])->assertStatus(202)->json();
            $bodies[] = str_replace($name.'@', 'x@', (string) json_encode($body));
        }

        expect(array_unique($bodies))->toHaveCount(1);

        Mail::assertSent(VerificationCodeMail::class, 1);
        Mail::assertSent(VerificationCodeMail::class, fn ($mail) => $mail->hasTo('offen@example.de'));
    });

    it('holds the cooldown of 60 seconds, silently', function () {
        $member = User::factory()->registered()->create();

        $this->postJson('/api/v1/auth/email/resend', ['email' => $member->email])->assertStatus(202);
        $this->postJson('/api/v1/auth/email/resend', ['email' => $member->email])->assertStatus(202);
        Mail::assertSent(VerificationCodeMail::class, 1);

        $this->travel(61)->seconds();
        $this->postJson('/api/v1/auth/email/resend', ['email' => $member->email])->assertStatus(202);
        Mail::assertSent(VerificationCodeMail::class, 2);
    });

    it('sends at most five codes per hour', function () {
        $member = User::factory()->registered()->create();
        RateLimiter::clear('member_email');

        foreach (range(1, 7) as $round) {
            $this->withServerVariables(['REMOTE_ADDR' => "203.0.113.$round"])->postJson('/api/v1/auth/email/resend', ['email' => $member->email])->assertStatus(202);
            $this->travel(61)->seconds();
        }

        Mail::assertSent(VerificationCodeMail::class, 5);
    });

    it('sends to the code the mail states', function () {
        $member = User::factory()->registered()->create();

        $this->postJson('/api/v1/auth/email/resend', ['email' => $member->email])->assertStatus(202);

        $this->postJson('/api/v1/auth/email/verify', ['email' => $member->email, 'code' => codeFromMail(), 'password' => 'password', 'device_name' => 'P'])->assertOk();
    });

    it('is rate limited per IP', function () {
        foreach (range(1, 10) as $round) {
            $this->postJson('/api/v1/auth/email/resend', ['email' => 'wer@example.de'])->assertStatus(202);
        }

        $this->postJson('/api/v1/auth/email/resend', ['email' => 'wer@example.de'])->assertStatus(429);
    });
});

describe('POST auth/login', function () {
    beforeEach(function () {
        $this->member = User::factory()->create(['email' => 'lukas@example.de', 'password' => AUTH_PASSWORD]);
    });

    it('issues a token for this device, and a second login replaces it', function () {
        $first = signInOnDevice($this->member, 'Pixel 9', AUTH_PASSWORD);
        $second = signInOnDevice($this->member, 'Pixel 9', AUTH_PASSWORD);

        expect($second)->not->toBe($first)
            ->and($this->member->tokens()->count())->toBe(1);

        forgetAuth();
        $this->withToken($first)->getJson('/api/v1/auth/me')->assertUnauthorized();
        forgetAuth();
        $this->withToken($second)->getJson('/api/v1/auth/me')->assertOk();
    });

    it('keeps one token per device, not per account', function () {
        signInOnDevice($this->member, 'Pixel 9', AUTH_PASSWORD);
        signInOnDevice($this->member, 'iPhone', AUTH_PASSWORD);

        expect($this->member->tokens()->count())->toBe(2);
    });

    it('gives the same 401 for a wrong password and an unknown address, and checks a hash for both', function () {
        $hash = new class(app()) extends HashManager
        {
            public int $checks = 0;

            public function check(#[SensitiveParameter] $value, $hashedValue, array $options = []): bool
            {
                $this->checks++;

                return parent::check($value, $hashedValue, $options);
            }
        };
        Hash::swap($hash);

        $wrong = $this->postJson('/api/v1/auth/login', ['email' => 'lukas@example.de', 'password' => 'falsch-falsch', 'device_name' => 'P'])->assertUnauthorized();
        $unknown = $this->postJson('/api/v1/auth/login', ['email' => 'wer@example.de', 'password' => 'falsch-falsch', 'device_name' => 'P'])->assertUnauthorized();

        expect($wrong->json())->toBe($unknown->json())
            ->and($wrong->json('code'))->toBe('invalid_credentials')
            ->and($hash->checks)->toBe(2);
    });

    it('lets an unverified member in and says where to resume', function () {
        $member = User::factory()->registered()->create(['email' => 'neu@example.de', 'password' => AUTH_PASSWORD]);

        $this->postJson('/api/v1/auth/login', ['email' => 'neu@example.de', 'password' => AUTH_PASSWORD, 'device_name' => 'P'])
            ->assertOk()
            ->assertJsonPath('data.member.email_verified', false)
            ->assertJsonPath('data.member.has_username', false)
            ->assertJsonPath('data.member.next_step', 'verify_email');

        expect($member->tokens()->count())->toBe(1);
    });

    it('stops a suspended member only after the right password', function () {
        $until = now()->addWeek()->startOfSecond();
        $member = User::factory()->suspended($until)->create(['email' => 'gesperrt@example.de', 'password' => AUTH_PASSWORD]);

        $this->postJson('/api/v1/auth/login', ['email' => 'gesperrt@example.de', 'password' => 'falsch-falsch', 'device_name' => 'P'])->assertUnauthorized();

        $this->postJson('/api/v1/auth/login', ['email' => 'gesperrt@example.de', 'password' => AUTH_PASSWORD, 'device_name' => 'P'])
            ->assertForbidden()
            ->assertJsonPath('code', 'account_restricted')
            ->assertJsonPath('until', $until->toIso8601String());

        expect($member->tokens()->count())->toBe(0);
    });

    it('lets a member in whose suspension has passed', function () {
        User::factory()->suspended(now()->subDay())->create(['email' => 'zurueck@example.de', 'password' => AUTH_PASSWORD]);

        $this->postJson('/api/v1/auth/login', ['email' => 'zurueck@example.de', 'password' => AUTH_PASSWORD, 'device_name' => 'P'])->assertOk();
    });

    it('stops a member the team deactivated', function () {
        User::factory()->create(['email' => 'weg@example.de', 'password' => AUTH_PASSWORD, 'status' => 'deactivated']);

        $this->postJson('/api/v1/auth/login', ['email' => 'weg@example.de', 'password' => AUTH_PASSWORD, 'device_name' => 'P'])
            ->assertForbidden()
            ->assertJsonPath('code', 'account_restricted');
    });

    // M2.5 (m2.5-contract §3): in its 30 days a closed account answers like an unknown one, also to the right password.
    it('treats a member who asked for deletion as unknown', function () {
        User::factory()->deactivated()->create(['email' => 'weg@example.de', 'password' => AUTH_PASSWORD]);

        $this->postJson('/api/v1/auth/login', ['email' => 'weg@example.de', 'password' => AUTH_PASSWORD, 'device_name' => 'P'])
            ->assertUnauthorized()
            ->assertJsonPath('code', 'invalid_credentials');
    });

    it('treats a soft-deleted member as unknown', function () {
        User::factory()->create(['email' => 'geloescht@example.de', 'password' => AUTH_PASSWORD])->delete();

        $this->postJson('/api/v1/auth/login', ['email' => 'geloescht@example.de', 'password' => AUTH_PASSWORD, 'device_name' => 'P'])
            ->assertUnauthorized()
            ->assertJsonPath('code', 'invalid_credentials');
    });

    it('sends a flagged member to the reset instead of signing them in', function () {
        $this->member->forceFill(['force_password_change' => true])->save();

        $this->postJson('/api/v1/auth/login', ['email' => 'lukas@example.de', 'password' => AUTH_PASSWORD, 'device_name' => 'P'])
            ->assertForbidden()
            ->assertJsonPath('code', 'password_change_required')
            ->assertJsonPath('next', 'reset_password')
            ->assertJsonPath('email', 'lukas@example.de');

        expect($this->member->tokens()->count())->toBe(0);

        Mail::assertSent(PasswordResetCodeMail::class, 1);

        $this->postJson('/api/v1/auth/password/reset', ['email' => 'lukas@example.de', 'code' => codeFromMail(PasswordResetCodeMail::class), 'password' => 'Neues-Passwort-77'])->assertOk();

        expect($this->member->refresh()->force_password_change)->toBeFalse();

        signInOnDevice($this->member, 'P', 'Neues-Passwort-77');
    });

    it('delays after five failures per account, without a lockout', function () {
        foreach (range(1, 4) as $attempt) {
            $this->postJson('/api/v1/auth/login', ['email' => 'lukas@example.de', 'password' => 'falsch-falsch', 'device_name' => 'P'])->assertUnauthorized();
        }

        $this->postJson('/api/v1/auth/login', ['email' => 'lukas@example.de', 'password' => 'falsch-falsch', 'device_name' => 'P'])->assertUnauthorized();

        $this->postJson('/api/v1/auth/login', ['email' => 'lukas@example.de', 'password' => AUTH_PASSWORD, 'device_name' => 'P'])
            ->assertStatus(429)
            ->assertJsonPath('code', 'rate_limited')
            ->assertHeader('Retry-After');

        $this->travel(3)->seconds();

        signInOnDevice($this->member, 'P', AUTH_PASSWORD);
    });

    it('delays an unknown address the same way', function () {
        foreach (range(1, 5) as $attempt) {
            $this->postJson('/api/v1/auth/login', ['email' => 'wer@example.de', 'password' => 'falsch-falsch', 'device_name' => 'P'])->assertUnauthorized();
        }

        $this->postJson('/api/v1/auth/login', ['email' => 'wer@example.de', 'password' => 'falsch-falsch', 'device_name' => 'P'])->assertStatus(429);
    });

    it('allows ten attempts per minute per IP', function () {
        foreach (range(1, 10) as $round) {
            $this->postJson('/api/v1/auth/login', ['email' => "a$round@example.de", 'password' => 'falsch-falsch', 'device_name' => 'P'])->assertUnauthorized();
        }

        $this->postJson('/api/v1/auth/login', ['email' => 'b@example.de', 'password' => 'falsch-falsch', 'device_name' => 'P'])->assertStatus(429);
    });

    it('answers 419 without a device and without a session, before looking at the password', function () {
        $this->postJson('/api/v1/auth/login', ['email' => 'lukas@example.de', 'password' => 'falsch-falsch'])
            ->assertStatus(419)
            ->assertJsonPath('code', 'session_expired');

        foreach (range(1, 8) as $attempt) {
            $this->postJson('/api/v1/auth/login', ['email' => 'lukas@example.de', 'password' => 'falsch-falsch']);
        }

        signInOnDevice($this->member, 'P', AUTH_PASSWORD);
    });

    it('starts a session on the SPA and changes the session id', function () {
        $session = freshSpaSession();

        $response = spa($session)->postJson('/api/v1/auth/login', ['email' => 'lukas@example.de', 'password' => AUTH_PASSWORD])
            ->assertOk()
            ->assertJsonPath('data.token', null)
            ->assertJsonPath('data.member.email', 'lukas@example.de');

        $newSession = $response->getCookie(config()->string('session.cookie'))->getValue();

        expect($newSession)->not->toBe($session)
            ->and(DB::table('sessions')->where('id', $session)->exists())->toBeFalse()
            ->and(DB::table('sessions')->where('id', $newSession)->value('user_id'))->toBe($this->member->id);

        forgetAuth();
        spa($newSession)->getJson('/api/v1/auth/me')->assertOk();

        // Session fixation: the old id is worth nothing.
        forgetAuth();
        spa($session)->getJson('/api/v1/auth/me')->assertUnauthorized();
    });

    it('validates the input', function (array $body, string $field) {
        $this->postJson('/api/v1/auth/login', [...['email' => 'lukas@example.de', 'password' => 'x', 'device_name' => 'P'], ...$body])
            ->assertUnprocessable()
            ->assertJsonValidationErrors($field);
    })->with([
        'no address' => [['email' => null], 'email'],
        'no password' => [['password' => null], 'password'],
        'long device' => [['device_name' => str_repeat('x', 121)], 'device_name'],
        'platform' => [['platform' => 'beos'], 'platform'],
    ]);

    describe('new devices', function () {
        it('stays quiet on the first device, and warns on a new one with an audit event', function () {
            signInOnDevice($this->member, 'Pixel 9', AUTH_PASSWORD);
            Mail::assertNotSent(SecurityNoticeMail::class);

            signInOnDevice($this->member, 'iPhone 16', AUTH_PASSWORD);

            Mail::assertSent(SecurityNoticeMail::class, fn ($mail) => $mail->hasTo('lukas@example.de') && $mail->deviceName === 'iPhone 16');
            $this->assertDatabaseHas('audit_events', ['action' => MemberSecurityEvent::LoginNewDevice->value, 'actor_id' => $this->member->id]);
            expect(DB::table('audit_event_access')->count())->toBe(0);
        });

        it('sends nothing to an address nobody has proved, whatever the number of devices', function () {
            $unproven = User::factory()->unverified()->create(['email' => 'opfer@example.de', 'password' => AUTH_PASSWORD]);

            foreach (['A', 'B', 'C', 'D'] as $name) {
                signInOnDevice($unproven, $name, AUTH_PASSWORD);
            }

            Mail::assertNotSent(SecurityNoticeMail::class);
            $this->assertDatabaseMissing('audit_events', ['action' => MemberSecurityEvent::LoginNewDevice->value, 'actor_id' => $unproven->id]);
            expect($unproven->knownDevices()->count())->toBe(0);
        });

        it('takes the device that verifies as the first one, and warns from then on', function () {
            $this->postJson('/api/v1/auth/register', registration());
            $code = codeFromMail();
            $this->postJson('/api/v1/auth/email/verify', ['email' => 'neu@example.de', 'code' => $code, 'password' => AUTH_PASSWORD, 'device_name' => 'Pixel 9', 'platform' => 'android', 'app_version' => '0.1.0'])->assertOk();
            Mail::assertNotSent(SecurityNoticeMail::class);
            forgetAuth();
            $this->flushHeaders();

            signInOnDevice(User::query()->where('email', 'neu@example.de')->firstOrFail(), 'iPhone 16', AUTH_PASSWORD);

            Mail::assertSent(SecurityNoticeMail::class, 1);
        });

        it('caps the mails to the owner of a stolen password, and still audits every device', function () {
            config()->set('speedclub.known_devices.max_notices_per_hour', 2);

            foreach (['first', 'A', 'B', 'C', 'D'] as $name) {
                signInOnDevice($this->member, $name, AUTH_PASSWORD);
            }

            Mail::assertSent(SecurityNoticeMail::class, 2);
            expect(DB::table('audit_events')->where('action', MemberSecurityEvent::LoginNewDevice->value)->where('actor_id', $this->member->id)->count())->toBe(4);
        });

        it('does not warn again after a sign-out on the same device', function () {
            $token = signInOnDevice($this->member, 'Pixel 9', AUTH_PASSWORD);
            $this->withToken($token)->postJson('/api/v1/auth/logout')->assertNoContent();
            $this->flushHeaders();
            forgetAuth();

            signInOnDevice($this->member, 'Pixel 9', AUTH_PASSWORD);

            Mail::assertNotSent(SecurityNoticeMail::class);
        });

        // SEC-M47-02: a browser is its random id in a first-party cookie, not its user agent.
        it('recognises a browser after an update by its browser cookie, and treats the same user agent without it as new', function () {
            $this->member->knownDevices()->create(['fingerprint' => str_repeat('a', 64), 'last_seen_at' => now()]);
            $name = config()->string('speedclub.known_devices.browser_cookie');

            $session = freshSpaSession();
            $response = spa($session)->withHeader('User-Agent', 'Mozilla/5.0 Firefox/140.0')->postJson('/api/v1/auth/login', ['email' => 'lukas@example.de', 'password' => AUTH_PASSWORD])->assertOk();
            Mail::assertSent(SecurityNoticeMail::class, 1);
            $browserId = $response->getCookie($name)?->getValue();
            expect($browserId)->toBeString();
            forgetAuth();

            $session = freshSpaSession();
            spa($session)->withCookie($name, (string) $browserId)->withHeader('User-Agent', 'Mozilla/5.0 Firefox/141.0')->postJson('/api/v1/auth/login', ['email' => 'lukas@example.de', 'password' => AUTH_PASSWORD])->assertOk();
            Mail::assertSent(SecurityNoticeMail::class, 1);
            forgetAuth();
            // Another browser with the same user agent: no browser cookie.
            $this->defaultCookies = [];

            $session = freshSpaSession();
            spa($session)->withHeader('User-Agent', 'Mozilla/5.0 Firefox/141.0')->postJson('/api/v1/auth/login', ['email' => 'lukas@example.de', 'password' => AUTH_PASSWORD])->assertOk();
            Mail::assertSent(SecurityNoticeMail::class, 2);
        });

        it('stores only a checksum', function () {
            signInOnDevice($this->member, 'Pixel 9', AUTH_PASSWORD);

            expect(strlen((string) KnownDevice::query()->sole()->fingerprint))->toBe(64);
        });
    });
});

describe('POST auth/logout', function () {
    it('revokes only this token', function () {
        $member = User::factory()->create();
        $this_device = signInOnDevice($member, 'A');
        $other_device = signInOnDevice($member, 'B');

        $this->withToken($this_device)->postJson('/api/v1/auth/logout')->assertNoContent();

        forgetAuth();
        $this->withToken($this_device)->getJson('/api/v1/auth/me')->assertUnauthorized();
        forgetAuth();
        $this->withToken($other_device)->getJson('/api/v1/auth/me')->assertOk();
    });

    it('invalidates the session on the SPA', function () {
        $member = User::factory()->create();
        $session = freshSpaSession();
        $signedIn = spa($session)->postJson('/api/v1/auth/login', ['email' => $member->email, 'password' => 'password'])->assertOk()
            ->getCookie(config()->string('session.cookie'))->getValue();

        forgetAuth();
        spa($signedIn)->postJson('/api/v1/auth/logout')->assertNoContent();

        forgetAuth();
        spa($signedIn)->getJson('/api/v1/auth/me')->assertUnauthorized();
    });

    it('needs a sign-in', function () {
        $this->postJson('/api/v1/auth/logout')->assertUnauthorized()->assertJsonPath('code', 'unauthenticated');
    });
});

describe('POST auth/token/rotate', function () {
    it('refuses a token younger than seven days', function () {
        $token = signInOnDevice(User::factory()->create());

        $this->withToken($token)->postJson('/api/v1/auth/token/rotate')
            ->assertStatus(409)
            ->assertJsonPath('code', 'token_rotation_not_due')
            ->assertJsonStructure(['retry_at']);
    });

    it('replaces an older token, keeps the device data and ends the old one after its grace', function () {
        $member = User::factory()->create();
        $old = signInOnDevice($member, 'Pixel 9');

        $this->travel(8)->days();

        $new = $this->withToken($old)->postJson('/api/v1/auth/token/rotate')
            ->assertOk()
            ->assertJsonPath('data.member.id', $member->id)
            ->json('data.token');

        expect($new)->toBeString()->not->toBe($old);

        $token = $member->tokens()->latest('id')->firstOrFail();

        expect($token->device_name)->toBe('Pixel 9')
            ->and($token->platform->value)->toBe('android')
            ->and($token->app_version)->toBe('0.1.0')
            ->and((int) round(now()->diffInDays($token->expires_at)))->toBe(90);

        forgetAuth();
        $this->withToken($old)->getJson('/api/v1/auth/me')->assertOk();
        $this->travel(121)->seconds();
        forgetAuth();
        $this->withToken($old)->getJson('/api/v1/auth/me')->assertUnauthorized();
        forgetAuth();
        $this->withToken($new)->getJson('/api/v1/auth/me')->assertOk();
    });

    it('refuses a cookie session', function () {
        $session = databaseSessionFor(User::factory()->create(), 'web');

        spa($session)->postJson('/api/v1/auth/token/rotate')->assertStatus(409)->assertJsonPath('code', 'conflict');
    });

    it('stops working after 90 days', function () {
        $token = signInOnDevice(User::factory()->create());

        $this->travel(91)->days();

        $this->withToken($token)->getJson('/api/v1/auth/me')->assertUnauthorized();
    });

    it('needs a sign-in', function () {
        $this->postJson('/api/v1/auth/token/rotate')->assertUnauthorized();
    });

    it('issues nothing to a member who may not enter', function (Closure $state, string $code) {
        $member = User::factory()->create();
        $old = signInOnDevice($member);
        $id = $member->tokens()->sole()->id;

        $this->travel(8)->days();
        $member->forceFill($state())->save();

        forgetAuth();
        $this->withToken($old)->postJson('/api/v1/auth/token/rotate')
            ->assertForbidden()
            ->assertJsonPath('code', $code)
            ->assertJsonMissingPath('data.token');

        expect($member->tokens()->sole()->id)->toBe($id);
    })->with([
        'suspended without an end' => [fn () => ['status' => 'suspended', 'restrictions' => ['suspension' => ['until' => null]]], 'account_restricted'],
        'suspended until a date' => [fn () => ['status' => 'suspended', 'restrictions' => ['suspension' => ['until' => now()->addDay()->format(DATE_ATOM)]]], 'account_restricted'],
        'deactivated' => [fn () => ['status' => 'deactivated', 'deletion_requested_at' => now()], 'account_restricted'],
        'must change the password' => [fn () => ['force_password_change' => true], 'password_change_required'],
    ]);

    it('rotates again once a suspension has run out', function () {
        $member = User::factory()->create();
        $old = signInOnDevice($member);

        $this->travel(8)->days();
        $member->forceFill(['status' => 'suspended', 'restrictions' => ['suspension' => ['until' => now()->subMinute()->format(DATE_ATOM)]]])->save();

        forgetAuth();
        $this->withToken($old)->postJson('/api/v1/auth/token/rotate')->assertOk();
    });

    it('answers a suspended cookie session as restricted, not as a conflict', function () {
        $session = databaseSessionFor(User::factory()->suspended()->create(), 'web');

        spa($session)->postJson('/api/v1/auth/token/rotate')->assertForbidden()->assertJsonPath('code', 'account_restricted');
    });
});

describe('GET auth/me', function () {
    it('returns the exact shape', function () {
        $member = User::factory()->create(['username' => 'lukas.sc', 'display_name' => 'Lukas', 'city' => 'Stuttgart', 'bio' => 'R34']);

        $this->withToken(signInOnDevice($member))->getJson('/api/v1/auth/me')
            ->assertOk()
            ->assertExactJsonStructure(['data' => [
                'id', 'email', 'email_verified', 'has_username', 'profile_complete', 'next_step', 'force_password_change',
                'username', 'username_change_available_at', 'display_name', 'city', 'bio', 'avatar', 'cover', 'locale', 'theme',
                'power_display', 'member_since',
                'stats' => ['vehicles', 'followers', 'following'],
                'is_sample', 'is_editorial',
                'two_factor_enabled',
                // M4.6: false for a passwordless account.
                'password_set',
                'restrictions' => [
                    'suspended',
                    'messaging' => ['restricted', 'until', 'decision_id'],
                    'publishing' => ['restricted', 'until', 'decision_id'],
                ],
            ]])
            ->assertJsonPath('data.username', 'lukas.sc')
            ->assertJsonPath('data.next_step', null)
            ->assertJsonPath('data.stats', ['vehicles' => 0, 'followers' => 0, 'following' => 0])
            ->assertJsonPath('data.member_since', $member->created_at->toIso8601String());
    });

    it('never holds a secret', function () {
        $member = User::factory()->create();
        $body = $this->withToken(signInOnDevice($member))->getJson('/api/v1/auth/me')->assertOk()->getContent();

        // two_factor_enabled (M2.5) is a flag; the key and the codes never leave the server.
        expect($body)->not->toContain('password"')->not->toContain('two_factor_secret')->not->toContain('two_factor_recovery')->not->toContain('recovery_codes')->not->toContain('remember_token');
    });

    it('derives the onboarding step', function (Closure $state, ?string $step) {
        $member = User::factory()->create($state());

        $this->withToken(signInOnDevice($member))->getJson('/api/v1/auth/me')->assertJsonPath('data.next_step', $step);
    })->with([
        'unverified' => [fn () => ['email_verified_at' => null, 'username' => null, 'display_name' => null], 'verify_email'],
        'no username' => [fn () => ['username' => null, 'display_name' => null], 'choose_username'],
        'no profile' => [fn () => ['display_name' => null], 'profile_setup'],
        'done' => [fn () => [], null],
    ]);

    it('summarises the restrictions', function () {
        $until = now()->addDays(3)->startOfSecond();
        $member = User::factory()->restrictedFrom(RestrictionType::Messaging, $until)->create();

        $this->withToken(signInOnDevice($member))->getJson('/api/v1/auth/me')
            ->assertOk()
            ->assertJsonPath('data.restrictions.suspended', false)
            ->assertJsonPath('data.restrictions.messaging', ['restricted' => true, 'until' => $until->toIso8601String(), 'decision_id' => null])
            ->assertJsonPath('data.restrictions.publishing', ['restricted' => false, 'until' => null, 'decision_id' => null]);
    });

    it('still answers a suspended member with a live token', function () {
        $member = User::factory()->create();
        $token = signInOnDevice($member);
        $member->forceFill(['status' => 'suspended', 'restrictions' => ['suspension' => ['until' => null]]])->save();

        forgetAuth();
        $this->withToken($token)->getJson('/api/v1/auth/me')
            ->assertOk()
            ->assertJsonPath('data.restrictions.suspended', true)
            ->assertJsonPath('data.restrictions.publishing.restricted', true);
    });

    it('refuses a deactivated member with a live token', function () {
        $member = User::factory()->create();
        $token = signInOnDevice($member);
        $member->forceFill(['status' => 'deactivated'])->save();

        forgetAuth();
        $this->withToken($token)->getJson('/api/v1/auth/me')->assertForbidden();
    });

    it('does not authenticate a guest or a staff session', function () {
        $this->getJson('/api/v1/auth/me')->assertUnauthorized()->assertJsonPath('code', 'unauthenticated');

        $session = databaseSessionFor(Staff::factory()->create(), 'staff');

        spa($session)->getJson('/api/v1/auth/me')->assertUnauthorized();
    });

    it('sees a member token as the member ability', function () {
        $member = User::factory()->create();
        signInOnDevice($member);

        expect(PersonalAccessToken::query()->sole()->can('member'))->toBeTrue();
    });
});

describe('password reset', function () {
    beforeEach(function () {
        $this->member = User::factory()->create(['email' => 'lukas@example.de', 'password' => AUTH_PASSWORD, 'username' => 'lukas.sc']);
    });

    it('answers the same for a known and an unknown address, and sends a code with the fallback link', function () {
        $known = $this->postJson('/api/v1/auth/password/forgot', ['email' => 'lukas@example.de'])->assertStatus(202);
        $unknown = $this->postJson('/api/v1/auth/password/forgot', ['email' => 'wer@example.de'])->assertStatus(202);

        expect(json_encode($known->json()))->toBe(str_replace('wer@', 'lukas@', (string) json_encode($unknown->json())))
            ->and($known->json('data.next'))->toBe('reset_password');

        Mail::assertSent(PasswordResetCodeMail::class, 1);
        Mail::assertSent(PasswordResetCodeMail::class, fn ($mail) => $mail->hasTo('lukas@example.de') && preg_match('/\A\d{6}\z/', $mail->code) === 1);
    });

    it('does not answer differently or send anything for a deleted account', function () {
        $this->member->delete();

        $this->postJson('/api/v1/auth/password/forgot', ['email' => 'lukas@example.de'])->assertStatus(202);

        Mail::assertNothingSent();
    });

    it('holds the cooldown on forgot', function () {
        $this->postJson('/api/v1/auth/password/forgot', ['email' => 'lukas@example.de'])->assertStatus(202);
        $this->postJson('/api/v1/auth/password/forgot', ['email' => 'lukas@example.de'])->assertStatus(202);

        Mail::assertSent(PasswordResetCodeMail::class, 1);
    });

    it('replaces the password, ends every sign-in, warns by mail and records it', function () {
        $phone = signInOnDevice($this->member, 'Phone', AUTH_PASSWORD);
        $tablet = signInOnDevice($this->member, 'Tablet', AUTH_PASSWORD);
        $browser = databaseSessionFor($this->member, 'web');
        DB::table('sessions')->where('id', $browser)->update(['user_id' => $this->member->id]);
        Mail::fake();

        $this->postJson('/api/v1/auth/password/forgot', ['email' => 'lukas@example.de'])->assertStatus(202);

        $this->postJson('/api/v1/auth/password/reset', ['email' => 'lukas@example.de', 'code' => codeFromMail(PasswordResetCodeMail::class), 'password' => 'Neues-Passwort-77'])
            ->assertOk()
            ->assertExactJson(['data' => ['next' => 'sign_in', 'email' => 'lukas@example.de', 'resend_after_seconds' => null]]);

        expect(Hash::check('Neues-Passwort-77', $this->member->refresh()->password))->toBeTrue()
            ->and($this->member->tokens()->count())->toBe(0)
            ->and(DB::table('sessions')->where('id', $browser)->exists())->toBeFalse();

        forgetAuth();
        $this->withToken($phone)->getJson('/api/v1/auth/me')->assertUnauthorized();
        forgetAuth();
        $this->withToken($tablet)->getJson('/api/v1/auth/me')->assertUnauthorized();

        Mail::assertSent(SecurityNoticeMail::class, fn ($mail) => $mail->hasTo('lukas@example.de'));
        $this->assertDatabaseHas('audit_events', ['action' => MemberSecurityEvent::PasswordReset->value, 'actor_id' => $this->member->id]);
        $this->assertDatabaseHas('audit_events', ['action' => MemberSecurityEvent::LogoutAll->value, 'actor_id' => $this->member->id]);
    });

    it('ends a session on another driver through the password hash', function () {
        $session = freshSpaSession();
        $signedIn = spa($session)->postJson('/api/v1/auth/login', ['email' => 'lukas@example.de', 'password' => AUTH_PASSWORD])->assertOk()
            ->getCookie(config()->string('session.cookie'))->getValue();

        forgetAuth();
        spa($signedIn)->getJson('/api/v1/auth/me')->assertOk();

        // The row stays, as with a file session store, but the password in it no longer matches.
        $this->member->forceFill(['password' => 'Neues-Passwort-77'])->save();

        forgetAuth();
        spa($signedIn)->getJson('/api/v1/auth/me')->assertUnauthorized();
    });

    it('counts as proof of the address for an unverified member', function () {
        $member = User::factory()->registered()->create(['email' => 'neu@example.de']);
        $code = issueCode($member, VerificationPurpose::PasswordReset);

        $this->postJson('/api/v1/auth/password/reset', ['email' => 'neu@example.de', 'code' => $code, 'password' => 'Neues-Passwort-77'])->assertOk();

        expect($member->refresh()->email_verified_at)->not->toBeNull();
    });

    it('answers the same for wrong, unknown, expired and used', function () {
        $code = issueCode($this->member, VerificationPurpose::PasswordReset);
        $body = fn (string $email, string $value) => ['email' => $email, 'code' => $value, 'password' => 'Neues-Passwort-77'];

        $responses = [
            $this->postJson('/api/v1/auth/password/reset', $body('lukas@example.de', otherCode($code))),
            $this->postJson('/api/v1/auth/password/reset', $body('wer@example.de', '123456')),
        ];

        $this->postJson('/api/v1/auth/password/reset', $body('lukas@example.de', $code))->assertOk();
        $responses[] = $this->postJson('/api/v1/auth/password/reset', $body('lukas@example.de', $code));

        $this->travel(61)->seconds();
        $expiring = issueCode($this->member, VerificationPurpose::PasswordReset);
        $this->travel(11)->minutes();
        $responses[] = $this->postJson('/api/v1/auth/password/reset', $body('lukas@example.de', $expiring));

        foreach ($responses as $response) {
            $response->assertUnprocessable()->assertJsonPath('code', 'invalid_code');
            expect($response->json())->toBe($responses[0]->json());
        }
    });

    it('gives each code five attempts', function () {
        $code = issueCode($this->member, VerificationPurpose::PasswordReset);

        foreach (range(1, 5) as $attempt) {
            $this->postJson('/api/v1/auth/password/reset', ['email' => 'lukas@example.de', 'code' => otherCode($code), 'password' => 'Neues-Passwort-77'])->assertUnprocessable();
        }

        $this->postJson('/api/v1/auth/password/reset', ['email' => 'lukas@example.de', 'code' => $code, 'password' => 'Neues-Passwort-77'])->assertUnprocessable();

        expect(Hash::check(AUTH_PASSWORD, $this->member->refresh()->password))->toBeTrue();
    });

    it('applies the password rules', function (string $password) {
        $code = issueCode($this->member, VerificationPurpose::PasswordReset);

        $this->postJson('/api/v1/auth/password/reset', ['email' => 'lukas@example.de', 'code' => $code, 'password' => $password])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('password');
    })->with(['kurz', 'qwertyuiop', 'lukas@example.de']);

    it('refuses the username as a password, only after the right code and without spending it', function () {
        $this->member->forceFill(['username' => 'lukas.sc.1234'])->save();
        $code = issueCode($this->member, VerificationPurpose::PasswordReset);

        $this->postJson('/api/v1/auth/password/reset', ['email' => 'lukas@example.de', 'code' => otherCode($code), 'password' => 'lukas.sc.1234'])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'invalid_code');

        $this->postJson('/api/v1/auth/password/reset', ['email' => 'lukas@example.de', 'code' => $code, 'password' => 'lukas.sc.1234'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('password');

        $this->postJson('/api/v1/auth/password/reset', ['email' => 'lukas@example.de', 'code' => $code, 'password' => 'Neues-Passwort-77'])->assertOk();
    });

    it('rate limits forgot per IP', function () {
        foreach (range(1, 10) as $round) {
            $this->postJson('/api/v1/auth/password/forgot', ['email' => 'wer@example.de'])->assertStatus(202);
        }

        $this->postJson('/api/v1/auth/password/forgot', ['email' => 'wer@example.de'])->assertStatus(429);
    });

    it('rate limits reset per IP', function () {
        foreach (range(1, 30) as $round) {
            $this->postJson('/api/v1/auth/password/reset', ['email' => 'wer@example.de', 'code' => '123456', 'password' => 'Neues-Passwort-77'])->assertUnprocessable();
        }

        $this->postJson('/api/v1/auth/password/reset', ['email' => 'wer@example.de', 'code' => '123456', 'password' => 'Neues-Passwort-77'])->assertStatus(429);
    });
});

describe('EnsureVerified', function () {
    beforeEach(function () {
        Route::middleware(['api', 'auth:sanctum', 'verified-member'])->post('api/v1/test-publish', fn () => response()->noContent());
    });

    it('sends an unverified member back with a clear code', function () {
        $token = signInOnDevice(User::factory()->unverified()->create());

        $this->withToken($token)->postJson('/api/v1/test-publish')->assertForbidden()->assertJsonPath('code', 'email_not_verified');
    });

    it('lets a verified member pass', function () {
        $token = signInOnDevice(User::factory()->create());

        $this->withToken($token)->postJson('/api/v1/test-publish')->assertNoContent();
    });

    it('leaves guests to the auth middleware', function () {
        $this->postJson('/api/v1/test-publish')->assertUnauthorized();
    });
});

it('has a limiter of its own for every auth route', function (string $limiter, int $max, int $seconds) {
    $limit = RateLimiter::limiter($limiter)(Request::create('/'));

    expect($limit->maxAttempts)->toBe($max)->and($limit->decaySeconds)->toBe($seconds);
})->with([
    ['member-verify', 30, 60],
    ['member-email', 10, 600],
    ['username-check', 60, 60],
]);
