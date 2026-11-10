<?php

use Illuminate\Support\Facades\Hash;

it('hashes passwords with argon2id where available', function () {
    expect(config('hashing.driver'))->toBe(defined('PASSWORD_ARGON2ID') ? 'argon2id' : 'bcrypt');

    $info = Hash::info(Hash::make('korrekt-pferd-batterie'));

    expect($info['algoName'])->toBe(defined('PASSWORD_ARGON2ID') ? 'argon2id' : 'bcrypt');
});

it('reads the production bcrypt cost of 12 from the default', function () {
    $config = (function () {
        return require dirname(__DIR__, 2).'/config/hashing.php';
    })();

    expect(env('BCRYPT_ROUNDS'))->toBe('4')
        ->and($config['bcrypt']['rounds'])->toBe('4');

    expect((string) file_get_contents(dirname(__DIR__, 2).'/config/hashing.php'))
        ->toContain("env('BCRYPT_ROUNDS', 12)");
});

it('keeps verifying a bcrypt hash after a move to an argon2id host', function () {
    $bcrypt = password_hash('korrekt-pferd-batterie', PASSWORD_BCRYPT, ['cost' => 4]);

    expect(Hash::check('korrekt-pferd-batterie', $bcrypt))->toBeTrue()
        ->and(Hash::needsRehash($bcrypt))->toBeTrue();
})->skip(fn () => ! defined('PASSWORD_ARGON2ID'), 'PHP build without argon2id');
