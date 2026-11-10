<?php

namespace Tests\Support;

use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Str;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use ReflectionClass;
use ReflectionIntersectionType;
use ReflectionMethod;
use ReflectionNamedType;
use ReflectionType;
use ReflectionUnionType;
use Symfony\Component\HttpFoundation\Response;

/**
 * Static rules Pest's dependency-based arch expectations cannot express: method calls such as
 * $model->save() and unnamespaced files (routes, migrations, Blade). tests/Arch/ArchRulesTest.php
 * proves against fixtures that these rules detect violations, so they cannot silently pass on nothing.
 */
final class SourceScanner
{
    /** Eloquent and query builder writes that belong in Actions. */
    public const ELOQUENT_WRITES = [
        'associate', 'attach', 'create', 'createmany', 'createorfirst', 'createquietly', 'decrement', 'delete',
        'deletequietly', 'destroy', 'detach', 'dissociate', 'firstorcreate', 'forcecreate', 'forcedelete', 'increment',
        'insert', 'insertgetid', 'insertorignore', 'push', 'restore', 'save', 'savemany', 'saveorfail', 'savequietly',
        'sync', 'syncwithoutdetaching', 'toggle', 'touch', 'truncate', 'update', 'updateorcreate', 'updateorinsert',
        'updatequietly', 'upsert',
    ];

    /**
     * @param  list<string>  $directories
     * @return list<string>
     */
    public static function phpFiles(array $directories): array
    {
        return array_values(array_filter(
            self::files($directories, '.php'),
            fn (string $file): bool => ! str_ends_with($file, '.blade.php'),
        ));
    }

    /**
     * @return list<string>
     */
    public static function bladeFiles(string $directory): array
    {
        return self::files([$directory], '.blade.php');
    }

    /**
     * Calls of global functions, e.g. env('X'), but not ->env() or a function declaration.
     *
     * @param  list<string>  $names  lowercase
     * @return list<string> "name:line"
     */
    public static function functionCalls(string $code, array $names): array
    {
        return self::calls($code, $names, fn (?int $previous): bool => ! in_array($previous, [T_OBJECT_OPERATOR, T_NULLSAFE_OBJECT_OPERATOR, T_DOUBLE_COLON, T_FUNCTION, T_NEW], true));
    }

    /**
     * Calls through -> ?-> or ::, e.g. $model->save() or Vehicle::create().
     *
     * @param  list<string>  $names  lowercase
     * @return list<string> "name:line"
     */
    public static function methodCalls(string $code, array $names): array
    {
        return self::calls($code, $names, fn (?int $previous): bool => in_array($previous, [T_OBJECT_OPERATOR, T_NULLSAFE_OBJECT_OPERATOR, T_DOUBLE_COLON], true));
    }

    /**
     * @param  list<string>  $names  lowercase
     * @return list<string> "name:line"
     */
    public static function bladeCalls(string $template, array $names): array
    {
        $pattern = '/(?<![\w>:$])@?('.implode('|', array_map(fn (string $name): string => preg_quote($name, '/'), $names)).')\s*\(/i';
        preg_match_all($pattern, $template, $matches, PREG_OFFSET_CAPTURE);

        return array_map(
            fn (array $match): string => strtolower($match[0]).':'.(substr_count(substr($template, 0, $match[1]), "\n") + 1),
            $matches[1],
        );
    }

    /**
     * Public methods of an API controller whose declared return type could emit anything but a Resource.
     * Allowed: JsonResource subclasses and Symfony responses (204, files, `$resource->response()`).
     *
     * @param  class-string  $class
     * @return list<string>
     */
    public static function apiOutputViolations(string $class): array
    {
        $violations = [];

        foreach ((new ReflectionClass($class))->getMethods(ReflectionMethod::IS_PUBLIC) as $method) {
            if ($method->getDeclaringClass()->getName() !== $class
                || $method->isConstructor()
                || (str_starts_with($method->getName(), '__') && $method->getName() !== '__invoke')) {
                continue;
            }

            if (! self::isAllowedApiOutput($method->getReturnType())) {
                $violations[] = $class.'::'.$method->getName();
            }
        }

        return $violations;
    }

    /**
     * @param  list<string>  $directories
     * @return list<class-string>
     */
    public static function classesIn(string $appPath, array $directories): array
    {
        $classes = [];

        foreach (self::phpFiles($directories) as $file) {
            $relative = Str::of($file)->replace('\\', '/')->after(str_replace('\\', '/', $appPath).'/')->beforeLast('.php');
            /** @var class-string $class */
            $class = 'App\\'.str_replace('/', '\\', (string) $relative);
            $classes[] = $class;
        }

        return $classes;
    }

    /**
     * @param  list<string>  $directories
     * @return list<string>
     */
    private static function files(array $directories, string $suffix): array
    {
        $files = [];

        foreach ($directories as $directory) {
            if (is_dir($directory)) {
                $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($directory, RecursiveDirectoryIterator::SKIP_DOTS));
                foreach ($iterator as $file) {
                    if (str_ends_with($file->getPathname(), $suffix)) {
                        $files[] = $file->getPathname();
                    }
                }
            }
        }

        return $files;
    }

    private static function isAllowedApiOutput(?ReflectionType $type): bool
    {
        if ($type instanceof ReflectionUnionType || $type instanceof ReflectionIntersectionType) {
            foreach ($type->getTypes() as $inner) {
                if (! self::isAllowedApiOutput($inner)) {
                    return false;
                }
            }

            return true;
        }

        return $type instanceof ReflectionNamedType
            && ! $type->allowsNull()
            && ! $type->isBuiltin()
            && (is_a($type->getName(), JsonResource::class, true) || is_a($type->getName(), Response::class, true));
    }

    /**
     * @param  list<string>  $names
     * @param  callable(?int): bool  $acceptPrevious
     * @return list<string>
     */
    private static function calls(string $code, array $names, callable $acceptPrevious): array
    {
        $tokens = array_values(array_filter(
            token_get_all($code),
            fn (array|string $token): bool => ! is_array($token) || ! in_array($token[0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true),
        ));

        $found = [];

        foreach ($tokens as $index => $token) {
            if (! is_array($token) || ! in_array($token[0], [T_STRING, T_NAME_FULLY_QUALIFIED], true)) {
                continue;
            }

            $name = strtolower(ltrim($token[1], '\\'));
            if (! in_array($name, $names, true) || ($tokens[$index + 1] ?? null) !== '(') {
                continue;
            }

            $previous = $tokens[$index - 1] ?? null;
            if ($acceptPrevious(is_array($previous) ? $previous[0] : null)) {
                $found[] = $name.':'.$token[2];
            }
        }

        return $found;
    }
}
