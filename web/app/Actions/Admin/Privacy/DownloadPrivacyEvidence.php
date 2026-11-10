<?php

namespace App\Actions\Admin\Privacy;

use App\Enums\PrivacyEvent;
use App\Models\PrivacyRequest;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * ADM-46 evidence file (`privacy.view`): streamed from the private disk as a download, audited (who opened which request's file).
 *
 * @throws AuthorizationException|NotFoundHttpException
 */
class DownloadPrivacyEvidence
{
    public function handle(Staff $by, PrivacyRequest $request): StreamedResponse
    {
        StaffAtoms::ensure($by, 'privacy.view');
        $disk = Storage::disk(config()->string('speedclub.media.private_disk'));
        $path = $request->evidence_path;

        if (! is_string($path) || ! $disk->exists($path)) {
            throw new NotFoundHttpException;
        }

        Audit::record(PrivacyEvent::EvidenceViewed->value, $request, actor: $by);

        return $disk->download($path, $request->evidence_name ?? basename($path), ['Cache-Control' => 'no-store, private']);
    }
}
