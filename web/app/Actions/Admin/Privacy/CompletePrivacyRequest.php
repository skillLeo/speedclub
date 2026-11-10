<?php

namespace App\Actions\Admin\Privacy;

use App\Enums\PrivacyEvent;
use App\Enums\PrivacyRequestStatus;
use App\Models\PrivacyRequest;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Team\TeamRefused;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * ADM-46 "Abschließen" / "Ablehnen" (`privacy.process`): the evidence of completion is a note (10–5000 characters) or a file (PDF, image,
 * text or ZIP, ≤ speedclub.privacy.evidence_max_kb) on the private disk, or both; a refusal needs the note (its grounds). Final.
 * The file never reaches a public path; DownloadPrivacyEvidence hands it out, audited.
 *
 * @throws AuthorizationException|ValidationException|TeamRefused
 */
class CompletePrivacyRequest
{
    public function handle(Staff $by, PrivacyRequest $request, PrivacyRequestStatus $outcome, ?string $note, ?UploadedFile $evidence = null): void
    {
        StaffAtoms::ensure($by, 'privacy.process');

        if (! $outcome->isFinal()) {
            throw ValidationException::withMessages(['status' => [(string) __('privacy.validation.outcome')]]);
        }

        $note = trim((string) $note) === '' ? null : trim((string) $note);
        Validator::make(['note' => $note, 'evidence' => $evidence], [
            'note' => [$outcome === PrivacyRequestStatus::Rejected ? 'required' : 'nullable', 'string', 'min:10', 'max:5000'],
            'evidence' => ['nullable', 'file', 'max:'.config()->integer('speedclub.privacy.evidence_max_kb'), 'mimes:pdf,png,jpg,jpeg,webp,txt,zip'],
        ])->validate();

        if ($note === null && $evidence === null) {
            throw new TeamRefused('evidence_required');
        }

        $disk = Storage::disk(config()->string('speedclub.media.private_disk'));
        $path = null;

        if ($evidence !== null) {
            $extension = strtolower($evidence->getClientOriginalExtension() ?: ($evidence->extension() ?? 'bin'));
            $path = $disk->putFileAs(config()->string('speedclub.privacy.evidence_directory').'/'.$request->getKey(), $evidence, Str::ulid()->toBase32().'.'.$extension);

            if (! is_string($path)) {
                throw new TeamRefused('evidence_required');
            }
        }

        try {
            DB::transaction(function () use ($by, $request, $outcome, $note, $evidence, $path): void {
                $locked = PrivacyRequest::query()->whereKey($request->getKey())->lockForUpdate()->firstOrFail();

                if ($locked->status->isFinal()) {
                    throw new TeamRefused('final');
                }

                $before = $locked->status;
                $locked->forceFill([
                    'status' => $outcome,
                    'completed_at' => now(),
                    'completed_by' => $by->getKey(),
                    'evidence_note' => $note,
                    'evidence_path' => $path,
                    'evidence_name' => $evidence === null ? null : Str::limit(self::safeName($evidence->getClientOriginalName()), 180, ''),
                ])->save();
                $request->setRawAttributes($locked->getAttributes(), true);

                Audit::record(PrivacyEvent::RequestCompleted->value, $locked,
                    before: ['status' => $before->value],
                    after: ['status' => $outcome->value, 'has_note' => $note !== null, 'has_file' => $path !== null, 'on_time' => ! $locked->due_at->isPast()],
                    actor: $by);
            });
        } catch (\Throwable $failure) {
            if ($path !== null) {
                $disk->delete($path);
            }

            throw $failure;
        }
    }

    private static function safeName(string $name): string
    {
        $clean = (string) preg_replace('/[^\pL\pN ._-]+/u', '_', $name);

        return trim($clean) === '' ? 'evidence' : $clean;
    }
}
