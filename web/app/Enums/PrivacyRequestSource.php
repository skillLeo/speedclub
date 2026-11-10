<?php

namespace App\Enums;

/** How a GDPR request reached the team (ADM-45). */
enum PrivacyRequestSource: string
{
    case Email = 'email';
    case Post = 'post';
    case Support = 'support';
    case Other = 'other';
}
