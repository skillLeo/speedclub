<?php

namespace App\Http\Middleware;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Services\AppConfig\FeatureFlags;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * A route of a [SIGNATURE] or [AI] feature exists only while its flag is on (02_PRODUCT_SPEC §5), with the rule clients read from
 * app-config. Off: 404 feature_disabled. Use as EnsureFeatureEnabled::class.':sig.saved_builds', after `member` on member routes.
 */
class EnsureFeatureEnabled
{
    public function __construct(private readonly FeatureFlags $flags) {}

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next, string $flag): Response
    {
        if (! $this->flags->enabled($flag)) {
            throw new ApiException(ErrorCode::FeatureDisabled);
        }

        return $next($request);
    }
}
