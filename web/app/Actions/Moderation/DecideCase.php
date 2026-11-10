<?php

namespace App\Actions\Moderation;

use App\Enums\CaseStatus;
use App\Enums\DecisionAction;
use App\Enums\DecisionRestriction;
use App\Enums\RedressOption;
use App\Enums\ReportSource;
use App\Enums\UserStatus;
use App\Mail\ReportOutcomeMail;
use App\Models\Appeal;
use App\Models\Decision;
use App\Models\ModerationCase;
use App\Models\Report;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Approvals\FourEyes;
use App\Services\Audit\Audit;
use App\Services\Auth\AuthMailer;
use App\Services\Moderation\ContentRemoval;
use App\Services\Moderation\ContentRestoration;
use App\Services\Moderation\DecisionInput;
use App\Services\Moderation\GuestReportMails;
use App\Services\Moderation\SendDecisionMail;
use App\Services\Notifications\Notifier;
use App\Services\PublicPages\OgImages;
use App\Services\PublicPages\SitemapWriter;
use Carbon\CarbonImmutable;
use Closure;
use DomainException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;
use Throwable;

/**
 * The only writer of decisions (m2.6-contract §2), for the Phase 3 admin (ADM-21), the operator command and the seeder. In one
 * transaction under the case's lock: the decision with its statement of reasons, the action (remove_content through ContentRemoval;
 * restrict writes users.restrictions.<messaging|publishing> = {until, decision_id}; suspend sets the status and
 * users.restrictions.suspension the same way), the case closed for new reports, and the audit event (last, as Audit asks).
 *
 * After the commit: files of removed content go, then the affected member hears of a restriction in the app, by an urgent push and by
 * the mandatory e-mail with the full statement of reasons, queued with retries (SendDecisionMail) (02_PRODUCT_SPEC §7, ADR-192); every member who reported the case gets the
 * outcome in the app, and every web notifier with an address gets it by e-mail (Art. 16(5) DSA). A no_action decision is not sent to
 * the affected member, who was never told about the report.
 *
 * M3.2 (m3.2-contract §1): an own-initiative case (origin staff, OwnInitiativeCases) is decided the same way, without reporters. A
 * `reverse` decision lifts the restriction or brings back the content of the decision it names (ContentRestoration, from the snapshot a
 * remove_content decision keeps in decisions.restore), once per decision; the member is told in the app and by e-mail, without
 * redress (nothing to appeal).
 */
class DecideCase
{
    public function __construct(
        private readonly ContentRemoval $removal,
        private readonly ContentRestoration $restoration,
        private readonly Notifier $notifier,
        private readonly AuthMailer $mailer,
        private readonly GuestReportMails $guestMails,
        private readonly OgImages $og,
        private readonly SitemapWriter $sitemap,
    ) {}

    /**
     * @throws DomainException when the case is not open
     * @throws InvalidArgumentException when a restriction has no member to restrict
     * @throws AuthorizationException for a staff suspension outside its approval
     */
    public function handle(ModerationCase $case, DecisionInput $input): Decision
    {
        // A staff suspension runs only inside its `moderation.suspend` approval or the operator command (MF-1, SEC-P3-10).
        FourEyes::suspension($input);

        /** @var array{0: Decision, 1: list<Closure(): void>} $result */
        $result = DB::transaction(fn (): array => $this->decide($case, $input));
        [$decision, $after] = $result;

        // After the outermost commit (at once when there is no outer transaction): a caller that decides inside its own transaction
        // (DeleteVehicleAsStaff, SF-7; an approval) and then rolls back has neither removed files nor told anybody.
        DB::afterCommit(function () use ($decision, $after): void {
            foreach ($after as $work) {
                try {
                    $work();
                } catch (Throwable $exception) {
                    // A file that could not go is retried by media:prune and og:prune; the decision stands.
                    report($exception);
                }
            }

            $this->notify($decision);
        });

        return $decision;
    }

    /**
     * @return array{0: Decision, 1: list<Closure(): void>}
     */
    private function decide(ModerationCase $case, DecisionInput $input): array
    {
        $locked = ModerationCase::query()->whereKey($case->id)->lockForUpdate()->firstOrFail();
        $before = ['case_status' => $locked->status->value, 'report_count' => $locked->report_count];

        if (! $locked->status->isOpen()) {
            throw new DomainException('The case is not open.');
        }

        $subject = $locked->subject_id === null ? null : User::withTrashed()->whereKey($locked->subject_id)->lockForUpdate()->first();

        if (in_array($input->action, [DecisionAction::Restrict, DecisionAction::Suspend], true) && ($subject === null || $subject->trashed())) {
            throw new InvalidArgumentException('There is no account to restrict.');
        }

        $original = $input->action === DecisionAction::Reverse ? $this->reversible($locked, $input) : null;

        $now = now();
        $restriction = match ($input->action) {
            DecisionAction::Restrict => ['type' => $input->restriction?->value, 'until' => $input->until?->toIso8601String()],
            DecisionAction::Suspend => ['type' => DecisionRestriction::Suspension->value, 'until' => $input->until?->toIso8601String()],
            default => null,
        };

        $decision = new Decision;
        $decision->forceFill([
            'case_id' => $locked->id,
            'subject_id' => $locked->subject_id,
            'action' => $input->action,
            'restriction' => $restriction,
            'statement_of_reasons' => [
                'facts' => trim($input->facts),
                'ground' => trim($input->ground),
                'ground_document' => $input->groundDocument->value,
                'ground_section' => $input->groundSection,
                'automated_detection' => $input->automatedDetection,
                'automated_decision' => $input->automatedDecision,
                'redress' => $input->action === DecisionAction::Reverse ? [] : array_map(fn (RedressOption $option): string => $option->value, RedressOption::cases()),
            ],
            'reverses_decision_id' => $original?->id,
            'restore' => $input->action === DecisionAction::RemoveContent ? $this->restoration->snapshot($locked) : null,
            'decided_by' => $input->decidedBy?->getKey(),
            'decided_at' => $now,
            // The in-app rows follow right after the commit and the appeal period runs from here (§ 187(1) BGB); the mail is queued
            // with retries and stamps mailed_at (SendDecisionMail).
            'notified_at' => $now,
        ])->save();

        ['lifted' => $lifted, 'after' => $reversal] = $original === null ? ['lifted' => [], 'after' => []] : $this->restoration->reverse($original, $subject);

        $after = match ($input->action) {
            DecisionAction::RemoveContent => $this->removal->remove($locked),
            DecisionAction::Restrict, DecisionAction::Suspend => $this->restrict($subject, $decision, $restriction),
            DecisionAction::NoAction => [],
            DecisionAction::Reverse => $reversal,
        };

        $locked->forceFill([
            'status' => CaseStatus::Decided,
            'open_target' => null,
            'decided_at' => $now,
            'assigned_staff_id' => $locked->assigned_staff_id ?? $input->decidedBy?->getKey(),
        ])->save();

        Audit::record(
            'moderation.decided',
            $decision,
            $before,
            [
                'case_id' => $locked->id,
                'target_type' => $locked->target_type->value,
                'target_id' => $locked->target_id,
                'subject_id' => $locked->subject_id,
                'action' => $input->action->value,
                'restriction' => $restriction,
                'ground_document' => $input->groundDocument->value,
                'automated_detection' => $input->automatedDetection,
                'automated_decision' => $input->automatedDecision,
                // Four-eyes (M2.6 review #10): the second staff member who approved a suspension.
                'approved_by' => $input->approvedBy?->getKey(),
                // M3.2: own-initiative cases and reversals.
                'origin' => $locked->origin->value,
                'reverses_decision_id' => $original?->id,
                'lifted' => $lifted,
            ],
            $input->reason,
            $input->decidedBy,
        );

        return [$decision, $after];
    }

    /**
     * The decision a reverse decision lifts, under its lock: about the same member and target, one that restricted something, and not
     * reversed before (the unique index on reverses_decision_id has the last word on a race).
     *
     * @throws DomainException
     */
    private function reversible(ModerationCase $case, DecisionInput $input): Decision
    {
        $original = Decision::query()->with('case')->whereKey($input->reverses?->id)->lockForUpdate()->first();
        $source = $original?->case;

        if ($original === null || ! $source instanceof ModerationCase || ! in_array($original->action, [DecisionAction::RemoveContent, DecisionAction::Restrict, DecisionAction::Suspend], true)) {
            throw new DomainException('There is no measure to reverse.');
        }

        if ($original->subject_id !== $case->subject_id || $source->target_type !== $case->target_type || $source->target_id !== $case->target_id) {
            throw new DomainException('A reversal is recorded on a case about the same target.');
        }

        if (Decision::query()->where('reverses_decision_id', $original->id)->exists()) {
            throw new DomainException('This decision has been reversed already.');
        }

        return $original;
    }

    /**
     * @param  array{type: string|null, until: string|null}|null  $restriction
     * @return list<Closure(): void>
     */
    private function restrict(?User $subject, Decision $decision, ?array $restriction): array
    {
        if ($subject === null || $restriction === null || $restriction['type'] === null) {
            return [];
        }

        $restrictions = is_array($subject->restrictions) ? $subject->restrictions : [];
        $current = $restrictions[$restriction['type']] ?? null;

        // A second decision never shortens a restriction in force (M2.6 review #8): the later end wins, and no end date (null) wins over
        // any date. The account keeps the decision whose end applies; the new decision still records its own restriction.
        if (! is_array($current) || ! $this->outlasts($current['until'] ?? null, $restriction['until'])) {
            $restrictions[$restriction['type']] = ['until' => $restriction['until'], 'decision_id' => $decision->id];
        }

        $changes = ['restrictions' => $restrictions];

        if ($restriction['type'] === DecisionRestriction::Suspension->value) {
            $changes['status'] = UserStatus::Suspended;
        }

        $subject->forceFill($changes)->save();

        return $restriction['type'] === DecisionRestriction::Suspension->value ? $this->takeDown($subject) : [];
    }

    /**
     * A suspended member is not public, nor are their vehicles (User::isPubliclyVisible): their OG files go at once and the sitemap is
     * written again, rather than waiting for og:prune and the night (SEC-P1-09, SEC-P1-08). After the commit, each on its own, as a
     * rollback can bring rows back but not files. A lifted suspension draws the files again on the next page view.
     *
     * @return list<Closure(): void>
     */
    private function takeDown(User $member): array
    {
        $work = [fn () => $this->og->purge($member)];

        $vehicles = Vehicle::query()->withoutGlobalScopes()->where('owner_id', $member->id)->whereNotNull('og_image_path')->get();

        foreach ($vehicles as $vehicle) {
            $work[] = fn () => $this->og->purge($vehicle);
        }

        $work[] = fn () => $this->sitemap->forget();

        return $work;
    }

    /**
     * Whether a restriction in force until $current lasts at least as long as one until $new. Null is no end date. A lapsed or
     * unreadable current end does not outlast anything.
     */
    private function outlasts(mixed $current, ?string $new): bool
    {
        if ($current === null) {
            return true;
        }

        if (! is_string($current)) {
            return false;
        }

        try {
            $end = CarbonImmutable::parse($current);
        } catch (Throwable) {
            return false;
        }

        return $end->isFuture() && $new !== null && $end->greaterThanOrEqualTo(CarbonImmutable::parse($new));
    }

    private function webLocale(Report $report): string
    {
        $locale = $report->getAttribute('contact_locale');

        return is_string($locale) && in_array($locale, config()->array('speedclub.locales'), true) ? $locale : config()->string('app.locale');
    }

    private function notify(Decision $decision): void
    {
        $decision->loadMissing('case');
        $subject = $decision->subject_id === null ? null : User::query()->find($decision->subject_id);

        if ($decision->action->concernsMember() && $subject instanceof User) {
            $this->notifier->moderationDecision($subject, $decision);
            SendDecisionMail::dispatch($decision->id);
        }

        $mailed = [];

        Report::query()->where('case_id', $decision->case_id)->with('reporter')->orderBy('created_at')->orderBy('id')->get()
            ->each(function (Report $report) use ($decision, &$mailed): void {
                $reporter = $report->reporter;
                $email = is_string($report->contact_email) ? mb_strtolower($report->contact_email) : '';

                if ($reporter instanceof User && ! $reporter->trashed()) {
                    $this->notifier->reportDecided($reporter, $decision);
                } elseif ($report->source === ReportSource::WebForm && $email !== '' && ! isset($mailed[$email]) && $this->guestMails->allow($email)) {
                    // One outcome mail per address and case, within the per-address daily cap.
                    $mailed[$email] = true;
                    $this->mailer->sendLater($report->contact_email, $this->webLocale($report), new ReportOutcomeMail($decision, $report->id));
                }
            });

        $this->notifyAppealAudience($decision);
    }

    /**
     * M3.4: a case that records the outcome of an overturned appeal (moderation_cases.appeal_id: the reversal, or the new measure after a
     * reporter's appeal against no action) also tells the members who reported the appealed decision's case, and the appellant, the
     * outcome (Art. 20(4) DSA, m3.4-contract §1 "member and reporters notified"). DecisionAudience lets them open it on SAFE-01. The
     * affected member already heard of it above.
     */
    private function notifyAppealAudience(Decision $decision): void
    {
        $case = $decision->case;
        $appeal = $case instanceof ModerationCase && $case->appeal_id !== null ? Appeal::query()->with('decision')->find($case->appeal_id) : null;

        if (! $appeal instanceof Appeal || ! $appeal->decision instanceof Decision) {
            return;
        }

        $ids = Report::query()->where('case_id', $appeal->decision->case_id)->whereNotNull('reporter_id')->pluck('reporter_id')->all();
        $ids[] = $appeal->appellant_id;
        $already = Report::query()->where('case_id', $decision->case_id)->whereNotNull('reporter_id')->pluck('reporter_id')->all();

        foreach (array_unique(array_filter($ids, is_string(...))) as $id) {
            if ($id === $decision->subject_id || in_array($id, $already, true)) {
                continue;
            }

            $member = User::query()->find($id);

            if ($member instanceof User) {
                $this->notifier->reportDecided($member, $decision);
            }
        }
    }
}
