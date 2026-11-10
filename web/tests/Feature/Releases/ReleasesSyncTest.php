<?php

use App\Actions\Admin\Config\RecordRelease;
use App\Enums\ReleaseChannel;
use App\Enums\ReleasePlatform;
use App\Enums\ReleaseSource;
use App\Models\AuditEvent;
use App\Models\Release;
use App\Services\Config\ConfigRefused;
use App\Services\Releases\ReleaseRegister;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Validation\ValidationException;

require_once __DIR__.'/../Admin/Config/ConfigHelpers.php';

/**
 * ADM-38: speedclub:releases-sync reads docs/RELEASES.md, idempotent by version + build + channel; manual entries by releases.manage.
 */
function m35Register(string $sha = '932AE22E788049E1FB6094763CAF76DEAC86F3BA428C0DFFAB390EE0087D346D'): string
{
    return <<<MD
    # SPEED CLUB — Releases

    ## 0.1.0 (Build 1) - lan - 2026-11-02 08:54
    - APK: releases/android/speedclub-0.1.0-b1-lan.apk (51.2 MB)
    - SHA-256: 8739A8E1BC83555E2852FD48FC9D8F805EB329238B4BCF2F13558E9A5383AC84
    - Changes: M1.0 toolchain spike build.
    - Known issues (Low): none.

    ## 0.2.0 — Phase 2 (2026-11-09)
    Tester summary, not a build.

    ## 0.2.0 (Build 4) - lan - 2026-11-09 05:48
    - APK: releases/android/speedclub-0.2.0-b4-lan.apk (55.8 MB)
    - SHA-256: $sha
    - Changes (since Build 3):
      - M2.8 QA fixes.
    - Test status: all gates PASS.

    ## 0.1.0 (Build 1) - lan - 2026-11-02 14:48
    - APK: releases/android/speedclub-0.1.0-b1-lan-2.apk (35.7 MB)
    - SHA-256: 1CC5492A8DB095989675B9049551E03D3C7AF6D0D282DD6D552CE61235D80E27
    - Changes: the second spike build.
    MD;
}

it('parses the build entries and skips the summaries', function () {
    $entries = app(ReleaseRegister::class)->parse(m35Register());

    expect($entries)->toHaveCount(3)
        ->and($entries[1])->toMatchArray(['version_name' => '0.2.0', 'version_code' => 4, 'channel' => 'lan', 'platform' => 'android', 'released_at' => '2026-11-09T04:48:00Z'])
        ->and($entries[1]['notes'])->toContain('M2.8 QA fixes')->not->toContain('Test status');
});

it('syncs idempotently: the later of two equal headings wins, a second run changes nothing, a changed SHA updates', function () {
    $path = tempnam(sys_get_temp_dir(), 'releases');
    file_put_contents($path, m35Register());

    $this->artisan('speedclub:releases-sync', ['--path' => $path])->assertSuccessful()->expectsOutputToContain('2 new, 0 updated, 0 unchanged, 1 duplicate');
    $this->artisan('speedclub:releases-sync', ['--path' => $path])->assertSuccessful()->expectsOutputToContain('0 new, 0 updated, 2 unchanged');

    expect(Release::query()->count())->toBe(2)
        ->and(Release::query()->where('version_code', 1)->value('apk_sha256'))->toBe('1CC5492A8DB095989675B9049551E03D3C7AF6D0D282DD6D552CE61235D80E27')
        ->and(Release::query()->first()->source)->toBe(ReleaseSource::Sync);

    file_put_contents($path, m35Register(str_repeat('A', 64)));
    expect(app(ReleaseRegister::class)->sync((string) file_get_contents($path)))->toBe(['created' => 0, 'updated' => 1, 'unchanged' => 1, 'duplicates' => 1]);
    expect(AuditEvent::query()->where('action', 'release.synced')->count())->toBe(2);
});

it('reads the real register of this repository', function () {
    $result = app(ReleaseRegister::class)->sync((string) file_get_contents(base_path('../docs/RELEASES.md')));

    expect($result['created'])->toBeGreaterThanOrEqual(3)
        ->and(Release::query()->where('version_name', '0.2.0')->where('version_code', 4)->value('apk_sha256'))->toBe('932AE22E788049E1FB6094763CAF76DEAC86F3BA428C0DFFAB390EE0087D346D');
});

it('fails without a readable file', function () {
    $this->artisan('speedclub:releases-sync', ['--path' => '/nope/RELEASES.md'])->assertFailed();
});

it('records a release by hand, refuses a duplicate and bad values, audits', function () {
    $admin = m31Staff('admin');
    $input = ['version_name' => '1.0.0', 'version_code' => 10, 'platform' => 'android', 'channel' => 'production', 'apk_sha256' => strtolower(str_repeat('ab', 32)), 'notes' => 'Erster Store-Build.'];

    $release = app(RecordRelease::class)->handle($admin, $input);
    expect($release->apk_sha256)->toBe(strtoupper(str_repeat('ab', 32)))->and($release->channel)->toBe(ReleaseChannel::Production)->and($release->platform)->toBe(ReleasePlatform::Android);

    expect(fn () => app(RecordRelease::class)->handle($admin, $input))->toThrow(fn (ConfigRefused $e) => expect($e->reason)->toBe('release_taken'));
    expect(fn () => app(RecordRelease::class)->handle($admin, [...$input, 'version_code' => 11, 'apk_sha256' => 'xyz']))->toThrow(ValidationException::class);

    $updated = app(RecordRelease::class)->revise($admin, $release, ['notes' => 'Korrigiert.'], 'Tippfehler in den Notizen.');
    expect($updated->notes)->toBe('Korrigiert.');
    expect(AuditEvent::query()->whereIn('action', ['release.recorded', 'release.updated'])->count())->toBe(2);
});

it('checks releases.manage inside', function (string $role, bool $allowed) {
    $run = fn () => app(RecordRelease::class)->handle(m31Staff($role), ['version_name' => '1.0.0', 'version_code' => 10, 'platform' => 'android', 'channel' => 'lan']);

    $allowed ? expect($run())->toBeInstanceOf(Release::class) : expect($run)->toThrow(AuthorizationException::class);
})->with(m35Matrix('releases.manage'));
