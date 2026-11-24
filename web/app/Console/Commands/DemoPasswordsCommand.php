<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\Auth\LoginThrottle;
use App\Services\Showcase\Showcase;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use RuntimeException;

/**
 * Round 5 (client login on staging): every demo account (an address on @speedclub.test, sebastian.demo included) signs in with
 * DEMO_MEMBER_PASSWORD of this host's .env. Idempotent: a hash that already matches stays (a new one would sign the member out
 * everywhere, AuthenticateSession), so a second run changes nothing. It also lifts the progressive sign-in delay of these
 * accounts (LoginThrottle, by account and by address) so a reviewer who mistyped is not held back. Never prints the password;
 * refuses outside local and staging. A deleted demo account stays as it is.
 */
#[Signature('speedclub:demo-passwords {--dry-run : Count what would change, change nothing}')]
#[Description('Make every demo account sign in with DEMO_MEMBER_PASSWORD (local and staging only)')]
class DemoPasswordsCommand extends Command
{
    public const AUDIT_ACTION = 'showcase.demo_passwords_set';

    public function handle(LoginThrottle $throttle): int
    {
        try {
            Showcase::assertEnvironment('speedclub:demo-passwords');
        } catch (RuntimeException $exception) {
            $this->error($exception->getMessage());

            return self::FAILURE;
        }

        $password = config('speedclub.demo.member_password');

        if (! is_string($password) || $password === '') {
            $this->error('DEMO_MEMBER_PASSWORD is not set in .env: nothing was changed.');

            return self::FAILURE;
        }

        $dryRun = (bool) $this->option('dry-run');
        $hash = null;
        $checked = 0;
        $changed = [];

        User::query()
            ->where('email', 'like', '%@'.Showcase::EMAIL_DOMAIN)
            ->orderBy('id')
            ->each(function (User $user) use ($password, $dryRun, $throttle, &$hash, &$checked, &$changed): void {
                $checked++;

                if (! is_string($user->password) || ! Hash::check($password, $user->password)) {
                    $changed[] = (string) $user->username;

                    if (! $dryRun) {
                        $hash ??= Hash::make($password);
                        $user->forceFill(['password' => $hash])->save();
                    }
                }

                if (! $dryRun) {
                    $throttle->clear(LoginThrottle::accountSubject($user));
                    $throttle->clear((string) $user->email);
                    RateLimiter::clear('account-exists:'.hash('sha256', (string) $user->email));
                }
            });

        if (! $dryRun && $changed !== []) {
            Audit::record(self::AUDIT_ACTION, after: ['accounts' => count($changed), 'usernames' => $changed], reason: 'Demo-Zugänge auf DEMO_MEMBER_PASSWORD gesetzt (speedclub:demo-passwords)');
        }

        $this->info(sprintf(
            '%s %d of %d demo accounts%s; sign-in delays %s.',
            $dryRun ? 'Dry run: would set the password on' : 'Password set on',
            count($changed),
            $checked,
            $changed === [] ? ' (all already sign in with DEMO_MEMBER_PASSWORD)' : ': '.implode(', ', array_slice($changed, 0, 20)).(count($changed) > 20 ? ' …' : ''),
            $dryRun ? 'left as they are' : 'cleared',
        ));

        return self::SUCCESS;
    }
}
