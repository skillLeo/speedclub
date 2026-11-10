{!! $heading !!}

@foreach ($lines as $line)
{!! $line !!}

@endforeach
@if ($code !== null)
{!! $code !!}

@endif
@foreach ($actions as $action)
{!! $action['label'] !!}: {!! $action['url'] !!}

@endforeach
@if ($note !== null)
{!! $note !!}

@endif
SPEED CLUB
