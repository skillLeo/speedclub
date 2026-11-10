<?php

namespace App\Actions\Admin\Audit;

use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Services\Approvals\Approvals;

/**
 * Audit export is always four-eyes (06 §2, ADR-214): this never writes a file. It asks for approval; the engine's `audit.export`
 * handler writes the file once a second staff member approves, and the requester downloads it for 24 h.
 */
final class RequestAuditExport
{
    public function __construct(private readonly Approvals $approvals) {}

    /**
     * @param  array<string, string|null>  $filter  the ADM-44 filter (actor = "staff:12" | "member:01…" | "system")
     *                                              The controller turns the request into the flash (ApprovalsGateway::flash(), review N-5: an Action does not depend on the HTTP
     *                                              layer).
     */
    public function __invoke(Staff $staff, string $format, array $filter, string $reason): ApprovalRequest
    {
        $filter = array_filter($filter, fn (?string $value): bool => $value !== null && $value !== '');

        // The handler names the actor in two fields.
        if (isset($filter['actor'])) {
            [$type, $id] = array_pad(explode(':', $filter['actor'], 2), 2, null);
            unset($filter['actor']);
            $filter['actor_type'] = $type;
            if ($id !== null && $id !== '') {
                $filter['actor_id'] = $id;
            }
        }

        return $this->approvals->request('audit.export', ['format' => $format, 'filter' => $filter], $reason, $staff);
    }
}
