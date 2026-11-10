<?php

namespace App\Http\Controllers\Admin\Members;

use App\Http\Controllers\Admin\Support\TableProps;
use App\Http\Controllers\Controller;
use App\Models\Staff;
use App\Models\User;
use App\Services\Approvals\HandlerRegistry;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-09 members list (06 §3 Members): server table with filters, saved views, bulk actions (restrict, revoke sessions, export*,
 * delete*) and the per-record result panel of the last bulk run, flashed by MembersBulkController.
 */
class MembersIndexController extends Controller
{
    public function __invoke(Request $request): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        return Inertia::render('Members/Index', [
            ...TableProps::make(MemberListQuery::build($request, $staff), $request, MemberListQuery::TABLE, $staff, fn (array $members): array => MemberListQuery::rows($members, $staff), MemberListQuery::DEFAULT_SORT),
            'bulkResult' => fn (): ?array => self::bulkResult($request),
            'piiVisible' => $staff->can('members.view_pii'),
            // SEC-P3-03: the list with addresses is the four-eyes members.list_export, once its handler is registered.
            'listExportAvailable' => $staff->can('members.export') && $staff->can('members.view_pii') && app(HandlerRegistry::class)->has(MembersListExportRequestController::HANDLER),
        ]);
    }

    /**
     * @return array{action: string, rows: list<array{id: string, ok: bool, code: string|null}>, labels: array<string, string>}|null
     */
    private static function bulkResult(Request $request): ?array
    {
        $result = $request->hasSession() ? $request->session()->get(MembersBulkController::FLASH) : null;

        if (! is_array($result) || ! is_string($result['action'] ?? null) || ! is_array($result['rows'] ?? null)) {
            return null;
        }

        /** @var list<array{id: string, ok: bool, code: string|null}> $rows */
        $rows = array_values($result['rows']);
        $labels = User::withTrashed()->whereIn('id', array_column($rows, 'id'))->pluck('username', 'id')
            ->map(fn (mixed $username): string => is_string($username) ? '@'.$username : '–')->all();

        return ['action' => $result['action'], 'rows' => $rows, 'labels' => $labels];
    }
}
