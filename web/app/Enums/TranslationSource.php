<?php

namespace App\Enums;

/**
 * What ai.translate translates (POST ai/translate): a vehicle's description, a build update's note, or a message of a conversation the
 * member takes part in.
 */
enum TranslationSource: string
{
    case VehicleDescription = 'vehicle_description';
    case BuildUpdate = 'build_update';
    case Message = 'message';
}
