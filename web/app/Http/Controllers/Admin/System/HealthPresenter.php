<?php

namespace App\Http\Controllers\Admin\System;

use Carbon\CarbonImmutable;

/**
 * ADM-48 as the page reads it (DQ-620/638): each check with its status and a reason the admin translates (`system.health.reasons.*`,
 * built from the check's own meta, never from its English message), a "was tun" target per problem, and the counts of the summary line.
 * A service that is simply not set up outside production (log mailer, no Pusher, no AI provider) reads "nicht eingerichtet", the same
 * as ADM-50, instead of "in Ordnung"; in production the checks themselves fail or warn for it. Meta values never carry a secret
 * (HealthReport), and only numbers, versions, driver names and dates reach the page.
 */
final class HealthPresenter
{
    private const PROBLEMS = ['failed', 'crashed', 'warning'];

    /** Where the admin follows up a problem of a check (its "was tun" link); a check without one is the server's job (its reason says what). */
    private const TODO = [
        'Queue' => 'jobs',
        'QueueBacklog' => 'jobs',
        'FailedJobs' => 'jobs',
        'MailConfig' => 'integrations',
        'Pusher' => 'integrations',
        'AiProvider' => 'integrations',
        'AuditChain' => 'audit',
    ];

    private const ROUTES = ['jobs' => 'admin.system.jobs', 'integrations' => 'admin.system.integrations', 'audit' => 'admin.audit.index'];

    /**
     * @param  array{finished_at: string|null, status: string, checks: list<array{name: string, label: string, status: string, summary: string, meta: array<string, mixed>}>}  $report
     * @return array{finished_at: string|null, status: string, counts: array{failed: int, warning: int, ok: int, not_configured: int}, checks: list<array{name: string, label: string, status: string, reason: array{key: string, count?: int, params?: array<string, string|int>}|null, todo: array{target: string, href: string}|null}>}
     */
    public static function present(array $report): array
    {
        $checks = array_map(self::check(...), $report['checks']);
        $statuses = array_column($checks, 'status');
        $counts = [
            'failed' => count(array_intersect($statuses, ['failed', 'crashed'])),
            'warning' => count(array_keys($statuses, 'warning', true)),
            'ok' => count(array_keys($statuses, 'ok', true)),
            'not_configured' => count(array_keys($statuses, 'not_configured', true)),
        ];
        $status = $checks === [] ? 'unknown' : ($counts['failed'] > 0 ? 'failed' : ($counts['warning'] > 0 ? 'warning' : 'ok'));

        return ['finished_at' => $report['finished_at'], 'status' => $status, 'counts' => $counts, 'checks' => $checks];
    }

    /**
     * @param  array{name: string, label: string, status: string, summary: string, meta: array<string, mixed>}  $check
     * @return array{name: string, label: string, status: string, reason: array{key: string, count?: int, params?: array<string, string|int>}|null, todo: array{target: string, href: string}|null}
     */
    private static function check(array $check): array
    {
        $status = $check['status'];
        $meta = $check['meta'];

        if ($status === 'ok' && self::notConfigured($check['name'], $meta)) {
            $status = 'not_configured';
        }

        $target = self::TODO[$check['name']] ?? null;
        $open = in_array($status, [...self::PROBLEMS, 'not_configured'], true);

        return [
            'name' => $check['name'],
            'label' => $check['label'],
            'status' => $status,
            'reason' => self::reason($check['name'], $status, $check['summary'], $meta),
            'todo' => $open && $target !== null && app('router')->has(self::ROUTES[$target]) ? ['target' => $target, 'href' => route(self::ROUTES[$target])] : null,
        ];
    }

    /**
     * @param  array<string, mixed>  $meta
     */
    private static function notConfigured(string $name, array $meta): bool
    {
        return match ($name) {
            'MailConfig' => in_array($meta['mailer'] ?? null, ['log', 'array'], true),
            'Pusher', 'AiProvider' => ($meta['configured'] ?? null) === false,
            default => false,
        };
    }

    /**
     * @param  array<string, mixed>  $meta
     * @return array{key: string, count?: int, params?: array<string, string|int>}|null
     */
    private static function reason(string $name, string $status, string $summary, array $meta): ?array
    {
        $problem = in_array($status, self::PROBLEMS, true);
        $int = fn (string $key): int => is_numeric($meta[$key] ?? null) ? (int) $meta[$key] : 0;
        $text = fn (string $key): string => is_scalar($meta[$key] ?? null) ? (string) $meta[$key] : '';

        return match ($name) {
            'DiskSpace' => isset($meta['used_percent']) ? ['key' => 'disk_used', 'params' => ['percent' => $int('used_percent')]] : ['key' => 'disk_unknown'],
            'FailedJobs' => ['key' => 'failed_jobs', 'count' => $int('count')],
            'QueueBacklog' => $problem ? self::waiting($int('oldest_minutes')) : ['key' => 'queue_waiting', 'count' => $int('waiting')],
            'Queue' => ['key' => $problem ? 'queue_failed' : 'queue_ok'],
            'Schedule' => ['key' => $problem ? 'schedule_silent' : 'schedule_ok'],
            'Database' => ['key' => $problem ? 'database_failed' : 'database_ok'],
            'Cache' => ['key' => $problem ? 'cache_failed' : 'cache_ok'],
            'StorageLink' => ['key' => $problem ? 'storage_link_missing' : 'storage_link_ok'],
            'GdWebp' => $problem ? ['key' => 'gd_missing'] : ['key' => 'gd_ok'],
            'PhpEnvironment' => self::php($status, $meta),
            'MailConfig' => match (true) {
                $status === 'not_configured' => ['key' => 'mail_log', 'params' => ['driver' => $text('mailer')]],
                $status === 'failed' => ['key' => 'mail_no_delivery', 'params' => ['driver' => $text('mailer')]],
                $status === 'warning' => ['key' => 'mail_no_sender'],
                default => ['key' => 'mail_driver', 'params' => ['driver' => $text('mailer')]],
            },
            'Pusher' => match (true) {
                ($meta['configured'] ?? null) === false => ['key' => 'pusher_off'],
                $problem => ['key' => 'pusher_unreachable'],
                default => ['key' => 'pusher_reachable'],
            },
            'AiProvider' => match (true) {
                ($meta['configured'] ?? null) === false => ['key' => 'ai_none'],
                $summary === 'no_key' => ['key' => 'ai_no_key', 'params' => ['provider' => $text('provider')]],
                $problem => ['key' => 'ai_unreachable', 'params' => ['provider' => $text('provider')]],
                default => ['key' => 'ai_ready', 'params' => ['provider' => $text('provider')]],
            },
            'LastBackup' => self::backup($status, $summary, $meta),
            'AuditChain' => match (true) {
                ($meta['verified'] ?? null) !== true => ['key' => 'audit_never'],
                ($meta['intact'] ?? null) !== true => ['key' => 'audit_broken'],
                $problem => ['key' => 'audit_old', 'params' => ['date' => $text('verified_at')]],
                default => ['key' => 'audit_ok', 'count' => $int('checked'), 'params' => ['date' => $text('verified_at')]],
            },
            'DebugMode' => $problem ? ['key' => 'debug_on'] : null,
            'Environment' => $problem ? ['key' => 'environment_wrong'] : null,
            'OptimizedApp' => $problem ? ['key' => 'not_optimized'] : null,
            default => null,
        };
    }

    /**
     * @return array{key: string, count: int}
     */
    private static function waiting(int $minutes): array
    {
        return match (true) {
            $minutes >= 2 * 1440 => ['key' => 'queue_waits_days', 'count' => intdiv($minutes, 1440)],
            $minutes >= 120 => ['key' => 'queue_waits_hours', 'count' => intdiv($minutes, 60)],
            default => ['key' => 'queue_waits_minutes', 'count' => max(1, $minutes)],
        };
    }

    /**
     * @param  array<string, mixed>  $meta
     * @return array{key: string, params: array<string, string>}
     */
    private static function php(string $status, array $meta): array
    {
        $version = is_string($meta['version'] ?? null) ? $meta['version'] : '';
        $missing = is_array($meta['missing_extensions'] ?? null) ? array_values(array_filter($meta['missing_extensions'], is_string(...))) : [];

        return match (true) {
            $missing !== [] => ['key' => 'php_missing', 'params' => ['list' => implode(', ', $missing)]],
            $status === 'failed' => ['key' => 'php_old', 'params' => ['version' => $version]],
            default => ['key' => 'php_version', 'params' => ['version' => $version]],
        };
    }

    /**
     * @param  array<string, mixed>  $meta
     * @return array{key: string, count?: int, params?: array<string, string|int>}
     */
    private static function backup(string $status, string $summary, array $meta): array
    {
        if (($meta['found'] ?? null) !== true || ! is_string($meta['at'] ?? null)) {
            return ['key' => $summary === 'unknown' ? 'backup_unreadable' : 'backup_none'];
        }

        if ($status === 'ok') {
            return ['key' => 'backup_at', 'params' => ['date' => $meta['at']]];
        }

        $hours = (int) CarbonImmutable::parse($meta['at'])->diffInHours(now(), true);

        return $hours >= 48 ? ['key' => 'backup_old_days', 'count' => intdiv($hours, 24)] : ['key' => 'backup_old_hours', 'count' => $hours];
    }
}
