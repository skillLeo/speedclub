<?php

namespace App\Enums;

/**
 * The segments of HOME-01: "Für dich" (ranked, guests too) and "Folge ich" (chronological, members only).
 */
enum FeedTab: string
{
    case ForYou = 'for_you';
    case Following = 'following';
}
