<?php

namespace App\Enums;

/**
 * The member writes the keyword rules check (m3.4-contract §1; SEC-P3-15 adds nickname, mod title and photo caption). Mod notes are private to the owner and not checked. Message bodies are
 * flag only: never blocked, never read by staff unless the automated report puts the message on ADM-22.
 */
enum KeywordField: string
{
    case VehicleDescription = 'vehicle_description';
    case BuildNote = 'build_note';
    case ProfileBio = 'profile_bio';
    case ProfileDisplayName = 'profile_display_name';
    case MessageBody = 'message_body';
    // SEC-P3-15: public too (the nickname also reaches page titles and OG tags); blocked like the description.
    case VehicleNickname = 'vehicle_nickname';
    case ModTitle = 'mod_title';
    case PhotoCaption = 'photo_caption';

    public function mayBlock(): bool
    {
        return $this !== self::MessageBody;
    }
}
