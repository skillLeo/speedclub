<?php

namespace App\Policies;

/**
 * M4.11: internal rows; members reach mentions through the build update or comment they belong to. No member ability, so every check
 * is denied.
 */
class MentionPolicy {}
