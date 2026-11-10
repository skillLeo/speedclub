<?php

namespace App\Actions\Admin\Moderation;

use App\Enums\ReportSource;
use App\Models\ModerationCase;
use App\Models\Report;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Support\PiiReveals;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * ADM-21 "Anzeigen" (SEC-P3-25, `moderation.view` + `members.view_pii`): the full e-mail address of a web-form notifier (a DSA notice
 * through /melden), which the case page shows masked. Like RevealTicketContact: the daily cap of address reveals first (PiiReveals,
 * shared with the member PII reveal), then the audit event `moderation.contact_viewed` on the case (06 §1: every view of sensitive
 * data). A report of another case, or one without a web contact address, is not found (404).
 */
class RevealReportContact
{
    /**
     * @return array{email: string}
     *
     * @throws AuthorizationException
     */
    public function handle(Staff $staff, ModerationCase $case, string $reportId): array
    {
        StaffAtoms::ensure($staff, 'moderation.view');
        StaffAtoms::ensure($staff, 'members.view_pii');

        $report = Report::query()->whereKey(strtolower($reportId))->where('case_id', $case->id)->where('source', ReportSource::WebForm)->first();
        $email = $report?->contact_email;
        abort_if(! is_string($email) || $email === '', 404);

        PiiReveals::ensureAllowed($staff);

        DB::transaction(fn () => Audit::record('moderation.contact_viewed', $case, after: ['report_id' => $report->id, 'fields' => ['email']], actor: $staff));

        return ['email' => $email];
    }
}
