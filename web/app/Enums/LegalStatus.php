<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

enum LegalStatus: string
{
    use HasLabel;

    case Abe = 'abe';
    case PartsCertificate = 'parts_certificate';
    case Registered = 'registered';
    case IndividualApproval = 'individual_approval';
    case NotRequired = 'not_required';
    case Unknown = 'unknown';
}
