<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}" data-theme="carbon">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="color-scheme" content="dark light">
        <meta name="robots" content="noindex, nofollow">
        <meta name="csp-nonce" content="{{ Vite::cspNonce() }}">
        <title inertia>SPEED CLUB Admin</title>
        {{-- Admin has two themes (03 §14): Carbon and Hell. Set before the first paint, so there is no flash. --}}
        <script nonce="{{ Vite::cspNonce() }}">
            try { document.documentElement.dataset.theme = localStorage.getItem('sc-admin-theme') === 'light' ? 'light' : 'carbon'; }
            catch (e) { document.documentElement.dataset.theme = 'carbon'; }
        </script>
        <x-font-preload />
        {{-- SEC-P3-04: guests see only the routes of the sign-in pages. --}}
        @routes(\App\Http\Controllers\Admin\Support\ZiggyScope::group(request()), nonce: Vite::cspNonce())
        @vite(['resources/css/admin.css', 'resources/js/admin/app.ts'])
        @inertiaHead
    </head>
    <body class="min-h-screen bg-canvas font-ui text-body text-ink antialiased">
        @inertia
    </body>
</html>
