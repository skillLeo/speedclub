<?php

namespace App\Database;

use Illuminate\Database\Connectors\MySqlConnector;
use PDO;
use PDOException;
use Throwable;

/**
 * Shared hosts cap NEW MySQL connections per second (Hostinger: 20/s) and refuse the rest for that second; the member web opens
 * with 20+ API calls at once, and a refused connection became a 500 (client round 3: "Veröffentlichen does nothing"). A refused
 * connect is tried again after a short pause, up to four times within about 1.5 s, which outlasts a per-second cap. Any other
 * error (wrong password, unknown database) is not retried.
 */
class RetryingMySqlConnector extends MySqlConnector
{
    /** @var list<int> pauses in milliseconds before the 2nd, 3rd and 4th attempt */
    public const PAUSES_MS = [200, 450, 800];

    /**
     * @param  string  $dsn
     * @param  array<string, mixed>  $config
     * @param  array<int, mixed>  $options
     */
    public function createConnection($dsn, array $config, array $options): PDO
    {
        foreach ([...self::PAUSES_MS, null] as $pause) {
            try {
                return parent::createConnection($dsn, $config, $options);
            } catch (PDOException $e) {
                if ($pause === null || ! self::isRefusedForLoad($e)) {
                    throw $e;
                }

                usleep($pause * 1000);
            }
        }

        throw new PDOException('unreachable');
    }

    /** Refused for load (host cap or server limit), not a configuration error. */
    public static function isRefusedForLoad(Throwable $e): bool
    {
        $message = $e->getMessage();

        return str_contains($message, '[2002]') || str_contains($message, 'SQLSTATE[HY000] [2002]')
            || str_contains($message, '[1040]') || str_contains($message, 'Too many connections')
            || str_contains($message, '[1203]') || str_contains($message, 'max_user_connections')
            || str_contains($message, 'Connection refused');
    }
}
