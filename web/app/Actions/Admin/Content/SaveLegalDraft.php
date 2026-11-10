<?php

namespace App\Actions\Admin\Content;

use App\Enums\ApprovalStatus;
use App\Enums\ContentEvent;
use App\Enums\LegalDocumentKey;
use App\Models\ApprovalRequest;
use App\Models\LegalDocument;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\AppConfig\LegalDocuments;
use App\Services\Audit\Audit;
use App\Services\Config\ConfigRefused;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * ADM-31 (`content.edit`; the Content editor may only draft, 06 §2): the one draft of a document and locale (a legal_documents row
 * without published_at), created or updated. `version` is new for the document and locale (legal_version_taken); `requires_reconsent`
 * only exists for AGB and Datenschutz, and then needs the changes `summary` the app's re-consent sheet shows. Markdown is rendered by
 * App\Support\SafeMarkdown, the renderer of SET-17/18 and the Blade legal pages. Refused while a re-consent publish of the draft waits
 * for approval (legal_pending_approval, MF-3). Audited as `legal.draft_saved`.
 */
final class SaveLegalDraft
{
    /**
     * @param  array<string, mixed>  $input  version, body_md, summary?, requires_reconsent?
     *
     * @throws AuthorizationException|ValidationException|ConfigRefused
     */
    public function handle(Staff $staff, LegalDocumentKey $key, string $locale, array $input, ?string $revision = null): LegalDocument
    {
        StaffAtoms::ensure($staff, 'content.edit');
        $reconsentable = in_array($key, LegalDocuments::RECONSENT, true);

        $data = Validator::make([...$input, 'locale' => $locale], [
            'locale' => ['required', Rule::in(config()->array('speedclub.locales'))],
            'version' => ['required', 'string', 'max:32', 'regex:/\A[0-9A-Za-z][0-9A-Za-z.\-]{0,31}\z/'],
            'body_md' => ['required', 'string', 'min:20', 'max:200000'],
            'requires_reconsent' => ['sometimes', 'boolean', $reconsentable ? 'nullable' : 'declined'],
            'summary' => [$reconsentable && ($input['requires_reconsent'] ?? false) === true ? 'required' : 'nullable', 'string', 'max:1000'],
        ])->validate();

        return DB::transaction(function () use ($staff, $key, $locale, $data, $revision): LegalDocument {
            $rows = LegalDocument::query()->where('key', $key)->where('locale', $locale)->lockForUpdate()->get();
            $draft = $rows->first(fn (LegalDocument $row): bool => $row->published_at === null);

            // MF-3: while a re-consent publish of this draft waits for its second person, the text the approver reads stays as it is.
            if ($draft !== null && ApprovalRequest::query()->where('action', 'legal.publish_reconsent')->where('status', ApprovalStatus::Pending)
                ->where('subject_type', $draft->getMorphClass())->where('subject_id', (string) $draft->getKey())->exists()) {
                throw new ConfigRefused('legal_pending_approval', ['version' => $draft->version]);
            }

            // SF-1: the editor sends the revision of the draft it loaded ('' when it started without one); a draft that moved since
            // (another save, another person's new draft) answers 409 instead of being overwritten silently.
            if ($revision !== null && ($draft === null ? $revision !== '' : ! hash_equals(PublishLegalDocument::revision($draft), $revision))) {
                throw new ConfigRefused('stale_revision');
            }

            if ($rows->contains(fn (LegalDocument $row): bool => $row->version === $data['version'] && ! $row->is($draft))) {
                throw new ConfigRefused('legal_version_taken', ['version' => (string) $data['version']]);
            }

            $before = $draft === null ? null : self::describe($draft);
            $draft ??= new LegalDocument(['key' => $key, 'locale' => $locale, 'created_by' => $staff->getKey()]);
            $draft->fill([
                'version' => (string) $data['version'],
                'body_md' => (string) $data['body_md'],
                'requires_reconsent' => (bool) ($data['requires_reconsent'] ?? false),
                'summary' => isset($data['summary']) ? trim((string) $data['summary']) : null,
            ])->save();

            Audit::record(ContentEvent::LegalDraftSaved->value, $draft, before: $before, after: self::describe($draft), actor: $staff);

            return $draft;
        });
    }

    /**
     * @return array<string, mixed>
     */
    public static function describe(LegalDocument $document): array
    {
        return [
            'key' => $document->key->value,
            'locale' => $document->locale,
            'version' => $document->version,
            'requires_reconsent' => $document->requires_reconsent,
            'summary' => $document->summary,
            'body_sha256' => hash('sha256', $document->body_md),
        ];
    }
}
