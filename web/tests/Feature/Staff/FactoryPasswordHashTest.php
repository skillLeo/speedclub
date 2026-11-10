<?php

use App\Models\Staff;
use App\Models\User;
use Illuminate\Support\Facades\Hash;

/**
 * Phase 3 verify run 1: the perf group run alone failed KpiTest with "Could not verify the hashed value's configuration", because
 * StaffResetTimingTest (production hashing cost) ran first and left its hash in the factory's once-per-process memo. The memo now
 * follows the hashing configuration, so a later test at the testing cost gets a hash its `hashed` cast accepts.
 */
function factoryHashAt(array $hashing): void
{
    config($hashing);
    app()->forgetInstance('hash');
    Hash::clearResolvedInstance('hash');
}

it('hashes the factory passwords again when a test changed the hashing cost before', function () {
    $testing = [
        'hashing.bcrypt.rounds' => config('hashing.bcrypt.rounds'),
        'hashing.argon.memory' => config('hashing.argon.memory'),
        'hashing.argon.time' => config('hashing.argon.time'),
        'hashing.argon.threads' => config('hashing.argon.threads'),
    ];

    factoryHashAt(['hashing.bcrypt.rounds' => 12, 'hashing.argon.memory' => 65536, 'hashing.argon.time' => 4, 'hashing.argon.threads' => 1]);
    Staff::factory()->make();
    User::factory()->make();

    factoryHashAt($testing);
    $staff = Staff::factory()->make();
    $user = User::factory()->make();

    expect(Hash::needsRehash($staff->password))->toBeFalse()
        ->and(Hash::needsRehash((string) $user->getAttribute('password')))->toBeFalse()
        ->and(Hash::check('password-for-tests', $staff->password))->toBeTrue()
        ->and(Hash::check('password', (string) $user->getAttribute('password')))->toBeTrue();
});
