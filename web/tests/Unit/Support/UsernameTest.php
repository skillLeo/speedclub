<?php

use App\Rules\ValidUsername;
use App\Support\Username;
use Illuminate\Support\Facades\Validator;

it('accepts valid usernames', function (string $username) {
    expect(Username::violations($username))->toBe([])
        ->and(Username::isValid($username))->toBeTrue();
})->with(['abc', 'max.mustermann', 'max_mustermann', 'r34.gtr_99', '1er.fahrer', 'trailing_', str_repeat('a', 24)]);

it('reports every broken rule', function (string $username, array $violations) {
    expect(Username::violations($username))->toBe($violations);
})->with([
    'too short' => ['ab', [Username::VIOLATION_LENGTH]],
    'too long' => [str_repeat('a', 25), [Username::VIOLATION_LENGTH]],
    'empty' => ['', [Username::VIOLATION_LENGTH]],
    'umlaut' => ['müller', [Username::VIOLATION_CHARACTERS]],
    'space' => ['max muster', [Username::VIOLATION_CHARACTERS]],
    'dash' => ['max-muster', [Username::VIOLATION_CHARACTERS]],
    'starts with a dot' => ['.max', [Username::VIOLATION_START]],
    'starts with an underscore' => ['_max', [Username::VIOLATION_START]],
    'trailing dot' => ['max.', [Username::VIOLATION_TRAILING_DOT]],
    'double dot' => ['max..m', [Username::VIOLATION_CONSECUTIVE_DOTS]],
    'several at once' => ['.a..', [Username::VIOLATION_START, Username::VIOLATION_TRAILING_DOT, Username::VIOLATION_CONSECUTIVE_DOTS]],
]);

it('treats usernames case-insensitively', function () {
    expect(Username::normalize(' Max.Muster '))->toBe('max.muster')
        ->and(Username::isValid('Max.Muster'))->toBeTrue();
});

it('rejects a newline behind an otherwise valid name', function () {
    expect(Username::violations("max\nmuster"))->toBe([Username::VIOLATION_CHARACTERS]);
});

it('rejects the reserved list from the config in any case', function (string $username) {
    expect(Username::violations($username))->toContain(Username::VIOLATION_RESERVED);
})->with(['admin', 'ADMIN', 'support', 'SpeedClub', 'api', 'impressum', 'datenschutz', 'hilfe', 'undefined', 'official']);

it('reads the reserved list from the config', function () {
    config(['speedclub.usernames.reserved' => ['werkstatt']]);

    expect(Username::isReserved('Werkstatt'))->toBeTrue()
        ->and(Username::isReserved('admin'))->toBeFalse();
});

it('fails validation with translated messages', function (string $locale, string $username, string $message) {
    app()->setLocale($locale);

    $validator = Validator::make(['username' => $username], ['username' => [new ValidUsername]]);

    expect($validator->errors()->get('username'))->toBe([$message]);
})->with([
    ['de', 'admin', 'Dieser Benutzername ist nicht verfügbar.'],
    ['en', 'admin', 'This username is not available.'],
    ['de', 'ab', 'Dein Benutzername muss 3 bis 24 Zeichen lang sein.'],
    ['en', 'ab', 'Your username must be 3 to 24 characters long.'],
]);

it('passes validation for a valid username', function () {
    expect(Validator::make(['username' => 'max.muster'], ['username' => [new ValidUsername]])->passes())->toBeTrue();
});

it('fails validation for a non-string value', function () {
    expect(Validator::make(['username' => ['max']], ['username' => [new ValidUsername]])->fails())->toBeTrue();
});
