<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}" @class(['dark' => ($appearance ?? 'dark') == 'dark']) data-theme="{{ $theme ?? 'classic' }}">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">

        {{-- Inline script to detect system dark mode preference and apply it immediately --}}
        <script>
            (function() {
                let appearance = '{{ $appearance ?? "dark" }}';

                try {
                    appearance = localStorage.getItem('appearance') || appearance;
                } catch (e) {}

                document.documentElement.classList.toggle('dark', appearance === 'dark');

                if (appearance === 'system') {
                    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

                    if (prefersDark) {
                        document.documentElement.classList.add('dark');
                    }
                }

                try {
                    const theme = localStorage.getItem('theme');

                    if (['classic', 'layered', 'graphite'].includes(theme)) {
                        document.documentElement.dataset.theme = theme;
                    }
                } catch (e) {}
            })();
        </script>

        {{-- Inline style to set the HTML background color based on our theme in app.css --}}
        <style>
            html[data-theme="classic"] {
                background-color: #f7f5f0;
            }

            html[data-theme="classic"].dark {
                background-color: #0b0e14;
            }

            html[data-theme="layered"] {
                background-color: #efede5;
            }

            html[data-theme="layered"].dark {
                background-color: #07090f;
            }
        </style>

        <link rel="icon" href="/favicon.ico" sizes="any">
        <link rel="icon" href="/favicon.svg" type="image/svg+xml">
        <link rel="apple-touch-icon" href="/apple-touch-icon.png">

        @viteReactRefresh
        @vite(['resources/css/app.css', 'resources/js/app.tsx', "resources/js/pages/{$page['component']}.tsx"])
        <x-inertia::head>
            <title>{{ config('app.name', 'Laravel') }}</title>
        </x-inertia::head>
    </head>
    <body class="font-sans antialiased">
        <x-inertia::app />
    </body>
</html>
