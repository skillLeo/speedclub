<?php

namespace App\Enums;

/**
 * FOR-01/02 sort chips (10 §7.2): Aktiv (pinned first, then the newest activity), Neu (newest publication), Unbeantwortet (no published
 * reply yet, newest first), Gelöst (a marked solution, newest activity first).
 */
enum ForumThreadSort: string
{
    case Active = 'active';
    case New = 'new';
    case Unanswered = 'unanswered';
    case Solved = 'solved';
}
