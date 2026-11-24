<?php

namespace App\Http\Controllers\Admin\Crews;

use App\Enums\CrewStatus;
use App\Enums\ReportTargetType;
use App\Http\Controllers\Admin\Support\MediaUrls;
use App\Models\Crew;
use App\Models\CrewMember;
use App\Models\Decision;
use App\Models\ModerationCase;
use App\Services\Moderation\ModerationHolds;
use Illuminate\Database\Eloquent\Builder;

/**
 * ADM-80/81 shapes (contract-crews.md §6/§8). The staff status of a crew is one of four: active, hidden (a DSA removal), removed (deleted
 * by staff: status removed + soft delete) and deleted (deleted by its founder or with the founder's account: soft delete, status kept).
 * The member count is a plain fact for staff; it is never a sort here either (C2).
 */
final class CrewAdminRecord
{
    public const MEMBERS_SHOWN = 200;

    /** active · hidden · removed · deleted */
    public static function state(Crew $crew): string
    {
        return match (true) {
            $crew->status === CrewStatus::Removed => 'removed',
            // R4DQ-55: the system ended it (no member left), the founder did not delete it.
            $crew->trashed() && $crew->ended_reason !== null => 'ended',
            $crew->trashed() => 'deleted',
            default => $crew->status->value,
        };
    }

    /**
     * @param  list<Crew>  $crews
     * @return list<array<string, mixed>>
     */
    public static function rows(array $crews): array
    {
        return array_map(function (Crew $crew): array {
            $founder = $crew->founderMembership?->user;

            return [
                'id' => $crew->id,
                'name' => $crew->name,
                'slug' => $crew->slug,
                'logo' => MediaUrls::at($crew->logo, 64),
                'founder' => $founder === null ? null : ['id' => $founder->id, 'username' => $founder->username],
                'bundesland' => $crew->bundesland?->label(),
                'join_mode' => $crew->join_mode->value,
                'members' => $crew->members_count,
                'state' => self::state($crew),
                'is_sample' => $crew->is_sample,
                'created_at' => $crew->created_at?->toIso8601String(),
            ];
        }, $crews);
    }

    /**
     * @return array<string, mixed>
     */
    public static function detail(Crew $crew, ModerationHolds $holds): array
    {
        $crew->loadMissing(['logo', 'cover', 'founderMembership.user']);
        $founder = $crew->founderMembership?->user;
        $state = self::state($crew);
        $removal = $crew->trashed() ? null : $holds->activeRemoval(ReportTargetType::Crew, $crew->id);

        return [
            'id' => $crew->id,
            'name' => $crew->name,
            'slug' => $crew->slug,
            'previous_slug' => $crew->previous_slug,
            'description' => $crew->description,
            'bundesland' => $crew->bundesland?->label(),
            'join_mode' => $crew->join_mode->value,
            'state' => $state,
            'is_sample' => $crew->is_sample,
            'members' => $crew->members_count,
            'logo' => MediaUrls::at($crew->logo, 160),
            'cover' => MediaUrls::at($crew->cover, 640),
            'cover_placeholder' => MediaUrls::placeholder($crew->cover),
            'founder' => $founder === null ? null : ['id' => $founder->id, 'username' => $founder->username, 'display_name' => $founder->getAttribute('display_name')],
            'open_requests' => $crew->requests()->count(),
            'open_invites' => $crew->invites()->count(),
            'hidden_since' => $removal?->decided_at->toIso8601String() ?? $crew->hidden_at?->toIso8601String(),
            'removed_at' => $crew->removed_at?->toIso8601String(),
            'deleted_at' => $crew->deleted_at?->toIso8601String(),
            'created_at' => $crew->created_at?->toIso8601String(),
            'updated_at' => $crew->updated_at?->toIso8601String(),
            'public_url' => $state === 'active' ? url('/app/crews/'.$crew->slug) : null,
            // What the Staff actions accept (C6); the server checks again.
            'can' => [
                'hide' => $state === 'active',
                'unhide' => $state === 'hidden' && $removal !== null,
                'remove' => $state === 'hidden',
                'restore' => $state === 'removed' && $crew->trashed(),
            ],
        ];
    }

    /**
     * Founder → admins → members, by joined_at (the app's order), the first MEMBERS_SHOWN.
     *
     * @return array{rows: list<array<string, mixed>>, total: int}
     */
    public static function members(Crew $crew): array
    {
        $query = CrewMember::query()->where('crew_id', $crew->id);
        $rows = (clone $query)->with(['user' => fn ($user) => $user->withTrashed()->select(['id', 'username', 'display_name', 'status', 'deleted_at'])])
            ->orderBy('role_rank')->orderBy('joined_at')->orderBy('id')->limit(self::MEMBERS_SHOWN)->get();

        return [
            'rows' => array_values($rows->map(fn (CrewMember $m): array => [
                'id' => $m->id,
                'member' => ['id' => $m->user->id, 'username' => $m->user->username, 'display_name' => $m->user->getAttribute('display_name'), 'status' => $m->user->status->value],
                'role' => $m->role->value,
                'joined_at' => $m->joined_at->toIso8601String(),
            ])->all()),
            'total' => $query->count(),
        ];
    }

    /**
     * The moderation cases on the crew, newest first.
     *
     * @return list<array<string, mixed>>
     */
    public static function cases(Crew $crew): array
    {
        return array_values(self::caseQuery($crew)
            ->with('decision:id,case_id,action,decided_at,reverses_decision_id')
            ->orderByDesc('created_at')->orderByDesc('id')->limit(50)->get()
            ->map(fn (ModerationCase $case): array => [
                'id' => $case->id,
                'origin' => $case->origin->value,
                'status' => $case->status->value,
                'report_count' => $case->report_count,
                'created_at' => $case->created_at?->toIso8601String(),
                'decision' => $case->decision instanceof Decision ? ['action' => $case->decision->action->value, 'decided_at' => $case->decision->decided_at->toIso8601String()] : null,
            ])->all());
    }

    /**
     * The audit targets of the activity column: the crew and the decisions on it.
     *
     * @return array<string, list<string>>
     */
    public static function targets(Crew $crew): array
    {
        return [
            'crew' => [$crew->id],
            'decision' => array_values(Decision::query()->whereIn('case_id', self::caseQuery($crew)->select('id'))->pluck('id')->map(fn (mixed $id): string => (string) $id)->all()),
        ];
    }

    /**
     * @return Builder<ModerationCase>
     */
    private static function caseQuery(Crew $crew): Builder
    {
        return ModerationCase::query()->where('target_type', ReportTargetType::Crew->value)->where('target_id', $crew->id);
    }
}
