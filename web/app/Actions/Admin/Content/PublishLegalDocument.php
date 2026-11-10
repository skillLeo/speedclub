<?php

namespace App\Actions\Admin\Content;

use App\Enums\ContentEvent;
use App\Models\LegalDocument;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\AppConfig\AppConfig;
use App\Services\AppConfig\LegalDocuments;
use App\Services\Approvals\Approvals;
use App\Services\Approvals\FourEyes;
use App\Services\Audit\Audit;
use App\Services\Catalog\Reason;
use App\Services\Config\ConfigRefused;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ADM-31 "Veröffentlichen" ⚿ (`legal.publish`, reason): the draft becomes the current text (published_at now), SET-17/18, the Blade
 * pages and app-config's legal_versions follow at once (AppConfig flushed). A terms or privacy draft that requires re-consent is
 * four-eyes (`legal.publish_reconsent`, 06 §2): the approval is requested, its handler calls execute(). Once it is live, app-config's
 * legal_reconsent names its version and GET me/consents asks every member who accepted an older one (ConsentController).
 * Audited as `legal.published` (previous and new version, requester and approver).
 */
final class PublishLegalDocument
{
    public function __construct(private readonly Approvals $approvals, private readonly AppConfig $appConfig, private readonly LegalDocuments $documents) {}

    /**
     * @throws AuthorizationException|ValidationException|ConfigRefused
     */
    public function handle(Staff $staff, LegalDocument $draft, string $reason, string $revision): LegalOutcome
    {
        StaffAtoms::ensure($staff, 'legal.publish');
        $reason = Reason::required($reason);

        if ($draft->published_at !== null) {
            throw new ConfigRefused('legal_not_draft');
        }

        if ($draft->requires_reconsent && in_array($draft->key, LegalDocuments::RECONSENT, true)) {
            // MF-3 (M3.4 batch review): the approval pins what the approver reads; an edited draft no longer matches it. Code review
            // phase-3-final SF-4: and what it pins is the locked row the requester saw (their revision), not the model the controller
            // loaded, so an approval can never be requested for a text the requester never read.
            return DB::transaction(function () use ($staff, $draft, $reason, $revision): LegalOutcome {
                $locked = LegalDocument::query()->whereKey($draft->id)->lockForUpdate()->first();

                if ($locked === null || $locked->published_at !== null) {
                    throw new ConfigRefused('legal_not_draft');
                }

                if (! hash_equals(self::revision($locked), $revision)) {
                    throw new ConfigRefused('stale_revision');
                }

                return new LegalOutcome(approval: $this->approvals->request('legal.publish_reconsent', [
                    'document_id' => $locked->id,
                    ...self::pins($locked),
                ], $reason, $staff, $locked));
            });
        }

        return new LegalOutcome($this->run($staff, null, $draft, $reason, null, $revision));
    }

    /**
     * The draft's revision as the page saw it (code review SF-1): every field a member reads and the re-consent flag, hashed. A save
     * or a publish that carries an older one answers 409 stale_revision, so nobody overwrites or publishes a text they did not see.
     */
    public static function revision(LegalDocument $document): string
    {
        return hash('sha256', implode("\0", [$document->version, $document->body_md, (string) $document->summary, $document->requires_reconsent ? '1' : '0']));
    }

    /**
     * The approved re-consent publish: only from the `legal.publish_reconsent` handler inside its approval (FourEyes).
     *
     * @throws AuthorizationException|ConfigRefused
     */
    public function execute(Staff $requester, Staff $approver, LegalDocument $draft, string $reason): LegalDocument
    {
        $request = FourEyes::executor(['legal.publish_reconsent'], $requester, $approver, 'legal.publish');

        if ((int) ($request->payload['document_id'] ?? 0) !== $draft->id) {
            throw new AuthorizationException('The approval names another document.');
        }

        return $this->run($requester, $approver, $draft, $reason, $request->payload);
    }

    /**
     * What a re-consent approval pins (MF-3): the version, the text's hash and the changes summary the approver read. execute() re-checks
     * them under the row lock, so an edited draft can never go live on an approval given for another text.
     *
     * @return array{version: string, body_sha256: string, summary: string|null}
     */
    public static function pins(LegalDocument $document): array
    {
        return [
            'version' => $document->version,
            'body_sha256' => hash('sha256', $document->body_md),
            'summary' => $document->summary,
        ];
    }

    /**
     * Whether the document is still what the approval pinned.
     *
     * @param  array<string, mixed>  $payload
     */
    public static function matchesPins(LegalDocument $document, array $payload): bool
    {
        $pins = self::pins($document);

        return array_key_exists('version', $payload) && array_key_exists('body_sha256', $payload) && array_key_exists('summary', $payload)
            && $payload['version'] === $pins['version']
            && is_string($payload['body_sha256']) && hash_equals($pins['body_sha256'], $payload['body_sha256'])
            && $payload['summary'] === $pins['summary'];
    }

    /**
     * @param  array<string, mixed>|null  $pinned  the approval payload, for a four-eyes publish
     * @param  string|null  $revision  the requester's revision, mandatory on the direct path (SF-4); the four-eyes path checks the pins
     */
    private function run(Staff $requester, ?Staff $approver, LegalDocument $draft, string $reason, ?array $pinned = null, ?string $revision = null): LegalDocument
    {
        return DB::transaction(function () use ($requester, $approver, $draft, $reason, $pinned, $revision): LegalDocument {
            $locked = LegalDocument::query()->whereKey($draft->id)->lockForUpdate()->first();

            if ($locked === null || $locked->published_at !== null) {
                throw new ConfigRefused('legal_not_draft');
            }

            if ($pinned !== null && (! $locked->requires_reconsent || ! self::matchesPins($locked, $pinned))) {
                throw new ConfigRefused('legal_changed');
            }

            // SF-1: the direct path decides from the locked row. A draft that asks for re-consent never goes live without its second
            // person, even when it was saved so between the page's load and this lock; and only the text the publisher saw goes live.
            if ($pinned === null && $locked->requires_reconsent && in_array($locked->key, LegalDocuments::RECONSENT, true)) {
                throw new ConfigRefused('approval_required');
            }

            if ($pinned === null && ($revision === null || ! hash_equals(self::revision($locked), $revision))) {
                throw new ConfigRefused('stale_revision');
            }

            $previous = $this->documents->current($locked->key, $locked->locale);

            $locked->forceFill([
                'published_at' => now(),
                'published_by' => ($approver ?? $requester)->getKey(),
                'reason' => $reason,
            ])->save();

            DB::afterCommit(fn () => $this->appConfig->flush());

            Audit::record(ContentEvent::LegalPublished->value, $locked,
                before: ['key' => $locked->key->value, 'locale' => $locked->locale, 'version' => $previous?->version],
                after: [...SaveLegalDraft::describe($locked), 'requested_by' => $requester->getKey(), 'approved_by' => $approver?->getKey()],
                reason: $reason, actor: $approver ?? $requester);

            return $locked;
        });
    }
}
