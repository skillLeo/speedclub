<?php

namespace App\Http\Controllers\Api\V1\Me;

use App\Actions\Me\RequestDataExport;
use App\Enums\ErrorCode;
use App\Enums\MemberSecurityEvent;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Me\PasswordRequest;
use App\Http\Resources\V1\DataExportCollection;
use App\Http\Resources\V1\DataExportResource;
use App\Models\DataExport;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\DataExport\BuildDataExport;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class DataExportController extends Controller
{
    /**
     * Ask for a data export (SET-12).
     *
     * Needs the `password` (422 on it when wrong). Queued at once: a ZIP with JSON of everything stored about the account and the
     * originals of every photo the member uploaded, usually ready within minutes, then a mail with the download link (valid 7 days).
     * One per 24 hours: 429 with `retry_at` and Retry-After. A failed export does not count. Open under every restriction.
     */
    public function store(PasswordRequest $request, RequestDataExport $action): DataExportResource
    {
        /** @var User $user */
        $user = $request->user();

        Gate::authorize('create', DataExport::class);

        /** @status 202 */
        return (new DataExportResource($action->handle($user, $request->string('password')->toString())))->accepted();
    }

    /**
     * My data exports (SET-12).
     *
     * Newest first, at most 20. `download_url` while ready; Cache-Control: no-store, as the signed link is a credential.
     */
    public function index(Request $request): DataExportCollection
    {
        /** @var User $user */
        $user = $request->user();

        Gate::authorize('viewAny', DataExport::class);

        return new DataExportCollection(
            // An export built for staff (M3.2, four-eyes members.export) is not the member's.
            $user->dataExports()->whereNull('requested_by_staff_id')->latest('requested_at')->latest('id')->limit(20)->get(),
        );
    }

    /**
     * Download a data export (SET-12).
     *
     * The signed link of the mail and of `download_url`, valid 7 days: the signature is the credential, so it works in any browser
     * without signing in. Bound to that export and to the owner's sign-ins (SEC-P2-02): a changed or expired link, and one minted before
     * a device was signed out, the password was reset, the address changed or the deletion was asked for: 403. `GET me/exports` gives a
     * remaining session a fresh link. An export that is gone (expired, account hard-deleted): 404.
     *
     * @unauthenticated
     */
    public function download(Request $request, string $export): StreamedResponse
    {
        $row = DataExport::query()->find($export);
        $owner = $row === null ? null : User::withTrashed()->find($row->user_id);

        // A pending deletion keeps the export until its expires_at (lead ruling, amends ADR-203 c); the hard delete removes it.
        if ($row === null || $row->isForStaff() || ! $row->isDownloadable() || ! BuildDataExport::ownerMayExport($owner)) {
            throw new ApiException(ErrorCode::NotFound);
        }

        if (! $owner instanceof User || ! BuildDataExport::linkStillValid($row, $owner, $request->query('c'))) {
            throw new ApiException(ErrorCode::Forbidden, (string) __('errors.export_link_ended'));
        }

        $path = BuildDataExport::zipPath($row);
        $disk = Storage::disk('local');

        if (! $disk->exists($path)) {
            throw new ApiException(ErrorCode::NotFound);
        }

        Audit::record(MemberSecurityEvent::DataExportDownloaded->value, $owner, actor: $owner);

        $date = $row->ready_at?->format('Y-m-d') ?? now()->format('Y-m-d');

        return $disk->download($path, 'speedclub-export-'.$date.'.zip', [
            'Content-Type' => 'application/zip',
            'Cache-Control' => 'no-store, private',
            'X-Robots-Tag' => 'noindex',
        ]);
    }
}
