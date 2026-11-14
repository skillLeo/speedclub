<?php

namespace App\Http\Controllers\Admin\Audit;

use App\Http\Controllers\Controller;
use App\Services\Audit\AuditPageCheck;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * ADM-44 "Diese Seite prüfen" (09 §10.2: hash verification per page, M4.17): the audit events shown on one page of the log, checked
 * against the chain by AuditPageCheck. Hashes only, no personal data, so the check itself is not audited. At most 100 ids (the
 * largest page).
 */
class AuditPageCheckController extends Controller
{
    private const MAX_IDS = 100;

    public function __invoke(Request $request, AuditPageCheck $check): JsonResponse
    {
        $raw = $request->query('ids');
        $ids = array_values(array_unique(array_map('intval', array_filter(explode(',', is_string($raw) ? $raw : ''), fn (string $id): bool => preg_match('/^\d{1,20}$/', $id) === 1))));
        abort_if($ids === [] || count($ids) > self::MAX_IDS, 422);

        return new JsonResponse([
            ...$check->check($ids),
            'checked_at' => now()->toIso8601String(),
        ], 200, ['Cache-Control' => 'no-store, private']);
    }
}
