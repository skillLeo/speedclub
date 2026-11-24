<?php

namespace App\Policies;

/**
 * M5.7: no ability of its own. The raw, deduplicated view events are written by App\Services\Insights\ViewRecorder and pruned by
 * views:prune; nothing ever reads them out to anybody.
 */
class ViewEventPolicy {}
