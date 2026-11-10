<?php

namespace App\Http;

use App\Http\Middleware\LimitJsonBody;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\InputBag;

/**
 * Request::capture() decodes a JSON body in the front controller, before the kernel and its first middleware, and a large one ran
 * out of memory right there (SEC-P1-48). This leaves a body over the limit undecoded, so that LimitJsonBody can answer it.
 */
final class BoundedRequest extends Request
{
    /**
     * @param  string|null  $key
     * @param  mixed  $default
     * @return ($key is null ? InputBag<bool|float|int|string> : mixed)
     */
    public function json($key = null, $default = null)
    {
        if (! isset($this->json) && LimitJsonBody::exceeds($this)) {
            $this->json = new InputBag;
        }

        return parent::json($key, $default);
    }
}
