<?php

namespace App\Http\Controllers\Admin\Members;

use App\Enums\ApprovalStatus;
use App\Enums\AuditActorType;
use App\Enums\DataExportStatus;
use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Http\Controllers\Admin\Support\ActivityFeed;
use App\Http\Controllers\Admin\Support\MediaUrls;
use App\Http\Controllers\Admin\Support\RecordLookup;
use App\Http\Controllers\Admin\Vehicles\VehicleListQuery;
use App\Http\Controllers\Controller;
use App\Models\ApprovalRequest;
use App\Models\AuditEvent;
use App\Models\DataExport;
use App\Models\Decision;
use App\Models\Staff;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Admin\Members\MemberRecord;
use App\Services\Garage\VehiclePresenter;
use App\Services\Moderation\SuspensionLimit;
use App\Support\ViewAs;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-10 member record (m3.2-contract §2). Only the open tab's data is read (`?tab=`; the other tabs are optional props a tab switch
 * reloads), so opening the record never audits a message-metadata view nobody asked for. The address is masked unless the viewer holds
 * members.view_pii; the full one comes from MemberPiiController, audited. Never a password, secret, IP address or message content.
 */
class MemberShowController extends Controller
{
    public const TABS = ['overview', 'vehicles', 'security', 'reports', 'messages', 'audit', 'privacy'];

    public function __invoke(Request $request, string $member, MemberRecord $record, VehiclePresenter $presenter): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $user = RecordLookup::member($member);
        $tab = self::tab($request, $staff);

        $panel = fn (string $name, callable $resolve): mixed => $tab === $name ? $resolve : Inertia::optional($resolve);

        return Inertia::render('Members/Show', [
            'member' => fn (): array => [
                ...$record->overview($user, $staff),
                'avatar' => MediaUrls::at($user->avatar, 160),
                'state' => MemberListQuery::status($user),
                'deleted' => $user->trashed(),
            ],
            'tab' => $tab,
            'vehicles' => $panel('vehicles', fn (): array => self::vehicles($user, $presenter)),
            'security' => $panel('security', fn (): array => $record->security($user)),
            'reports' => $panel('reports', fn (): array => $record->reports($user)),
            'messages' => $panel('messages', fn (): ?array => $staff->can('members.message_metadata') ? $record->messageMetadata($user, $staff) : null),
            'audit' => $panel('audit', fn (): ?array => $staff->can('audit.view') ? self::audit($user) : null),
            'privacy' => $panel('privacy', fn (): array => self::privacy($record->privacy($user), $user, $staff)),
            'activity' => fn (): array => ActivityFeed::for(self::targets($user), $staff),
            'pendingApprovals' => fn (): array => self::pending($user),
            'viewAs' => fn (): ?array => self::viewAs($user, $staff),
            'suspendMaxDays' => SuspensionLimit::isLimited($staff) ? SuspensionLimit::MODERATOR_MAX_DAYS : null,
        ]);
    }

    private static function tab(Request $request, Staff $staff): string
    {
        $tab = $request->query('tab');
        $tab = is_string($tab) && in_array($tab, self::TABS, true) ? $tab : 'overview';

        return match ($tab) {
            'messages' => $staff->can('members.message_metadata') ? $tab : 'overview',
            'audit' => $staff->can('audit.view') ? $tab : 'overview',
            default => $tab,
        };
    }

    /**
     * @return list<array<string, mixed>>
     */
    private static function vehicles(User $member, VehiclePresenter $presenter): array
    {
        $vehicles = Vehicle::query()
            ->where('owner_id', $member->id)
            ->with(['make', 'vehicleModel', 'generation', 'cover', 'activeQrCode'])
            ->withCount(['media as photos_count' => fn (Builder $q) => $q->where('status', MediaStatus::Ready)->where('moderation_status', '!=', ModerationStatus::Rejected), 'modifications'])
            ->orderBy('sort')
            ->orderBy('id')
            ->get();
        // One query for every vehicle's removal (review N-6), the rule of VehicleListQuery::hiddenAmong.
        $hidden = array_flip(VehicleListQuery::hiddenAmong(array_values($vehicles->pluck('id')->map(fn (mixed $id): string => (string) $id)->all())));

        return array_values($vehicles
            ->map(fn (Vehicle $vehicle): array => [
                'id' => $vehicle->id,
                'title' => $presenter->fullTitle($vehicle),
                'nickname' => $vehicle->getAttribute('nickname'),
                'model_year' => $vehicle->model_year,
                'status' => $vehicle->status->value,
                'visibility' => $vehicle->visibility->value,
                'hidden' => isset($hidden[$vehicle->id]),
                'cover' => MediaUrls::at($vehicle->cover, 64),
                'cover_focus' => MediaUrls::focus($vehicle->cover),
                'cover_placeholder' => MediaUrls::placeholder($vehicle->cover),
                'photos' => (int) $vehicle->getAttribute('photos_count'),
                'mods' => (int) $vehicle->getAttribute('modifications_count'),
                'qr' => $vehicle->activeQrCode?->code,
                'updated_at' => $vehicle->updated_at?->toIso8601String(),
            ])->all());
    }

    /**
     * Events with the member as target or actor (and the decisions about them), newest first. No before/after, IP or user agent.
     *
     * @return array{events: list<array<string, mixed>>, more: bool}
     */
    private static function audit(User $member): array
    {
        $decisions = Decision::query()->where('subject_id', $member->id)->pluck('id')->all();
        $events = AuditEvent::query()
            ->where(fn (Builder $q) => $q
                ->where(fn (Builder $t) => $t->where('target_type', 'user')->where('target_id', $member->id))
                ->orWhere(fn (Builder $t) => $t->where('target_type', 'decision')->whereIn('target_id', $decisions === [] ? ['-'] : $decisions))
                ->orWhere(fn (Builder $t) => $t->where('actor_type', AuditActorType::Member->value)->where('actor_id', $member->id)))
            ->orderByDesc('occurred_at')
            ->orderByDesc('id')
            ->limit(101)
            ->get(['id', 'occurred_at', 'actor_type', 'actor_id', 'action', 'reason']);

        return ['events' => ActivityFeed::map(array_values($events->take(100)->all()), true), 'more' => $events->count() > 100];
    }

    /**
     * @param  array<string, mixed>  $privacy
     * @return array<string, mixed>
     */
    private static function privacy(array $privacy, User $member, Staff $staff): array
    {
        /** @var list<array<string, mixed>> $exports */
        $exports = $privacy['exports'];
        $names = Staff::query()->whereIn('id', array_filter(array_column($exports, 'requested_by_staff_id')))->pluck('name', 'id');
        // The exports of this list in one query (review N-6), not one find() per row.
        $downloadable = DataExport::query()->whereIn('id', array_map(fn (array $e): string => (string) $e['id'], $exports))->get()
            ->filter(fn (DataExport $export): bool => $export->isDownloadable())->keyBy('id');

        $privacy['exports'] = array_map(fn (array $export): array => [
            ...$export,
            'requested_by' => is_int($export['requested_by_staff_id']) ? ($names[$export['requested_by_staff_id']] ?? null) : null,
            'download' => $export['for_staff'] === true
                && $export['requested_by_staff_id'] === $staff->getKey()
                && $export['status'] === DataExportStatus::Ready->value
                && $staff->can('members.export')
                && $downloadable->has((string) $export['id'])
                    ? route('admin.members.exports.download', ['member' => $member->id, 'export' => $export['id']], false)
                    : null,
        ], $exports);

        return $privacy;
    }

    /**
     * @return array<string, list<string>>
     */
    private static function targets(User $member): array
    {
        return [
            'user' => [$member->id],
            'decision' => array_values(Decision::query()->where('subject_id', $member->id)->pluck('id')->map(fn (mixed $id): string => (string) $id)->all()),
        ];
    }

    /**
     * Four-eyes requests about this member that wait for a second person (suspend, 2FA reset, export, delete).
     *
     * @return list<array{id: string, action: string, title: string, expires_at: string}>
     */
    private static function pending(User $member): array
    {
        return array_values(ApprovalRequest::query()
            ->where('subject_type', $member->getMorphClass())
            ->where('subject_id', $member->id)
            ->where('status', ApprovalStatus::Pending)
            ->where('expires_at', '>', now())
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->get()
            ->map(fn (ApprovalRequest $r): array => ['id' => $r->id, 'action' => $r->action, 'title' => $r->summary['title'], 'expires_at' => $r->expires_at->toIso8601String()])
            ->all());
    }

    /**
     * This staff member's view-as of the member that is still running (they may end it here).
     *
     * @return array{expires_at: string|null}|null
     */
    private static function viewAs(User $member, Staff $staff): ?array
    {
        $token = $member->tokens()->where('name', ViewAs::NAME_PREFIX.$staff->getKey())->where('expires_at', '>', now())->first();

        return $token === null ? null : ['expires_at' => $token->expires_at?->toIso8601String()];
    }
}
