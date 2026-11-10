<?php

namespace App\Actions\Admin\Catalog;

use App\Enums\CatalogEvent;
use App\Enums\CatalogRequestStatus;
use App\Models\CatalogRequest;
use App\Models\Staff;
use App\Models\User;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Catalog\CatalogRefused;
use App\Services\Catalog\Reason;
use App\Services\Notifications\Notifier;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ADM-14 Anfragen "Ablehnen" (`catalog.manage`, reason): the vehicle keeps its free text, the request is closed with the reason (shown
 * to the member, at most 500 characters) and the member is told in-app. Audited as `catalog.request_rejected`.
 */
class RejectCatalogRequest
{
    public function __construct(private readonly Notifier $notifier) {}

    /**
     * @throws AuthorizationException|ValidationException|CatalogRefused
     */
    public function handle(Staff $staff, CatalogRequest $request, string $reason): CatalogRequest
    {
        StaffAtoms::ensure($staff, 'catalog.manage');
        $reason = Reason::required($reason);
        $shown = mb_substr($reason, 0, 500);

        $resolved = DB::transaction(function () use ($staff, $request, $reason, $shown): CatalogRequest {
            /** @var CatalogRequest $locked */
            $locked = CatalogRequest::query()->whereKey($request->getKey())->lockForUpdate()->firstOrFail();

            if ($locked->status !== CatalogRequestStatus::Pending) {
                throw new CatalogRefused('request_resolved');
            }

            $locked->forceFill([
                'status' => CatalogRequestStatus::Rejected,
                'rejection_reason' => $shown,
                'resolved_by' => $staff->getKey(),
                'resolved_at' => now(),
            ])->save();

            Audit::record(CatalogEvent::RequestRejected->value, $locked, after: ['status' => CatalogRequestStatus::Rejected->value], reason: $reason, actor: $staff);

            return $locked;
        });

        $user = is_string($resolved->user_id) ? User::query()->find($resolved->user_id) : null;

        if ($user instanceof User) {
            $this->notifier->catalogRequest($user, $resolved, accepted: false, reason: $shown);
        }

        return $resolved;
    }
}
