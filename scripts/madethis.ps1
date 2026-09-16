<#
.SYNOPSIS
  madethis.website CLI — upload HTML, Markdown, JS/CSS, or ZIP static sites.
#>

$baseUrl = if ($env:MADETHIS_URL) { $env:MADETHIS_URL } else { "https://www.madethis.website" }
$defaultKey = "8d6a7f7e482e1ecb8ab76c1938ebb65dd264a4e18ed0b5e1f00c12eeca8eb545"
$apiKey = if ($env:MADETHIS_API_KEY) { $env:MADETHIS_API_KEY } else { $defaultKey }
$ttl = "86400"
$customFilename = ""
$jsonOut = $false
$targetFile = ""

function Print-Usage {
    [Console]::Out.WriteLine(@"
Usage: madethis upload <file> [options]
       madethis <file> [options]

Environment:
  MADETHIS_API_KEY   API key from https://www.madethis.website/admin (default: configured system key)
  MADETHIS_URL       API base URL (default: https://www.madethis.website)

Options:
  --ttl 1h|24h       How long the site stays live (default: 24h)
  --name NAME        Filename inside the zip / custom filename
  --json             Print full JSON response
  -h, --help         Show this help

Supported files:
  .html .htm .md .js .mjs .css .png .jpg .jpeg .gif .webp .svg .avif .zip (full static sites)

Examples:
  madethis upload demo.html --ttl 1h
  madethis upload screenshot.png
  madethis my_plan.html
  madethis upload dist.zip
"@)
}

$argList = @($args)
$i = 0
while ($i -lt $argList.Count) {
    $arg = [string]$argList[$i]
    switch -Regex ($arg) {
        '^(upload)$' {
            $i++
            if ($i -lt $argList.Count) {
                $targetFile = [string]$argList[$i]
            } else {
                [Console]::Error.WriteLine("error: missing file after upload command")
                exit 1
            }
        }
        '^(--ttl|-ttl)$' {
            $i++
            if ($i -lt $argList.Count) {
                $val = [string]$argList[$i]
                switch ($val) {
                    { $_ -in '1h', '3600' } { $ttl = "3600" }
                    { $_ -in '24h', '86400', '1d' } { $ttl = "86400" }
                    default {
                        [Console]::Error.WriteLine("error: --ttl must be 1h or 24h")
                        exit 1
                    }
                }
            }
        }
        '^(--name|-name)$' {
            $i++
            if ($i -lt $argList.Count) {
                $customFilename = [string]$argList[$i]
            }
        }
        '^(--json|-json)$' {
            $jsonOut = $true
        }
        '^(-h|--help|-help|\/\?)$' {
            Print-Usage
            exit 0
        }
        default {
            if (-not $targetFile -and (Test-Path $arg)) {
                $targetFile = $arg
            } else {
                [Console]::Error.WriteLine("error: unknown argument or file not found: $arg")
                Print-Usage
                exit 1
            }
        }
    }
    $i++
}

if (-not $targetFile) {
    [Console]::Error.WriteLine("error: no file specified to upload")
    Print-Usage
    exit 1
}

if (-not (Test-Path $targetFile)) {
    [Console]::Error.WriteLine("error: file not found or not readable: $targetFile")
    exit 1
}

$resolved = Resolve-Path $targetFile
$fullPath = $resolved.Path
$normalizedPath = $fullPath.Replace('\', '/')
$ext = [System.IO.Path]::GetExtension($fullPath).ToLower().TrimStart('.')
$contentType = switch ($ext) {
    'zip' { 'application/zip' }
    { $_ -in 'md', 'markdown' } { 'text/markdown; charset=utf-8' }
    { $_ -in 'html', 'htm' } { 'text/html; charset=utf-8' }
    { $_ -in 'js', 'mjs' } { 'text/javascript; charset=utf-8' }
    'css' { 'text/css; charset=utf-8' }
    'png' { 'image/png' }
    { $_ -in 'jpg', 'jpeg' } { 'image/jpeg' }
    'gif' { 'image/gif' }
    'webp' { 'image/webp' }
    'svg' { 'image/svg+xml' }
    'avif' { 'image/avif' }
    'ico' { 'image/x-icon' }
    'bmp' { 'image/bmp' }
    'mp4' { 'video/mp4' }
    'webm' { 'video/webm' }
    'mov' { 'video/quicktime' }
    'm4v' { 'video/mp4' }
    { $_ -in 'ogg', 'ogv' } { 'video/ogg' }
    default { 'application/octet-stream' }
}

$filename = if ($customFilename) { $customFilename } else { [System.IO.Path]::GetFileName($fullPath) }
$uploadUrl = "$baseUrl/api/cli/upload?ttl=$ttl"

$curlArgs = @(
    "-s",
    "-w", "`n%{http_code}",
    "-X", "POST",
    $uploadUrl,
    "-H", "Authorization: Bearer $apiKey",
    "-H", "Content-Type: $contentType",
    "-H", "X-Filename: $filename",
    "--data-binary", "@$normalizedPath"
)

$respLines = & curl.exe @curlArgs
if ($LASTEXITCODE -ne 0 -or -not $respLines) {
    [Console]::Error.WriteLine("error: curl execution failed")
    exit 1
}

$httpCode = $respLines[-1]
$respBody = if ($respLines.Count -gt 1) { ($respLines[0..($respLines.Count - 2)]) -join "`n" } else { "" }

if ([int]$httpCode -lt 200 -or [int]$httpCode -ge 300) {
    [Console]::Error.WriteLine("error: upload failed with HTTP $httpCode")
    if ($respBody) { [Console]::Error.WriteLine($respBody) }
    exit 1
}

if ($jsonOut) {
    [Console]::Out.WriteLine($respBody)
    exit 0
}

try {
    $parsed = $respBody | ConvertFrom-Json
    if ($parsed.fullUrl) {
        [Console]::Out.WriteLine($parsed.fullUrl)
        exit 0
    }
} catch {
}

[Console]::Out.WriteLine($respBody)
