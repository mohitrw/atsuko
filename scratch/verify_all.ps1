$files = @(
  'js/app.js',
  'js/dataFolderService.js',
  'js/atuSchema.js',
  'js/songFingerprint.js',
  'js/folderService.js',
  'js/recorderService.js',
  'js/onboardingWizard.js',
  'js/player.js',
  'js/fileManager.js'
)

foreach ($f in $files) {
  if (Test-Path $f) {
    $c = Get-Content $f -Raw
    $ob = ([regex]::Matches($c, '\{')).Count
    $cb = ([regex]::Matches($c, '\}')).Count
    $diff = $ob - $cb
    Write-Host "$f : { = $ob, } = $cb (Diff: $diff)"
    if ($diff -ne 0) {
      Write-Host "WARNING: Mismatch in $f" -ForegroundColor Red
    } else {
      Write-Host "OK: Braces match in $f" -ForegroundColor Green
    }
  } else {
    Write-Host "File not found: $f" -ForegroundColor Red
  }
}

