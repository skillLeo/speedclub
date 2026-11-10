<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

enum LegalDocumentKey: string
{
    use HasLabel;

    case Imprint = 'imprint';
    case Privacy = 'privacy';
    case Terms = 'terms';
    case Community = 'community';
    case Licenses = 'licenses';
}
