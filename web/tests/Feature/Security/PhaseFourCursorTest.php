<?php

use App\Models\Brand;
use App\Models\Business;
use App\Models\Event;
use App\Models\Product;
use App\Models\User;
use App\Rules\ValidCursor;
use App\Rules\ValidStreamCursor;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Routing\Route;
use Illuminate\Support\Facades\Route as Router;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;

require_once dirname(__DIR__).'/Events/EventTestHelpers.php';
require_once dirname(__DIR__).'/Businesses/BusinessTestHelpers.php';

/**
 * SEC-P4-02 (Low, docs/reports/security/phase-4.md; merges CARRY-412-a): Phase 4 lists took `cursor` without ValidCursor, and the
 * framework answered a forged cursor with a 500 (a stack trace in the log, three of them for guests). Probe P3 turned round: every
 * cursor-paginated Phase 4 list answers a forged cursor with 422 `validation_failed` on `cursor`, and still takes a cursor of its own
 * order columns (a column list that does not match the query would be the 500 again). The closed-world check keeps a new list request
 * from leaving the rule out.
 */
beforeEach(function () {
    evFlags();
    bizFlags();
    $this->organiser = evOrganiser(['username' => 'jann.ptrs']);
    $this->member = User::factory()->create(['username' => 'lena.911']);
    $this->event = evEvent($this->organiser);
    $this->business = bizBusiness($this->member);
    $this->brand = Brand::factory()->create(['slug' => 'kw']);
    $this->product = Product::factory()->create(['brand_id' => $this->brand->id]);
});

/**
 * A cursor as the framework writes it (Illuminate\Pagination\Cursor::encode).
 *
 * @param  array<string, mixed>  $parameters
 */
function p4Cursor(array $parameters): string
{
    return str_replace(['+', '/', '='], ['-', '_', ''], base64_encode((string) json_encode([...$parameters, '_pointsToNextItems' => true])));
}

/**
 * [path, who, the list's order columns with a value each] of every cursor-paginated Phase 4 list.
 *
 * @return array{0: string, 1: 'guest'|'member'|'organiser', 2: array<string, mixed>}
 */
function p4List(string $list, Event $event, Business $business, Product $product): array
{
    $ulid = strtolower((string) Str::ulid());
    $at = '2026-11-01 12:00:00';
    $builds = ['sample' => 0, 'sort_at' => $at, 'id' => $ulid];
    $ranked = ['products.real_builds' => 1, 'products.visible_builds' => 1, 'products.name' => 'Variante 3', 'products.id' => $ulid];
    $events = ['events.starts_at' => $at, 'events.id' => $ulid];

    return match ($list) {
        'events' => ['/api/v1/events', 'guest', $events],
        'member events' => ['/api/v1/public/users/jann.ptrs/events', 'guest', $events],
        'member events, past' => ['/api/v1/public/users/jann.ptrs/events?when=past', 'guest', $events],
        'my events' => ['/api/v1/me/events', 'member', $events],
        'my events, past' => ['/api/v1/me/events?tab=past', 'member', $events],
        'attendees (member)' => ["/api/v1/events/{$event->slug}/attendees", 'member', ['attendee.username' => 'anna.e46']],
        'attendees (organiser)' => ["/api/v1/events/{$event->slug}/attendees", 'organiser', ['event_rsvps.status_at' => $at, 'event_rsvps.id' => $ulid]],
        'businesses' => ['/api/v1/businesses', 'guest', ['businesses.is_sample' => false, 'businesses.name' => 'Fahrwerkstatt Elbe', 'businesses.id' => $ulid]],
        'business portfolio' => ["/api/v1/businesses/{$business->slug}/portfolio", 'guest', $builds],
        'business invitations' => ['/api/v1/me/business-invites', 'member', ['created_at' => $at, 'id' => $ulid]],
        'tag requests' => ['/api/v1/me/business/tag-requests', 'member', ['created_at' => $at, 'id' => $ulid]],
        'mod tags' => ['/api/v1/me/mod-tags', 'member', ['created_at' => $at, 'id' => $ulid]],
        'products' => ['/api/v1/products', 'guest', ['products.name' => 'Variante 3', 'products.id' => $ulid]],
        'products, counts' => ['/api/v1/products?counts=1', 'guest', $ranked],
        'brand products' => ['/api/v1/brands/kw/products', 'guest', $ranked],
        'brand builds' => ['/api/v1/brands/kw/builds', 'guest', $builds],
        'product builds' => ["/api/v1/products/{$product->id}/builds", 'guest', $builds],
        'security events' => ['/api/v1/me/security-events', 'member', ['created_at' => $at, 'id' => 1]],
        default => throw new InvalidArgumentException($list),
    };
}

dataset('phase 4 lists', [
    'events', 'member events', 'member events, past', 'my events', 'my events, past', 'attendees (member)', 'attendees (organiser)',
    'businesses', 'business portfolio', 'business invitations', 'tag requests', 'mod tags',
    'products', 'products, counts', 'brand products', 'brand builds', 'product builds', 'security events',
]);

function p4As(string $who, User $member, User $organiser): void
{
    match ($who) {
        'member' => Sanctum::actingAs($member),
        'organiser' => Sanctum::actingAs($organiser),
        default => null,
    };
}

function p4With(string $path, string $cursor): string
{
    return $path.(str_contains($path, '?') ? '&' : '?').'cursor='.urlencode($cursor);
}

it('answers a forged cursor with 422, never a 500', function (string $list, Closure $forge) {
    [$path, $who, $columns] = p4List($list, $this->event, $this->business, $this->product);
    p4As($who, $this->member, $this->organiser);

    $this->getJson(p4With($path, $forge($columns)))
        ->assertUnprocessable()
        ->assertJsonPath('code', 'validation_failed')
        ->assertJsonValidationErrors('cursor');
})->with('phase 4 lists')->with([
    // Probe P3 of the report, as sent: no order column at all.
    'the report\'s probe' => [fn (array $columns): string => 'eyJfcG9pbnRzVG9OZXh0SXRlbXMiOnRydWV9'],
    'columns of another list' => [fn (array $columns): string => p4Cursor(['nope' => 'x', 'id' => 1])],
    'array values' => [fn (array $columns): string => p4Cursor(array_map(fn (mixed $value): array => [$value], $columns))],
    'a null value' => [fn (array $columns): string => p4Cursor([...$columns, array_key_first($columns) => null])],
    'not a cursor' => [fn (array $columns): string => 'kaputt'],
]);

it('still takes a cursor of the list\'s own order columns', function (string $list) {
    [$path, $who, $columns] = p4List($list, $this->event, $this->business, $this->product);
    p4As($who, $this->member, $this->organiser);

    $this->getJson(p4With($path, p4Cursor($columns)))->assertOk();
})->with('phase 4 lists');

it('never lets a member page the attendees with the organiser\'s cursor, which carries answer times (security review L1)', function () {
    Sanctum::actingAs($this->member);

    $this->getJson(p4With("/api/v1/events/{$this->event->slug}/attendees", p4Cursor(['event_rsvps.status_at' => '2026-11-01 12:00:00', 'event_rsvps.id' => 'x'])))
        ->assertUnprocessable()->assertJsonValidationErrors('cursor');
});

/**
 * Whether the request checks its cursor with ValidCursor in an after-validation hook, where a cursor depends on other validated input
 * (the Discover lists bind it to their filters and sort).
 *
 * @param  class-string<FormRequest>  $class
 */
function p4ChecksCursorAfter(string $class): bool
{
    for ($reflection = new ReflectionClass($class); $reflection !== false; $reflection = $reflection->getParentClass()) {
        foreach (['after', 'withValidator'] as $hook) {
            if (! $reflection->hasMethod($hook) || $reflection->getMethod($hook)->getDeclaringClass()->getName() !== $reflection->getName()) {
                continue;
            }

            $method = $reflection->getMethod($hook);
            $lines = array_slice(file((string) $method->getFileName()) ?: [], $method->getStartLine() - 1, $method->getEndLine() - $method->getStartLine() + 1);

            if (str_contains(implode('', $lines), 'new ValidCursor(')) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Closed world: every API route's FormRequest that takes a `cursor` checks it with ValidCursor (in its rules or an after hook), the Home
 * stream's own cursor rule, or prohibits it, so a list added later cannot bring the 500 back.
 */
it('puts ValidCursor on every API request that takes a cursor', function () {
    $checked = [];
    $missing = [];

    foreach (Router::getRoutes()->getRoutes() as $route) {
        /** @var Route $route */
        if (! str_starts_with($route->uri(), 'api/') || ! in_array('GET', $route->methods(), true)) {
            continue;
        }

        foreach ($route->signatureParameters(['subClass' => FormRequest::class]) as $parameter) {
            $class = $parameter->getType() instanceof ReflectionNamedType ? $parameter->getType()->getName() : null;

            if ($class === null || ! is_subclass_of($class, FormRequest::class)) {
                continue;
            }

            $request = $class::create('/'.$route->uri(), 'GET');
            $bound = clone $route;
            $bound->parameters = [];
            $request->setRouteResolver(fn () => $bound);
            $request->setUserResolver(fn () => null);
            $rules = method_exists($request, 'rules') ? app()->call([$request, 'rules']) : [];

            if (! array_key_exists('cursor', $rules)) {
                continue;
            }

            $checked[] = $route->getName();
            $cursorRules = is_array($rules['cursor']) ? $rules['cursor'] : [$rules['cursor']];
            $guarded = collect($cursorRules)->contains(fn (mixed $rule): bool => $rule instanceof ValidCursor || $rule instanceof ValidStreamCursor || $rule === 'prohibited')
                || p4ChecksCursorAfter($class);

            if (! $guarded) {
                $missing[] = $route->getName().' ('.$class.')';
            }
        }
    }

    expect($missing)->toBe([])
        // The Phase 4 lists of the report are among those checked.
        ->and($checked)->toContain(
            'api.v1.events.index', 'api.v1.public.users.events', 'api.v1.me.events', 'api.v1.events.attendees.index',
            'api.v1.businesses.index', 'api.v1.businesses.portfolio', 'api.v1.me.business-invites.index', 'api.v1.me.business.tags.index',
            'api.v1.me.mod-tags.index', 'api.v1.products.index', 'api.v1.brands.products', 'api.v1.brands.builds', 'api.v1.products.builds',
            'api.v1.me.security-events.index',
        );
});
