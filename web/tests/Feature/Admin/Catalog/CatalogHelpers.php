<?php

use App\Models\ApprovalRequest;
use App\Models\AuditEvent;
use App\Models\Staff;
use App\Services\Approvals\Approvals;

require_once __DIR__.'/../../Staff/Helpers.php';
require_once __DIR__.'/../../Discover/DiscoverM23Helpers.php';

/**
 * M3.3 catalogue Action tests (lane a). Functions are prefixed m33c so they cannot collide with helpers of other suites.
 */
function m33cReason(): string
{
    return 'Doppelter Eintrag aus der Anfrage-Queue bereinigt.';
}

function m33cEditor(): Staff
{
    return m31Staff('content_editor');
}

function m33cApprove(ApprovalRequest $request, ?Staff $approver = null): ApprovalRequest
{
    return app(Approvals::class)->approve($request, $approver ?? m31Staff('owner'));
}

/**
 * The roles of 06_ADMIN_SPEC §2 and whether they hold `catalog.manage` / `catalog.import`: Owner, Admin and Content-Editor.
 *
 * @return array<string, array{0: string, 1: bool}>
 */
function m33cMatrix(): array
{
    $rows = [];

    foreach (M31_ROLES as $role) {
        $rows[$role] = [$role, in_array($role, ['owner', 'admin', 'content_editor'], true)];
    }

    return $rows;
}

/**
 * @return list<AuditEvent>
 */
function m33cEvents(string $action): array
{
    return AuditEvent::query()->where('action', $action)->orderBy('id')->get()->all();
}
