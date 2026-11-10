<?php

namespace App\Enums;

/**
 * Who reads a decision (SAFE-01): the member it is about (the full statement of reasons) or a member who reported the case (the outcome
 * only). Also the role of an appeal: both may complain (Art. 20(1) DSA).
 */
enum DecisionViewer: string
{
    case Affected = 'affected';
    case Reporter = 'reporter';
}
