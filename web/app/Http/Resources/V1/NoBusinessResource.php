<?php

namespace App\Http\Resources\V1;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * GET me/business for a member without a business: `{"data": null}`, so BIZ-02 offers the application (asking before applying is
 * no error). Unwrapped, since the body itself is the envelope.
 */
class NoBusinessResource extends JsonResource
{
    /** @var string|null */
    public static $wrap = null;

    public function __construct()
    {
        parent::__construct(null);
    }

    /**
     * @return array{data: null}
     */
    public function toArray(Request $request): array
    {
        return ['data' => null];
    }
}
