<?php

namespace App\Support\Doctor;

use App\Enums\StaffStatus;
use App\Health\Checks\LastBackupCheck;
use App\Models\Role;
use App\Models\Staff;
use App\Support\Backups\BackupEncryption;
use App\Support\CommonPasswords;
use App\Support\HostFunctions;
use Database\Seeders\StaffSeeder;
use Illuminate\Database\Migrations\Migrator;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Spatie\Health\Checks\Checks\ScheduleCheck;
use Spatie\Health\Enums\Status;
use Throwable;

/**
 * Deployment checks of 05_ARCHITECTURE §19. Blockers: the app cannot work. Warnings: degraded or optional.
 */
final class EnvironmentDoctor
{
    /**
     * @return list<DoctorResult>
     */
    public function run(): array
    {
        return [
            ...$this->php(),
            $this->gd(),
            $this->writableDirectories(),
            $this->appKey(),
            $this->debugMode(),
            $this->logging(),
            $this->guarded('Database', fn (): DoctorResult => $this->database()),
            $this->guarded('Migrations', fn (): DoctorResult => $this->migrations()),
            $this->guarded('Audit triggers', fn (): DoctorResult => $this->auditTriggers()),
            $this->https(),
            $this->guarded('Cron heartbeat', fn (): DoctorResult => $this->cronHeartbeat()),
            $this->guarded('Queue', fn (): DoctorResult => $this->queue()),
            $this->guarded('Search projection', fn (): DoctorResult => $this->searchProjection()),
            $this->mail(),
            $this->pusher(),
            $this->storageLink(),
            $this->directoryListing(),
            $this->processFunctions(),
            $this->responseFlush(),
            $this->guarded('Common passwords', fn (): DoctorResult => $this->commonPasswords()),
            $this->adminFence(),
            $this->guarded('Active Owner', fn (): DoctorResult => $this->activeOwner()),
            $this->guarded('Backups', fn (): DoctorResult => $this->backups()),
        ];
    }

    /**
     * @return list<DoctorResult>
     */
    private function php(): array
    {
        $minimum = config()->string('speedclub.doctor.php_minimum');
        $results = [
            version_compare(PHP_VERSION, $minimum, '>=')
                ? DoctorResult::ok('PHP version', PHP_VERSION)
                : DoctorResult::blocker('PHP version', PHP_VERSION." is below the required {$minimum}."),
        ];

        /** @var list<string> $required */
        $required = config('speedclub.doctor.php_extensions');
        $missing = array_filter($required, fn (string $extension): bool => ! extension_loaded($extension));
        $results[] = $missing === []
            ? DoctorResult::ok('PHP extensions', count($required).' required extensions loaded')
            : DoctorResult::blocker('PHP extensions', 'Missing: '.implode(', ', $missing));

        /** @var array<string, string> $limits */
        $limits = config('speedclub.doctor.php_limits');
        foreach ($limits as $setting => $minimumValue) {
            $results[] = $this->phpLimit($setting, $minimumValue);
        }

        $maxExecution = (int) ini_get('max_execution_time');
        $minimumExecution = config()->integer('speedclub.doctor.max_execution_time');
        $results[] = $maxExecution === 0 || $maxExecution >= $minimumExecution
            ? DoctorResult::ok('max_execution_time', (string) $maxExecution)
            : DoctorResult::warning('max_execution_time', "{$maxExecution} s, recommended at least {$minimumExecution} s.");

        return $results;
    }

    private function phpLimit(string $setting, string $minimum): DoctorResult
    {
        $value = (string) ini_get($setting);
        $bytes = ini_parse_quantity($value);

        return $bytes < 0 || $bytes >= ini_parse_quantity($minimum)
            ? DoctorResult::ok($setting, $value)
            : DoctorResult::warning($setting, "{$value}, recommended at least {$minimum}. PHP CLI and web can differ on a host.");
    }

    private function gd(): DoctorResult
    {
        if (! function_exists('gd_info')) {
            return DoctorResult::blocker('GD WebP + FreeType', 'GD is not available.');
        }

        $info = gd_info();
        $missing = array_keys(array_filter([
            'WebP' => ! $info['WebP Support'],
            'FreeType' => ! $info['FreeType Support'],
        ]));

        return $missing === []
            ? DoctorResult::ok('GD WebP + FreeType')
            : DoctorResult::blocker('GD WebP + FreeType', 'GD lacks: '.implode(', ', $missing));
    }

    private function writableDirectories(): DoctorResult
    {
        $paths = [
            storage_path('app'),
            storage_path('framework/cache'),
            storage_path('framework/sessions'),
            storage_path('framework/views'),
            storage_path('logs'),
            base_path('bootstrap/cache'),
        ];

        $notWritable = array_filter($paths, fn (string $path): bool => ! is_dir($path) || ! is_writable($path));

        return $notWritable === []
            ? DoctorResult::ok('Writable directories', count($paths).' directories')
            : DoctorResult::blocker('Writable directories', 'Not writable: '.implode(', ', $notWritable));
    }

    private function appKey(): DoctorResult
    {
        return blank(config('app.key'))
            ? DoctorResult::blocker('APP_KEY', 'Not set, run php artisan key:generate (first deploy only).')
            : DoctorResult::ok('APP_KEY', 'Set');
    }

    private function debugMode(): DoctorResult
    {
        if (app()->isProduction() && config()->boolean('app.debug')) {
            return DoctorResult::blocker('APP_DEBUG', 'Must be false in production.');
        }

        return DoctorResult::ok('APP_DEBUG', config()->boolean('app.debug') ? 'On ('.app()->environment().')' : 'Off');
    }

    /**
     * The privacy policy promises 14 days of application logs, and a log nobody rotates can fill the disk.
     */
    private function logging(): DoctorResult
    {
        $default = config()->string('logging.default');
        /** @var list<string> $channels */
        $channels = $default === 'stack' ? (array) config('logging.channels.stack.channels') : [$default];
        $days = config()->integer('logging.channels.daily.days');
        $level = config()->string('logging.channels.daily.level');

        return match (true) {
            in_array('single', $channels, true) => DoctorResult::warning('Logging', 'The single channel never rotates. Set LOG_STACK=daily (LOG_CHANNEL=daily).'),
            in_array('daily', $channels, true) && ($days < 1 || $days > 14) => DoctorResult::warning('Logging', "LOG_DAILY_DAYS is {$days}, the privacy policy promises at most 14."),
            app()->isProduction() && $level === 'debug' => DoctorResult::warning('Logging', 'LOG_LEVEL is debug. Use warning in production.'),
            default => DoctorResult::ok('Logging', implode(',', $channels).", {$days} days, level {$level}"),
        };
    }

    private function database(): DoctorResult
    {
        $row = DB::selectOne('select version() as version');
        $version = is_object($row) && isset($row->version) && is_string($row->version) ? $row->version : '0';
        $isMariaDb = str_contains(strtolower($version), 'mariadb');
        $minimum = config()->string($isMariaDb ? 'speedclub.doctor.mariadb_minimum' : 'speedclub.doctor.mysql_minimum');
        $engine = $isMariaDb ? 'MariaDB' : 'MySQL';

        return version_compare($version, $minimum, '>=')
            ? DoctorResult::ok('Database', "{$engine} {$version}")
            : DoctorResult::warning('Database', "{$engine} {$version} is below the production minimum {$minimum}.");
    }

    private function migrations(): DoctorResult
    {
        /** @var Migrator $migrator */
        $migrator = app('migrator');

        if (! $migrator->repositoryExists()) {
            return DoctorResult::warning('Migrations', 'Not run yet, run php artisan migrate --force.');
        }

        $files = $migrator->getMigrationFiles([database_path('migrations')]);
        $pending = array_diff(array_keys($files), $migrator->getRepository()->getRan());

        return $pending === []
            ? DoctorResult::ok('Migrations', count($files).' applied')
            : DoctorResult::warning('Migrations', count($pending).' pending, run php artisan migrate --force.');
    }

    /**
     * The migration skips the triggers where the host forbids TRIGGER (05_ARCHITECTURE §13). The chain still detects
     * changes then, but the database no longer refuses them.
     */
    private function auditTriggers(): DoctorResult
    {
        $found = DB::table('information_schema.TRIGGERS')
            ->whereRaw('TRIGGER_SCHEMA = DATABASE()')
            ->where('EVENT_OBJECT_TABLE', 'audit_events')
            ->pluck('TRIGGER_NAME')
            ->all();
        $missing = array_diff(['audit_events_no_update', 'audit_events_no_delete'], $found);

        return $missing === []
            ? DoctorResult::ok('Audit triggers', 'Append-only triggers present')
            : DoctorResult::warning('Audit triggers', 'Missing: '.implode(', ', $missing).'. The database accepts changes to the audit log, only audit:verify would notice.');
    }

    private function https(): DoctorResult
    {
        $isHttps = str_starts_with(config()->string('app.url'), 'https://');

        return match (true) {
            app()->isProduction() && ! $isHttps => DoctorResult::warning('HTTPS', 'APP_URL is not https.'),
            $isHttps && config('session.secure') !== true => DoctorResult::warning('HTTPS', 'SESSION_SECURE_COOKIE is off on an https site.'),
            default => DoctorResult::ok('HTTPS', $isHttps ? 'APP_URL and session cookie use https' : 'Plain http ('.app()->environment().')'),
        };
    }

    private function cronHeartbeat(): DoctorResult
    {
        $check = ScheduleCheck::new();
        $last = Cache::store($check->getCacheStoreName())->get($check->getCacheKey());
        $maximumAge = config()->integer('speedclub.doctor.cron_max_age_minutes');

        if (! is_numeric($last)) {
            return DoctorResult::warning('Cron heartbeat', 'Never seen, add the cron entry for php artisan schedule:run.');
        }

        $minutes = (int) floor((time() - (int) $last) / 60);

        return $minutes <= $maximumAge
            ? DoctorResult::ok('Cron heartbeat', "{$minutes} min ago")
            : DoctorResult::warning('Cron heartbeat', "Last seen {$minutes} min ago, cron does not seem to run.");
    }

    private function queue(): DoctorResult
    {
        $connection = config()->string('queue.default');

        if ($connection !== 'database') {
            return app()->isProduction()
                ? DoctorResult::warning('Queue', "Connection is {$connection}, production uses database.")
                : DoctorResult::ok('Queue', "Connection {$connection}");
        }

        if (! Schema::hasTable('jobs')) {
            return DoctorResult::blocker('Queue', 'The jobs table is missing, run php artisan migrate --force.');
        }

        $oldest = DB::table('jobs')->whereNull('reserved_at')->min('available_at');
        $backlogMinutes = is_numeric($oldest) ? (int) floor((time() - (int) $oldest) / 60) : 0;
        $failed = Schema::hasTable('failed_jobs') ? DB::table('failed_jobs')->count() : 0;

        return match (true) {
            $backlogMinutes > config()->integer('speedclub.doctor.queue_max_backlog_minutes') => DoctorResult::warning('Queue', "Oldest job has been waiting {$backlogMinutes} min, check cron."),
            $failed > 0 => DoctorResult::warning('Queue', "{$failed} failed jobs."),
            default => DoctorResult::ok('Queue', 'database, no backlog'),
        };
    }

    /**
     * A vehicle_search row without search_keys is found by no search. The M1.8 migration queues a rebuild of every existing row;
     * until the cron worker has run them, or when it does not run, `php artisan search:rebuild` fills them at once.
     */
    private function searchProjection(): DoctorResult
    {
        if (! Schema::hasColumn('vehicle_search', 'search_keys')) {
            return DoctorResult::warning('Search projection', 'Not migrated yet, run php artisan migrate --force.');
        }

        $missing = DB::table('vehicle_search')->where(fn ($rows) => $rows->whereNull('search_keys')->orWhereNull('updated_at'))->count();

        return $missing === 0
            ? DoctorResult::ok('Search projection', 'Every build can be found')
            : DoctorResult::warning('Search projection', "{$missing} builds cannot be found yet, run php artisan search:rebuild.");
    }

    private function mail(): DoctorResult
    {
        $mailer = config()->string('mail.default');

        if ($mailer !== 'smtp') {
            return DoctorResult::warning('Mail', "Mailer is {$mailer}: nothing is delivered until SMTP is configured.");
        }

        $host = config()->string('mail.mailers.smtp.host');
        $port = config()->integer('mail.mailers.smtp.port');

        if ($host === '') {
            return DoctorResult::warning('Mail', 'MAIL_HOST is not set.');
        }

        $socket = @fsockopen($host, $port, $errorCode, $errorMessage, 3);
        if ($socket === false) {
            return DoctorResult::warning('Mail', "Cannot reach {$host}:{$port}.");
        }
        fclose($socket);

        return DoctorResult::ok('Mail', "SMTP {$host}:{$port} reachable");
    }

    private function pusher(): DoctorResult
    {
        if (config('broadcasting.default') !== 'pusher') {
            return DoctorResult::warning('Pusher', 'Not configured: clients use polling (optional service).');
        }

        return filled(config('broadcasting.connections.pusher.key'))
            && filled(config('broadcasting.connections.pusher.secret'))
            && filled(config('broadcasting.connections.pusher.app_id'))
            ? DoctorResult::ok('Pusher', 'Keys set')
            : DoctorResult::warning('Pusher', 'PUSHER_APP_ID, PUSHER_APP_KEY or PUSHER_APP_SECRET is empty: clients use polling.');
    }

    private function storageLink(): DoctorResult
    {
        if (file_exists(public_path('storage'))) {
            return DoctorResult::ok('Storage link');
        }

        $detail = 'public/storage is missing, run php artisan storage:link.';

        return app()->isProduction() && config('speedclub.media.disk') === 'public'
            ? DoctorResult::blocker('Storage link', $detail)
            : DoctorResult::warning('Storage link', $detail);
    }

    /**
     * public/.htaccess turns listing off where mod_autoindex is loaded, but the host decides in the end, and a listing of /storage
     * would name every photo file and the OG cards of unlisted builds. So this asks the site itself, as a stranger would.
     */
    private function directoryListing(): DoctorResult
    {
        if (config('filesystems.disks.'.config()->string('speedclub.media.disk').'.driver') !== 'local') {
            return DoctorResult::ok('Directory listing', 'Media are not served from this host');
        }

        $base = rtrim(config()->string('app.url'), '/');
        /** @var list<string> $paths */
        $paths = config()->array('speedclub.doctor.listing_paths');
        $listed = [];

        foreach ($paths as $path) {
            try {
                $body = Http::connectTimeout(3)->timeout(5)->withoutRedirecting()->get($base.$path)->body();
            } catch (Throwable $exception) {
                return DoctorResult::warning('Directory listing', 'Could not ask '.$base.$path.' ('.strtok($exception->getMessage(), "\n").'). Check by hand that it does not answer "Index of".');
            }

            if (str_contains($body, 'Index of')) {
                $listed[] = $path;
            }
        }

        if ($listed === []) {
            return DoctorResult::ok('Directory listing', 'Off for '.implode(', ', $paths));
        }

        $detail = 'The host lists '.implode(', ', $listed).'. Turn off Options Indexes for the document root.';

        return app()->isProduction() ? DoctorResult::blocker('Directory listing', $detail) : DoctorResult::warning('Directory listing', $detail);
    }

    /**
     * schedule:run starts its commands through proc_open, so the cron-driven queue needs it, unless the cron runs
     * speedclub:schedule-inline (SCHEDULER_INLINE=true), which needs no child process. The app's backups need it either way.
     */
    private function processFunctions(): DoctorResult
    {
        if (HostFunctions::procOpen()) {
            return DoctorResult::ok('proc_open', 'Available for schedule:run and backups');
        }

        return config()->boolean('speedclub.scheduler.inline')
            ? DoctorResult::warning('proc_open', 'Disabled on this host: the cron runs speedclub:schedule-inline, and the app\'s own backups are off, so the host\'s backups apply (docs/DEPLOY.md §5, §12).')
            : DoctorResult::blocker('proc_open', 'Disabled: schedule:run cannot start the queue worker on this host. Run the cron with php artisan speedclub:schedule-inline and set SCHEDULER_INLINE=true (docs/DEPLOY.md §5).');
    }

    /**
     * Auth mails go out after the response (ADR-130). Without one of these functions PHP cannot end the response first,
     * so the client waits for the mail, and the time of an answer on forgot and resend could reveal known addresses.
     */
    private function responseFlush(): DoctorResult
    {
        /** @var list<string> $functions */
        $functions = config()->array('speedclub.doctor.response_flush_functions');
        $available = array_values(array_filter($functions, function_exists(...)));

        return $available !== []
            ? DoctorResult::ok('Response flush', $available[0].' available')
            : DoctorResult::warning('Response flush', 'Neither '.implode(' nor ', $functions).' in this PHP ('.PHP_SAPI.'), and CLI and web can differ. Without them on the web PHP the time of an answer on forgot and resend can reveal known addresses.');
    }

    /**
     * A shorter list silently lets more weak passwords through; no list at all makes registration answer 500.
     */
    private function commonPasswords(): DoctorResult
    {
        $entries = CommonPasswords::reachableEntries();
        $minimum = config()->integer('speedclub.passwords.common_list_minimum');

        return $entries >= $minimum
            ? DoctorResult::ok('Common passwords', "{$entries} entries can match")
            : DoctorResult::blocker('Common passwords', "Only {$entries} entries can match, at least {$minimum} are required.");
    }

    /**
     * SEC-P3-05: with TRUSTED_PROXIES=* every sender may set X-Forwarded-For, so the admin IP allow-list can only look at the
     * connection address (RestrictAdminAccess) and either locks everyone out behind a proxy or means nothing.
     */
    private function adminFence(): DoctorResult
    {
        $allowlist = config()->array('speedclub.staff.ip_allowlist', []);
        $proxies = config()->array('speedclub.trusted_proxies', []);

        return match (true) {
            $allowlist !== [] && in_array('*', $proxies, true) => DoctorResult::warning('Admin IP allow-list', 'ADMIN_IP_ALLOWLIST is set with TRUSTED_PROXIES=*: list the host\'s proxy ranges in TRUSTED_PROXIES instead.'),
            $allowlist === [] && app()->environment(['production', 'staging']) => DoctorResult::warning('Admin IP allow-list', 'ADMIN_IP_ALLOWLIST is empty: /admin answers from every address (docs/DEPLOY.md checklist 1).'),
            $allowlist === [] => DoctorResult::ok('Admin IP allow-list', 'Not set ('.app()->environment().')'),
            default => DoctorResult::ok('Admin IP allow-list', count($allowlist).' address(es) or range(s)'),
        };
    }

    /**
     * 06_ADMIN_SPEC §2: at least one active Owner (active, password set, not anonymised), else nobody can approve Owner-level four-eyes
     * requests or change the team. A fresh install has none until the invited Owner sets the password.
     */
    private function activeOwner(): DoctorResult
    {
        $role = Role::query()->where('name', 'owner')->where('guard_name', StaffSeeder::GUARD)->first();

        if ($role === null) {
            return DoctorResult::warning('Active Owner', 'No owner role yet: run php artisan db:seed --class=StaffSeeder --force.');
        }

        $ids = DB::table(config()->string('permission.table_names.model_has_roles'))
            ->where('role_id', $role->getKey())
            ->where('model_type', (new Staff)->getMorphClass())
            ->pluck('model_id');

        $active = Staff::query()->whereKey($ids->all())
            ->where('status', StaffStatus::Active)
            ->where('password_proof_required', false)
            ->whereNull('anonymised_at')
            ->count();

        return $active > 0
            ? DoctorResult::ok('Active Owner', "{$active} active Owner(s)")
            : DoctorResult::warning('Active Owner', 'No active Owner: the invited Owner must set the password from the mail (STAFF_OWNER_EMAIL), or nobody can run the team.');
    }

    /**
     * docs/DEPLOY.md §12: config/backup.php names a destination disk that exists, outside the backed-up folders and outside public/,
     * archives are encrypted, failures go to a mailbox, and the newest archive is recent (LastBackupCheck).
     */
    private function backups(): DoctorResult
    {
        /** @var list<string> $disks */
        $disks = array_values(array_filter((array) config('backup.backup.destination.disks', []), is_string(...)));
        /** @var list<string> $sources */
        $sources = array_values(array_filter((array) config('backup.backup.source.files.include', []), is_string(...)));
        $problems = [];

        if ($disks === []) {
            $problems[] = 'no destination disk in config/backup.php';
        }

        foreach ($disks as $disk) {
            $settings = config("filesystems.disks.$disk");

            if (! is_array($settings)) {
                $problems[] = "the disk \"$disk\" is not defined in config/filesystems.php";

                continue;
            }

            $root = is_string($settings['root'] ?? null) ? rtrim($settings['root'], '/') : null;

            if ($root !== null && ($settings['driver'] ?? null) === 'local') {
                foreach ([...$sources, public_path()] as $path) {
                    if (self::inside($root, $path)) {
                        $problems[] = "the disk \"$disk\" lies inside $path";
                    }
                }
            }
        }

        foreach ($sources as $path) {
            if (realpath($path) === realpath(base_path('.env')) || str_ends_with($path, '.env')) {
                $problems[] = '.env is among the sources';
            }
        }

        if (BackupEncryption::missing()) {
            // SF-3: production refuses to back up unencrypted (BackupEncryption::ensure()), so it is an error there, not a warning.
            if (BackupEncryption::required()) {
                return DoctorResult::blocker('Backups', 'BACKUP_ARCHIVE_PASSWORD is empty: backup:run refuses to write an unencrypted archive in production, so there is no backup. Set it (docs/DEPLOY.md §12).'.($problems === [] ? '' : ' Also: '.implode('; ', $problems).'.'));
            }

            $problems[] = 'BACKUP_ARCHIVE_PASSWORD is empty (archives unencrypted)';
        }

        if (trim((string) config('backup.notifications.mail.to', '')) === '') {
            $problems[] = 'no address for failure mails (BACKUP_MAIL_TO)';
        }

        if ($problems !== []) {
            return DoctorResult::warning('Backups', 'Not configured: '.implode('; ', $problems).'. See docs/DEPLOY.md §12.');
        }

        $last = LastBackupCheck::new()->run();

        return $last->status->equals(Status::ok())
            ? DoctorResult::ok('Backups', 'Newest archive '.$last->getShortSummary().' on '.implode(', ', $disks))
            : DoctorResult::warning('Backups', 'Configured on '.implode(', ', $disks).', but: '.$last->getNotificationMessage().' Schedule backup:run (docs/DEPLOY.md §12).');
    }

    /**
     * Whether $path is $parent or below it, compared as written and, where both exist, after resolving symlinks and `..` (a
     * symlinked public_html or a BACKUP_DISK_ROOT with `..` cannot hide the archive below a source or the web root).
     */
    private static function inside(string $path, string $parent): bool
    {
        $within = fn (string $a, string $b): bool => rtrim($a, '/') === rtrim($b, '/') || str_starts_with(rtrim($a, '/').'/', rtrim($b, '/').'/');

        return $within($path, $parent) || $within(self::resolved($path), self::resolved($parent));
    }

    /** $path with symlinks and `..` resolved up to its nearest existing ancestor (the destination may not exist yet). */
    private static function resolved(string $path): string
    {
        $tail = [];

        while ($path !== '' && $path !== '/' && realpath($path) === false) {
            array_unshift($tail, basename($path));
            $path = dirname($path);
        }

        $base = realpath($path === '' ? '.' : $path);
        $resolved = $base === false ? $path : $base;

        foreach ($tail as $segment) {
            $resolved = $segment === '..' ? dirname($resolved) : ($segment === '.' ? $resolved : rtrim($resolved, '/').'/'.$segment);
        }

        return $resolved;
    }

    /**
     * @param  callable(): DoctorResult  $check
     */
    private function guarded(string $name, callable $check): DoctorResult
    {
        try {
            return $check();
        } catch (Throwable $exception) {
            return DoctorResult::blocker($name, 'Failed: '.strtok($exception->getMessage(), "\n"));
        }
    }
}
