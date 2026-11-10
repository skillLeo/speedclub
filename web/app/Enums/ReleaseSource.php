<?php

namespace App\Enums;

enum ReleaseSource: string
{
    case Manual = 'manual';
    case Sync = 'sync';
}
