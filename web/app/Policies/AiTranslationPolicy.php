<?php

namespace App\Policies;

/**
 * M3.7 [AI]: written and read only by App\Services\Ai and App\Actions\Ai, never by a member or a staff route, so every check is denied.
 */
class AiTranslationPolicy {}
