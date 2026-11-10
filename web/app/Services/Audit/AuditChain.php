<?php

namespace App\Services\Audit;

use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * hash = sha256(prev_hash || canonical_json(row)). Canonical means sorted keys and no escaping choices, so the hash
 * stays the same whether the database keeps the JSON text (MariaDB) or normalises it (MySQL 8).
 *
 * Ids may have holes after a rollback; the chain itself cannot, because only committed rows move the head.
 */
final class AuditChain
{
    private const HASHED_COLUMNS = [
        'occurred_at', 'actor_type', 'actor_id', 'action', 'target_type', 'target_id', 'before', 'after', 'reason',
        'request_id',
    ];

    /** Session variable that only AuditRetention sets, for the one delete the triggers let through. */
    public const ARCHIVE_VARIABLE = '@speedclub_audit_archive';

    /**
     * Updates are always rejected. Deletes only pass during the archive step, and a row removed any other way still
     * breaks the chain at the next verify.
     *
     * @return list<literal-string>
     */
    public static function triggerStatements(): array
    {
        $reject = "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_events is append-only'";

        return [
            "CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events FOR EACH ROW $reject",
            'CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events FOR EACH ROW IF COALESCE('.self::ARCHIVE_VARIABLE.", 0) <> 1 THEN $reject; END IF",
        ];
    }

    /**
     * @param  array<string, mixed>  $row
     */
    public static function hash(?string $previous, array $row): string
    {
        $hashed = [];

        foreach (self::HASHED_COLUMNS as $column) {
            $hashed[$column] = $row[$column] ?? null;
        }

        return hash('sha256', ($previous ?? '').self::canonicalJson($hashed));
    }

    public static function canonicalJson(mixed $value): string
    {
        return json_encode(
            self::sorted($value),
            JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION,
        );
    }

    /**
     * Walks the chain from its start (or the archive checkpoint) up to a snapshot of the head and compares its end with
     * that snapshot, which also catches removed tail rows. Events written during the walk lie above the snapshot and wait
     * for the next run. Only a row above a head that has not moved is a forgery: a real event moves the head in the same
     * commit.
     */
    public static function verify(): AuditVerification
    {
        $head = self::head();
        $result = self::walk($head);

        // Archiving removes events from the front, so a walk it overtook starts in front of the new first event.
        if (! $result->intact && self::head()?->archived_through_id !== $head?->archived_through_id) {
            return self::walk(self::head());
        }

        return $result;
    }

    private static function head(): ?stdClass
    {
        return DB::table('audit_chain_head')->where('id', 1)->first();
    }

    private static function walk(?stdClass $head): AuditVerification
    {
        if ($head === null) {
            return new AuditVerification(false, 0, null, 'head');
        }

        $previous = is_string($head->archived_hash) ? $head->archived_hash : null;
        $snapshot = is_numeric($head->last_event_id) ? (int) $head->last_event_id : null;
        $lastId = null;
        $checked = 0;
        $events = $snapshot === null ? [] : DB::table('audit_events')->where('id', '<=', $snapshot)->orderBy('id')->lazyById(1000);

        foreach ($events as $event) {
            /** @var stdClass $event */
            $id = is_numeric($event->id) ? (int) $event->id : 0;

            if ($event->prev_hash !== $previous) {
                return new AuditVerification(false, $checked, $id, 'prev_hash');
            }

            if (! hash_equals(self::hash($previous, self::decoded($event)), (string) $event->hash)) {
                return new AuditVerification(false, $checked, $id, 'hash');
            }

            $previous = (string) $event->hash;
            $lastId = $id;
            $checked++;
        }

        if ($head->hash !== $previous || ($lastId !== null && $snapshot !== $lastId)) {
            return new AuditVerification(false, $checked, $lastId, 'head');
        }

        $unchained = self::unchainedEvent($head, $snapshot);

        return $unchained === null
            ? new AuditVerification(true, $checked)
            : new AuditVerification(false, $checked, $unchained, 'head');
    }

    /**
     * The first event above the snapshot if the head still has not moved. The order matters: the event is read first, so
     * a head read afterwards already includes every commit that made the event visible.
     */
    private static function unchainedEvent(stdClass $head, ?int $snapshot): ?int
    {
        $first = DB::table('audit_events')->when($snapshot !== null, fn ($query) => $query->where('id', '>', $snapshot))->min('id');

        if (! is_numeric($first)) {
            return null;
        }

        $current = self::head();

        return $current !== null && $current->last_event_id === $head->last_event_id ? (int) $first : null;
    }

    /**
     * @return array<string, mixed>
     */
    private static function decoded(stdClass $event): array
    {
        $row = (array) $event;

        foreach (['before', 'after'] as $column) {
            $row[$column] = is_string($row[$column]) ? json_decode($row[$column], true) : null;
        }

        return $row;
    }

    private static function sorted(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }

        $sorted = array_map(self::sorted(...), $value);

        if (! array_is_list($sorted)) {
            ksort($sorted, SORT_STRING);
        }

        return $sorted;
    }
}
