<?php

namespace App\Actions\Moderation;

use App\Enums\CaseStatus;
use App\Enums\ErrorCode;
use App\Enums\IllegalSubReason;
use App\Enums\ReportReason;
use App\Enums\ReportSource;
use App\Exceptions\ApiException;
use App\Models\Message;
use App\Models\ModerationCase;
use App\Models\Report;
use App\Services\Moderation\MessageEvidence;
use App\Services\Moderation\ReportDraft;
use App\Services\Moderation\ResolvedTarget;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * A notice joins the open case of its target, or opens one (one open case per target, m2.6-contract §1). A member reports a target once
 * per open case: again is 409 already_reported, also when two requests race (unique case_id + reporter_id under the case's lock). After
 * a decision a new report opens a new case.
 *
 * The case's priority (ADM-20 queue order) is the highest reason weight of its reports plus 2 for each further distinct reporter (a
 * member, a web address), up to 20 more.
 * M3.4: an automated notice (a keyword rule of the flag list, KeywordFlagger) has no reporter; it joins the case like any other and
 * marks it `automated`, so the decision states that automated means detected the content (Art. 17(3)(c) DSA).
 * For a message, the evidence holds the reported message and, with message_context, up to 5 before and after it (MessageEvidence);
 * for everything else a snapshot of the reported text. Nothing of a report is logged.
 */
class SubmitReport
{
    private const REPEAT_BONUS = 2;

    private const MAX_REPEAT_BONUS = 20;

    public function __construct(private readonly MessageEvidence $messages) {}

    public function handle(ResolvedTarget $target, ReportDraft $draft): Report
    {
        $evidence = ['target' => $target->snapshot];

        if ($target->model instanceof Message && $draft->reporter !== null) {
            $evidence['messages'] = $this->messages->snapshot($target->model, $draft->reporter->id, $draft->messageContext);
        }

        // A case decided between the insert and the lock leaves no open row to join: the second pass opens a new case (review #25).
        for ($attempt = 1; ; $attempt++) {
            try {
                return DB::transaction(fn (): Report => $this->store($target, $draft, $evidence), 3);
            } catch (UniqueConstraintViolationException) {
                throw new ApiException(ErrorCode::AlreadyReported);
            } catch (ModelNotFoundException $exception) {
                if ($attempt >= 2) {
                    throw $exception;
                }
            }
        }
    }

    /**
     * @param  array<string, mixed>  $evidence
     */
    private function store(ResolvedTarget $target, ReportDraft $draft, array $evidence): Report
    {
        $key = ModerationCase::openKey($target->type, $target->id());
        $now = now();

        // Two first reports of one target meet at the unique open_target: one inserts, both then work under its row lock.
        ModerationCase::query()->insertOrIgnore([
            'id' => (new ModerationCase)->newUniqueId(),
            'target_type' => $target->type->value,
            'target_id' => $target->id(),
            'open_target' => $key,
            'subject_id' => $target->subjectId,
            'status' => CaseStatus::New->value,
            'priority' => 0,
            'report_count' => 0,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $case = ModerationCase::query()->where('open_target', $key)->lockForUpdate()->firstOrFail();

        if ($draft->reporter !== null && Report::query()->where('case_id', $case->id)->where('reporter_id', $draft->reporter->id)->exists()) {
            throw new ApiException(ErrorCode::AlreadyReported);
        }

        $report = new Report;
        $report->forceFill([
            'reporter_id' => $draft->reporter?->id,
            'case_id' => $case->id,
            'source' => $draft->source,
            'target_type' => $target->type,
            'target_id' => $target->id(),
            'target_label' => $target->label === '' ? null : $target->label,
            'reason' => $draft->reason,
            'sub_reason' => $draft->reason === ReportReason::Illegal ? $draft->subReason : null,
            'details' => $draft->details === null || trim($draft->details) === '' ? null : trim($draft->details),
            'contact_name' => $draft->contactName,
            'contact_email' => $draft->contactEmail,
            'contact_locale' => $draft->contactEmail === null ? null : $draft->contactLocale,
            'good_faith' => $draft->goodFaith,
            'evidence' => $evidence,
            'created_at' => $now,
        ])->save();

        $reports = Report::query()->where('case_id', $case->id)->get(['reason', 'sub_reason', 'reporter_id', 'contact_email']);
        $weight = $reports->max(fn (Report $row): int => $row->reason->weight($row->sub_reason instanceof IllegalSubReason ? $row->sub_reason : null)) ?? 0;
        // Repeats count people, not submissions (review #23): each member once, each web address once, all anonymous web notices as one.
        $people = $reports->map(fn (Report $row): string => match (true) {
            $row->reporter_id !== null => 'member:'.$row->reporter_id,
            is_string($row->contact_email) && $row->contact_email !== '' => 'email:'.mb_strtolower($row->contact_email),
            default => 'anonymous',
        })->unique()->count();

        $case->forceFill([
            'report_count' => $reports->count(),
            'priority' => $weight + min(self::MAX_REPEAT_BONUS, ($people - 1) * self::REPEAT_BONUS),
            // M3.4: the parts ADM-20 shows next to the priority (CasePriority adds repeat target and age when it reads the queue).
            'reason_weight' => $weight,
            'reporter_count' => $people,
            'automated' => $case->automated || $draft->source === ReportSource::Automated,
            'subject_id' => $case->subject_id ?? $target->subjectId,
        ])->save();

        return $report;
    }
}
