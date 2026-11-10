<?php

namespace App\Http\OpenApi;

use App\Http\Middleware\EnsureFeatureEnabled;
use App\Http\Middleware\LimitJsonBody;
use Dedoc\Scramble\Extensions\OperationExtension;
use Dedoc\Scramble\Support\Generator\Combined\AnyOf;
use Dedoc\Scramble\Support\Generator\Header;
use Dedoc\Scramble\Support\Generator\Operation;
use Dedoc\Scramble\Support\Generator\Parameter;
use Dedoc\Scramble\Support\Generator\Reference;
use Dedoc\Scramble\Support\Generator\Response;
use Dedoc\Scramble\Support\Generator\Schema;
use Dedoc\Scramble\Support\Generator\Types\IntegerType;
use Dedoc\Scramble\Support\Generator\Types\StringType;
use Dedoc\Scramble\Support\RouteInfo;

/**
 * The headers and answers our middleware adds, which are invisible in the controller method Scramble analyses.
 */
class MiddlewareResponses extends OperationExtension
{
    /** Thrown deep inside an action, by route name. */
    private const ROUTE_ERRORS = [
        'api.v1.vehicles.media.store' => [
            413 => 'Larger than the upload limit.',
            415 => 'Not really a JPEG, PNG or WebP.',
        ],
        'api.v1.mods.media.store' => [
            413 => 'Larger than the upload limit.',
            415 => 'Not really a JPEG, PNG or WebP.',
        ],
        'api.v1.me.avatar' => [
            413 => 'Larger than the upload limit.',
            415 => 'Not really a JPEG, PNG or WebP.',
        ],
        'api.v1.me.cover' => [
            413 => 'Larger than the upload limit.',
            415 => 'Not really a JPEG, PNG or WebP.',
        ],
        'api.v1.conversations.media.store' => [
            413 => 'Larger than the upload limit.',
            415 => 'Not really a JPEG, PNG or WebP.',
        ],
    ];

    /**
     * The same, where the body has fields of its own: route name, status, description, the bodies it can be.
     */
    private const ROUTE_ERROR_BODIES = [
        'api.v1.feed' => [
            401 => ['tab=following for a guest, before anything else is checked.', [ApiDocumentation::UNAUTHENTICATED]],
            403 => ['tab=following for a deactivated account.', [ApiDocumentation::FORBIDDEN]],
            409 => ['feed_stale: the ranking this for_you cursor paged on has been replaced since (home:rank). Reload the stream from the top.', [ApiDocumentation::FEED_STALE]],
        ],
        'api.v1.public.users.show' => [
            404 => ['member_unavailable: no such name, or nobody the viewer may see (unverified, suspended, deactivated, a block either way). The same for all of them.', [ApiDocumentation::MEMBER_UNAVAILABLE]],
        ],
        'api.v1.public.users.vehicles' => [
            404 => ['member_unavailable: no such name, or nobody the viewer may see (unverified, suspended, deactivated, a block either way). The same for all of them.', [ApiDocumentation::MEMBER_UNAVAILABLE]],
        ],
        'api.v1.public.users.followers' => [
            404 => ['member_unavailable: no such name, or nobody the viewer may see (unverified, suspended, deactivated, a block either way). The same for all of them.', [ApiDocumentation::MEMBER_UNAVAILABLE]],
        ],
        'api.v1.public.users.following' => [
            404 => ['member_unavailable: no such name, or nobody the viewer may see (unverified, suspended, deactivated, a block either way). The same for all of them.', [ApiDocumentation::MEMBER_UNAVAILABLE]],
        ],
        'api.v1.follows.store' => [
            404 => ['member_unavailable: no such name, or nobody the viewer may see (unverified, suspended, deactivated, a block either way). The same for all of them.', [ApiDocumentation::MEMBER_UNAVAILABLE]],
        ],
        'api.v1.blocks.store' => [
            404 => ['member_unavailable: no account has this name. Never because of a block.', [ApiDocumentation::MEMBER_UNAVAILABLE]],
            422 => ['validation_failed: blocking yourself.', [ApiDocumentation::VALIDATION]],
        ],
        'api.v1.saves.store' => [
            404 => ['vehicle_unavailable as on the vehicle page, or feature_disabled while sig.saved_builds is off.', [ApiDocumentation::VEHICLE_UNAVAILABLE, ApiDocumentation::FEATURE_DISABLED]],
        ],
        'api.v1.auth.login' => [
            401 => ['invalid_credentials: wrong password or unknown address.', [ApiDocumentation::INVALID_CREDENTIALS]],
            403 => ['account_restricted (with until) or password_change_required (with next and email).', [ApiDocumentation::ACCOUNT_RESTRICTED, ApiDocumentation::PASSWORD_CHANGE_REQUIRED]],
        ],
        'api.v1.auth.email.verify' => [
            403 => ['account_restricted (with until) or password_change_required (with next and email).', [ApiDocumentation::ACCOUNT_RESTRICTED, ApiDocumentation::PASSWORD_CHANGE_REQUIRED]],
        ],
        'api.v1.auth.token.rotate' => [
            403 => ['account_restricted (with until) or password_change_required (with next and email).', [ApiDocumentation::ACCOUNT_RESTRICTED, ApiDocumentation::PASSWORD_CHANGE_REQUIRED]],
            409 => ['token_rotation_not_due (with retry_at), or conflict for a cookie session or a token a parallel call already rotated.', [ApiDocumentation::TOKEN_ROTATION_NOT_DUE, ApiDocumentation::CONFLICT]],
        ],
        'api.v1.vehicles.publish' => [
            422 => ['vehicle_incomplete with the list of what is missing, or validation_failed.', [ApiDocumentation::VEHICLE_INCOMPLETE, ApiDocumentation::VALIDATION]],
        ],
        'api.v1.public.vehicles.show' => [
            404 => ['vehicle_unavailable: private, deleted, draft, owner not public, a block, or nothing there. The same for all of them.', [ApiDocumentation::VEHICLE_UNAVAILABLE]],
        ],
        'api.v1.public.vehicles.mods.show' => [
            404 => ['vehicle_unavailable as on the vehicle page, or not_found for this entry.', [ApiDocumentation::VEHICLE_UNAVAILABLE, ApiDocumentation::ERROR_SCHEMA]],
        ],
        'api.v1.public.vehicles.updates.show' => [
            404 => ['vehicle_unavailable as on the vehicle page, or not_found for this entry; a hidden entry for anybody but the owner.', [ApiDocumentation::VEHICLE_UNAVAILABLE, ApiDocumentation::ERROR_SCHEMA]],
        ],
        'api.v1.public.vehicles.updates.index' => [
            404 => ['vehicle_unavailable as on the vehicle page.', [ApiDocumentation::VEHICLE_UNAVAILABLE]],
        ],
        'api.v1.updates.update' => [
            403 => ['account_restricted (with until) only when showing an entry again, as hiding stays open; password_change_required, or forbidden for anybody but the owner.', [ApiDocumentation::PASSWORD_CHANGE_REQUIRED, ApiDocumentation::ACCOUNT_RESTRICTED, ApiDocumentation::FORBIDDEN]],
        ],
        'api.v1.vehicles.visibility' => [
            403 => ['account_restricted (with until) for anything but going private; password_change_required, or forbidden for anybody but the owner.', [ApiDocumentation::PASSWORD_CHANGE_REQUIRED, ApiDocumentation::ACCOUNT_RESTRICTED, ApiDocumentation::FORBIDDEN]],
        ],
        'api.v1.conversations.store' => [
            403 => ['cannot_message with reason, or account_restricted, email_not_verified, password_change_required.', [ApiDocumentation::CANNOT_MESSAGE, ApiDocumentation::ACCOUNT_RESTRICTED, ApiDocumentation::EMAIL_NOT_VERIFIED, ApiDocumentation::PASSWORD_CHANGE_REQUIRED]],
            404 => ['member_unavailable: no such name, or a member nobody may see (unverified, suspended, deactivated).', [ApiDocumentation::MEMBER_UNAVAILABLE]],
            409 => ['request_pending: your request to this member holds its one message; idempotency_key_reused: the same client_id or Idempotency-Key with another message.', [ApiDocumentation::REQUEST_PENDING, ApiDocumentation::IDEMPOTENCY_KEY_REUSED]],
        ],
        'api.v1.conversations.messages.store' => [
            403 => ['cannot_message with reason, or account_restricted, email_not_verified, password_change_required.', [ApiDocumentation::CANNOT_MESSAGE, ApiDocumentation::ACCOUNT_RESTRICTED, ApiDocumentation::EMAIL_NOT_VERIFIED, ApiDocumentation::PASSWORD_CHANGE_REQUIRED]],
            404 => ['not_found: not a conversation you are an active participant of (also behind a block). Never 403.', [ApiDocumentation::ERROR_SCHEMA]],
            409 => ['request_pending: your request holds its one message; idempotency_key_reused: the same client_id or Idempotency-Key with another message.', [ApiDocumentation::REQUEST_PENDING, ApiDocumentation::IDEMPOTENCY_KEY_REUSED]],
        ],
        'api.v1.conversations.media.store' => [
            403 => ['cannot_message with reason, or account_restricted, email_not_verified, password_change_required.', [ApiDocumentation::CANNOT_MESSAGE, ApiDocumentation::ACCOUNT_RESTRICTED, ApiDocumentation::EMAIL_NOT_VERIFIED, ApiDocumentation::PASSWORD_CHANGE_REQUIRED]],
        ],
        'api.v1.me.username' => [
            409 => ['username_change_cooldown, with until.', [ApiDocumentation::USERNAME_CHANGE_COOLDOWN]],
        ],
        'api.v1.reports.store' => [
            403 => ['forbidden for a deactivated account (before any lookup), or password_change_required.', [ApiDocumentation::FORBIDDEN, ApiDocumentation::PASSWORD_CHANGE_REQUIRED]],
            404 => ['not_found: a target the reporter cannot see (unknown, hidden, deleted, across a block); a message only for its conversation\'s participants.', [ApiDocumentation::ERROR_SCHEMA]],
            409 => ['already_reported: this member already reported the target and its case is still open; idempotency_key_reused: the same key with another body.', [ApiDocumentation::ALREADY_REPORTED, ApiDocumentation::IDEMPOTENCY_KEY_REUSED]],
            422 => ['own_content: your own profile or content; validation_failed: the fields (sub_reason and good_faith for illegal).', [ApiDocumentation::OWN_CONTENT, ApiDocumentation::VALIDATION]],
        ],
        'api.v1.decisions.show' => [
            404 => ['not_found: an unknown id, or a decision that concerns the viewer neither as the affected member nor as a reporter.', [ApiDocumentation::ERROR_SCHEMA]],
        ],
        'api.v1.decisions.appeal' => [
            404 => ['not_found: an unknown id, or a decision that concerns the viewer neither as the affected member nor as a reporter.', [ApiDocumentation::ERROR_SCHEMA]],
            409 => ['appeal_exists: this member already appealed this decision; idempotency_key_reused: the same key with another body.', [ApiDocumentation::APPEAL_EXISTS, ApiDocumentation::IDEMPOTENCY_KEY_REUSED]],
            422 => ['appeal_period_over: after appeal_until; decision_not_appealable: a reverse decision (it lifted a measure); validation_failed: the text.', [ApiDocumentation::APPEAL_PERIOD_OVER, ApiDocumentation::DECISION_NOT_APPEALABLE, ApiDocumentation::VALIDATION]],
        ],
    ];

    public function handle(Operation $operation, RouteInfo $routeInfo): void
    {
        $middleware = array_filter($routeInfo->route->gatherMiddleware(), is_string(...));
        $isMember = in_array('member', $middleware, true);

        if (in_array('etag', $middleware, true) || in_array('etag:no-store', $middleware, true)) {
            $this->addHeaderParameter($operation, 'If-None-Match', 'ETag of the copy the client holds.');
            $operation->addResponse(Response::make(304)->setDescription('Not modified; the copy with this ETag is current.'));
        }

        if (array_filter($middleware, fn (string $name): bool => str_starts_with($name, EnsureFeatureEnabled::class.':')) !== []) {
            $operation->addResponse($this->errorWith(404, 'feature_disabled: the feature flag of this route is off.', [ApiDocumentation::FEATURE_DISABLED]));
        }

        if (in_array('idempotent', $middleware, true)) {
            $this->addHeaderParameter($operation, 'Idempotency-Key', 'Repeating the key replays the first response for 24 hours.');
            $operation->addResponse($this->error(409, 'The key is in use by a running request: `conflict` with Retry-After. It was used with another body: `idempotency_key_reused`.'));
        }

        foreach ($middleware as $name) {
            if (str_starts_with($name, 'throttle:')) {
                $operation->addResponse($this->errorWith(429, 'Rate limited, or a login delay is running.', [ApiDocumentation::RATE_LIMITED])->addHeader('Retry-After', $this->retryAfter()));
                break;
            }
        }

        if ($isMember) {
            $operation->addResponse($this->errorWith(401, 'unauthenticated.', [ApiDocumentation::UNAUTHENTICATED]));
        }

        if (strtolower($operation->method) !== 'get') {
            $operation->addResponse($this->errorWith(419, 'session_expired: a browser session without a valid CSRF token, or a sign-in without device_name and without a session.', [ApiDocumentation::SESSION_EXPIRED]));
            // From LimitJsonBody, global and invisible on the route. An upload route replaces it below with the limit of its file.
            $operation->addResponse($this->error(413, 'payload_too_large: a JSON body over '.(LimitJsonBody::MAX_BYTES / 1024).' KB.'));
        }

        $forbidden = $this->forbiddenBodies($middleware);

        if ($forbidden !== []) {
            $operation->addResponse($this->errorWith(403, 'Forbidden, or one of the states in the body.', $forbidden));
        }

        foreach (self::ROUTE_ERRORS[$routeInfo->route->getName()] ?? [] as $status => $description) {
            $operation->addResponse($this->error($status, $description));
        }

        foreach (self::ROUTE_ERROR_BODIES[$routeInfo->route->getName()] ?? [] as $status => [$description, $bodies]) {
            $operation->addResponse($this->errorWith($status, $description, $bodies));
        }
    }

    /**
     * @param  array<int|string, string>  $middleware
     * @return list<string>
     */
    private function forbiddenBodies(array $middleware): array
    {
        $bodies = [];

        if (in_array('member', $middleware, true)) {
            $bodies[] = ApiDocumentation::PASSWORD_CHANGE_REQUIRED;
        }

        if (in_array('verified-member', $middleware, true)) {
            $bodies[] = ApiDocumentation::EMAIL_NOT_VERIFIED;
        }

        foreach ($middleware as $name) {
            if (str_starts_with($name, 'not-restricted:')) {
                $bodies[] = ApiDocumentation::ACCOUNT_RESTRICTED;
                break;
            }
        }

        return $bodies === [] ? [] : [...$bodies, ApiDocumentation::FORBIDDEN];
    }

    private function addHeaderParameter(Operation $operation, string $name, string $description): void
    {
        $operation->addParameters([
            Parameter::make($name, 'header')
                ->description($description)
                ->setSchema(Schema::fromType(new StringType)),
        ]);
    }

    private function retryAfter(): Header
    {
        return (new Header)
            ->setDescription('Seconds until the next attempt.')
            ->setSchema(Schema::fromType(new IntegerType));
    }

    private function error(int $status, string $description): Response
    {
        return Response::make($status)
            ->setDescription($description)
            ->setContent('application/json', ApiDocumentation::errorReference($this->openApiTransformer->getComponents()));
    }

    /**
     * @param  list<string>  $bodies
     */
    private function errorWith(int $status, string $description, array $bodies): Response
    {
        $components = $this->openApiTransformer->getComponents();
        $references = array_map(
            fn (string $name): Reference => $name === ApiDocumentation::ERROR_SCHEMA ? ApiDocumentation::errorReference($components) : ApiDocumentation::bodyReference($components, $name),
            $bodies,
        );

        return Response::make($status)
            ->setDescription($description)
            ->setContent('application/json', count($references) === 1
                ? $references[0]
                : Schema::fromType((new AnyOf)->setItems($references)));
    }
}
