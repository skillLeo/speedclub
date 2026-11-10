<?php

use App\Mail\VerificationCodeMail;
use App\Models\User;
use App\Services\Auth\AuthMailer;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\Process\Process;

/**
 * The preview must be reliable for the Playwright flow F1 and must not exist in production.
 */
beforeEach(function () {
    Storage::fake('local');
});

function register(string $email, array $overrides = [], array $headers = []): void
{
    test()->withHeaders($headers)->postJson('/api/v1/auth/register', [
        'email' => $email,
        'password' => 'Lackierung-92-rot',
        'accepted_age_16' => true,
        'accepted_terms' => true,
        'accepted_privacy' => true,
        ...$overrides,
    ])->assertStatus(202);
}

/**
 * @return array<int, array<string, mixed>>
 */
function artisanJson(array $command, string $environment): array
{
    $process = new Process([PHP_BINARY, 'artisan', ...$command], base_path(), ['APP_ENV' => $environment]);
    $process->mustRun();

    return json_decode($process->getOutput(), true, 512, JSON_THROW_ON_ERROR);
}

it('returns subject, html, text and code of the latest mail to an address', function () {
    register('flow@example.de');

    $mail = $this->getJson('/dev/mail/latest?to=FLOW@example.de')
        ->assertOk()
        ->assertExactJsonStructure(['at', 'to', 'subject', 'html', 'text', 'code'])
        ->json();

    expect($mail['code'])->toMatch('/\A\d{6}\z/')
        ->and($mail['subject'])->toContain($mail['code'])
        ->and($mail['html'])->toContain($mail['code'])
        ->and($mail['text'])->toContain($mail['code']);

    $this->postJson('/api/v1/auth/email/verify', ['email' => 'flow@example.de', 'code' => $mail['code'], 'password' => 'Lackierung-92-rot', 'device_name' => 'E2E'])->assertOk();
});

it('returns the newest code after a resend', function () {
    register('flow@example.de');
    $first = $this->getJson('/dev/mail/latest?to=flow@example.de')->json('at');

    $this->travel(61)->seconds();
    $this->postJson('/api/v1/auth/email/resend', ['email' => 'flow@example.de'])->assertStatus(202);

    $mail = $this->getJson('/dev/mail/latest?to=flow@example.de')->json();

    expect($mail['at'])->not->toBe($first);

    $this->postJson('/api/v1/auth/email/verify', ['email' => 'flow@example.de', 'code' => $mail['code'], 'password' => 'Lackierung-92-rot', 'device_name' => 'E2E'])->assertOk();
});

it('answers 404 when there is none', function () {
    $this->getJson('/dev/mail/latest?to=wer@example.de')->assertNotFound();
    $this->getJson('/dev/mail/latest')->assertNotFound();
});

it('lists recent mails, newest first, and sets no cookie', function () {
    register('eins@example.de');
    $this->travel(1)->seconds();
    register('zwei@example.de');

    $response = $this->getJson('/dev/mail')->assertOk();

    expect($response->json('data.0.to'))->toBe(['zwei@example.de'])
        ->and($response->json('data.1.to'))->toBe(['eins@example.de'])
        ->and(array_keys($response->json('data.0')))->toBe(['at', 'to', 'subject', 'code'])
        ->and($response->headers->getCookies())->toBe([]);
});

it('keeps a bounded number of files', function () {
    config(['speedclub.dev_mail.keep' => 2]);

    foreach (range(1, 3) as $round) {
        $this->travel(1)->seconds();
        register("n$round@example.de");
    }

    expect(Storage::disk('local')->files('dev-mail'))->toHaveCount(2);
});

describe('mail content', function () {
    it('renders the verification mail in both languages, with the code in large tabular digits', function (string $locale, string $subjectPart, string $heading) {
        register('flow@example.de', ['locale' => $locale]);

        $mail = $this->getJson('/dev/mail/latest?to=flow@example.de')->json();

        expect($mail['subject'])->toContain($subjectPart)
            ->and($mail['html'])->toContain($heading)
            ->and($mail['html'])->toContain('lang="'.$locale.'"')
            ->and($mail['html'])->toContain('max-width:560px')
            ->and($mail['html'])->toContain('tabular-nums')
            ->and($mail['html'])->toContain('/brand/logo-wide-black-320.png')
            ->and($mail['html'])->not->toContain('Lackierung')
            ->and($mail['text'])->toContain($heading)
            ->and($mail['text'])->not->toContain('<');
    })->with([
        ['de', 'ist dein SPEED CLUB Code', 'Bestätige deine E-Mail-Adresse'],
        ['en', 'is your SPEED CLUB code', 'Confirm your e-mail address'],
    ]);

    it('takes colours from the light tokens', function () {
        register('flow@example.de');

        $css = (string) file_get_contents(resource_path('css/tokens.generated.css'));
        $light = substr($css, (int) strpos($css, '[data-theme="light"]'));
        preg_match('/--sc-color-text-primary:\s*(#[0-9A-Fa-f]+);/', $light, $match);

        expect($this->getJson('/dev/mail/latest?to=flow@example.de')->json('html'))->toContain('color:'.$match[1]);
    });

    it('sends the notice for a known address in the owner\'s language, with both links', function (string $locale, string $heading) {
        User::factory()->create(['email' => 'da@example.de', 'locale' => $locale]);

        register('da@example.de', headers: ['Accept-Language' => $locale === 'de' ? 'en' : 'de']);

        $mail = $this->getJson('/dev/mail/latest?to=da@example.de')->json();

        expect($mail['code'])->toBeNull()
            ->and($mail['html'])->toContain($heading)
            // The address rides in the fragment since M2.5 (ADR-138), never in the query.
            ->and($mail['html'])->toContain('/app/sign-in#email=')
            ->and($mail['html'])->toContain('/app/forgot-password#email=')
            ->and($mail['text'])->toContain('/app/forgot-password#email=')
            ->and($mail['text'])->not->toContain('?email=');
    })->with([
        ['de', 'Für diese Adresse gibt es schon ein Konto'],
        ['en', 'This address already has an account'],
    ]);

    it('sends the reset code with the fallback link', function (string $locale, string $heading) {
        User::factory()->create(['email' => 'da@example.de', 'locale' => $locale]);

        $this->postJson('/api/v1/auth/password/forgot', ['email' => 'da@example.de'])->assertStatus(202);

        $mail = $this->getJson('/dev/mail/latest?to=da@example.de')->json();

        expect($mail['code'])->toMatch('/\A\d{6}\z/')
            ->and($mail['html'])->toContain($heading)
            // WEB-07 landing since the M2.5 fix round (ADR-207 h), the values in the fragment.
            ->and($mail['text'])->toContain('/email/reset#code='.$mail['code'].'&email=da%40example.de');
    })->with([
        ['de', 'Neues Passwort festlegen'],
        ['en', 'Set a new password'],
    ]);

    it('sends the security notice for a new device and a changed password', function (string $locale, string $device, string $changed) {
        $member = User::factory()->create(['email' => 'da@example.de', 'locale' => $locale]);
        $login = fn (string $name) => $this->postJson('/api/v1/auth/login', ['email' => 'da@example.de', 'password' => 'password', 'device_name' => $name])->assertOk();

        $login('Erstes');
        $login('<b>Zweites</b>');

        $mail = $this->getJson('/dev/mail/latest?to=da@example.de')->json();

        expect($mail['html'])->toContain($device)
            ->and($mail['html'])->toContain('&lt;b&gt;Zweites&lt;/b&gt;')
            ->and($mail['html'])->not->toContain('<b>Zweites');

        $this->postJson('/api/v1/auth/password/forgot', ['email' => 'da@example.de'])->assertStatus(202);
        $code = $this->getJson('/dev/mail/latest?to=da@example.de')->json('code');
        $this->postJson('/api/v1/auth/password/reset', ['email' => 'da@example.de', 'code' => $code, 'password' => 'Neues-Passwort-77'])->assertOk();

        expect($this->getJson('/dev/mail/latest?to=da@example.de')->json('subject'))->toBe($changed)
            ->and($member->refresh()->tokens()->count())->toBe(0);
    })->with([
        ['de', 'Neue Anmeldung auf einem Gerät', 'Dein Passwort wurde geändert'],
        ['en', 'New sign-in on a device', 'Your password was changed'],
    ]);
});

describe('in production', function () {
    it('registers neither the routes nor the listener', function () {
        $routes = fn (string $environment) => array_column(artisanJson(['route:list', '--json'], $environment), 'uri');
        $listeners = fn (string $environment) => json_encode(artisanJson(['event:list', '--json', '--event=MessageSent'], $environment));

        expect($routes('local'))->toContain('dev/mail', 'dev/mail/latest')
            ->and($routes('production'))->not->toContain('dev/mail')->not->toContain('dev/mail/latest')
            ->and($listeners('local'))->toContain('RecordDevMail')
            ->and($listeners('production'))->not->toContain('RecordDevMail');
    });

    it('refuses to write an auth mail to the log', function () {
        app()->detectEnvironment(fn () => 'production');
        config(['mail.default' => 'log']);
        Mail::fake();
        Log::spy();

        app(AuthMailer::class)->send('da@example.de', 'de', new VerificationCodeMail('123456'));

        Mail::assertNothingSent();
        Log::shouldHaveReceived('error')->once()->withArgs(fn (string $message): bool => ! str_contains($message, '123456') && ! str_contains($message, 'da@example.de'));
    });
});

it('stays neutral when the mail transport fails, and logs no address', function () {
    Mail::shouldReceive('to')->andThrow(new RuntimeException('550 rejected da@example.de'));
    Log::spy();

    register('neu@example.de');

    Log::shouldHaveReceived('error')->withArgs(function (string $message, array $context): bool {
        return ! str_contains($message.json_encode($context), 'da@example.de');
    });
});
