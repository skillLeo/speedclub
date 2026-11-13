<?php

namespace App\Policies;

/**
 * M4.11: internal rows; the rail is read and set through VehiclePolicy (view, update). No member ability, so every check is denied.
 */
class VehicleHighlightPolicy {}
