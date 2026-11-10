<?php

namespace App\Services\System;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * ADM-49 pending and failed jobs, redacted (m3.6 §1): the job's class name (payload displayName), queue, attempts and times, and for a
 * failed job the exception's class only. The serialized command, which can hold message bodies, addresses, tokens or codes, never leaves
 * here; failed_jobs.exception is already scrubbed of messages (ScrubbingFailedJobProvider, BL-2).
 */
final class JobsInspector
{
    /**
     * @return list<array{id: int, queue: string, job: string, attempts: int, reserved: bool, available_at: string, created_at: string}>
     */
    public function pending(int $limit = 100): array
    {
        return array_values(DB::table('jobs')->orderBy('id')->limit(max(1, min(500, $limit)))
            ->get(['id', 'queue', 'payload', 'attempts', 'reserved_at', 'available_at', 'created_at'])
            ->map(fn (object $row): array => [
                'id' => (int) $row->id,
                'queue' => (string) $row->queue,
                'job' => self::jobName((string) $row->payload),
                'attempts' => (int) $row->attempts,
                'reserved' => $row->reserved_at !== null,
                'available_at' => CarbonImmutable::createFromTimestamp((int) $row->available_at)->toIso8601String(),
                'created_at' => CarbonImmutable::createFromTimestamp((int) $row->created_at)->toIso8601String(),
            ])->all());
    }

    /**
     * @return list<array{uuid: string, connection: string, queue: string, job: string, exception: string, failed_at: string}>
     */
    public function failed(int $limit = 100): array
    {
        return array_values(DB::table(config()->string('queue.failed.table', 'failed_jobs'))->orderByDesc('id')->limit(max(1, min(500, $limit)))
            ->get(['uuid', 'connection', 'queue', 'payload', 'exception', 'failed_at'])
            ->map(fn (object $row): array => [
                'uuid' => (string) $row->uuid,
                'connection' => (string) $row->connection,
                'queue' => (string) $row->queue,
                'job' => self::jobName((string) $row->payload),
                'exception' => self::exceptionClass((string) $row->exception),
                'failed_at' => CarbonImmutable::parse((string) $row->failed_at, 'UTC')->toIso8601String(),
            ])->all());
    }

    /**
     * @return array{pending: int, failed: int}
     */
    public function counts(): array
    {
        return ['pending' => DB::table('jobs')->count(), 'failed' => DB::table(config()->string('queue.failed.table', 'failed_jobs'))->count()];
    }

    /** The class name the queue records for the job; nothing else of the payload. */
    public static function jobName(string $payload): string
    {
        $decoded = json_decode($payload, true);
        $name = is_array($decoded) ? ($decoded['displayName'] ?? null) : null;

        return is_string($name) && preg_match('/\A[A-Za-z0-9_\\\\:.\-]{1,200}\z/', $name) === 1 ? $name : 'unknown';
    }

    /** The exception's class: the first token of the stored text, when it looks like a class name. */
    public static function exceptionClass(string $exception): string
    {
        $first = strtok(ltrim($exception), " :\n(");

        return is_string($first) && preg_match('/\A[A-Za-z_][A-Za-z0-9_\\\\]{0,200}\z/', $first) === 1 ? $first : 'unknown';
    }
}
