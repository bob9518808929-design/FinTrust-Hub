$ErrorActionPreference = "Continue"
$backend = "c:\Users\Windws\Desktop\caiwu\jinrong\production\backend"
$py = Join-Path $backend ".venv\Scripts\python.exe"

# 杀掉占用 8000 的旧进程
$old = netstat -ano | Select-String ":8000\s.*LISTENING"
foreach ($line in $old) {
    $parts = ($line.Line.Trim() -split "\s+")
    $pidToKill = $parts[-1]
    if ($pidToKill -match "^\d+$") { Stop-Process -Id $pidToKill -Force -ErrorAction SilentlyContinue }
}
Start-Sleep 1

# 分离启动 uvicorn (无 --reload, 更稳定)
Start-Process -FilePath $py -ArgumentList "-m","uvicorn","app.main:app","--host","0.0.0.0","--port","8000" -WorkingDirectory $backend -WindowStyle Hidden

Start-Sleep 8
$listening = netstat -ano | Select-String ":8000\s.*LISTENING"
if ($listening) {
    Write-Output "BACKEND_OK: $($listening.Line.Trim())"
} else {
    Write-Output "BACKEND_FAIL"
    if (Test-Path "$backend\logs") { Get-ChildItem "$backend\logs" | Sort-Object LastWriteTime -Descending | Select-Object -First 3 Name }
}
