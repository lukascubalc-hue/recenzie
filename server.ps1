param([int]$port = 8080)

# Load .env file if it exists
$envVariables = @{}
$envPath = Join-Path $PSScriptRoot ".env"
if (Test-Path -Path $envPath -PathType Leaf) {
    Get-Content $envPath | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
            $parts = $line.Split("=", 2)
            $key = $parts[0].Trim()
            $val = $parts[1].Trim()
            $envVariables[$key] = $val
        }
    }
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Prefixes.Add("http://127.0.0.1:$port/")
$listener.Start()
Write-Host "Dev server running at http://localhost:$port/"

$mimeTypes = @{
    ".html"        = "text/html; charset=utf-8"
    ".css"         = "text/css; charset=utf-8"
    ".js"          = "application/javascript; charset=utf-8"
    ".svg"         = "image/svg+xml"
    ".json"        = "application/json; charset=utf-8"
    ".webmanifest" = "application/manifest+json"
    ".ico"         = "image/x-icon"
}

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $relPath = $request.Url.LocalPath.TrimStart('/')
        if ([string]::IsNullOrWhiteSpace($relPath)) {
            $relPath = "index.html"
        }

        # API endpoint to safely supply environment config to client
        if ($relPath -eq "api/config") {
            $token = ""
            if (Test-Path -Path $envPath -PathType Leaf) {
                Get-Content $envPath | ForEach-Object {
                    $l = $_.Trim()
                    if ($l -and -not $l.StartsWith("#") -and $l.Contains("=")) {
                        $p = $l.Split("=", 2)
                        if ($p[0].Trim() -eq "APIFY_API_TOKEN") {
                            $token = $p[1].Trim()
                        }
                    }
                }
            }
            $json = @{ apifyToken = $token } | ConvertTo-Json
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
            $response.ContentType = "application/json; charset=utf-8"
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            $response.OutputStream.Close()
            continue
        }

        # Security: Never serve .env or git files directly
        if ($relPath.StartsWith(".") -or $relPath -like "*.env*") {
            $response.StatusCode = 403
            $msg = [System.Text.Encoding]::UTF8.GetBytes("403 Forbidden")
            $response.ContentLength64 = $msg.Length
            $response.OutputStream.Write($msg, 0, $msg.Length)
            $response.OutputStream.Close()
            continue
        }

        $filePath = Join-Path $PSScriptRoot $relPath

        if (Test-Path -Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $contentType = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { "application/octet-stream" }
            $response.ContentType = $contentType
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 404
            $msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
            $response.ContentLength64 = $msg.Length
            $response.OutputStream.Write($msg, 0, $msg.Length)
        }
        $response.OutputStream.Close()
    }
} finally {
    $listener.Stop()
}
