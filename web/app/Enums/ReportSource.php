<?php

namespace App\Enums;

/**
 * Where a notice came from: the app's report flow (a member) or WEB-09 /melden (anybody, no account). M3.4: `automated` is a notice
 * the platform filed itself when a member write matched a keyword rule of the flag list (ADM-23); it has no reporter and makes the
 * decision's `automated_detection` true (Art. 17(3)(c) DSA).
 */
enum ReportSource: string
{
    case App = 'app';
    case WebForm = 'web_form';
    case Automated = 'automated';
}
