<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * M5.9b (contract §1): the 16 German states by their usual two-letter code. Spots, de_cities and users.bundesland store the code.
 */
enum Bundesland: string
{
    use HasLabel;

    case BW = 'BW';
    case BY = 'BY';
    case BE = 'BE';
    case BB = 'BB';
    case HB = 'HB';
    case HH = 'HH';
    case HE = 'HE';
    case MV = 'MV';
    case NI = 'NI';
    case NW = 'NW';
    case RP = 'RP';
    case SL = 'SL';
    case SN = 'SN';
    case ST = 'ST';
    case SH = 'SH';
    case TH = 'TH';
}
