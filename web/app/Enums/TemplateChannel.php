<?php

namespace App\Enums;

enum TemplateChannel: string
{
    case Mail = 'mail';
    case Push = 'push';
}
