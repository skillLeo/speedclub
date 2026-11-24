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
    // M4.11 [build_comments]: public like a build note, so blocked like it.
    case Comment = 'comment';
    // M4.12: an event's title, description and organiser rules; public, so blocked like a build note.
    case EventText = 'event_text';
    // M5.4: the custom line of a sticker design; printed on a car in public, so blocked like a build note.
    case StickerLine = 'sticker_line';
    // M5.8: a forum thread's title, tags and the text of a forum post; public, so blocked like a build note.
    case ForumText = 'forum_text';
    // R4-2.3: a crew's name and description; public, so blocked like a build note.
    case CrewText = 'crew_text';
    // R5-2e VEH-07 2.0: the own line of a share card; shared as a picture, so blocked like a build note (never stored publicly, so no flag
    // report: only the block hits count).
    case ShareCardText = 'share_card_text';

    public function mayBlock(): bool
    {
        return $this !== self::MessageBody;
    }
}
