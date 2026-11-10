<?php

use App\Models\User;
use App\Rules\DeliverableEmail;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Validator;
use Laravel\Sanctum\Sanctum;

/**
 * SEC-P1-51: sign-up and the e-mail change refuse what email:rfc takes but no relay delivers to, with the normal e-mail error, and
 * still take what mail providers hand out.
 */
beforeEach(function () {
    Mail::fake();
});

function deliverableRegistration(string $email): array
{
    return ['email' => $email, 'password' => 'Ein-langes-Passwort-2026', 'accepted_age_16' => true, 'accepted_terms' => true, 'accepted_privacy' => true];
}

$undeliverable = [
    'single-label host' => 'a@localhost',
    'single-label host, upper case' => 'a@LOCALHOST',
    'IPv4 literal' => 'a@[127.0.0.1]',
    'IPv6 literal' => 'a@[IPv6:::1]',
    'bare IPv4' => 'a@127.0.0.1',
    'comment before the domain' => 'a@(x)x.de',
    'comment in the local part' => 'a(b)@x.de',
    'comment after the domain' => 'a@x.de(c)',
    'quoted local part with a space' => '"a b"@x.de',
    'quoted local part' => '"ab"@x.de',
    'trailing dot' => 'a@x.de.',
    'empty label' => 'a@x..de',
    'label starting with a hyphen' => 'a@-x.de',
    'label ending with a hyphen' => 'a@x-.de',
    'all-digit top-level domain' => 'a@x.123',
    'label longer than 63' => 'a@'.str_repeat('x', 64).'.de',
    'local part longer than 64' => str_repeat('a', 65).'@x.de',
    'umlaut in the local part' => 'jürgen@x.de',
    'no local part' => '@x.de',
    'subdomain of localhost' => 'a@sub.localhost',
    '.local' => 'a@printer.local',
    '.invalid' => 'a@x.invalid',
    '.example' => 'a@mail.example',
    '.internal' => 'a@corp.internal',
    'reserved name in upper case' => 'a@X.INTERNAL',
];

$deliverable = [
    'plain' => 'max.mustermann@example.de',
    'plus addressing' => 'max.mustermann+garage@example.de',
    'subdomain' => 'lukas@mail.werkstatt.example.de',
    'umlaut domain (IDN)' => 'max@müller.de',
    'IDN already in punycode' => 'max@xn--mller-kva.de',
    'hyphen and digits' => 'm-3_tuning@bmw-m3.club',
    'IDN top-level domain' => 'ivan@пример.рф',
    'second-level example domain' => 'max@example.de',
    'two-part country domain' => 'max@werkstatt.co.uk',
    'new generic top-level domain' => 'max@speedclub.app',
    'a reserved word that is not the last label' => 'max@test.de',
];

describe('the rule', function () use ($undeliverable, $deliverable) {
    it('refuses an address no relay delivers to', function (string $email) {
        expect(DeliverableEmail::deliverable($email))->toBeFalse()
            ->and(Validator::make(['email' => $email], ['email' => [new DeliverableEmail]])->fails())->toBeTrue();
    })->with($undeliverable);

    it('takes the addresses mail providers hand out', function (string $email) {
        expect(DeliverableEmail::deliverable($email))->toBeTrue()
            ->and(Validator::make(['email' => $email], ['email' => ['email:rfc', new DeliverableEmail]])->passes())->toBeTrue();
    })->with($deliverable);

    it('leaves a value that is no string to the other rules', function () {
        expect(Validator::make(['email' => ['a']], ['email' => [new DeliverableEmail]])->passes())->toBeTrue();
    });
});

describe('the reserved name "test"', function () {
    it('is refused where the host runs as production or staging', function () {
        config(['speedclub.verification.reserved_email_tlds' => ['localhost', 'local', 'test', 'invalid', 'example', 'internal']]);

        expect(DeliverableEmail::deliverable('lukas@e2e.speedclub.test'))->toBeFalse()
            ->and(DeliverableEmail::deliverable('lukas@speedclub.de'))->toBeTrue();
    });

    it('stays open on local and testing hosts, for the demo and e2e accounts under speedclub.test', function () {
        expect(config('speedclub.verification.reserved_email_tlds'))->not->toContain('test')->toContain('localhost', 'internal')
            ->and(DeliverableEmail::deliverable('lukas@e2e.speedclub.test'))->toBeTrue();
    });
});

describe('POST auth/register', function () {
    it('refuses the address with the normal e-mail error and creates no account', function (string $email) {
        $this->withHeader('Accept-Language', 'de');
        $normal = $this->postJson('/api/v1/auth/register', deliverableRegistration('keine-adresse'))->assertUnprocessable()->json('errors.email.0');

        $this->postJson('/api/v1/auth/register', deliverableRegistration($email))
            ->assertUnprocessable()
            ->assertJsonPath('code', 'validation_failed')
            ->assertJsonPath('errors.email.0', $normal);

        expect(User::query()->count())->toBe(0);
    })->with(['a@localhost', 'a@[127.0.0.1]', 'a@(x)x.de', 'a(b)@x.de']);

    it('still registers a deliverable address', function (string $email) {
        $this->postJson('/api/v1/auth/register', deliverableRegistration($email))->assertStatus(202);

        expect(User::query()->count())->toBe(1);
    })->with(['max.mustermann+garage@example.de', 'lukas@mail.werkstatt.example.de', 'max@müller.de']);
});

describe('POST me/email', function () {
    it('refuses an undeliverable new address', function (string $email) {
        Sanctum::actingAs(User::factory()->create());

        $this->postJson('/api/v1/me/email', ['email' => $email, 'password' => 'password'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('email');
    })->with(['a@localhost', 'a@[127.0.0.1]', 'a@(x)x.de', 'a(b)@x.de']);
});
