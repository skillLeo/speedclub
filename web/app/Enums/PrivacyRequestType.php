<?php

namespace App\Enums;

/**
 * GDPR requests of ADM-45/46 (08_LEGAL_COMPLIANCE, Art. 15–21 GDPR). Export and erasure reuse the member's SET-12 export and SET-13
 * deletion (m3.6 contract §1).
 */
enum PrivacyRequestType: string
{
    /** Art. 15 Auskunft. */
    case Access = 'access';
    /** Art. 20 Datenübertragbarkeit (Export). */
    case Export = 'export';
    /** Art. 17 Löschung. */
    case Erasure = 'erasure';
    /** Art. 16 Berichtigung. */
    case Rectification = 'rectification';
    /** Art. 21 Widerspruch. */
    case Objection = 'objection';
    /** Art. 18 Einschränkung der Verarbeitung. */
    case Restriction = 'restriction';

    public function article(): int
    {
        return match ($this) {
            self::Access => 15,
            self::Rectification => 16,
            self::Erasure => 17,
            self::Restriction => 18,
            self::Export => 20,
            self::Objection => 21,
        };
    }

    /** Whether the SET-12 export answers it (an Auskunft gets the export as its copy, Art. 15(3)). */
    public function usesExport(): bool
    {
        return in_array($this, [self::Access, self::Export], true);
    }
}
