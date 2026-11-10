<?php

namespace App\Enums;

/**
 * Why something was reported (m2.6-contract §1). Keys are stable; labels live in lang/{de,en}/safety.php under reasons.
 * Only `illegal` takes a sub-reason (IllegalSubReason) and the good-faith statement of Art. 16(2)(d) DSA.
 */
enum ReportReason: string
{
    case Illegal = 'illegal';
    case Harassment = 'harassment';
    case Nudity = 'nudity';
    case Spam = 'spam';
    case Impersonation = 'impersonation';
    case Other = 'other';

    /**
     * The base of a case's priority (ADM-20 orders the queue by it): illegal content first, then attacks on people.
     */
    public function weight(?IllegalSubReason $sub = null): int
    {
        return match ($this) {
            self::Illegal => $sub?->weight() ?? 40,
            self::Harassment => 30,
            self::Nudity => 30,
            self::Impersonation => 20,
            self::Spam => 10,
            self::Other => 5,
        };
    }
}
