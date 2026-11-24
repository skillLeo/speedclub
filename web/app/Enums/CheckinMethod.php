<?php

namespace App\Enums;

/**
 * M5.6 (m5.6-contract §5.1): how a member checked in. Only the organiser's rotating code for now; no location is ever part of it.
 */
enum CheckinMethod: string
{
    case Code = 'code';
}
