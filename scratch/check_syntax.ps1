$files = @('js/player.js', 'js/voiceAssistant.js', 'js/kwsEngine.js')

foreach ($f in $files) {
    $content = Get-Content $f -Raw
    # Check brace count
    $opens = ($content.ToCharArray() | Where-Object { $_ -eq '{' }).Count
    $closes = ($content.ToCharArray() | Where-Object { $_ -eq '}' }).Count
    $diff = $opens - $closes
    Write-Host "$f : { = $opens, } = $closes (Diff: $diff)"
    if ($diff -ne 0) {
        Write-Host "ERROR: Brace mismatch in $f!" -ForegroundColor Red
    } else {
        Write-Host "OK: Braces match in $f." -ForegroundColor Green
    }
}

