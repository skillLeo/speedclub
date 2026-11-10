<?php

namespace App\Services\Admin\Members;

use App\Enums\AuditActorType;
use App\Models\Staff;
use Closure;
use DomainException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;
use Throwable;

/**
 * Runs one bulk step per record, each in its own transaction (outside any approval transaction, SF-3), so one refusal neither stops the
 * others nor undoes them, and turns the outcome into the result panel's row. Shared by the member and the vehicle bulk actions, with
 * the rolling four-eyes window (SF-4): recentDirect() and alone().
 */
final class BulkRunner
{
    public const MAX_IDS = 500;

    public const APPROVAL_ABOVE = 100;

    public const WINDOW_HOURS = 24;

    /** How long a run may hold its staff member's lock for the action (a run of 100 records takes seconds). */
    private const LOCK_SECONDS = 600;

    /**
     * How many records $staff ran in bulk without an approval in the last WINDOW_HOURS, from the summary events of those runs ($event,
     * and for member bulk actions the same `after.action`). An approved run does not count: it had its second pair of eyes.
     */
    public static function recentDirect(Staff $staff, string $event, ?string $action = null): int
    {
        $since = Carbon::now('UTC')->subHours(self::WINDOW_HOURS)->format('Y-m-d H:i:s.u');

        return (int) DB::table('audit_events')
            ->where('actor_type', AuditActorType::Staff->value)
            ->where('actor_id', (string) $staff->getKey())
            ->where('action', $event)
            ->where('occurred_at', '>=', $since)
            ->pluck('after')
            ->sum(function (mixed $after) use ($action): int {
                $data = is_string($after) ? json_decode($after, true) : $after;

                if (! is_array($data) || ($data['approved_by'] ?? null) !== null || ($action !== null && ($data['action'] ?? null) !== $action)) {
                    return 0;
                }

                return (int) ($data['records'] ?? ((int) ($data['done'] ?? 0) + (int) ($data['failed'] ?? 0)));
            });
    }

    /**
     * Runs $run while holding the lock of $staff for $key, so the window check and the run it allows cannot interleave with a parallel
     * run of the same staff member and action. When another run holds it, $busy runs instead (the bulk then asks for approval).
     *
     * @template T
     *
     * @param  Closure(): T  $busy
     * @param  Closure(): T  $run
     * @return T
     */
    public static function alone(Staff $staff, string $key, Closure $busy, Closure $run): mixed
    {
        $lock = Cache::lock('admin-bulk:'.$staff->getKey().':'.$key, self::LOCK_SECONDS);

        if (! $lock->get()) {
            return $busy();
        }

        try {
            return $run();
        } finally {
            $lock->release();
        }
    }

    /**
     * @param  list<string>  $ids
     * @param  callable(string): bool  $step  false when the record is not there
     * @return list<array{id: string, ok: bool, code: string|null}>
     */
    public static function each(array $ids, callable $step): array
    {
        $rows = [];

        foreach ($ids as $id) {
            try {
                $found = DB::transaction(fn (): bool => $step($id));
                $rows[] = ['id' => $id, 'ok' => $found, 'code' => $found ? null : 'not_found'];
            } catch (AuthorizationException) {
                $rows[] = ['id' => $id, 'ok' => false, 'code' => 'forbidden'];
            } catch (ValidationException) {
                $rows[] = ['id' => $id, 'ok' => false, 'code' => 'invalid'];
            } catch (DomainException|InvalidArgumentException) {
                $rows[] = ['id' => $id, 'ok' => false, 'code' => 'not_possible'];
            } catch (Throwable $exception) {
                report($exception);
                $rows[] = ['id' => $id, 'ok' => false, 'code' => 'failed'];
            }
        }

        return $rows;
    }

    /**
     * @param  array<mixed>  $ids
     * @return list<string>
     *
     * @throws ValidationException
     */
    public static function ids(array $ids): array
    {
        $clean = array_values(array_unique(array_filter($ids, fn (mixed $id): bool => is_string($id) && preg_match('/\A[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}\z/', $id) === 1)));

        if ($clean === [] || count($clean) !== count($ids) || count($clean) > self::MAX_IDS) {
            throw ValidationException::withMessages(['ids' => [(string) __('validation.between.array', ['attribute' => 'ids', 'min' => 1, 'max' => self::MAX_IDS])]]);
        }

        return array_map(strtolower(...), $clean);
    }
}
