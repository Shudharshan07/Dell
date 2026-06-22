@echo off
setlocal

:: ── Output zip name (timestamped) ────────────────────────────────────────────
set TIMESTAMP=%DATE:~10,4%%DATE:~4,2%%DATE:~7,2%_%TIME:~0,2%%TIME:~3,2%%TIME:~6,2%
set TIMESTAMP=%TIMESTAMP: =0%
set ZIP_NAME=onemcp_%TIMESTAMP%.zip
set ROOT=%~dp0
set ZIP_PATH=%ROOT%%ZIP_NAME%

echo.
echo  Creating bundle: %ZIP_NAME%
echo.

:: ── Use PowerShell to zip, respecting exclusions ──────────────────────────────
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root = '%ROOT%'.TrimEnd('\'); " ^
  "$zip  = '%ZIP_PATH%'; " ^
  "if (Test-Path $zip) { Remove-Item $zip -Force }; " ^
  "Add-Type -Assembly 'System.IO.Compression.FileSystem'; " ^
  "$archive = [System.IO.Compression.ZipFile]::Open($zip, 'Create'); " ^
  "$excludeDirs  = @('.git','.vscode','venv','node_modules','__pycache__','dist','dist-ssr'); " ^
  "$excludeFiles = @('local_storage.json','gram_storage.json'); " ^
  "$v2Seen = 0; $v3Seen = 0; " ^
  "Get-ChildItem -Path $root -Recurse -File | Sort-Object FullName | Where-Object { " ^
  "  $rel   = $_.FullName.Substring($root.Length + 1); " ^
  "  $parts = $rel.Split([IO.Path]::DirectorySeparatorChar); " ^
  "  $skip  = ($_.FullName -eq $zip) -or ($_.Extension -eq '.zip') -or " ^
  "           ($excludeDirs  | Where-Object { $parts -contains $_ }) -or " ^
  "           ($excludeFiles -contains $_.Name) -or " ^
  "           ($_.Extension -eq '.pyc') -or ($_.Name -like '*.log') -or " ^
  "           ($_.Name -like '*.local') -or " ^
  "           ($_.Name -eq '.env' -and $rel -like 'compiler*'); " ^
  "  if (-not $skip -and $rel -like 'test_specs\V2\*') { if ($v2Seen -ge 5) { $skip = $true } else { $v2Seen++ } }; " ^
  "  if (-not $skip -and $rel -like 'test_specs\V3\*') { if ($v3Seen -ge 5) { $skip = $true } else { $v3Seen++ } }; " ^
  "  -not $skip " ^
  "} | ForEach-Object { " ^
  "  $rel = $_.FullName.Substring($root.Length + 1); " ^
  "  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $rel) | Out-Null " ^
  "}; " ^
  "$archive.Dispose(); " ^
  "Write-Host \"  Done: $zip\""

echo.
echo ================================================
echo   Bundle saved to:
echo   %ZIP_PATH%
echo ================================================
echo.
pause
endlocal
