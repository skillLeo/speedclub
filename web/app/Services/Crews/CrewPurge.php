<?php

namespace App\Services\Crews;

use App\Enums\AppealStatus;
use App\Enums\CrewStatus;
use App\Enums\ReportTargetType;
use App\Models\Crew;
use App\Models\Media;
use App\Models\ModerationCase;
use App\Services\Media\MediaService;
use App\Services\Notifications\Notifier;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * The hard delete of deleted crews (crews:prune, daily): a crew its founder deleted after hard_delete_after_days, one staff deleted
 * (status removed) after removed_retention_days, never while a moderation case about it is open or an appeal against a decision on it is
 * pending (DSA evidence). Logo and cover (their private originals) go first, then the row with its members, requests and invitations.
 * A crew that fails is reported and stays for the next run.
 */
final class CrewPurge
{
    /** Keeps one cron run well below the 50 s window; the rest waits for the next day. */
    public const BATCH = 200;

    public function __construct(private readonly MediaService $media, private readonly Notifier $notifier) {}

    /**
     * @return int the crews hard-deleted
     */
    public function run(int $batch = self::BATCH): int
    {
        $deleted = 0;
        $founderDeleted = now()->subDays(config()->integer('speedclub.crews.hard_delete_after_days'));
        $staffRemoved = now()->subDays(config()->integer('speedclub.crews.removed_retention_days'));

        $crews = Crew::onlyTrashed()
            ->where(fn ($due) => $due
                ->where(fn ($own) => $own->where('status', '!=', CrewStatus::Removed->value)->where('deleted_at', '<', $founderDeleted))
                ->orWhere(fn ($staff) => $staff->where('status', CrewStatus::Removed->value)->where('deleted_at', '<', $staffRemoved)))
            // Nit 6: held crews are left out in SQL, so they never fill the batch and starve the others.
            ->whereNotExists(fn ($open) => $open->selectRaw('1')->from('moderation_cases', 'mc')
                ->where('mc.target_type', ReportTargetType::Crew->value)->whereColumn('mc.target_id', 'crews.id')->whereNotNull('mc.open_target'))
            ->whereNotExists(fn ($appeal) => $appeal->selectRaw('1')->from('appeals', 'ap')
                ->join('decisions as d', 'd.id', '=', 'ap.decision_id')
                ->join('moderation_cases as amc', 'amc.id', '=', 'd.case_id')
                ->where('amc.target_type', ReportTargetType::Crew->value)->whereColumn('amc.target_id', 'crews.id')
                ->where('ap.status', AppealStatus::Open->value))
            ->orderBy('deleted_at')
            ->limit($batch)
            ->get();

        foreach ($crews as $crew) {
            // Checked again row by row: a report may have arrived since the query.
            if ($this->held($crew)) {
                continue;
            }

            try {
                foreach (Media::withTrashed()->whereIn('id', array_values(array_filter([$crew->logo_media_id, $crew->cover_media_id])))->get() as $photo) {
                    $this->media->purge($photo);
                }

                DB::transaction(fn () => $crew->forceDelete());
                // Nit 9: the member's "Du bist jetzt in der Crew" row leads nowhere now.
                $this->notifier->forgetCrew($crew->id, 'request_approved');
                $deleted++;
            } catch (Throwable $exception) {
                report($exception);
            }
        }

        return $deleted;
    }

    /**
     * An open case about the crew, or a pending appeal against a decision of one of its cases.
     */
    public function held(Crew $crew): bool
    {
        if (ModerationCase::query()->where('open_target', ModerationCase::openKey(ReportTargetType::Crew, $crew->id))->exists()) {
            return true;
        }

        return DB::table('appeals')
            ->join('decisions', 'decisions.id', '=', 'appeals.decision_id')
            ->join('moderation_cases', 'moderation_cases.id', '=', 'decisions.case_id')
            ->where('moderation_cases.target_type', ReportTargetType::Crew->value)
            ->where('moderation_cases.target_id', $crew->id)
            ->where('appeals.status', AppealStatus::Open->value)
            ->exists();
    }
}
