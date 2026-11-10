<?php

namespace App\Enums;

/**
 * 02_PRODUCT_SPEC §3.6: text (≤ 2000 characters), one photo, or a vehicle card.
 */
enum MessageType: string
{
    case Text = 'text';
    case Photo = 'photo';
    case Vehicle = 'vehicle';
}
