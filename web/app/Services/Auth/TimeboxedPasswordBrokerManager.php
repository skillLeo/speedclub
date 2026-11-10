<?php

namespace App\Services\Auth;

use Illuminate\Auth\AuthManager;
use Illuminate\Auth\Passwords\PasswordBroker;
use Illuminate\Auth\Passwords\PasswordBrokerManager;
use Illuminate\Contracts\Events\Dispatcher;
use InvalidArgumentException;

/**
 * Laravel's manager with one addition: a broker may set its own `timebox` (microseconds) in config/auth.php. Without one it
 * keeps the framework's auth.timebox_duration, which also governs the session guard.
 *
 * Why (SEC-P1-19 and the password.update check of M1.9): PasswordBroker::sendResetLink() and ::reset() pad every outcome
 * that does not return early to the timebox. That only hides which addresses belong to staff while the slowest outcome, a
 * known address (one argon2id hash of the new token, or the check of a wrong one), stays below the floor. At the production
 * cost that hash alone takes about as long as the framework's 200 ms, so the staff broker gets a floor with headroom.
 */
final class TimeboxedPasswordBrokerManager extends PasswordBrokerManager
{
    /**
     * Same as the parent, apart from the timebox (and the container lookups typed).
     *
     * @param  string  $name
     */
    protected function resolve($name): PasswordBroker
    {
        $config = $this->getConfig($name);

        if (is_null($config)) {
            throw new InvalidArgumentException("Password resetter [{$name}] is not defined.");
        }

        $users = $this->app->make(AuthManager::class)->createUserProvider($config['provider'] ?? null);

        if ($users === null) {
            throw new InvalidArgumentException("Password resetter [{$name}] has no user provider.");
        }

        return new PasswordBroker(
            $this->createTokenRepository($config),
            $users,
            $this->app->make(Dispatcher::class),
            timeboxDuration: self::timebox($name),
        );
    }

    /** The floor of every outcome of the broker that does not return early, in microseconds. */
    public static function timebox(string $broker): int
    {
        $own = config("auth.passwords.$broker.timebox");

        return is_int($own) && $own > 0 ? $own : config()->integer('auth.timebox_duration', 200000);
    }
}
