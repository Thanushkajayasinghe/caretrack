$ErrorActionPreference = "SilentlyContinue"
$adb = "C:\Android\platform-tools\adb.exe"
while ($true) {
    & $adb -s 1d8a5b05 reverse tcp:8081 tcp:8081 | Out-Null
    Start-Sleep -Seconds 2
}
