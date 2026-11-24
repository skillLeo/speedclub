<?php

namespace App\Policies;

/**
 * M5.7: no ability of its own. Rows are written by App\Services\Insights\ViewRecorder and read by Insights (INS-01, owner-only through
 * VehiclePolicy::viewInsights and UserPolicy::viewInsights) and the badge metric only.
 */
class ViewDayPolicy {}
