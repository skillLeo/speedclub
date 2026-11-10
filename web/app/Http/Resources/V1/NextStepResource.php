<?php

namespace App\Http\Resources\V1;

use App\Enums\AuthNextStep;
use App\Support\Auth\NextStep;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The neutral answer: never reveals whether an account exists.
 *
 * @property NextStep $resource
 */
class NextStepResource extends JsonResource
{
    /**
     * @return array{next: AuthNextStep, email: string, resend_after_seconds: int|null}
     */
    public function toArray(Request $request): array
    {
        return [
            'next' => $this->resource->next,
            'email' => $this->resource->email,
            'resend_after_seconds' => $this->resource->resendAfterSeconds,
        ];
    }

    /**
     * @param  Request  $request
     * @param  JsonResponse  $response
     */
    public function withResponse($request, $response): void
    {
        $response->setStatusCode($this->resource->status);
    }
}
