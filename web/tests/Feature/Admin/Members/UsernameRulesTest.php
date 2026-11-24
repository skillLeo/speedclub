<?php

use App\Models\User;
use App\Rules\ValidUsername;
use App\Support\Username;
use Illuminate\Support\Facades\Validator;

/**
 * Client round 2 (2026-11-19): members choose 5 to 24 characters; staff (ADM-10) may set 1 to 40 and reserved names.
 */
it('asks members for at least five characters', function () {
    expect(Username::violations('abcd'))->toContain(Username::VIOLATION_LENGTH)
        ->and(Username::violations('abcde'))->toBe([])
        ->and(Validator::make(['u' => 'abcd'], ['u' => [new ValidUsername]])->fails())->toBeTrue();
});

it('lets staff set any length from 1 to 40 and reserved names, but keeps the character rules', function () {
    expect(Username::violations('ab', staff: true))->toBe([])
        ->and(Username::violations(str_repeat('a', 40), staff: true))->toBe([])
        ->and(Username::violations(str_repeat('a', 41), staff: true))->toContain(Username::VIOLATION_LENGTH)
        ->and(Username::violations('admin', staff: true))->toBe([])
        ->and(Username::violations('admin'))->toContain(Username::VIOLATION_RESERVED)
        ->and(Username::violations('a b', staff: true))->toContain(Username::VIOLATION_CHARACTERS)
        ->and(Validator::make(['u' => 'ab'], ['u' => [new ValidUsername(staff: true)]])->fails())->toBeFalse();
});

it('stores a long staff-given username', function () {
    $member = User::factory()->create();
    $member->forceFill(['username' => str_repeat('b', 40)])->save();
    expect($member->fresh()->username)->toBe(str_repeat('b', 40));
});
