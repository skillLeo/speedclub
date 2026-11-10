<?php

namespace App\Http\Middleware;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\IdempotencyKey;
use App\Models\User;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Arr;
use Illuminate\Support\Carbon;
use Symfony\Component\HttpFoundation\Response;

/**
 * Creating POSTs may send Idempotency-Key (05_ARCHITECTURE §7). Scope: member + concrete path + key.
 *
 * Only finished work is remembered. A failed attempt (4xx, 5xx) changed nothing, so its row goes and the client may
 * fix the request or retry with the same key. Requests without the header, and guests, pass through untouched.
 */
class Idempotency
{
    public const HEADER = 'Idempotency-Key';

    public const REPLAYED_HEADER = 'Idempotency-Replayed';

    private const REPLAYED_HEADERS = ['Content-Type', 'Location', 'ETag'];

    /** Input fields that never enter the fingerprint (SEC-P2-01). */
    public const SECRET_FIELDS = ['password', 'current_password', 'password_confirmation', 'new_password', 'code', 'recovery_code', 'one_time_password'];

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $key = $request->header(self::HEADER);
        $user = $request->user();

        if (! is_string($key) || $key === '' || ! $user instanceof User) {
            return $next($request);
        }

        self::assertValidKey($key);

        $route = $this->scope($request);
        $hash = $this->fingerprint($request);
        $replay = $this->claim($user, $route, $key, $hash);

        if ($replay !== null) {
            return $replay;
        }

        $response = $next($request);
        $record = IdempotencyKey::query()->where(['user_id' => $user->id, 'route' => $route, 'key' => $key]);

        if ($response->isSuccessful() && $response instanceof JsonResponse) {
            $record->update([
                'response_status' => $response->getStatusCode(),
                'response_body' => $response->getContent(),
                'response_headers' => $this->storedHeaders($response),
            ]);
        } else {
            $record->delete();
        }

        return $response;
    }

    /**
     * The key of a request that dedupes by itself (messages: App\Actions\Messaging\DeliverMessage), checked as this middleware checks it.
     */
    public static function keyOf(Request $request): ?string
    {
        $key = $request->header(self::HEADER);

        if (! is_string($key) || $key === '') {
            return null;
        }

        self::assertValidKey($key);

        return $key;
    }

    private static function assertValidKey(string $key): void
    {
        if (strlen($key) > config()->integer('speedclub.idempotency.max_key_length') || preg_match('/\A[\x21-\x7E]+\z/', $key) !== 1) {
            throw new ApiException(ErrorCode::BadRequest, (string) __('errors.idempotency_key_invalid'));
        }
    }

    /**
     * The unique index decides who is first, so concurrent duplicates cannot both run.
     * Returns the response to send when this request is not the first.
     */
    private function claim(User $user, string $route, string $key, string $hash): ?Response
    {
        $now = Carbon::now();
        $identity = ['user_id' => $user->id, 'route' => $route, 'key' => $key];
        $row = [
            ...$identity,
            'request_hash' => $hash,
            'expires_at' => $now->copy()->addHours(config()->integer('speedclub.idempotency.ttl_hours')),
            'created_at' => $now,
            'updated_at' => $now,
        ];

        if (IdempotencyKey::query()->insertOrIgnore($row) === 1) {
            return null;
        }

        $existing = IdempotencyKey::query()->where($identity)->first();

        // Gone between the insert and the read, or expired or abandoned: try once more to become the first.
        if ($existing === null || $this->isDead($existing, $now)) {
            $existing?->delete();

            if (IdempotencyKey::query()->insertOrIgnore($row) === 1) {
                return null;
            }

            throw $this->inFlight();
        }

        if ($existing->getAttribute('request_hash') !== $hash) {
            throw new ApiException(ErrorCode::IdempotencyKeyReused);
        }

        $status = $existing->getAttribute('response_status');

        if (! is_int($status)) {
            throw $this->inFlight();
        }

        /** @var array<string, string> $headers */
        $headers = $existing->getAttribute('response_headers') ?? [];
        $body = $existing->getAttribute('response_body');

        return new Response(is_string($body) ? $body : '', $status, [...$headers, self::REPLAYED_HEADER => 'true']);
    }

    private function isDead(IdempotencyKey $existing, Carbon $now): bool
    {
        /** @var Carbon $expires */
        $expires = $existing->getAttribute('expires_at');
        /** @var Carbon|null $created */
        $created = $existing->getAttribute('created_at');

        return $expires->lessThan($now) || (
            $existing->getAttribute('response_status') === null
            && $created?->diffInSeconds($now) > config()->integer('speedclub.idempotency.in_flight_timeout_seconds')
        );
    }

    private function inFlight(): ApiException
    {
        return new ApiException(
            ErrorCode::Conflict,
            (string) __('errors.idempotency_in_flight'),
            headers: ['Retry-After' => (string) config()->integer('speedclub.idempotency.retry_after_seconds')],
        );
    }

    /**
     * Fits the column whatever the path length.
     */
    private function scope(Request $request): string
    {
        $scope = $request->method().' '.$request->path();

        return strlen($scope) <= 191 ? $scope : $request->method().' '.hash('sha256', $scope);
    }

    /**
     * What tells a retry from another request with the same key: the input and the files' hashes. Never a secret (SEC-P2-01): a password
     * or code is left out at any depth, and the rest is keyed with the app key, so the column holds no fast hash of anything a member
     * typed. A retry that differs only in a secret counts as the same request; it changes nothing that the first one did not.
     */
    private function fingerprint(Request $request): string
    {
        $files = array_map(
            fn (UploadedFile $file): string => (string) hash_file('sha256', $file->getRealPath()),
            array_filter(Arr::flatten($request->allFiles()), fn (mixed $file): bool => $file instanceof UploadedFile && $file->isValid()),
        );

        return hash_hmac('sha256', (string) json_encode([self::withoutSecrets($request->input()), array_values($files)]), (string) config('app.key'));
    }

    /**
     * @param  array<array-key, mixed>  $input
     * @return array<array-key, mixed>
     */
    private static function withoutSecrets(array $input): array
    {
        $kept = [];

        foreach ($input as $name => $value) {
            if (is_string($name) && in_array(strtolower($name), self::SECRET_FIELDS, true)) {
                continue;
            }

            $kept[$name] = is_array($value) ? self::withoutSecrets($value) : $value;
        }

        return $kept;
    }

    /**
     * @return array<string, string>
     */
    private function storedHeaders(Response $response): array
    {
        $headers = [];

        foreach (self::REPLAYED_HEADERS as $name) {
            $value = $response->headers->get($name);

            if ($value !== null) {
                $headers[$name] = $value;
            }
        }

        return $headers;
    }
}
