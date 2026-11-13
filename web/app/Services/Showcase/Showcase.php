<?php

namespace App\Services\Showcase;

use RuntimeException;

/**
 * The staging showcase (DemoShowcaseSeeder, `speedclub:demo`): sample members and builds for a client review, marked is_sample so
 * `speedclub:demo --purge` removes exactly them. Only on local and staging hosts; production and every other environment refuse.
 */
final class Showcase
{
    public const EMAIL_DOMAIN = 'speedclub.test';

    /** The account a reviewer signs in with: three complete builds, followers, chats, notifications, saved builds. */
    public const SHOWCASE_USERNAME = 'sebastian.demo';

    /** The crawl's staff account (role admin), removed by the purge. */
    public const STAFF_EMAIL = 'admin.demo@speedclub.test';

    /** Reason given on the showcase's own admin writes (curation, approvals, decisions). */
    /** The Home collection the showcase adds to home_curation (ADM-29); the purge removes it again. */
    public const COLLECTION_KEY = 'showcase-jdm-klassiker';

    public const REASON = 'Showcase-Demo für das Staging-Review (DemoShowcaseSeeder)';

    /** The audit action written once when the showcase is first seeded. */
    public const AUDIT_SEEDED = 'showcase.seeded';

    public const AUDIT_PURGED = 'showcase.purged';

    public static function showcaseEmail(): string
    {
        return self::SHOWCASE_USERNAME.'@'.self::EMAIL_DOMAIN;
    }

    /**
     * @throws RuntimeException outside local and staging
     */
    public static function assertEnvironment(string $what): void
    {
        $environment = (string) app()->environment();

        if (! in_array($environment, ['local', 'staging'], true) || config('app.env') === 'production') {
            throw new RuntimeException("$what refuses to run: APP_ENV is $environment. The showcase exists only on local and staging hosts, never in production.");
        }
    }
}
