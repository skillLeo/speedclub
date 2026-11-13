<?php

namespace App\Services\Audit;

use App\Enums\AuditActorType;
use App\Models\Staff;
use App\Models\User;
use App\Services\Security\SecurityEventLog;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Append-only, tamper-evident log (05_ARCHITECTURE §13). There is deliberately no update or delete method.
 *
 * Inside a larger transaction, call record() last: the chain lock is held until the outermost commit.
 */
final class Audit
{
    private const REDACTED = '[redacted]';

    private const SECRET_KEYS = '/password|secret|token|recovery|code_hash|two_factor/i';

    /**
     * @param  array<array-key, mixed>|null  $before
     * @param  array<array-key, mixed>|null  $after
     * @param  Authenticatable|null  $actor  defaults to the signed-in user; without one the system is the actor
     */
    public static function record(
        string $action,
        ?Model $target = null,
        ?array $before = null,
        ?array $after = null,
        ?string $reason = null,
        ?Authenticatable $actor = null,
    ): void {
        $actor ??= Auth::user();
        $isStaff = $actor instanceof Staff;

        $row = [
            'occurred_at' => Carbon::now('UTC')->format('Y-m-d H:i:s.u'),
            'actor_type' => match (true) {
                $isStaff => AuditActorType::Staff->value,
                $actor instanceof User => AuditActorType::Member->value,
                default => AuditActorType::System->value,
            },
            'actor_id' => $actor === null ? null : self::stringOrNull($actor->getAuthIdentifier()),
            'action' => Str::limit($action, 100, ''),
            'target_type' => $target?->getMorphClass(),
            'target_id' => $target === null ? null : self::stringOrNull($target->getKey()),
            'before' => self::clean($before),
            'after' => self::clean($after),
            'reason' => $reason === null ? null : Str::limit($reason, 1000, ''),
            'request_id' => self::requestId(),
        ];

        DB::transaction(function () use ($row, $isStaff, $target, $actor): void {
            $head = self::lockHead();
            $hash = AuditChain::hash($head, $row);

            $id = DB::table('audit_events')->insertGetId([
                ...$row,
                'before' => $row['before'] === null ? null : AuditChain::canonicalJson($row['before']),
                'after' => $row['after'] === null ? null : AuditChain::canonicalJson($row['after']),
                'prev_hash' => $head,
                'hash' => $hash,
            ]);

            DB::table('audit_chain_head')->where('id', 1)->update(['last_event_id' => $id, 'hash' => $hash]);

            // M4.7 (09 §8.4): a member security event about a member is also a row of their SET-21 log.
            SecurityEventLog::capture($row['action'], $target, $row['after'], $actor);

            // Member IP addresses are not stored (05_ARCHITECTURE §6). Staff access data stays outside the chain (ADR-113).
            if ($isStaff) {
                DB::table('audit_event_access')->insert([
                    'audit_event_id' => $id,
                    'ip' => request()->ip(),
                    'user_agent' => self::stringOrNull(Str::limit((string) request()->userAgent(), 512, '')),
                    'occurred_at' => $row['occurred_at'],
                ]);
            }
        }, 3);
    }

    private static function lockHead(): ?string
    {
        $head = DB::table('audit_chain_head')->where('id', 1)->lockForUpdate()->first();

        if ($head === null) {
            DB::table('audit_chain_head')->insertOrIgnore(['id' => 1]);
            $head = DB::table('audit_chain_head')->where('id', 1)->lockForUpdate()->first();
        }

        return $head === null ? null : self::stringOrNull($head->hash);
    }

    /**
     * Plain JSON values, with enums and dates resolved and secrets removed. No secret may reach the log.
     *
     * @param  array<array-key, mixed>|null  $values
     * @return array<array-key, mixed>|null
     */
    private static function clean(?array $values): ?array
    {
        if ($values === null) {
            return null;
        }

        /** @var array<array-key, mixed> $plain */
        $plain = json_decode((string) json_encode($values, JSON_THROW_ON_ERROR), true, 512, JSON_THROW_ON_ERROR);

        return self::redact($plain);
    }

    /**
     * @param  array<array-key, mixed>  $values
     * @return array<array-key, mixed>
     */
    private static function redact(array $values): array
    {
        foreach ($values as $key => $value) {
            if (is_string($key) && preg_match(self::SECRET_KEYS, $key) === 1) {
                $values[$key] = self::REDACTED;
            } elseif (is_array($value)) {
                $values[$key] = self::redact($value);
            }
        }

        return $values;
    }

    /**
     * One id per request or command, so the rows of one action can be found together. Never taken from the client.
     */
    private static function requestId(): string
    {
        $request = request();
        $id = $request->attributes->get('audit_request_id');

        if (! is_string($id)) {
            $id = (string) Str::ulid();
            $request->attributes->set('audit_request_id', $id);
        }

        return $id;
    }

    private static function stringOrNull(mixed $value): ?string
    {
        return is_string($value) || is_int($value) ? (string) $value : null;
    }
}
