<?php

namespace App\Services\Moderation;

use App\Enums\ReportTargetType;
use App\Models\BuildUpdate;
use App\Models\Business;
use App\Models\Comment;
use App\Models\Event;
use App\Models\Media;
use App\Models\Message;
use App\Models\ModerationCase;
use App\Models\Modification;
use App\Models\User;
use App\Models\Vehicle;

/**
 * The row a case is about, as it is now (also hidden, withdrawn or removed content, for staff), or null when it is gone.
 */
final class CaseTargets
{
    public static function model(ModerationCase $case): User|Vehicle|Media|BuildUpdate|Modification|Message|Comment|Event|Business|null
    {
        $id = $case->target_id;

        return match ($case->target_type) {
            ReportTargetType::Member => User::withTrashed()->find($id),
            ReportTargetType::Vehicle => Vehicle::query()->withoutGlobalScopes()->find($id),
            ReportTargetType::Photo => Media::query()->withoutGlobalScopes()->find($id),
            ReportTargetType::BuildUpdate => BuildUpdate::query()->withoutGlobalScopes()->find($id),
            ReportTargetType::Modification => Modification::query()->withoutGlobalScopes()->find($id),
            ReportTargetType::Message => Message::query()->withoutGlobalScopes()->find($id),
            ReportTargetType::Comment => Comment::query()->withoutGlobalScopes()->find($id),
            ReportTargetType::Event => Event::query()->find($id),
            ReportTargetType::Business => Business::query()->find($id),
        };
    }
}
