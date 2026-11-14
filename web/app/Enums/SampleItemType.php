<?php

namespace App\Enums;

/**
 * ADM-58 (09 §8.19): the sample items staff can hide one by one while editorial_samples stays on.
 */
enum SampleItemType: string
{
    case Vehicle = 'vehicle';
    case Event = 'event';
    case Business = 'business';
}
