<?php

namespace App\Policies;

/**
 * M5.9: no ability of its own. Written and read by App\Actions\Ai\SuggestVehicleSpecs; staff delete through
 * App\Actions\Admin\Catalog\DeleteAiSpecSuggestions (catalog.manage).
 */
class AiSpecSuggestionPolicy {}
