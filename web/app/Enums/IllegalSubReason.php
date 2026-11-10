<?php

namespace App\Enums;

/**
 * The kind of illegal content (m2.6-contract §1): glorifying or organising street racing (§ 315d StGB), hate speech, privacy
 * (doxxing), copyright (stolen photos), anything else that is against the law.
 */
enum IllegalSubReason: string
{
    case StreetRacing = 'street_racing';
    case HateSpeech = 'hate_speech';
    case Privacy = 'privacy';
    case Copyright = 'copyright';
    case OtherIllegal = 'other_illegal';

    public function weight(): int
    {
        return match ($this) {
            self::HateSpeech, self::Privacy => 50,
            self::StreetRacing => 45,
            self::Copyright, self::OtherIllegal => 40,
        };
    }
}
