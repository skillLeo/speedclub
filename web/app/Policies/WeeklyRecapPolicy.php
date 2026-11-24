<?php

namespace App\Policies;

/**
 * M5.7: no ability of its own. The recap rows are written by the recap:weekly run and read by its mail job and the admin overview
 * only.
 */
class WeeklyRecapPolicy {}
