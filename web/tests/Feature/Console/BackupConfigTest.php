<?php

use App\Support\Doctor\EnvironmentDoctor;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Http;
use Spatie\Backup\Config\Config as BackupConfig;
use Spatie\Backup\Tasks\Backup\DbDumperFactory;
use Spatie\Backup\Tasks\Backup\FileSelection;

/**
 * docs/DEPLOY.md §12: config/backup.php backs up the database and the two storage roots, never .env, the code or the backups
 * themselves; the archive is encrypted and lands on a disk outside every source; failures are mailed. The package reads it.
 */
beforeEach(fn () => Http::fake());

function m3qInside(string $path, string $parent): bool
{
    $path = rtrim($path, '/');
    $parent = rtrim($parent, '/');

    return $path === $parent || str_starts_with($path.'/', $parent.'/');
}

it('backs up the database and the two storage roots, never .env, the code or the destination', function () {
    $includes = config('backup.backup.source.files.include');
    $disks = config('backup.backup.destination.disks');

    expect($includes)->toBe([storage_path('app/public'), storage_path('app/private')])
        ->and(config('backup.backup.source.databases'))->toBe([config('database.default')])
        ->and($disks)->toBe(['backups'])
        ->and(config('backup.backup.source.files.exclude'))->toContain(base_path('.env'));

    foreach ($includes as $include) {
        // No source is .env, holds .env (the app root) or is the code.
        expect(m3qInside(base_path('.env'), $include))->toBeFalse($include)
            ->and(m3qInside(base_path(), $include))->toBeFalse($include)
            ->and(str_ends_with($include, '.env'))->toBeFalse($include);

        foreach ($disks as $disk) {
            $root = config("filesystems.disks.$disk.root");
            expect($root)->toBeString()
                ->and(m3qInside($root, $include))->toBeFalse("$disk inside $include")
                ->and(m3qInside($include, $root))->toBeFalse("$include inside $disk")
                ->and(m3qInside($root, public_path()))->toBeFalse("$disk below public/");
        }

        expect(m3qInside(config('backup.backup.temporary_directory'), $include))->toBeFalse('temporary directory inside '.$include);
    }
});

it('encrypts with BACKUP_ARCHIVE_PASSWORD, mails failures only, keeps 30 days and monitors the same disk', function () {
    expect(config('backup.backup.encryption'))->toBe('aes256')
        ->and(array_key_exists('password', config('backup.backup')))->toBeTrue()
        ->and(config('backup.notifications.mail.to'))->toBeString()->not->toBe('')->not->toBe('your@example.com')
        ->and(array_filter(config('backup.notifications.notifications')))->toHaveCount(3)
        ->and(config('backup.monitor_backups.0.disks'))->toBe(config('backup.backup.destination.disks'))
        ->and(config('backup.cleanup.default_strategy.keep_all_backups_for_days') + config('backup.cleanup.default_strategy.keep_daily_backups_for_days'))->toBe(30)
        ->and(config('backup.cleanup.default_strategy.keep_weekly_backups_for_weeks'))->toBe(0);

    // The package accepts it as it is.
    expect(BackupConfig::fromArray(config('backup'))->backup->destination->disks)->toBe(['backups']);
});

/** Sets (or removes, for null) an environment variable everywhere env() looks, and returns the earlier values. */
function m3qEnv(string $name, ?string $value): array
{
    $before = [$_SERVER[$name] ?? null, $_ENV[$name] ?? null, getenv($name)];

    if ($value === null) {
        unset($_SERVER[$name], $_ENV[$name]);
        putenv($name);
    } else {
        $_SERVER[$name] = $_ENV[$name] = $value;
        putenv("$name=$value");
    }

    return $before;
}

it('falls back to HEALTH_TO_ADDRESS, then the support address, for the failure mails', function () {
    $evaluate = fn (): array => require config_path('backup.php');
    $saved = ['BACKUP_MAIL_TO' => m3qEnv('BACKUP_MAIL_TO', null), 'HEALTH_TO_ADDRESS' => m3qEnv('HEALTH_TO_ADDRESS', null), 'SUPPORT_EMAIL' => m3qEnv('SUPPORT_EMAIL', null)];

    try {
        expect($evaluate()['notifications']['mail']['to'])->toBe('support@speedclub.de');

        m3qEnv('HEALTH_TO_ADDRESS', 'ops@example.test');
        expect($evaluate()['notifications']['mail']['to'])->toBe('ops@example.test');

        m3qEnv('BACKUP_MAIL_TO', 'backups@example.test');
        expect($evaluate()['notifications']['mail']['to'])->toBe('backups@example.test');
    } finally {
        foreach ($saved as $name => [$server, $env, $put]) {
            m3qEnv($name, null);
            if ($server !== null) {
                $_SERVER[$name] = $server;
            }
            if ($env !== null) {
                $_ENV[$name] = $env;
            }
            if ($put !== false) {
                putenv("$name=$put");
            }
        }
    }
});

it('keeps storage/app/backups when BACKUP_DISK_ROOT is the empty line of .env.production.example (M3.10 dry run)', function () {
    $evaluate = fn (): array => require config_path('filesystems.php');
    [$server, $env, $put] = m3qEnv('BACKUP_DISK_ROOT', '');

    try {
        expect($evaluate()['disks']['backups']['root'])->toBe(storage_path('app/backups'));

        m3qEnv('BACKUP_DISK_ROOT', '/srv/speedclub-backups');
        expect($evaluate()['disks']['backups']['root'])->toBe('/srv/speedclub-backups');
    } finally {
        m3qEnv('BACKUP_DISK_ROOT', null);
        if ($server !== null) {
            $_SERVER['BACKUP_DISK_ROOT'] = $server;
        }
        if ($env !== null) {
            $_ENV['BACKUP_DISK_ROOT'] = $env;
        }
        if ($put !== false) {
            putenv("BACKUP_DISK_ROOT=$put");
        }
    }
});

it('dumps MySQL with --set-gtid-purged=OFF only when DB_DUMP_GTID_PURGED asks for it (M3.10 dry run)', function () {
    $evaluate = fn (): array => require config_path('database.php');
    $command = function (array $connection): string {
        config(['database.connections.gtid_probe' => $connection]);

        return DbDumperFactory::createFromConnection('gtid_probe')->getDumpCommand('/tmp/dump.sql', '/tmp/credentials.cnf');
    };
    [$server, $env, $put] = m3qEnv('DB_DUMP_GTID_PURGED', '');

    try {
        // The empty line of the env examples: no option, since MariaDB's mysqldump refuses it.
        expect($command($evaluate()['connections']['mysql']))->not->toContain('gtid')
            ->and($command($evaluate()['connections']['mariadb']))->not->toContain('gtid');

        m3qEnv('DB_DUMP_GTID_PURGED', 'OFF');
        expect($command($evaluate()['connections']['mysql']))->toContain('--set-gtid-purged=OFF')
            ->and($command($evaluate()['connections']['mariadb']))->not->toContain('gtid');
    } finally {
        m3qEnv('DB_DUMP_GTID_PURGED', null);
        if ($server !== null) {
            $_SERVER['DB_DUMP_GTID_PURGED'] = $server;
        }
        if ($env !== null) {
            $_ENV['DB_DUMP_GTID_PURGED'] = $env;
        }
        if ($put !== false) {
            putenv("DB_DUMP_GTID_PURGED=$put");
        }
    }
});

it('selects no file of the destination, the temporary folder or .env from a storage tree', function () {
    $root = sys_get_temp_dir().'/m3q-backup-'.bin2hex(random_bytes(4));
    $storage = app()->storagePath();
    app()->useStoragePath($root);

    try {
        foreach (['app/public/media/a.webp', 'app/private/originals/b.jpg', 'app/backups/speedclub/old.zip', 'app/backup-temp/x.sql', 'logs/laravel.log'] as $file) {
            File::ensureDirectoryExists(dirname("$root/$file"));
            File::put("$root/$file", 'x');
        }

        /** @var array{backup: array{source: array{files: array{include: list<string>, exclude: list<string>}}}} $config */
        $config = require config_path('backup.php');
        $files = FileSelection::create($config['backup']['source']['files']['include'])
            ->excludeFilesFrom($config['backup']['source']['files']['exclude'])
            ->selectedFiles();
        // Directories come along as entries of their own; the files decide.
        $selected = array_map(fn (string $file): string => substr($file, strlen($root) + 1), array_filter(iterator_to_array($files, false), is_file(...)));
        sort($selected);

        expect($selected)->toBe(['app/private/originals/b.jpg', 'app/public/media/a.webp']);
    } finally {
        app()->useStoragePath($storage);
        File::deleteDirectory($root);
    }
});

it('lets the doctor warn when backups are not configured', function (string $case, string $message) {
    $settings = match ($case) {
        'password' => ['backup.backup.password' => null],
        'disk' => ['backup.backup.destination.disks' => ['nowhere']],
        'inside' => ['filesystems.disks.backups.root' => storage_path('app/private/backups')],
        'public' => ['filesystems.disks.backups.root' => public_path('backups')],
        'env' => ['backup.backup.source.files.include' => [base_path('.env')]],
        'mail' => ['backup.notifications.mail.to' => ''],
        'empty' => ['filesystems.disks.backups.root' => sys_get_temp_dir().'/m3q-empty-backups-'.bin2hex(random_bytes(4))],
    };
    config(['backup.backup.password' => 'a-long-archive-password', ...$settings]);

    $result = collect(app(EnvironmentDoctor::class)->run())->firstWhere('check', 'Backups');

    expect($result->level->value)->toBe('warning')->and($result->detail)->toContain($message);
})->with([
    'no password' => ['password', 'BACKUP_ARCHIVE_PASSWORD is empty'],
    'unknown disk' => ['disk', 'the disk "nowhere" is not defined'],
    'disk inside a source' => ['inside', 'lies inside'],
    'disk below public' => ['public', 'lies inside'],
    '.env as a source' => ['env', '.env is among the sources'],
    'no mail' => ['mail', 'no address for failure mails'],
    'configured, no archive yet' => ['empty', 'No backup yet'],
]);

it('reports a recent archive as ok', function () {
    $root = sys_get_temp_dir().'/m3q-backups-'.bin2hex(random_bytes(4));
    File::ensureDirectoryExists("$root/".config('backup.backup.name'));
    File::put("$root/".config('backup.backup.name').'/2026-11-09-01-30-00.zip', 'zip');
    config(['backup.backup.password' => 'a-long-archive-password', 'filesystems.disks.backups.root' => $root]);

    try {
        $result = collect(app(EnvironmentDoctor::class)->run())->firstWhere('check', 'Backups');
        expect($result->level->value)->toBe('ok')->and($result->detail)->toContain('on backups');
    } finally {
        File::deleteDirectory($root);
    }
});
