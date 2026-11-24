<?php

namespace App\Services\Setup;

use App\Models\Staff;
use App\Services\Audit\Audit;
use Database\Seeders\CatalogSeeder;
use Database\Seeders\StaffSeeder;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Facades\Schema;
use Throwable;

/**
 * ADR-539: the web installer of a host without SSH (ALL-INKL Private, DEPLOY_ALLINKL.md). One run does what DEPLOY.md §4 (first
 * install) or §11 (update) does on a shell, in this order, and stops at the first step that fails:
 *
 *  key       APP_KEY present; empty only on a first install, then generated into .env (an existing key is never replaced)
 *  down      maintenance mode on (this page and /internal/maintenance stay reachable, bootstrap/app.php)
 *  migrate   migrate --force
 *  seed      an empty database: DatabaseSeeder, the required data only (demo seeders refuse to run in production);
 *            otherwise only the named seeders, which add what is missing and never change an admin's edit
 *  storage   the public/storage link; where the host forbids symlink(), a real public/storage folder (copy fallback):
 *            config/filesystems.php then writes photos there directly
 *  releases  the release register (ADM-38)
 *  cache     optimize:clear, then the config/route/view/event caches
 *  up        maintenance mode off
 *  owners    a one-time set-password link to each Owner of STAFF_OWNER_EMAIL who has no password of their own yet
 *  doctor    speedclub:doctor (its warnings do not fail the run)
 *
 * Every step is safe to run again. One run at a time (a file lock: on a first install there is no cache table yet).
 */
class WebSetup
{
    public const AUDIT_ACTION = 'setup.web_run';

    /** Named seeders of an update (DEPLOY.md §11 + the Phase 5 reference seeders): each only adds what is missing. */
    public const UPDATE_SEEDERS = ['StaffSeeder', 'FeatureFlagSeeder', 'ConfigSeeder', 'HelpArticleSeeder', 'DeCitySeeder', 'DexSetSeeder', 'BadgeSeeder', 'ForumCategorySeeder'];

    /** @var resource|null */
    private $lock = null;

    /** @var list<string> */
    private array $lines = [];

    /**
     * @return array{ok: bool, lines: list<string>, fresh: bool}|null null when another run holds the lock
     */
    public function run(): ?array
    {
        if (! $this->acquire()) {
            return null;
        }

        @set_time_limit(config()->integer('speedclub.setup.time_limit_seconds'));
        ignore_user_abort(true);
        $this->lines = [];
        $fresh = false;

        try {
            $fresh = $this->databaseIsEmpty();
            $ok = $this->key()
                && $this->call('down', ['--retry' => 60])
                && $this->call('migrate', ['--force' => true])
                && $this->seed()
                && $this->storage()
                && $this->call('speedclub:releases-sync', ['--path' => base_path('RELEASES.md')], fatal: false)
                && $this->call('optimize:clear', [])
                && $this->call('optimize', [])
                && $this->call('up', []);

            if ($ok) {
                $this->ownerLinks();
                $this->call('speedclub:doctor', [], fatal: false);
            }
        } catch (Throwable $exception) {
            report($exception);
            $this->lines[] = 'FEHLER: '.strtok($exception->getMessage(), "\n");
            $ok = false;
        } finally {
            $this->release();
        }

        $this->audit($ok, $fresh);

        return ['ok' => $ok, 'lines' => $this->lines, 'fresh' => $fresh];
    }

    /** Maintenance mode on or off. */
    public function maintenance(bool $down): bool
    {
        return Artisan::call($down ? 'down' : 'up', $down ? ['--retry' => 60] : []) === 0;
    }

    public function isDown(): bool
    {
        return app()->isDownForMaintenance();
    }

    /** No staff account and no catalogue yet: the full seeder may run (DEPLOY.md §7, ADR-234). */
    public function databaseIsEmpty(): bool
    {
        if (! Schema::hasTable('migrations') || ! Schema::hasTable('staff')) {
            return true;
        }

        return ! Staff::query()->exists() && ! CatalogSeeder::catalogueHasRows();
    }

    private function key(): bool
    {
        if (config('app.key') !== null && config('app.key') !== '') {
            $this->lines[] = 'APP_KEY: vorhanden (bleibt unverändert).';

            return true;
        }

        // First install only: an existing key is never replaced (it would sign everyone out and break encrypted columns).
        $this->lines[] = 'APP_KEY: leer, wird jetzt erzeugt und in .env geschrieben.';
        if ($this->call('key:generate', ['--force' => true]) && config('app.key') !== '') {
            return true;
        }
        $this->lines[] = 'APP_KEY konnte nicht in .env geschrieben werden. Auf dem Mac im Terminal: php -r "echo \'base64:\'.base64_encode(random_bytes(32)).PHP_EOL;" und die Ausgabe als APP_KEY=… selbst in .env eintragen, dann diese Seite erneut öffnen.';

        return false;
    }

    private function seed(): bool
    {
        if ($this->databaseIsEmpty()) {
            $this->lines[] = 'Leere Datenbank: Erstinstallation mit den Grunddaten (ohne Demo-Inhalte).';

            return $this->call('db:seed', ['--force' => true]);
        }

        foreach (self::UPDATE_SEEDERS as $seeder) {
            if (! $this->call('db:seed', ['--class' => $seeder, '--force' => true])) {
                return false;
            }
        }

        return true;
    }

    private function storage(): bool
    {
        $link = public_path('storage');

        if (is_link($link) || is_dir($link)) {
            $this->lines[] = is_link($link) ? 'public/storage: Link vorhanden.' : 'public/storage: Ordner vorhanden (Kopie-Variante).';

            return true;
        }

        $this->call('storage:link', [], fatal: false);
        if ($this->isLink($link)) {
            return true;
        }

        // Copy fallback: the host forbids symlink(). A real folder takes over as the public disk (config/filesystems.php).
        $this->lines[] = 'Der Host erlaubt keinen Link: public/storage wird ein echter Ordner, vorhandene Dateien werden kopiert.';
        $source = storage_path('app/public');
        if (! File::isDirectory($source) ? File::makeDirectory($link, 0775, true) : File::copyDirectory($source, $link)) {
            $this->lines[] = 'public/storage: Ordner angelegt, Fotos werden ab jetzt dort gespeichert.';

            return true;
        }
        $this->lines[] = 'public/storage konnte nicht angelegt werden: Schreibrechte von /speedclub/public prüfen.';

        return false;
    }

    /** Asked fresh: PHP caches file status, and storage:link has just tried to create the link. */
    private function isLink(string $path): bool
    {
        clearstatcache(true, $path);

        return is_link($path);
    }

    /** @param array<string, mixed> $arguments */
    private function call(string $command, array $arguments, bool $fatal = true): bool
    {
        $this->lines[] = '$ php artisan '.$command.$this->describe($arguments);

        try {
            $code = Artisan::call($command, $arguments);
            foreach (preg_split('/\R/', trim(Artisan::output())) ?: [] as $line) {
                if (trim($line) !== '') {
                    $this->lines[] = rtrim($line);
                }
            }
        } catch (Throwable $exception) {
            report($exception);
            $this->lines[] = 'FEHLER: '.strtok($exception->getMessage(), "\n");
            $code = 1;
        }

        if ($code !== 0) {
            $this->lines[] = $fatal ? "Abbruch: {$command} endete mit Code {$code}." : "({$command} endete mit Code {$code}, die Einrichtung geht weiter.)";
        }

        return $code === 0 || ! $fatal;
    }

    /** @param array<string, mixed> $arguments */
    private function describe(array $arguments): string
    {
        $parts = [];
        foreach ($arguments as $key => $value) {
            $parts[] = $value === true ? $key : $key.'='.(is_string($value) ? basename($value) : (string) json_encode($value));
        }

        return $parts === [] ? '' : ' '.implode(' ', $parts);
    }

    /**
     * Client round 6: every Owner of STAFF_OWNER_EMAIL (StaffSeeder::ownerEmails()) whose password nobody has set yet (seeded with a
     * random one, password_proof_required, never signed in) gets a one-time link to set it: the staff password reset, valid
     * auth.passwords.staff.expire minutes, sent after the response like every auth mail. Nobody ever sees, types or receives a
     * password for them. Never fails the run: "Passwort vergessen?" on /admin/login sends a new link at any time.
     */
    private function ownerLinks(): void
    {
        foreach (StaffSeeder::ownerEmails() as $email) {
            $owner = Staff::query()->where('email', $email)->first();
            if ($owner === null || ! $owner->hasRole('owner') || ! $owner->password_proof_required || $owner->last_login_at !== null) {
                continue;
            }

            try {
                $status = Password::broker('staff')->sendResetLink(['email' => $owner->email]);
            } catch (Throwable $exception) {
                report($exception);
                $status = 'error';
            }

            $minutes = config()->integer('auth.passwords.staff.expire');
            $this->lines[] = $status === Password::RESET_LINK_SENT
                ? 'Owner '.self::masked($owner->email).": Link zum Passwort-Setzen wird per E-Mail verschickt (einmal nutzbar, {$minutes} Minuten gültig; danach „Passwort vergessen?“ auf /admin/login)."
                : 'Owner '.self::masked($owner->email).': kein Link verschickt (gerade erst einer, oder Mail-Fehler). „Passwort vergessen?“ auf /admin/login schickt einen.';
        }
    }

    /** "info@joinspeedclub.com" → "i***@joinspeedclub.com": the page names the account without spelling the address out. */
    private static function masked(string $email): string
    {
        [$local, $domain] = array_pad(explode('@', $email, 2), 2, '');

        return mb_substr($local, 0, 1).'***@'.$domain;
    }

    private function audit(bool $ok, bool $fresh): void
    {
        try {
            if (Schema::hasTable('audit_events')) {
                Audit::record(self::AUDIT_ACTION, after: ['ok' => $ok, 'first_install' => $fresh], reason: 'Einrichtung im Browser (ADR-539)');
            }
        } catch (Throwable $exception) {
            report($exception);
        }
    }

    private function acquire(): bool
    {
        $handle = @fopen(storage_path('framework/setup.lock'), 'c');
        if ($handle === false || ! flock($handle, LOCK_EX | LOCK_NB)) {
            return false;
        }
        $this->lock = $handle;

        return true;
    }

    private function release(): void
    {
        if ($this->lock !== null) {
            flock($this->lock, LOCK_UN);
            fclose($this->lock);
            $this->lock = null;
        }
    }
}
