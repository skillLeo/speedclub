<?php

namespace App\Actions\Security;

use App\Enums\ErrorCode;
use App\Enums\LegalDocumentKey;
use App\Enums\MemberSecurityEvent;
use App\Exceptions\ApiException;
use App\Models\User;
use App\Services\AppConfig\LegalDocuments;
use App\Services\Audit\Audit;
use App\Services\Content\Consents;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * AUTH-09b "Fast geschafft" (09 §7.2, §8.1): a passwordless account accepts AGB and Datenschutz in their current versions and confirms the
 * minimum age; until then it may create nothing (EnsureCurrentConsent answers terms_required). Each version must be the one published
 * now in the member's language (as at registration), so an app holding an old screen cannot accept a replaced text. Asking again once
 * accepted answers 409 conflict.
 */
final class AcceptOnboardingTerms
{
    public function __construct(private readonly LegalDocuments $documents) {}

    public function handle(User $member, string $termsVersion, string $privacyVersion): User
    {
        if (! $member->isPendingTerms()) {
            throw new ApiException(ErrorCode::Conflict);
        }

        $locale = Consents::locale($member);
        $accepted = [];
        $errors = [];

        foreach ([LegalDocumentKey::Terms->value => $termsVersion, LegalDocumentKey::Privacy->value => $privacyVersion] as $key => $sent) {
            $current = $this->documents->current(LegalDocumentKey::from($key), $locale)?->version;

            if ($current !== null && $sent !== $current) {
                $errors[$key.'_version'] = [(string) __('content.consent.outdated')];

                continue;
            }

            $accepted[$key.'_version'] = $current ?? $sent;
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return DB::transaction(function () use ($member, $accepted): User {
            $locked = User::query()->whereKey($member->getKey())->lockForUpdate()->firstOrFail();

            if (! $locked->isPendingTerms()) {
                throw new ApiException(ErrorCode::Conflict);
            }

            $locked->forceFill([
                ...$accepted,
                'consented_at' => now(),
                'age_confirmed_at' => now(),
                'onboarding_state' => null,
            ])->save();

            Audit::record(MemberSecurityEvent::TermsAccepted->value, $locked, after: [...$accepted, 'age_confirmed' => true], actor: $locked);

            return $locked;
        });
    }
}
