<?php

namespace App\Policies;

/**
 * M5.7: no ability of its own. The day's key of the viewer hash is written and read by App\Services\Insights\ViewSalts only and never
 * leaves the server.
 */
class ViewSaltPolicy {}
