<?php

namespace App\Enums;

/**
 * Redress a statement of reasons names (Art. 17(3)(f) DSA): the internal complaint (Art. 20), a certified out-of-court dispute settlement
 * body (Art. 21) and the courts.
 */
enum RedressOption: string
{
    case InternalComplaint = 'internal_complaint';
    case OutOfCourt = 'out_of_court';
    case Court = 'court';
}
