<?php

namespace App\Services\Approvals\Handlers;

use App\Actions\Admin\Content\PublishLegalDocument;
use App\Models\ApprovalRequest;
use App\Models\LegalDocument;
use App\Models\Staff;
use App\Services\AppConfig\LegalDocuments;
use App\Services\Approvals\ApprovalHandler;
use App\Services\Approvals\FourEyes;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/**
 * legal.publish_reconsent (ADM-31, 06 §2 "publishing AGB/Datenschutz (re-consent)"): publishing a terms or privacy draft that asks every
 * member to accept again. Payload {document_id, version, body_sha256, summary} (MF-3): at approval it must still be an unpublished re-consent
 * draft of terms or privacy with exactly the version, text and summary the request pinned; execute() checks the pins again under the
 * row lock (PublishLegalDocument), so an edited draft is never published on an approval given for another text.
 */
final class PublishLegalWithReconsent implements ApprovalHandler
{
    public function __construct(private readonly PublishLegalDocument $publish) {}

    public function key(): string
    {
        return 'legal.publish_reconsent';
    }

    public function atom(): string
    {
        return 'legal.publish';
    }

    public function requiresOwner(array $payload): bool
    {
        return false;
    }

    public function validate(array $payload): void
    {
        Validator::make($payload, [
            'document_id' => ['required', 'integer'],
            'version' => ['required', 'string'],
            'body_sha256' => ['required', 'string', 'size:64'],
            'summary' => ['present', 'nullable', 'string'],
        ])->validate();
        $document = LegalDocument::query()->whereKey((int) $payload['document_id'])->lockForUpdate()->first();

        if ($document === null || $document->published_at !== null || ! $document->requires_reconsent || ! in_array($document->key, LegalDocuments::RECONSENT, true)
            || ! PublishLegalDocument::matchesPins($document, $payload)) {
            throw ValidationException::withMessages(['document_id' => [(string) __('content.approvals.changed')]]);
        }
    }

    public function describe(array $payload): array
    {
        $document = LegalDocument::query()->find((int) ($payload['document_id'] ?? 0));

        return [
            'title' => 'approvals.legal_publish_reconsent.title',
            'subject_label' => $document === null ? null : $document->key->value.' · '.$document->locale,
            'lines' => [
                // What the request pinned (MF-3), not what the draft says now.
                ['label' => 'approvals.legal_publish_reconsent.version', 'after' => is_string($payload['version'] ?? null) ? $payload['version'] : $document?->version],
                ['label' => 'approvals.legal_publish_reconsent.summary', 'after' => array_key_exists('summary', $payload) ? (is_string($payload['summary']) ? $payload['summary'] : null) : $document?->summary],
            ],
        ];
    }

    public function execute(ApprovalRequest $request, Staff $approver): array
    {
        FourEyes::handler($request, $approver, 'legal.publish_reconsent');
        $requester = Staff::query()->findOrFail($request->requested_by);
        $document = LegalDocument::query()->findOrFail((int) $request->payload['document_id']);

        $published = $this->publish->execute($requester, $approver, $document, $request->reason);

        return ['document_id' => $published->id, 'version' => $published->version];
    }
}
