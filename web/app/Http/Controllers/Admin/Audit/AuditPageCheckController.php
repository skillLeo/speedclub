<?php

namespace App\Http\Controllers\Admin\Audit;

use App\Http\Controllers\Controller;
use App\Services\Audit\AuditChain;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * ADM-44 "Diese Seite prüfen" (09 §10.2: hash verification per page, M4.17): checks the audit events shown on one page of the log
 * against the chain: each event's hash is recomputed from its predecessor's hash and its own hashed columns, and its prev_hash must be
 * the hash of the event right before it (or the archive checkpoint for the first kept event). The nightly audit:verify walks the whole
 * chain; this answers for the rows in front of the staff member. Hashes only, no personal data, so the check itself is not audited.
 * At most 100 ids (the largest page).
 */
class AuditPageCheckController extends Controller
{
    private const MAX_IDS = 100;

    public function __invoke(Request $request): JsonResponse
    {
        $raw = $request->query('ids');
        $ids = array_values(array_unique(array_map('intval', array_filter(explode(',', is_string($raw) ? $raw : ''), fn (string $id): bool => preg_match('/^\d{1,20}$/', $id) === 1))));
        abort_if($ids === [] || count($ids) > self::MAX_IDS, 422);

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

        return new JsonResponse([
            'checked' => $checked,
            'missing' => count($ids) - $checked,
            'intact' => $broken === [] && $checked === count($ids),
            'broken' => $broken,
            'checked_at' => now()->toIso8601String(),
        ], 200, ['Cache-Control' => 'no-store, private']);
    }
}
