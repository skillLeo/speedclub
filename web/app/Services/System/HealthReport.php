<?php

namespace App\Services\System;

use Carbon\CarbonImmutable;
use Spatie\Health\ResultStores\ResultStore;
use Spatie\Health\ResultStores\StoredCheckResults\StoredCheckResult;

/**
 * ADM-48: the latest stored run of the health checks (health:check every five minutes, HealthServiceProvider). name is the check's
 * key for the admin's labels; summary is a short machine value (a count, a version, `not_configured`); meta never holds a secret.
 */
final class HealthReport
{
    public function __construct(private readonly ResultStore $store) {}

    /**
     * @return array{finished_at: string|null, status: 'ok'|'warning'|'failed'|'unknown', checks: list<array{name: string, label: string, status: string, summary: string, meta: array<string, mixed>}>}
     */
    public function latest(): array
    {
        $results = $this->store->latestResults();

        if ($results === null) {
            return ['finished_at' => null, 'status' => 'unknown', 'checks' => []];
        }

        $checks = array_values($results->storedCheckResults->map(fn (StoredCheckResult $result): array => [
            'name' => $result->name,
            'label' => $result->label,
            'status' => $result->status,
            'summary' => $result->shortSummary,
            'meta' => $result->meta,
        ])->all());

        $statuses = array_column($checks, 'status');
        $status = match (true) {
            array_intersect($statuses, ['failed', 'crashed']) !== [] => 'failed',
            in_array('warning', $statuses, true) => 'warning',
            default => 'ok',
        };

        return ['finished_at' => CarbonImmutable::instance($results->finishedAt)->toIso8601String(), 'status' => $status, 'checks' => $checks];
    }
}
