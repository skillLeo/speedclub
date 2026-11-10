<?php

namespace App\Enums;

/** The build targets of scripts/build-apk.ps1 (06_ADMIN_SPEC §3 Configuration & releases). */
enum ReleaseChannel: string
{
    case Lan = 'lan';
    case Staging = 'staging';
    case Production = 'production';
}
