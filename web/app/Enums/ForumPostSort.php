<?php

namespace App\Enums;

/**
 * FOR-03 replies: in the order they were written, or the most "Hilfreich" first (10 §7.2: the count is visible to sort answers).
 */
enum ForumPostSort: string
{
    case Oldest = 'oldest';
    case Helpful = 'helpful';
}
