<?php

namespace App\Actions\Me;

use App\Enums\ContentEvent;
use App\Enums\LegalDocumentKey;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\Content\Consents;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * POST me/consents (the app's re-consent sheet, ADM-31): the member accepts the current version of AGB and/or Datenschutz. Each version
 * sent must be exactly the one GET me/consents offers now (Consents::offeredVersion(): their language when that text clears the
 * re-consent, else German); any other is refused (422), so an app holding a stale sheet cannot accept a text that was replaced
 * meanwhile, and accepting what was offered always clears the re-consent. Writes the version and consented_at; a member security event
 * `member.consent_accepted` (before/after versions) in the audit chain.
 */
final class AcceptLegalConsents
{
    public function __construct(private readonly Consents $consents) {}

    /**
     * @param  array{terms_version?: string|null, privacy_version?: string|null}  $input
     *
     * @throws ValidationException
     */
    public function handle(User $member, array $input): User
    {
        $changes = [];
        $errors = [];

        foreach ([LegalDocumentKey::Terms, LegalDocumentKey::Privacy] as $key) {
            $sent = $input[$key->value.'_version'] ?? null;

            if (! is_string($sent)) {
                continue;
            }

            if ($sent !== $this->consents->offeredVersion($member, $key)) {
                $errors[$key->value.'_version'] = [(string) __('content.consent.outdated')];

                continue;
            }

            $changes[Consents::column($key)] = $sent;
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return DB::transaction(function () use ($member, $changes): User {
            $locked = User::query()->whereKey($member->getKey())->lockForUpdate()->firstOrFail();
            $before = array_intersect_key($locked->only(['terms_version', 'privacy_version']), $changes);

            $locked->forceFill([...$changes, 'consented_at' => now()])->save();

            Audit::record(ContentEvent::ConsentAccepted->value, $locked, before: $before, after: $changes, actor: $locked);

            return $locked;
        });
    }
}
