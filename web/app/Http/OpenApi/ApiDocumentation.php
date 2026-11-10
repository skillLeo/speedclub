<?php

namespace App\Http\OpenApi;

use App\Enums\AuthNextStep;
use App\Enums\CannotMessageReason;
use App\Enums\ErrorCode;
use Dedoc\Scramble\Scramble;
use Dedoc\Scramble\Support\Generator\Components;
use Dedoc\Scramble\Support\Generator\OpenApi;
use Dedoc\Scramble\Support\Generator\Reference;
use Dedoc\Scramble\Support\Generator\Response;
use Dedoc\Scramble\Support\Generator\Schema;
use Dedoc\Scramble\Support\Generator\SecurityScheme;
use Dedoc\Scramble\Support\Generator\Types\ArrayType;
use Dedoc\Scramble\Support\Generator\Types\ObjectType;
use Dedoc\Scramble\Support\Generator\Types\StringType;
use Dedoc\Scramble\Support\Generator\Types\Type;
use Illuminate\Support\Str;

/**
 * What Scramble cannot infer: bearer auth and the real error bodies of ApiExceptionRenderer. ApiError is the general
 * {message, code, errors}; the named bodies say which code it is and which fields come with it, so the mobile types
 * need nothing written by hand. Public endpoints opt out of auth with @unauthenticated on the controller method.
 */
final class ApiDocumentation
{
    public const ERROR_SCHEMA = 'ApiError';

    public const UNAUTHENTICATED = 'UnauthenticatedError';

    public const INVALID_CREDENTIALS = 'InvalidCredentialsError';

    public const FORBIDDEN = 'ForbiddenError';

    public const ACCOUNT_RESTRICTED = 'AccountRestrictedError';

    public const PASSWORD_CHANGE_REQUIRED = 'PasswordChangeRequiredError';

    public const EMAIL_NOT_VERIFIED = 'EmailNotVerifiedError';

    public const CONFLICT = 'ConflictError';

    public const USERNAME_CHANGE_COOLDOWN = 'UsernameChangeCooldownError';

    public const TOKEN_ROTATION_NOT_DUE = 'TokenRotationNotDueError';

    public const SESSION_EXPIRED = 'SessionExpiredError';

    public const VALIDATION = 'ValidationError';

    public const RATE_LIMITED = 'RateLimitedError';

    public const VEHICLE_UNAVAILABLE = 'VehicleUnavailableError';

    public const VEHICLE_INCOMPLETE = 'VehicleIncompleteError';

    public const MEMBER_UNAVAILABLE = 'MemberUnavailableError';

    public const FEATURE_DISABLED = 'FeatureDisabledError';

    public const FEED_STALE = 'FeedStaleError';

    public const CANNOT_MESSAGE = 'CannotMessageError';

    public const REQUEST_PENDING = 'RequestPendingError';

    public const IDEMPOTENCY_KEY_REUSED = 'IdempotencyKeyReusedError';

    public const ALREADY_REPORTED = 'AlreadyReportedError';

    public const OWN_CONTENT = 'OwnContentError';

    public const APPEAL_EXISTS = 'AppealExistsError';

    public const APPEAL_PERIOD_OVER = 'AppealPeriodOverError';

    /** M3.2 view-as (RestrictViewAs) and the reverse decision. */
    public const VIEW_AS_READ_ONLY = 'ViewAsReadOnlyError';

    public const VIEW_AS_NO_MESSAGES = 'ViewAsNoMessagesError';

    public const DECISION_NOT_APPEALABLE = 'DecisionNotAppealableError';

    /** ADR-245 (EnsureCurrentConsent): a member write while a re-consent version is not accepted. */
    public const CONSENT_REQUIRED = 'ConsentRequiredError';

    /** The exceptions Scramble lists itself, and the body each has here. */
    private const COMPONENT_BODIES = [
        'AuthenticationException' => self::UNAUTHENTICATED,
        'AuthorizationException' => self::FORBIDDEN,
        'ValidationException' => self::VALIDATION,
    ];

    public static function register(): void
    {
        Scramble::configure()
            ->withDocumentTransformers([self::document(...), JsonBodyOnDelete::document(...)])
            ->withOperationTransformers(MiddlewareResponses::class);
    }

    private static function document(OpenApi $openApi): void
    {
        $openApi->secure(SecurityScheme::http('bearer')->as('bearerAuth'));

        $general = self::errorReference($openApi->components);

        // M3.2 view-as (RestrictViewAs): any api/v1 route answers a view-as token 403 view_as_read_only (a write other than
        // DELETE view-as) or view_as_no_messages (a message route). Not repeated on every route, which the member app never sees
        // them on; the bodies are here for the app's view-as mode.
        self::bodyReference($openApi->components, self::VIEW_AS_READ_ONLY);
        self::bodyReference($openApi->components, self::VIEW_AS_NO_MESSAGES);
        // ADR-245 (EnsureCurrentConsent): every member write but accepting, signing out, export, deletion, support, appeal and report
        // answers 403 consent_required while GET me/consents lists a required version. The app shows the consent sheet.
        self::bodyReference($openApi->components, self::CONSENT_REQUIRED);

        // The framework exceptions Scramble lists get our bodies. Their keys are full class names.
        foreach ($openApi->components->responses as $name => $response) {
            if ($response instanceof Response) {
                $body = self::COMPONENT_BODIES[Str::afterLast(str_replace('.', '\\', (string) $name), '\\')] ?? null;

                $response->setContent('application/json', $body === null ? $general : self::bodyReference($openApi->components, $body));
            }
        }
    }

    public static function errorReference(Components $components): Reference
    {
        if (! $components->hasSchema(self::ERROR_SCHEMA)) {
            $components->addSchema(self::ERROR_SCHEMA, self::errorSchema());
        }

        return $components->getSchemaReference(self::ERROR_SCHEMA);
    }

    public static function bodyReference(Components $components, string $name): Reference
    {
        if (! $components->hasSchema($name)) {
            $components->addSchema($name, self::bodySchema($name));
        }

        return $components->getSchemaReference($name);
    }

    private static function errorSchema(): Schema
    {
        return Schema::fromType(self::messageAndErrors()
            ->addProperty('code', (new StringType)->setDescription('Machine code, see App\Enums\ErrorCode.'))
            ->addProperty('until', (new StringType)
                ->nullable(true)
                ->setDescription('Only with code account_restricted: end of the restriction, null when it has none.'))
            ->setRequired(['message', 'code', 'errors']));
    }

    private static function bodySchema(string $name): Schema
    {
        $moment = fn (string $description): Type => (new StringType)->format('date-time')->setDescription($description);

        return match ($name) {
            self::UNAUTHENTICATED => self::body([ErrorCode::Unauthenticated]),
            self::INVALID_CREDENTIALS => self::body([ErrorCode::InvalidCredentials]),
            self::FORBIDDEN => self::body([ErrorCode::Forbidden]),
            self::EMAIL_NOT_VERIFIED => self::body([ErrorCode::EmailNotVerified]),
            self::CONFLICT => self::body([ErrorCode::Conflict]),
            self::SESSION_EXPIRED => self::body([ErrorCode::SessionExpired]),
            self::RATE_LIMITED => self::body([ErrorCode::RateLimited]),
            self::VEHICLE_UNAVAILABLE => self::body([ErrorCode::VehicleUnavailable]),
            self::MEMBER_UNAVAILABLE => self::body([ErrorCode::MemberUnavailable]),
            self::FEATURE_DISABLED => self::body([ErrorCode::FeatureDisabled]),
            self::FEED_STALE => self::body([ErrorCode::FeedStale]),
            self::CANNOT_MESSAGE => self::body([ErrorCode::CannotMessage], [
                'reason' => (new StringType)->enum(array_map(fn (CannotMessageReason $reason): string => $reason->value, CannotMessageReason::cases()))
                    ->setDescription('recipient_closed (Niemand, Following without a follow, a block either way, an account that is gone), not_verified, restricted.'),
            ]),
            self::REQUEST_PENDING => self::body([ErrorCode::RequestPending]),
            self::IDEMPOTENCY_KEY_REUSED => self::body([ErrorCode::IdempotencyKeyReused]),
            self::ALREADY_REPORTED => self::body([ErrorCode::AlreadyReported]),
            self::OWN_CONTENT => self::body([ErrorCode::OwnContent]),
            self::APPEAL_EXISTS => self::body([ErrorCode::AppealExists]),
            self::APPEAL_PERIOD_OVER => self::body([ErrorCode::AppealPeriodOver]),
            self::VIEW_AS_READ_ONLY => self::body([ErrorCode::ViewAsReadOnly]),
            self::VIEW_AS_NO_MESSAGES => self::body([ErrorCode::ViewAsNoMessages]),
            self::CONSENT_REQUIRED => self::body([ErrorCode::ConsentRequired]),
            self::DECISION_NOT_APPEALABLE => self::body([ErrorCode::DecisionNotAppealable]),
            self::VEHICLE_INCOMPLETE => self::body([ErrorCode::VehicleIncomplete], [
                'missing' => (new ArrayType)
                    ->setItems((new StringType)->enum(['make', 'model', 'model_year', 'photo', 'username']))
                    ->setDescription('Everything still missing; errors has a message per entry.'),
            ], 'A message per missing item.'),
            self::VALIDATION => self::body([ErrorCode::ValidationFailed, ErrorCode::InvalidCode], [], 'Messages by field, at least one.'),
            self::ACCOUNT_RESTRICTED => self::body([ErrorCode::AccountRestricted], [
                'until' => $moment('End of the restriction, null when it has none.')->nullable(true),
            ]),
            self::PASSWORD_CHANGE_REQUIRED => self::body([ErrorCode::PasswordChangeRequired], [
                'next' => (new StringType)->enum([AuthNextStep::ResetPassword->value])->setDescription('The screen to go to.'),
                'email' => (new StringType)->format('email')->setDescription('For the reset form.'),
            ]),
            self::USERNAME_CHANGE_COOLDOWN => self::body([ErrorCode::UsernameChangeCooldown], [
                'until' => $moment('When the next change is possible.'),
            ]),
            self::TOKEN_ROTATION_NOT_DUE => self::body([ErrorCode::TokenRotationNotDue], [
                'retry_at' => $moment('When this token can be rotated.'),
            ]),
            default => throw new \InvalidArgumentException("No error body named {$name}."),
        };
    }

    /**
     * @param  non-empty-list<ErrorCode>  $codes
     * @param  array<string, Type>  $extra  required fields of this body
     */
    private static function body(array $codes, array $extra = [], ?string $errorsDescription = null): Schema
    {
        $type = self::messageAndErrors($errorsDescription)
            ->addProperty('code', (new StringType)->enum(array_map(fn (ErrorCode $code): string => $code->value, $codes)));

        foreach ($extra as $name => $property) {
            $type->addProperty($name, $property);
        }

        return Schema::fromType($type->setRequired(['message', 'code', 'errors', ...array_keys($extra)]));
    }

    private static function messageAndErrors(?string $errorsDescription = null): ObjectType
    {
        return (new ObjectType)
            ->addProperty('message', (new StringType)->setDescription('Translated, safe to show.'))
            ->addProperty('errors', (new ObjectType)
                ->setDescription($errorsDescription ?? 'Messages by field; empty when the error is not about one field.')
                ->additionalProperties((new ArrayType)->setItems(new StringType)));
    }
}
