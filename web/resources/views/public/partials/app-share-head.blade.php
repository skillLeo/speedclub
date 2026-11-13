{{-- SpaController: the head of /v or /u for the same address in the member web app. The app copy is never indexed; the page is canonical. --}}
<title>{{ $seo['title'] }}</title>
<meta name="description" content="{{ $seo['description'] }}">
<meta name="robots" content="noindex">
<link rel="canonical" href="{{ \App\Support\PublicUrl::secure($seo['canonical']) }}">
@include('public.partials.share-meta', [
    'title' => $seo['title'],
    'description' => $seo['description'],
    'canonical' => $seo['canonical'],
    'images' => ['landscape' => $seo['image'], 'square' => $seo['image_square']],
    'imageAlt' => $seo['image_alt'],
    'ogType' => $seo['og_type'],
    'locale' => $locale,
])
