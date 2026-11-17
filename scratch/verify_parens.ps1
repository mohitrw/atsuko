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
    $op = ([regex]::Matches($c, '\(')).Count
    $cp = ([regex]::Matches($c, '\)')).Count
    $diff = $op - $cp
    Write-Host "$f : ( = $op, ) = $cp (Diff: $diff)"
    if ($diff -ne 0) {
      Write-Host "WARNING: Paren mismatch in $f" -ForegroundColor Red
    } else {
      Write-Host "OK: Parens match in $f" -ForegroundColor Green
    }
  }
}

