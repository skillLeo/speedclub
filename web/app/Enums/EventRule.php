<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * The rules checklist of EVT-03 (09 §8.7 "Rules & law", the events section of the community guidelines). legal_only is required on
 * every event; the organiser ticks the others that apply. Shown as "Regeln" on EVT-02 next to the organiser's own rules.
 */
enum EventRule: string
{
    use HasLabel;

    case LegalOnly = 'legal_only';
    case NoRacing = 'no_racing';
    case RespectResidents = 'respect_residents';
    case NoLitter = 'no_litter';
    case PermitsArranged = 'permits_arranged';
}
