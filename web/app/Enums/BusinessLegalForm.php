<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * The legal form of BIZ-02 and the Impressum (§ 5 DDG). A register entry is expected for every form but the sole trader, the GbR and
 * "other" (BusinessImpressum::needsRegister).
 */
enum BusinessLegalForm: string
{
    use HasLabel;

    case SoleTrader = 'sole_trader';
    case RegisteredMerchant = 'ek';
    case Gbr = 'gbr';
    case Ohg = 'ohg';
    case Kg = 'kg';
    case Gmbh = 'gmbh';
    case GmbhCoKg = 'gmbh_co_kg';
    case Ug = 'ug';
    case Ag = 'ag';
    case Other = 'other';

    public function needsRegister(): bool
    {
        return ! in_array($this, [self::SoleTrader, self::Gbr, self::Other], true);
    }
}
