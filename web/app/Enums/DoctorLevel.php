<?php

namespace App\Enums;

enum DoctorLevel: string
{
    case Ok = 'ok';
    case Warning = 'warning';
    case Blocker = 'blocker';
}
