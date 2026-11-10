<?php

namespace App\Http\Resources\V1;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The signature Pusher expects for a private channel. Answered without the `data` wrapper, as pusher-js reads `auth` at the top.
 *
 * @property array{auth: string} $resource
 */
class ChannelAuthResource extends JsonResource
{
    public static $wrap = null;

    /**
     * @return array{auth: string}
     */
    public function toArray(Request $request): array
    {
        return ['auth' => $this->resource['auth']];
    }
}
