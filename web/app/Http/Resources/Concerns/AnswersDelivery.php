<?php

namespace App\Http\Resources\Concerns;

use App\Http\Middleware\Idempotency;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * A send answers 201 when it wrote something new, 200 with Idempotency-Replayed: true when it handed back an earlier copy.
 */
trait AnswersDelivery
{
    private int $deliveryStatus = 200;

    private bool $deliveryReplayed = false;

    public function delivered(bool $created, bool $replayed): static
    {
        $this->deliveryStatus = $created && ! $replayed ? 201 : 200;
        $this->deliveryReplayed = $replayed;

        return $this;
    }

    /**
     * @param  Request  $request
     * @param  JsonResponse  $response
     */
    public function withResponse($request, $response): void
    {
        $response->setStatusCode($this->deliveryStatus);

        if ($this->deliveryReplayed) {
            $response->headers->set(Idempotency::REPLAYED_HEADER, 'true');
        }
    }
}
