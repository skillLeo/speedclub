<?php

namespace App\Enums;

/**
 * The template replies of ADM-46 (DE/EN, lang privacy.reply.<value>): receipt, a request for identity or details, the Art. 12(3)
 * extension notice, completion, refusal (with the redress the GDPR names: supervisory authority, court).
 */
enum PrivacyReplyTemplate: string
{
    case Received = 'received';
    case Identity = 'identity';
    case Extension = 'extension';
    case Completed = 'completed';
    case Rejected = 'rejected';
}
