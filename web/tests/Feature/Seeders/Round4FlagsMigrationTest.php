<?php

use App\Models\FeatureFlag;

/** Review SF-9: the round-4 flags reach a seeded host with the update (2027_01_12_100000). */
function round4FlagsMigration(): object
{
    return require database_path('migrations/2027_01_12_100000_add_round_4_flags.php');
}

it('adds crews and cotd_voting on outside production and switches comments on, leaving other rows alone', function () {
    FeatureFlag::query()->create(['key' => 'build_comments', 'enabled' => false, 'description' => 'x']);
    FeatureFlag::query()->create(['key' => 'forum', 'enabled' => false, 'description' => 'x']);

    round4FlagsMigration()->up();

    expect(FeatureFlag::query()->where('key', 'crews')->value('enabled'))->toBeTrue()
        ->and(FeatureFlag::query()->where('key', 'cotd_voting')->value('enabled'))->toBeTrue()
        ->and(FeatureFlag::query()->where('key', 'build_comments')->value('enabled'))->toBeTrue()
        ->and(FeatureFlag::query()->where('key', 'forum')->value('enabled'))->toBeFalse();
});

it('keeps everything off in production and never changes an existing crews row', function () {
    app()->detectEnvironment(fn (): string => 'production');
    FeatureFlag::query()->create(['key' => 'build_comments', 'enabled' => false, 'description' => 'x']);
    FeatureFlag::query()->create(['key' => 'crews', 'enabled' => true, 'description' => 'admin switched it on']);

    round4FlagsMigration()->up();

    expect(FeatureFlag::query()->where('key', 'cotd_voting')->value('enabled'))->toBeFalse()
        ->and(FeatureFlag::query()->where('key', 'build_comments')->value('enabled'))->toBeFalse()
        ->and(FeatureFlag::query()->where('key', 'crews')->value('description'))->toBe('admin switched it on');
});

it('leaves an empty table to the seeder', function () {
    round4FlagsMigration()->up();

    expect(FeatureFlag::query()->count())->toBe(0);
});
