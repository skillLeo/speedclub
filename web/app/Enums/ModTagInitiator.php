<?php

namespace App\Enums;

/**
 * Which side asked first: the build's owner ("Eingebaut von", BIZ-04 for the business to confirm) or the business (BIZ-03 portfolio,
 * for the owner to confirm). The other side's confirmation is the second of the double confirmation.
 */
enum ModTagInitiator: string
{
    case Member = 'member';
    case Business = 'business';
}
