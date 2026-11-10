<?php

namespace App\Http\Controllers\Admin\Members;

use App\Actions\Admin\Members\DownloadMemberExport;
use App\Http\Controllers\Admin\Support\RecordLookup;
use App\Http\Controllers\Controller;
use App\Models\DataExport;
use App\Models\Staff;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * ADM-10 privacy tab / ADM-43: the ZIP of an approved staff export (members.export), for the staff member who asked for it, within its
 * 24 hours; each download audited by DownloadMemberExport. Anybody else gets 403, a gone or expired file 404.
 */
class MemberExportDownloadController extends Controller
{
    public function __invoke(Request $request, string $member, string $export, DownloadMemberExport $download): StreamedResponse
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $user = RecordLookup::member($member);
        $row = DataExport::query()->whereKey(strtolower($export))->where('user_id', $user->id)->first();
        abort_unless($row instanceof DataExport, 404);

        $path = $download->handle($staff, $row);
        abort_if($path === null, 404);

        return Storage::disk('local')->download($path, 'speedclub-export-'.($user->username ?? $user->id).'-'.now('Europe/Berlin')->format('Ymd').'.zip', [
            'Content-Type' => 'application/zip',
            'Cache-Control' => 'no-store, private',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}
