<?php

namespace App\Enums;

/**
 * What can be reported (m2.6-contract §1). The id is the member's username for `member` (resolved to the account on receipt) and the
 * ULID of the row otherwise.
 */
enum ReportTargetType: string
{
    case Member = 'member';
    case Vehicle = 'vehicle';
    case Photo = 'photo';
    case Message = 'message';
    case BuildUpdate = 'build_update';
    case Modification = 'modification';
    // M4.11 [build_comments]: a comment on a build update.
    case Comment = 'comment';
    // M4.12 (09 §8.7): an event ("Illegales Rennen / gefährliches Fahren" among the reasons); its organiser is the subject.
    case Event = 'event';
    // M4.14 (09 §8.10, DSA): a business profile; its owner (the applicant) is the subject.
    case Business = 'business';
    // M5.8 (m5.8-contract D2): a forum post; a thread is reported by its opening post. Its author is the subject.
    case ForumPost = 'forum_post';
    // R4-2.3: a crew (name, description, logo, cover); its founder is the subject.
    case Crew = 'crew';
}
