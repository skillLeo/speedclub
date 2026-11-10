<script nonce="{{ Vite::cspNonce() }}">
    (function () {
        try {
            var theme = localStorage.getItem('sc-theme');
            if (['carbon', 'black', 'light', 'system'].indexOf(theme) !== -1) {
                document.documentElement.dataset.theme = theme;
            }
        } catch (e) {}
    })();
</script>
