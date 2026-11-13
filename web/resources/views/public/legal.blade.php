{{-- WEB-08. $html is the HtmlString of App\Support\SafeMarkdown, the only thing {{ }} prints as markup here. A short text needs no table of contents, so $toc is empty then. --}}
<x-public.layout :title="$title.' · SPEED CLUB'" :description="__('public.legal.description', ['title' => $title])" :canonical="$canonical">
    <x-public.top-bar />
    <main id="main" class="sc-legal flex-1" data-testid="WEB-08.root" data-document="{{ $key }}">
        <header class="sc-legal-head">
            <h1 class="t-title-1 text-ink" @if ($is_fallback) lang="de" @endif data-testid="WEB-08.title">{{ \App\Support\SafeMarkdown::joinShortCompounds($title) }}</h1>
            <p class="mt-8 text-callout text-ink-3" data-testid="WEB-08.version">{{ __('public.legal.version', ['version' => $version, 'date' => str_replace(' ', "\u{00A0}", (string) $published_at?->timezone(config('speedclub.display_timezone'))->locale(app()->getLocale())->isoFormat('LL'))]) }}</p>
            @if ($is_fallback && __('public.legal.german_is_binding') !== '')
                <p class="mt-12 text-callout text-ink-2" lang="{{ app()->getLocale() }}" data-testid="WEB-08.fallback">{{ __('public.legal.german_is_binding') }}</p>
            @endif
        </header>
        @if ($toc !== [])
            <nav class="sc-legal-toc" aria-labelledby="toc-title" data-testid="WEB-08.toc">
                <h2 id="toc-title" class="text-headline text-ink">{{ __('public.legal.toc') }}</h2>
                <ol class="mt-8">
                    @foreach ($toc as $entry)
                        <li><a href="#{{ $entry['id'] }}" class="sc-focus sc-toc-link text-callout text-ink-2 hover:text-ink">{{ $entry['title'] }}</a></li>
                    @endforeach
                </ol>
            </nav>
        @endif
        <article class="sc-prose text-body text-ink" lang="{{ $is_fallback ? 'de' : app()->getLocale() }}" data-testid="WEB-08.body">{{ $html }}</article>
    </main>
</x-public.layout>
