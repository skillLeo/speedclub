{{-- Shown when public/app has not been exported (npm --prefix mobile run export:web). --}}
<x-public.layout :title="__('public.spa_missing.title')" robots="noindex">
    <main class="flex min-h-screen flex-col justify-center p-24">
        <h1 class="text-title-l text-ink">{{ __('public.spa_missing.title') }}</h1>
        <p class="mt-12 text-body text-ink-2">{{ __('public.spa_missing.body') }}</p>
    </main>
</x-public.layout>
