<?php

use App\Models\User;
use Symfony\Component\Process\Process;

/**
 * SEC-P1-46: `email:rfc` makes a token of every non-ASCII or punctuation character, so a form or multipart address of a million of them
 * ran out of memory with an empty 500. A form is no JSON, so LimitJsonBody does not stop it: the length has to come first, and `bail`
 * has to stop the rule from running after the length has failed.
 */
dataset('routes that take an address', [
    'login' => ['/api/v1/auth/login'],
    'register' => ['/api/v1/auth/register'],
    'forgot' => ['/api/v1/auth/password/forgot'],
    'reset' => ['/api/v1/auth/password/reset'],
    'verify' => ['/api/v1/auth/email/verify'],
]);

describe('an address far over the length', function () {
    // At the 256M that docs/DEPLOY.md asks of a host, where this answered an empty 500.
    function longAddressStatus(string $uri, string $character, int $count): Process
    {
        $process = new Process(
            [PHP_BINARY, '-d', 'memory_limit=256M', '-d', 'display_errors=0', __DIR__.'/Fixtures/long-address-as-form.php', $uri, $character, (string) $count],
            base_path(),
            ['APP_ENV' => 'testing', 'APP_DEBUG' => 'false', 'DB_DATABASE' => config()->string('database.connections.mysql.database'), 'CACHE_STORE' => 'array', 'SESSION_DRIVER' => 'array', 'LOG_CHANNEL' => 'null'],
            null,
            120,
        );

        $process->run();

        return $process;
    }

    it('is answered with a 422 under the memory limit of a host', function (string $uri) {
        $process = longAddressStatus($uri, '€', 1000000);

        expect($process->getExitCode())->toBe(0)
            ->and($process->getOutput())->toBe('422');
    })->with('routes that take an address');

    it('is answered with a 422 when it is plain punctuation', function () {
        $process = longAddressStatus('/api/v1/auth/login', '.', 3000000);

        expect($process->getExitCode())->toBe(0)
            ->and($process->getOutput())->toBe('422');
    });
});

describe('an address over the length', function () {
    it('names the length and nothing else', function (string $uri) {
        // Malformed as well, so the second line would be there if the rule still ran behind the length.
        $response = $this->withHeader('Accept-Language', 'en')->postJson($uri, ['email' => str_repeat('a', 256)])->assertUnprocessable();

        expect($response->json('errors.email'))->toBe(['The email field must not be greater than 255 characters.']);
    })->with('routes that take an address');
});

describe('the rule that is left behind the length', function () {
    it('still refuses what is no address', function (string $uri) {
        $this->postJson($uri, ['email' => 'keine-adresse'])->assertUnprocessable()->assertJsonValidationErrors('email');
    })->with('routes that take an address');

    it('still signs in with an address of exactly the length', function () {
        $address = str_repeat('a', 61).'@'.str_repeat('b', 60).'.'.str_repeat('c', 60).'.'.str_repeat('d', 60).'.example.de';

        expect(strlen($address))->toBe(255);

        User::factory()->create(['email' => $address, 'password' => 'korrektes-passwort']);

        $this->postJson('/api/v1/auth/login', ['email' => $address, 'password' => 'korrektes-passwort', 'device_name' => 'P'])->assertOk();
    });
});
