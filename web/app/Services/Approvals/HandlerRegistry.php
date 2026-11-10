<?php

namespace App\Services\Approvals;

use Illuminate\Contracts\Container\Container;
use InvalidArgumentException;

/**
 * The handlers of app/Services/Approvals/Handlers, by key. Discovered from the directory once per process, so a module adds an action
 * by adding a class.
 */
final class HandlerRegistry
{
    /** @var array<string, ApprovalHandler>|null */
    private ?array $handlers = null;

    public function __construct(private readonly Container $container) {}

    public function get(string $action): ApprovalHandler
    {
        return $this->all()[$action] ?? throw new InvalidArgumentException("No four-eyes handler for [$action].");
    }

    /**
     * A handler that is not a class of the directory, e.g. a test double. The directory's handlers stay.
     */
    public function add(ApprovalHandler $handler): void
    {
        $this->all();
        $this->handlers[$handler->key()] = $handler;
    }

    public function has(string $action): bool
    {
        return isset($this->all()[$action]);
    }

    /**
     * @return array<string, ApprovalHandler>
     */
    public function all(): array
    {
        if ($this->handlers !== null) {
            return $this->handlers;
        }

        $this->handlers = [];

        foreach (glob(__DIR__.'/Handlers/*.php') ?: [] as $file) {
            $class = __NAMESPACE__.'\\Handlers\\'.basename($file, '.php');

            if (class_exists($class) && is_subclass_of($class, ApprovalHandler::class)) {
                /** @var ApprovalHandler $handler */
                $handler = $this->container->make($class);
                $this->handlers[$handler->key()] = $handler;
            }
        }

        ksort($this->handlers);

        return $this->handlers;
    }
}
