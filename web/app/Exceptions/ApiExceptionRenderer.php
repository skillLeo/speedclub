<?php

namespace App\Exceptions;

use App\Enums\ErrorCode;
use App\Http\Middleware\SetLocaleFromHeader;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Throwable;

/**
 * Renders every exception on /api/* as {message, code, errors} (05_ARCHITECTURE §7).
 * Messages always come from lang/{de,en}/errors.php, so framework or debug text never reaches clients.
 */
final class ApiExceptionRenderer
{
    public function render(Throwable $exception, Request $request): ?Response
    {
        if (! $request->is('api', 'api/*')) {
            return null;
        }

        // Routing errors happen before route middleware, so the locale is resolved here as well.
        SetLocaleFromHeader::apply($request);

        return match (true) {
            // Already a finished response, e.g. from abort(response(...)).
            $exception instanceof HttpResponseException => $exception->getResponse(),
            $exception instanceof ApiException => $this->respond(
                $exception->errorCode,
                $exception->getMessage(),
                $exception->errors,
                $exception->headers,
                data: $exception->data,
            ),
            $exception instanceof ValidationException => $this->respond(
                ErrorCode::ValidationFailed,
                errors: $exception->errors(),
            ),
            $exception instanceof AuthenticationException => $this->respond(ErrorCode::Unauthenticated),
            $this->policyCode($exception) !== null => $this->respond($this->policyCode($exception)),
            $exception instanceof HttpExceptionInterface => $this->respond(
                ErrorCode::fromStatus($exception->getStatusCode()),
                headers: $exception->getHeaders(),
                status: $exception->getStatusCode(),
            ),
            default => $this->respond(ErrorCode::ServerError),
        };
    }

    /**
     * A policy names a specific error with Response::deny(code: ...). The framework wraps its exception by the time it
     * gets here. It keeps that code as getCode(), which is 0 without one.
     */
    private function policyCode(Throwable $exception): ?ErrorCode
    {
        $denied = $exception->getPrevious();

        return $denied instanceof AuthorizationException ? ErrorCode::tryFrom((string) $denied->getCode()) : null;
    }

    /**
     * @param  array<array-key, array<int, string>>  $errors
     * @param  array<array-key, mixed>  $headers
     * @param  array<string, mixed>  $data
     */
    private function respond(
        ErrorCode $code,
        ?string $message = null,
        array $errors = [],
        array $headers = [],
        ?int $status = null,
        array $data = [],
    ): JsonResponse {
        return new JsonResponse([
            'message' => $message ?? $code->message(),
            'code' => $code->value,
            'errors' => (object) $errors,
            ...$data,
        ], $status ?? $code->status(), $headers);
    }
}
