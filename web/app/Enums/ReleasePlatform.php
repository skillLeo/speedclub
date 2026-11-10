<?php

namespace App\Enums;

enum ReleasePlatform: string
{
    case Android = 'android';
    case Ios = 'ios';
    case Web = 'web';
}
