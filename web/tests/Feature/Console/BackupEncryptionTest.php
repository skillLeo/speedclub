<?php

use App\Support\Backups\BackupEncryption;
use App\Support\Backups\UnencryptedBackupRefused;
use App\Support\Doctor\EnvironmentDoctor;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Http;
use Spatie\Backup\Events\BackupHasFailed;
use Spatie\Backup\Events\BackupWasSuccessful;
use Spatie\Backup\Events\DumpingDatabase;
use Spatie\DbDumper\Databases\MySql;

/**
 * Code review phase-3-final SF-3 (ADR-250): production never writes an unencrypted archive. Without BACKUP_ARCHIVE_PASSWORD the doctor
 * reports an error (not a warning) and backup:run fails loudly (BackupHasFailed, non-zero exit, nothing on the disk). Elsewhere it
 * stays a warning. The disk check resolves symlinks and `..`.
 */
beforeEach(function () {
    Http::fake();
    $this->root = sys_get_temp_dir().'/srvfix-backups-'.bin2hex(random_bytes(4));
    $this->sources = sys_get_temp_dir().'/srvfix-sources-'.bin2hex(random_bytes(4));
    File::ensureDirectoryExists($this->sources);
    File::put($this->sources.'/photo.webp', 'x');
    config(['filesystems.disks.backups.root' => $this->root]);
});

afterEach(function () {
    app()->detectEnvironment(fn (): string => 'testing');
    File::deleteDirectory($this->root);
    File::deleteDirectory($this->sources);
});

function sf3Production(): void
{
    app()->detectEnvironment(fn (): string => 'production');
}

function sf3Doctor(): object
{
    return collect(app(EnvironmentDoctor::class)->run())->firstWhere('check', 'Backups');
}

it('reports a missing archive password in production as an error, elsewhere as a warning', function (?string $password) {
    config(['backup.backup.password' => $password]);
    expect(sf3Doctor()->level->value)->toBe('warning');

    sf3Production();
    $result = sf3Doctor();

    expect($result->level->value)->toBe('blocker')
        ->and($result->detail)->toContain('BACKUP_ARCHIVE_PASSWORD is empty')
        ->and($result->detail)->toContain('refuses to write an unencrypted archive');
})->with(['null' => [null], 'empty' => [''], 'blank' => ['   ']]);

it('keeps the production doctor free of the password error once it is set', function () {
    config(['backup.backup.password' => 'a-long-archive-password']);
    sf3Production();

    expect(sf3Doctor()->detail)->not->toContain('BACKUP_ARCHIVE_PASSWORD');
});

it('fails backup:run loudly in production without the password and writes no archive', function () {
    Event::fake([BackupHasFailed::class, BackupWasSuccessful::class]);
    config(['backup.backup.password' => null, 'backup.backup.source.files.include' => [$this->sources], 'backup.backup.source.files.exclude' => []]);
    sf3Production();

    $this->artisan('backup:run', ['--only-files' => true, '--disable-notifications' => true])->assertFailed();

    Event::assertDispatched(BackupHasFailed::class, fn (BackupHasFailed $event): bool => $event->exception instanceof UnencryptedBackupRefused);
    Event::assertNotDispatched(BackupWasSuccessful::class);
    expect(File::isDirectory($this->root) ? File::allFiles($this->root) : [])->toBe([]);
});

it('refuses before the first database dump in production, and lets other environments run', function () {
    config(['backup.backup.password' => '']);

    expect(fn () => event(new DumpingDatabase(MySql::create())))->not->toThrow(UnencryptedBackupRefused::class)
        ->and(BackupEncryption::required())->toBeFalse();

    sf3Production();
    expect(fn () => event(new DumpingDatabase(MySql::create())))->toThrow(UnencryptedBackupRefused::class, 'BACKUP_ARCHIVE_PASSWORD is empty');

    config(['backup.backup.password' => 'a-long-archive-password']);
    expect(fn () => BackupEncryption::ensure())->not->toThrow(UnencryptedBackupRefused::class);
});

it('finds a destination below public/ through a symlink or a `..` path', function (string $case) {
    $link = sys_get_temp_dir().'/srvfix-link-'.bin2hex(random_bytes(4));

    try {
        $root = match ($case) {
            'symlink' => (function () use ($link): string {
                symlink(public_path(), $link);

                return $link.'/backups';
            })(),
            'dots' => storage_path('app/backups/../private/backups'),
        };
        config(['backup.backup.password' => 'a-long-archive-password', 'filesystems.disks.backups.root' => $root]);

        $result = sf3Doctor();
        expect($result->level->value)->toBe('warning')->and($result->detail)->toContain('lies inside');
    } finally {
        if (is_link($link)) {
            unlink($link);
        }
    }
})->with(['symlink', 'dots']);
