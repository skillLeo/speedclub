<?php

use App\Support\StaleBootstrapCache;

/*
 * Go-live 2026-11-24: code uploaded by FTP met the previous release's cached config; a new key read at boot made every request a
 * 500 until the cache file was deleted by hand. StaleBootstrapCache drops a cache older than its sources before the app boots.
 */
function staleCacheBase(): string
{
    $base = sys_get_temp_dir().'/sc-stale-cache-'.bin2hex(random_bytes(4));
    foreach (['bootstrap/cache', 'config', 'routes', 'app/Providers', 'app/Listeners'] as $dir) {
        mkdir($base.'/'.$dir, 0777, true);
    }
    file_put_contents($base.'/config/speedclub.php', '<?php return [];');
    file_put_contents($base.'/routes/web.php', '<?php');
    file_put_contents($base.'/app/Providers/AppServiceProvider.php', '<?php');

    return $base;
}

function staleCacheFile(string $base, string $name, int $mtime): string
{
    $file = $base.'/bootstrap/cache/'.$name;
    file_put_contents($file, '<?php return [];');
    touch($file, $mtime);

    return $file;
}

it('drops a cached config that is older than an uploaded config file, and keeps a current one', function () {
    $base = staleCacheBase();
    touch($base.'/config/speedclub.php', time());
    $stale = staleCacheFile($base, 'config.php', time() - 600);

    expect(StaleBootstrapCache::clear($base))->toBe(['config.php'])
        ->and(file_exists($stale))->toBeFalse();

    $current = staleCacheFile($base, 'config.php', time() + 600);
    expect(StaleBootstrapCache::clear($base))->toBe([])
        ->and(file_exists($current))->toBeTrue();
});

it('drops the route cache after a newer routes file and the event cache after a newer provider, each on its own', function () {
    $base = staleCacheBase();
    $past = time() - 600;
    touch($base.'/config/speedclub.php', $past - 60);
    touch($base.'/app/Providers/AppServiceProvider.php', $past - 60);
    touch($base.'/routes/web.php', time());
    $config = staleCacheFile($base, 'config.php', $past);
    $routes = staleCacheFile($base, 'routes-v7.php', $past);
    $events = staleCacheFile($base, 'events.php', $past);

    expect(StaleBootstrapCache::clear($base))->toBe(['routes-v7.php'])
        ->and(file_exists($config))->toBeTrue()
        ->and(file_exists($routes))->toBeFalse()
        ->and(file_exists($events))->toBeTrue();

    touch($base.'/app/Providers/AppServiceProvider.php', time());
    expect(StaleBootstrapCache::clear($base))->toBe(['events.php']);
});

it('does nothing without caches, and is called before the application is configured', function () {
    expect(StaleBootstrapCache::clear(staleCacheBase()))->toBe([]);

    $bootstrap = (string) file_get_contents(base_path('bootstrap/app.php'));
    $call = strpos($bootstrap, 'StaleBootstrapCache::clear(dirname(__DIR__));');
    $configure = strpos($bootstrap, 'return Application::configure(');
    expect($call)->toBeInt()
        ->and($configure)->toBeInt()
        ->and($call)->toBeLessThan($configure);
});
