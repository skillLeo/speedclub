<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

enum Aspiration: string
{
    use HasLabel;

    case NaturallyAspirated = 'naturally_aspirated';
    case Turbo = 'turbo';
    case Biturbo = 'biturbo';
    case Supercharged = 'supercharged';
    case Twincharged = 'twincharged';
    case None = 'none';
}
