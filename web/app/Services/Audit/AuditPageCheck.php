<?php

namespace App\Services\Audit;

use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * ADM-44 "Diese Seite prüfen" (09 §10.2, M4.17): checks the audit events of one page of the log against the chain. Each event's hash is
 * recomputed from its predecessor's hash and its own hashed columns, and its prev_hash must be the hash of the event right before it
 * (or the archive checkpoint for the first kept event). The nightly audit:verify walks the whole chain; this answers for the rows in
 * front of the staff member. Hashes only, no personal data.
 */
final class AuditPageCheck
{
    /**
     * @param  list<int>  $ids
     * @return array{checked: int, missing: int, intact: bool, broken: list<int>}
     */
    public function check(array $ids): array
    {
        $head = DB::table('audit_chain_head')->where('id', 1)->first();
        // The first kept event follows the archive checkpoint (AuditRetention), not an earlier event.
        $archived = $head !== null && is_string($head->archived_hash) ? $head->archived_hash : null;
        $broken = [];
        $checked = 0;

        foreach (DB::table('audit_events')->whereIn('id', $ids)->orderBy('id')->get() as $event) {
            /** @var stdClass $event */
            $previous = DB::table('audit_events')->where('id', '<', $event->id)->orderByDesc('id')->value('hash');
            $expectedPrevious = is_string($previous) ? $previous : $archived;
            $row = (array) $event;

            foreach (['before', 'after'] as $column) {
                $row[$column] = is_string($row[$column]) ? json_decode($row[$column], true) : null;
            }

            $intact = $event->prev_hash === $expectedPrevious && hash_equals(AuditChain::hash($expectedPrevious, $row), (string) $event->hash);
            $checked++;

            if (! $intact) {
                $broken[] = (int) $event->id;
            }
        }

        return [
            'checked' => $checked,
            'missing' => count($ids) - $checked,
            'intact' => $broken === [] && $checked === count($ids),
            'broken' => $broken,
        ];
    }
}
