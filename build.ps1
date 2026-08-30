$ErrorActionPreference = "Stop"

Write-Host "Cleaning dist..."

if (Test-Path "dist") {
    Remove-Item "dist" -Recurse -Force
}

New-Item -ItemType Directory -Path "dist" | Out-Null


Write-Host "Compiling TypeScript..."

npx tsc

if ($LASTEXITCODE -ne 0) {
    Write-Error "TypeScript compilation failed."
    exit 1
}


Write-Host "Copying extension files..."


Copy-Item `
    "manifest.json" `
    "dist\manifest.json"

New-Item `
    -ItemType Directory `
    -Path "dist\popup" `
    -Force | Out-Null

Copy-Item `
    "popup\popup.html" `
    "dist\popup\popup.html"

Copy-Item `
    "popup\popup.css" `
    "dist\popup\popup.css"


Write-Host "Build complete."