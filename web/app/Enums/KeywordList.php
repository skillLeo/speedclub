<?php

namespace App\Enums;

/**
 * ADM-23 keyword lists (m3.4-contract §1): a member write containing a `block` term is refused (422 content_blocked); one containing a
 * `flag` term goes through and the platform files an automated report, so a person looks at it. Message bodies are only ever flagged.
 */
enum KeywordList: string
{
    case Block = 'block';
    case Flag = 'flag';
}
