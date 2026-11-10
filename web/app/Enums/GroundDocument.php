<?php

namespace App\Enums;

/**
 * Where the ground of a decision is written (Art. 17(3)(d), (e) DSA): the community guidelines, the terms (both legal documents of
 * SET-18) or the law alone.
 */
enum GroundDocument: string
{
    case Community = 'community';
    case Terms = 'terms';
    case Law = 'law';

    public function legalDocument(): ?LegalDocumentKey
    {
        return match ($this) {
            self::Community => LegalDocumentKey::Community,
            self::Terms => LegalDocumentKey::Terms,
            self::Law => null,
        };
    }
}
