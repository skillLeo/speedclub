<?php

namespace App\Http\Requests\Api\V1\Garage;

/**
 * Verlauf: a row can hold many rendered changes and guests can ask, so its pages are smaller than the other lists.
 */
class BuildUpdateListRequest extends GarageListRequest
{
    protected const MAX_PAGE_SIZE = 30;
}
