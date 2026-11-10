<?php

namespace App\Http\Resources\V1;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * SET-03 step 1, the neutral 202: the same whether or not a code was sent (taken address, cooldown, budget).
 *
 * @property array{email: string, resend_after_seconds: int} $resource
 */
class EmailChangeResource extends JsonResource
{
    /**
     * @return array{email: string, resend_after_seconds: int}
     */
    public function toArray(Request $request): array
    {
        return [
            /** @var string */
            'email' => (string) $this->resource['email'],
            /** @var int Seconds until a new code may be asked for. */
            'resend_after_seconds' => (int) $this->resource['resend_after_seconds'],
        ];
    }

    /**
     * @param  Request  $request
     * @param  JsonResponse  $response
     */
    public function withResponse($request, $response): void
    {
        $response->setStatusCode(202);
        $response->headers->set('Cache-Control', 'no-store, private');
    }
}
