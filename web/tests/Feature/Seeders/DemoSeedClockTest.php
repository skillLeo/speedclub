<?php

use App\Enums\CatalogImportStatus;
use App\Models\Release;
use App\Services\AppConfig\AppConfig;
use Carbon\CarbonImmutable;
use Database\Seeders\Concerns\SeedClock;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\DemoSeeder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;

/**
 * DQ-677: a demo seed writes the same timestamps on every run, whatever the host's clock says, and none after the QA clock.
 * Production installs keep the real time.
 */

/**
 * Every date and time column of every table, as a sorted list of its values (row ids are ULIDs and differ between runs).
 *
 * @return array<string, list<string|null>>
 */
function seededTimestamps(): array
{
    $snapshot = [];

    foreach (Schema::getTables() as $table) {
        $name = $table['name'];

        if (in_array($name, ['migrations', 'cache', 'cache_locks', 'sessions', 'jobs', 'job_batches'], true)) {
            continue;
        }

        foreach (Schema::getColumns($name) as $column) {
            if (! in_array(strtolower((string) $column['type_name']), ['timestamp', 'datetime', 'date'], true)) {
                continue;
            }

            $values = DB::table($name)->orderBy($column['name'])->pluck($column['name'])->map(fn (mixed $v): ?string => $v === null ? null : (string) $v)->all();

            if ($values !== []) {
                $snapshot["$name.{$column['name']}"] = $values;
            }
        }
    }

    return $snapshot;
}

/** One full demo install (DatabaseSeeder on a local host) at a given host clock, rolled back afterwards. */
function seedDemoAt(string $hostNow): array
{
    Carbon::setTestNow(CarbonImmutable::parse($hostNow));
    Cache::flush();
    app(AppConfig::class)->flush();
    DB::beginTransaction();

    try {
        // Each run starts empty and really seeds (a run that found the last one's rows would skip and compare nothing).
        expect(DB::table('users')->count())->toBe(0)->and(DB::table('config_versions')->count())->toBe(0);
        test()->seed(DatabaseSeeder::class);
        expect(DB::table('users')->count())->toBeGreaterThan(10)->and(DB::table('config_versions')->where('key', 'branding')->count())->toBe(3);

        // Host clock on purpose (CatalogDemoSeeder): on a host past their upload + 30 days (both hosts here) the imports stay
        // appliable/reachable, and the running import never looks stalled. They follow the host, so they leave the comparison; the test
        // below pins them on a host before that day.
        DB::table('catalog_imports')->where('status', '!=', CatalogImportStatus::Expired->value)->update(['expires_at' => null]);
        DB::table('catalog_imports')->where('status', CatalogImportStatus::Applying->value)->update(['updated_at' => null]);

        return seededTimestamps();
    } finally {
        DB::rollBack();
        Carbon::setTestNow();
    }
}

/** A local demo host for a full DatabaseSeeder run: fake disks (no seed may touch or clear real media), demo passwords, sync queue. */
function prepareLocalDemoHost(): void
{
    app()->detectEnvironment(fn () => 'local');
    // The brand demo uploads photos: never onto the real disks, and no seed may clear a media folder.
    foreach (['public', 'local'] as $disk) {
        Storage::fake($disk);
    }
    config([
        'speedclub.media.disk' => 'public', 'speedclub.media.private_disk' => 'local',
        'speedclub.brand.public_disk' => 'public', 'speedclub.brand.private_disk' => 'local',
        'speedclub.demo.clear_media_database' => 'none',
        'speedclub.demo.member_password' => 'demo-member-password', 'speedclub.demo.staff_password' => 'demo-staff-password',
        'speedclub.demo.photo_limit' => 2, 'speedclub.staff.owner_email' => 'owner@speedclub.test', 'queue.default' => 'sync',
    ]);
}

it('writes the same timestamps on every demo seed, whatever the host clock says', function () {
    prepareLocalDemoHost();

    // What the migrations wrote (the shipped statement-of-reasons templates) is no seed: it stays out of the QA-clock check below.
    $migrated = seededTimestamps();
    $first = seedDemoAt('2027-03-01 08:00:00');
    $second = seedDemoAt('2027-04-15 17:31:07');

    $differs = array_keys(array_filter($first, fn (array $values, string $column): bool => ($second[$column] ?? null) !== $values, ARRAY_FILTER_USE_BOTH));

    expect(array_keys($second))->toBe(array_keys($first))
        ->and($differs)->toBe([])
        // The rows that print a time on an admin page (ADM-28…38, ADM-12) are there to compare.
        ->and($first)->toHaveKeys(['config_versions.published_at', 'config_versions.updated_at', 'brand_assets.created_at', 'legal_documents.updated_at', 'media.created_at', 'audit_events.occurred_at']);

    // Nothing is dated after the QA clock of the visual matrix (tests/e2e/support/qa.mjs QA_NOW), where the demo would sit in the future.
    // Deadlines and windows lie ahead on purpose; released_at are the real build times from docs/RELEASES.md (ADM-38).
    $ahead = '/\.(expires|due|until|ends|starts|released)_at$/';
    $late = [];
    foreach ($first as $column => $values) {
        if (! str_ends_with($column, '_at') || preg_match($ahead, $column) === 1) {
            continue;
        }
        foreach (array_diff($values, $migrated[$column] ?? []) as $value) {
            if ($value !== null && $value > '2026-11-02 10:00:00') {
                $late[] = "$column $value";
            }
        }
    }
    expect($late)->toBe([]);
});

it('dates the imports by upload + 30 days and the shipped templates by the demo clock on a host before that day, and seeds the frozen release register (DQ-687, DQ-690, DQ-702)', function () {
    prepareLocalDemoHost();
    Carbon::setTestNow(CarbonImmutable::parse('2026-11-10 02:00:00'));
    Cache::flush();
    app(AppConfig::class)->flush();

    try {
        test()->seed(DatabaseSeeder::class);
    } finally {
        Carbon::setTestNow();
    }

    $imports = DB::table('catalog_imports')->get(['status', 'created_at', 'expires_at']);
    expect($imports->count())->toBeGreaterThanOrEqual(4);
    foreach ($imports as $import) {
        expect(CarbonImmutable::parse((string) $import->expires_at)->toDateTimeString())
            ->toBe(CarbonImmutable::parse((string) $import->created_at)->addDays(30)->toDateTimeString(), "catalog import {$import->status}");
    }

    foreach (['sor_templates', 'support_macros'] as $table) {
        expect(DB::table($table)->count())->toBeGreaterThan(0)
            ->and(DB::table($table)->distinct()->pluck('updated_at')->map(fn (mixed $v): string => (string) $v)->all())->toBe([DemoSeeder::NOW], $table)
            ->and(DB::table($table)->distinct()->pluck('created_at')->map(fn (mixed $v): string => (string) $v)->all())->toBe([DemoSeeder::NOW], $table);
    }

    // DQ-702: the register comes from the frozen database/data/demo-releases.md, never from docs/RELEASES.md, which gains a row with
    // every build (1.0.0 Build 5 and 6 are in it now).
    expect(Release::query()->orderBy('released_at')->get()->map(fn (Release $r): string => $r->version_name.' b'.$r->version_code)->unique()->values()->all())
        ->toBe(['0.1.0 b1', '0.1.0 b2', '0.2.0 b3', '0.2.0 b4']);
});

it('puts back the outer moment after a nested one, and keeps the host clock in reach', function () {
    Carbon::setTestNow(CarbonImmutable::parse('2027-01-01 09:00:00'));
    $seen = [];

    SeedClock::at(CarbonImmutable::parse(DemoSeeder::NOW), function () use (&$seen): void {
        SeedClock::at(CarbonImmutable::parse('2026-10-01 10:00:00'), function () use (&$seen): void {
            $seen[] = now()->toDateTimeString();
        });
        $seen[] = now()->toDateTimeString();
        $seen[] = SeedClock::host()->toDateTimeString();
    });
    $seen[] = now()->toDateTimeString();

    expect($seen)->toBe(['2026-10-01 10:00:00', DemoSeeder::NOW, '2027-01-01 09:00:00', '2027-01-01 09:00:00']);
    Carbon::setTestNow();
});

it('installs at the real time outside a demo host', function () {
    // Testing, like production, is no demo host (DemoSeeder::runsAutomatically()); db:seed would ask for confirmation in production.
    expect(DemoSeeder::runsAutomatically())->toBeFalse();
    Carbon::setTestNow(CarbonImmutable::parse('2027-05-05 05:05:05'));
    config(['speedclub.staff.owner_email' => 'owner@example.test']);

    $this->seed(DatabaseSeeder::class);

    expect(DB::table('config_versions')->where('key', 'branding')->value('published_at'))->toStartWith('2027-05-05 05:05:05')
        ->and(json_decode((string) DB::table('config_versions')->where('key', 'branding')->value('payload'), true)['accent_set'])->toBe('signalRed');
    Carbon::setTestNow();
});
