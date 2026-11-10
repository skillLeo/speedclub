<?php

use App\Enums\MemberSecurityEvent;
use App\Enums\VerificationPurpose;
use App\Mail\AccountExistsMail;
use App\Mail\PasswordResetCodeMail;
use App\Mail\VerificationCodeMail;
use App\Models\Staff;
use App\Models\User;
use App\Models\VerificationCode;
use App\Services\Auth\VerificationCodes;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Http\UploadedFile;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\PersonalAccessToken;
use Laravel\Sanctum\Sanctum;
use Tests\Support\TestImages;

/**
 * Controls of the M1.5 security review (docs/07_QA_AND_RELEASE.md §6) that MemberAuthSecurityTest.php and the endpoint tests
 * did not prove yet.
 */
class CsrfEnforcedForControls extends ValidateCsrfToken
{
    protected function runningUnitTests(): bool
    {
        return false;
    }
}

const CTL_PASSWORD = 'Lackierung-92-rot';

const CTL_ORIGIN = 'http://localhost:8080';

function ctlForgetAuth(): void
{
    app('auth')->forgetGuards();
    app()->forgetInstance('auth.driver');
    app('session')->forgetDrivers();
    app()->forgetInstance('session.store');
}

/**
 * @return array{session: string, xsrf: string}
 */
function ctlOpenSpaSession(): array
{
    config(['session.driver' => 'database', 'sanctum.middleware.validate_csrf_token' => CsrfEnforcedForControls::class]);
    app()->forgetInstance('session.store');

    $response = test()->withHeaders(['Origin' => CTL_ORIGIN])->get('/sanctum/csrf-cookie')->assertNoContent();

    return [
        'session' => $response->getCookie(config()->string('session.cookie'))->getValue(),
        'xsrf' => $response->getCookie('XSRF-TOKEN', decrypt: false)->getValue(),
    ];
}

function ctlSpa(string $session, ?string $xsrf = null, string $origin = CTL_ORIGIN): mixed
{
    ctlForgetAuth();

    return test()->flushHeaders()
        ->withCredentials()
        ->withCookie(config()->string('session.cookie'), $session)
        ->withHeaders(['Origin' => $origin, 'Accept' => 'application/json', ...($xsrf === null ? [] : ['X-XSRF-TOKEN' => $xsrf])]);
}

function ctlOtherCode(string $code): string
{
    return $code === '000000' ? '000001' : '000000';
}

describe('guess budget per account', function () {
    beforeEach(function () {
        Mail::fake();
    });

    it('holds verification guesses to 25 an hour through resend, and the budget is per purpose', function () {
        $member = User::factory()->registered()->create(['email' => 'neu@example.de', 'password' => CTL_PASSWORD]);
        $counted = fn (VerificationPurpose $purpose) => (int) VerificationCode::query()->where('user_id', $member->id)->where('purpose', $purpose)->sum('attempts');

        foreach (range(1, 7) as $round) {
            Mail::fake();
            $this->postJson('/api/v1/auth/email/resend', ['email' => 'neu@example.de'])->assertStatus(202);
            $mail = Mail::sent(VerificationCodeMail::class)->last();
            $wrong = $mail === null ? '123456' : ctlOtherCode($mail->code);

            if ($round > 5) {
                expect($mail)->toBeNull();
            }

            foreach (range(1, 6) as $guess) {
                $this->postJson('/api/v1/auth/email/verify', ['email' => 'neu@example.de', 'code' => $wrong, 'password' => CTL_PASSWORD, 'device_name' => 'P'])->assertUnprocessable();
            }

            $this->travel(61)->seconds();
        }

        expect($counted(VerificationPurpose::EmailVerification))->toBe(25)
            ->and(VerificationCode::query()->where('user_id', $member->id)->count())->toBe(5);

        // The other purpose has a budget of its own, and only that one can replace a password.
        Mail::fake();
        $this->postJson('/api/v1/auth/password/forgot', ['email' => 'neu@example.de'])->assertStatus(202);
        Mail::assertSent(PasswordResetCodeMail::class);
    });

    it('counts the codes of the forced reset at login against the same hourly limit', function () {
        $member = User::factory()->create(['email' => 'pflicht@example.de', 'password' => CTL_PASSWORD, 'force_password_change' => true]);

        foreach (range(1, 8) as $round) {
            $this->postJson('/api/v1/auth/login', ['email' => 'pflicht@example.de', 'password' => CTL_PASSWORD, 'device_name' => 'P'])
                ->assertForbidden()
                ->assertJsonPath('code', 'password_change_required');
            $this->travel(61)->seconds();
        }

        expect(VerificationCode::query()->where('user_id', $member->id)->count())->toBe(5);
        Mail::assertSent(PasswordResetCodeMail::class, 5);
    });

    it('spends nothing on a code in the wrong format, in any digit script', function (string $code) {
        $member = User::factory()->registered()->create(['email' => 'neu@example.de', 'password' => CTL_PASSWORD]);
        app(VerificationCodes::class)->issue($member, VerificationPurpose::EmailVerification);

        $this->postJson('/api/v1/auth/email/verify', ['email' => 'neu@example.de', 'code' => $code, 'password' => CTL_PASSWORD, 'device_name' => 'P'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('code');

        expect(VerificationCode::query()->where('user_id', $member->id)->sole()->attempts)->toBe(0);
    })->with([
        'five digits' => ['12345'],
        'seven digits' => ['1234567'],
        'arabic-indic' => ['١٢٣٤٥٦'],
        'fullwidth' => ['１２３４５６'],
        'exponent' => ['1e5000'],
    ]);

    it('takes no code from a deactivated member, even one issued before', function () {
        $member = User::factory()->create(['email' => 'da@example.de', 'password' => CTL_PASSWORD]);
        $code = app(VerificationCodes::class)->issue($member, VerificationPurpose::PasswordReset);
        $member->forceFill(['status' => 'deactivated'])->save();

        $this->postJson('/api/v1/auth/password/reset', ['email' => 'da@example.de', 'code' => $code, 'password' => 'Neues-Passwort-77'])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'invalid_code');

        expect(Hash::check(CTL_PASSWORD, $member->refresh()->password))->toBeTrue();
    });
});

describe('neutral answers', function () {
    beforeEach(function () {
        Mail::fake();
    });

    it('answers the login delay the same for a known and an unknown address', function () {
        User::factory()->create(['email' => 'da@example.de']);

        $delayed = function (string $email) {
            foreach (range(1, 5) as $round) {
                $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.'.$round])
                    ->postJson('/api/v1/auth/login', ['email' => $email, 'password' => 'falsch-falsch', 'device_name' => 'P'])
                    ->assertUnauthorized();
            }

            return $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.50'])
                ->postJson('/api/v1/auth/login', ['email' => $email, 'password' => 'falsch-falsch', 'device_name' => 'P'])
                ->assertStatus(429);
        };

        $known = $delayed('da@example.de');
        $this->freezeTime();
        $unknown = $delayed('wer@example.de');

        expect($known->json())->toBe($unknown->json())
            ->and($known->headers->has('Retry-After'))->toBeTrue()
            ->and($unknown->headers->has('Retry-After'))->toBeTrue();
    });

    it('treats the address of a soft-deleted account as taken on register, with the same answer', function () {
        User::factory()->create(['email' => 'weg@example.de'])->delete();
        $body = fn (string $email) => ['email' => $email, 'password' => CTL_PASSWORD, 'accepted_age_16' => true, 'accepted_terms' => true, 'accepted_privacy' => true];

        $gone = $this->postJson('/api/v1/auth/register', $body('weg@example.de'))->assertStatus(202)->json('data');
        $free = $this->postJson('/api/v1/auth/register', $body('frei@example.de'))->assertStatus(202)->json('data');

        expect(array_keys($gone))->toBe(array_keys($free))
            ->and(User::withTrashed()->where('email', 'weg@example.de')->count())->toBe(1);
    });
});

describe('CSRF and sessions', function () {
    beforeEach(function () {
        Mail::fake();
    });

    it('asks every anonymous POST for the XSRF token once a session cookie is present', function (string $path, array $body) {
        $spa = ctlOpenSpaSession();
        $member = User::factory()->registered()->create(['email' => 'neu@example.de', 'password' => CTL_PASSWORD]);
        app(VerificationCodes::class)->issue($member, VerificationPurpose::PasswordReset);

        ctlSpa($spa['session'])->postJson($path, ['email' => 'neu@example.de', 'code' => '123456', ...$body])->assertStatus(419);

        expect(VerificationCode::query()->where('user_id', $member->id)->sole()->attempts)->toBe(0);
    })->with([
        'register' => ['/api/v1/auth/register', ['password' => CTL_PASSWORD, 'accepted_age_16' => true, 'accepted_terms' => true, 'accepted_privacy' => true]],
        'resend' => ['/api/v1/auth/email/resend', []],
        'forgot' => ['/api/v1/auth/password/forgot', []],
        'reset' => ['/api/v1/auth/password/reset', ['password' => 'Neues-Passwort-77']],
    ]);

    it('retires the session id and the XSRF token of before the login', function () {
        User::factory()->create(['email' => 'max@example.de', 'password' => CTL_PASSWORD]);
        $spa = ctlOpenSpaSession();

        $login = ctlSpa($spa['session'], $spa['xsrf'])->postJson('/api/v1/auth/login', ['email' => 'max@example.de', 'password' => CTL_PASSWORD])->assertOk();
        $signedIn = $login->getCookie(config()->string('session.cookie'))->getValue();

        expect($signedIn)->not->toBe($spa['session']);

        // The session id an attacker could have planted leads nowhere, and the old token no longer passes.
        ctlSpa($spa['session'])->getJson('/api/v1/auth/me')->assertUnauthorized();
        ctlSpa($signedIn, $spa['xsrf'])->patchJson('/api/v1/me/profile', ['display_name' => 'Nope'])->assertStatus(419);
    });

    it('does not treat a signed-in cookie from a foreign origin as signed in, and gives that origin no CORS answer', function () {
        $member = User::factory()->create(['email' => 'max@example.de', 'password' => CTL_PASSWORD]);
        $spa = ctlOpenSpaSession();
        $signedIn = ctlSpa($spa['session'], $spa['xsrf'])->postJson('/api/v1/auth/login', ['email' => 'max@example.de', 'password' => CTL_PASSWORD])->assertOk()
            ->getCookie(config()->string('session.cookie'))->getValue();

        $foreign = ctlSpa($signedIn, null, 'https://boese.example')->getJson('/api/v1/auth/me')->assertUnauthorized();
        expect($foreign->headers->get('Access-Control-Allow-Origin'))->toBeNull();

        ctlSpa($signedIn, null, 'https://boese.example')->patchJson('/api/v1/me/profile', ['display_name' => 'Nope'])->assertUnauthorized();
        expect($member->refresh()->getAttribute('display_name'))->not->toBe('Nope');

        $own = ctlSpa($signedIn)->getJson('/api/v1/auth/me')->assertOk();
        expect($own->headers->get('Access-Control-Allow-Origin'))->toBe(CTL_ORIGIN);
    });
});

describe('optional auth on anonymous routes', function () {
    beforeEach(function () {
        Mail::fake();
    });

    it('does not count an expired token as signed in on verify', function () {
        $member = User::factory()->registered()->create(['email' => 'neu@example.de', 'password' => CTL_PASSWORD]);
        $code = app(VerificationCodes::class)->issue($member, VerificationPurpose::EmailVerification);
        $expired = $member->createToken('Phone', ['member'], now()->subSecond())->plainTextToken;

        $this->withToken($expired)->postJson('/api/v1/auth/email/verify', ['email' => 'neu@example.de', 'code' => $code, 'device_name' => 'P'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('password');

        expect($member->refresh()->hasVerifiedEmail())->toBeFalse();
    });

    it('does not count a staff session as signed in on verify, even for the same address', function () {
        $member = User::factory()->registered()->create(['email' => 'beide@example.de', 'password' => CTL_PASSWORD]);
        $code = app(VerificationCodes::class)->issue($member, VerificationPurpose::EmailVerification);
        $session = databaseSessionFor(Staff::factory()->create(['email' => 'beide@example.de']), 'staff');

        $this->withCredentials()->withCookie(config()->string('session.cookie'), $session)
            ->withHeaders(['Origin' => CTL_ORIGIN, 'Accept' => 'application/json'])
            ->postJson('/api/v1/auth/email/verify', ['email' => 'beide@example.de', 'code' => $code, 'device_name' => 'P'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('password');

        expect($member->refresh()->hasVerifiedEmail())->toBeFalse();
    });
});

describe('fields a client cannot set', function () {
    it('ignores them on the username and the image routes', function () {
        Storage::fake('public');
        Storage::fake('local');
        $member = User::factory()->registered()->create(['username' => null, 'email' => 'bleibt@example.de']);
        Sanctum::actingAs($member);
        $forbidden = ['status' => 'suspended', 'email' => 'x@example.de', 'email_verified_at' => '2020-01-01 00:00:00', 'restrictions' => 'x', 'password' => 'Neues-Passwort-77', 'previous_username' => 'alt', 'force_password_change' => '1'];

        $this->putJson('/api/v1/me/username', ['username' => 'frei.name', ...$forbidden, 'username_changed_at' => '2020-01-01 00:00:00'])->assertOk();
        $this->post('/api/v1/me/avatar', ['file' => UploadedFile::fake()->createWithContent('a.jpg', TestImages::jpeg(400, 300)), ...$forbidden], ['Accept' => 'application/json'])->assertOk();

        $member->refresh();

        expect($member->status->value)->toBe('active')
            ->and($member->email)->toBe('bleibt@example.de')
            ->and($member->email_verified_at)->toBeNull()
            ->and($member->restrictions)->toBeNull()
            ->and($member->force_password_change)->toBeFalse()
            ->and(Hash::check('Neues-Passwort-77', $member->password))->toBeFalse()
            ->and($member->getAttribute('previous_username'))->toBeNull()
            ->and($member->getAttribute('username_changed_at'))->toBeNull();
    });

    it('never replays one member\'s stored answer to another with the same Idempotency-Key', function () {
        Storage::fake('public');
        Storage::fake('local');
        $bytes = TestImages::jpeg(400, 300);
        $first = User::factory()->create();
        $second = User::factory()->create();

        $upload = function (User $member) use ($bytes) {
            Sanctum::actingAs($member);

            return $this->post('/api/v1/me/avatar', ['file' => UploadedFile::fake()->createWithContent('a.jpg', $bytes)], ['Accept' => 'application/json', 'Idempotency-Key' => 'derselbe-schluessel'])->assertOk();
        };

        $upload($first)->assertJsonPath('data.id', $first->id);

        $answer = $upload($second)->assertJsonPath('data.id', $second->id);

        expect($answer->headers->get('Idempotency-Replayed'))->toBeNull()
            ->and((string) $answer->getContent())->not->toContain($first->email);
    });
});

describe('reserved usernames', function () {
    it('refuses every name of the product spec, in any case, on both routes', function () {
        $spec = ['admin', 'support', 'speedclub', 'api', 'app', 'c', 'v', 'u', 'legal', 'impressum', 'datenschutz', 'agb', 'help', 'hilfe', 'settings', 'login', 'register', 'staff', 'root', 'system', 'null', 'undefined', 'official'];
        $member = User::factory()->create(['username' => null]);
        Sanctum::actingAs($member);

        foreach ($spec as $name) {
            // The check and the change share a limit of 60 a minute.
            $this->travel(2)->minutes();

            foreach ([$name, strtoupper($name), ucfirst($name)] as $form) {
                $this->getJson('/api/v1/usernames/check?username='.$form)->assertOk()->assertJsonPath('data.available', false);
                $this->putJson('/api/v1/me/username', ['username' => $form])->assertUnprocessable()->assertJsonValidationErrors('username');
            }
        }

        expect($member->refresh()->username)->toBeNull();
    });
});

describe('mail links and secrets at rest', function () {
    beforeEach(function () {
        Mail::fake();
    });

    it('encodes the address in every link, so it cannot add a parameter', function () {
        $email = "a&code=000000&x='y@example.de";
        User::factory()->create(['email' => $email]);

        $this->postJson('/api/v1/auth/password/forgot', ['email' => $email])->assertStatus(202);
        $this->postJson('/api/v1/auth/register', ['email' => $email, 'password' => CTL_PASSWORD, 'accepted_age_16' => true, 'accepted_terms' => true, 'accepted_privacy' => true])->assertStatus(202);

        app()->setLocale('de');
        $reset = Mail::sent(PasswordResetCodeMail::class)->last();
        $exists = Mail::sent(AccountExistsMail::class)->last();

        // The reset link lands on WEB-07 /email/reset since the M2.5 fix round (ADR-207 h); still only the fragment carries values.
        preg_match('/href="([^"]*\/email\/reset[^"]*)"/', $reset->render(), $match);
        parse_str((string) parse_url(html_entity_decode($match[1]), PHP_URL_FRAGMENT), $query);

        expect($query)->toBe(['code' => $reset->code, 'email' => $email])
            ->and(parse_url(html_entity_decode($match[1]), PHP_URL_QUERY))->toBeNull()
            ->and($exists->render())->not->toContain('a&code=')->not->toContain('a&amp;code=000000');
    });

    it('takes every link host from APP_URL, not from the Host header of the request', function () {
        User::factory()->create(['email' => 'da@example.de']);
        config(['speedclub.trusted_hosts' => ['boese.example']]);

        $this->withServerVariables(['HTTP_HOST' => 'boese.example'])->postJson('http://boese.example/api/v1/auth/password/forgot', ['email' => 'da@example.de'])->assertStatus(202);

        app()->setLocale('de');
        $html = Mail::sent(PasswordResetCodeMail::class)->last()->render();

        expect($html)->not->toContain('boese.example')->toContain(config()->string('app.url'));
    });

    it('stores a token only as its hash', function () {
        User::factory()->create(['email' => 'da@example.de', 'password' => CTL_PASSWORD]);

        $token = $this->postJson('/api/v1/auth/login', ['email' => 'da@example.de', 'password' => CTL_PASSWORD, 'device_name' => 'P'])->assertOk()->json('data.token');
        $secret = explode('|', $token, 2)[1];

        expect(PersonalAccessToken::query()->sole()->token)->toBe(hash('sha256', $secret))
            ->and(json_encode(DB::table('personal_access_tokens')->get()))->not->toContain($secret);
    });
});

describe('audit and logs', function () {
    it('records every member security event, without an address, a code or a secret, and the chain verifies', function () {
        Mail::fake();
        Storage::fake('local');

        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.77']);
        $this->postJson('/api/v1/auth/register', ['email' => 'neu@example.de', 'password' => CTL_PASSWORD, 'accepted_age_16' => true, 'accepted_terms' => true, 'accepted_privacy' => true])->assertStatus(202);
        $code = Mail::sent(VerificationCodeMail::class)->last()->code;
        $token = $this->postJson('/api/v1/auth/email/verify', ['email' => 'neu@example.de', 'code' => $code, 'password' => CTL_PASSWORD, 'device_name' => 'Erstes'])->assertOk()->json('data.token');
        $this->postJson('/api/v1/auth/login', ['email' => 'neu@example.de', 'password' => CTL_PASSWORD, 'device_name' => 'Zweites'])->assertOk();

        ctlForgetAuth();
        $this->withToken($token)->putJson('/api/v1/me/username', ['username' => 'frei.name'])->assertOk();
        ctlForgetAuth();
        $this->flushHeaders();

        $this->postJson('/api/v1/auth/password/forgot', ['email' => 'neu@example.de'])->assertStatus(202);
        $resetCode = Mail::sent(PasswordResetCodeMail::class)->last()->code;
        $this->postJson('/api/v1/auth/password/reset', ['email' => 'neu@example.de', 'code' => $resetCode, 'password' => 'Neues-Passwort-77'])->assertOk();

        $events = DB::table('audit_events')->get();
        $actions = $events->pluck('action')->all();

        foreach ([MemberSecurityEvent::Registered, MemberSecurityEvent::EmailVerified, MemberSecurityEvent::LoginNewDevice, MemberSecurityEvent::UsernameChanged, MemberSecurityEvent::PasswordReset, MemberSecurityEvent::LogoutAll] as $event) {
            expect($actions)->toContain($event->value);
        }

        $stored = (string) json_encode($events);

        expect($stored)->not->toContain('203.0.113.77')
            ->not->toContain('neu@example.de')
            ->not->toContain($code)
            ->not->toContain($resetCode)
            ->not->toContain(CTL_PASSWORD)
            ->not->toContain('Neues-Passwort-77');

        $this->artisan('audit:verify')->assertSuccessful();
    });

    it('logs no code or password in the flows the first log test leaves out', function () {
        Mail::fake();
        $lines = [];
        Event::listen(MessageLogged::class, function (MessageLogged $event) use (&$lines): void {
            $lines[] = $event->level.' '.$event->message.' '.json_encode($event->context);
        });

        User::factory()->create(['email' => 'pflicht@example.de', 'password' => CTL_PASSWORD, 'force_password_change' => true]);

        $this->postJson('/api/v1/auth/login', ['email' => 'pflicht@example.de', 'password' => CTL_PASSWORD, 'device_name' => 'P'])->assertForbidden();
        $code = Mail::sent(PasswordResetCodeMail::class)->last()->code;

        foreach (range(1, 6) as $round) {
            $this->postJson('/api/v1/auth/password/reset', ['email' => 'pflicht@example.de', 'code' => ctlOtherCode($code), 'password' => 'Neues-Passwort-77'])->assertUnprocessable();
        }

        foreach (range(1, 6) as $round) {
            $this->postJson('/api/v1/auth/login', ['email' => 'wer@example.de', 'password' => 'Falsches-Passwort-55', 'device_name' => 'P']);
        }

        expect(implode("\n", $lines))->not->toContain($code)
            ->not->toContain(CTL_PASSWORD)
            ->not->toContain('Neues-Passwort-77')
            ->not->toContain('Falsches-Passwort-55');
    });
});
