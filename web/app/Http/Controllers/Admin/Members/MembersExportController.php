<?php

namespace App\Http\Controllers\Admin\Members;

use App\Actions\Admin\Members\RecordMemberListExport;
use App\Http\Controllers\Admin\Support\TableProps;
use App\Http\Controllers\Controller;
use App\Models\Staff;
use App\Models\User;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * ADM-09 "CSV" of the current list (m3.2-contract §2, `members.view`): same filters and order as the page, at most MAX_ROWS rows, the
 * addresses masked for everybody (SEC-P3-03). A list with addresses is a PII export: the four-eyes `members.list_export`
 * (MembersListExportRequestController). Audited `member.list_exported` with the filter and the row count.
 */
class MembersExportController extends Controller
{
    public const MAX_ROWS = 5000;

    public function __invoke(Request $request, RecordMemberListExport $record): StreamedResponse
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $query = MemberListQuery::build($request, $staff);
        $total = min((clone $query->getEloquentBuilder())->count(), self::MAX_ROWS);

        $record->handle($staff, TableProps::filters($request), $total);

        $columns = ['id', 'username', 'display_name', 'email_masked', 'status', 'vehicles', 'followers', 'registered_at', 'last_active_at', 'two_factor', 'verified'];

        return response()->streamDownload(function () use ($query, $staff, $columns): void {
            $out = fopen('php://output', 'wb');
            if ($out === false) {
                return;
            }
            fwrite($out, "\u{FEFF}");
            fputcsv($out, $columns, escape: '');

            $query->getEloquentBuilder()->limit(self::MAX_ROWS)->get()->each(function (User $member) use ($out, $staff): void {
                $row = MemberListQuery::rows([$member], $staff)[0];
                fputcsv($out, array_map(self::cell(...), [
                    $row['id'], $row['username'], $row['display_name'], $row['email'], $row['status'],
                    $row['vehicles'], $row['followers'], $row['created_at'], $row['last_seen_at'],
                    $row['two_factor'] ? '1' : '0', $row['verified'] ? '1' : '0',
                ]), escape: '');
            });

            fclose($out);
        }, 'speedclub-mitglieder-'.now('Europe/Berlin')->format('Ymd-Hi').'.csv', [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Cache-Control' => 'no-store, private',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    /** Spreadsheet formula injection: a cell that starts like a formula gets a leading apostrophe. */
    private static function cell(mixed $value): string
    {
        $text = is_scalar($value) ? (string) $value : '';

        return preg_match('/^[=+\-@\t\r]/', $text) === 1 ? "'".$text : $text;
    }
}
