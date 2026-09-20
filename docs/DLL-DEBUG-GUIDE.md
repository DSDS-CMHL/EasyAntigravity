# version.dll 调试日志捕获指南

## 一、DLL 日志位置

```
优先级 1: <AG安装目录>\logs\proxy-YYYYMMDD.log
优先级 2: %TEMP%\antigravity-proxy-logs\proxy-YYYYMMDD.log
```

快速打开：
```powershell
# AG 安装目录的日志
explorer "$env:LOCALAPPDATA\Programs\antigravity\logs"

# TEMP 日志
explorer "$env:TEMP\antigravity-proxy-logs"
```

## 二、全量日志捕获命令

### 2.1 实时监控 DLL 日志（测试时开着）
```powershell
# PowerShell - 实时跟踪 DLL 日志
$logDir = "$env:LOCALAPPDATA\Programs\antigravity\logs"
$logFile = Get-ChildItem $logDir -Filter "proxy-*.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($logFile) {
    Write-Host "监控: $($logFile.FullName)"
    Get-Content $logFile.FullName -Wait -Tail 50
}
```

### 2.2 启动 AG 并捕获所有输出
```powershell
$appDir = "$env:LOCALAPPDATA\Programs\antigravity"

# 捕获 stdout + stderr
$proc = Start-Process -FilePath "$appDir\Antigravity.exe" `
    -ArgumentList "--remote-debugging-port=9333" `
    -PassThru `
    -RedirectStandardOutput "ag_stdout.log" `
    -RedirectStandardError "ag_stderr.log" `
    -WindowStyle Normal

Start-Sleep -Seconds 8

if ($proc.HasExited) {
    Write-Host "进程已退出 ExitCode=$($proc.ExitCode)"
} else {
    Write-Host "进程运行中 PID=$($proc.Id)"
}

Write-Host "`n=== stdout ==="
Get-Content "ag_stdout.log" -ErrorAction SilentlyContinue

Write-Host "`n=== stderr ==="
Get-Content "ag_stderr.log" -ErrorAction SilentlyContinue
```

### 2.3 同时捕获 DLL 日志 + AG 主日志 + Windows 事件
```powershell
$appDir = "$env:LOCALAPPDATA\Programs\antigravity"
$agDataDir = "$env:APPDATA\Antigravity\logs"

Write-Host "========== 测试前 =========="
Write-Host "时间: $(Get-Date)"

# 记录当前日志位置
$dllLogBefore = Get-ChildItem "$appDir\logs" -Filter "proxy-*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$agLogBefore = Get-ChildItem $agDataDir -Filter "main.log" -ErrorAction SilentlyContinue

# 启动 AG
Start-Process -FilePath "$appDir\Antigravity.exe" -ArgumentList "--remote-debugging-port=9333"
Start-Sleep -Seconds 8

Write-Host "`n========== 测试后 =========="

# DLL 日志
Write-Host "`n--- DLL 日志 (最后20行) ---"
$dllLog = Get-ChildItem "$appDir\logs" -Filter "proxy-*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($dllLog) { Get-Content $dllLog.FullName -Tail 20 }

# AG 主日志
Write-Host "`n--- AG main.log (最后20行) ---"
if (Test-Path "$agDataDir\main.log") {
    Get-Content "$agDataDir\main.log" -Tail 20
}

# Windows 事件日志
Write-Host "`n--- Windows 应用错误 ---"
Get-WinEvent -FilterHashtable @{LogName='Application'; Level=2; StartTime=(Get-Date).AddMinutes(-2)} -MaxEvents 5 -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "[$($_.TimeCreated)] $($_.Message.Substring(0, [Math]::Min(200, $_.Message.Length)))"
}

# 进程状态
Write-Host "`n--- 进程状态 ---"
Get-Process -Name "Antigravity" -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, StartTime
if (!(Get-Process -Name "Antigravity" -ErrorAction SilentlyContinue)) {
    Write-Host "AG 未运行"
}
```

### 2.4 开启 DLL 详细日志
修改 `config.json`，提高日志级别：
```json
{
  "log_level": "debug",
  "traffic_logging": true,
  "diagnostics": {
    "agent_ip_probe": true
  }
}
```

### 2.5 完整测试脚本（保存为 test-dll.ps1）
```powershell
param(
    [string]$Label = "test",
    [switch]$EnableDll,
    [switch]$DisableDll
)

$appDir = "$env:LOCALAPPDATA\Programs\antigravity"
$dllPath = "$appDir\version.dll"
$cfgPath = "$appDir\config.json"
$logFile = "dll-test-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"

function Write-Log($msg) {
    $line = "[$(Get-Date -Format 'HH:mm:ss')] $msg"
    Write-Host $line
    Add-Content -Path $logFile -Value $line
}

Write-Log "========== 测试: $Label =========="

# 控制 DLL 状态
if ($EnableDll) {
    if (Test-Path "$dllPath.disabled") { Rename-Item "$dllPath.disabled" "version.dll" -Force }
    Write-Log "DLL: 已启用"
} elseif ($DisableDll) {
    if (Test-Path $dllPath) { Rename-Item $dllPath "version.dll.disabled" -Force }
    Write-Log "DLL: 已禁用"
}

$dllStatus = if (Test-Path $dllPath) { "存在 ($([math]::Round((Get-Item $dllPath).Length/1KB,1))KB)" } else { "不存在" }
Write-Log "DLL 状态: $dllStatus"

# AG 版本
$exe = Get-Item "$appDir\Antigravity.exe" -ErrorAction SilentlyContinue
if ($exe) { Write-Log "AG 版本: $($exe.VersionInfo.FileVersion)" }

# 代理端口
$port = Get-NetTCPConnection -LocalPort 7890 -State Listen -ErrorAction SilentlyContinue
Write-Log "代理 7890: $(if($port){'监听中'}else{'未监听'})"

# 启动 AG
Write-Log "启动 AG..."
$proc = Start-Process -FilePath "$appDir\Antigravity.exe" `
    -ArgumentList "--remote-debugging-port=9333" `
    -PassThru -WindowStyle Normal

Start-Sleep -Seconds 8

# 检查结果
$ag = Get-Process -Name "Antigravity" -ErrorAction SilentlyContinue
if ($ag) {
    Write-Log "✅ AG 启动成功 PID=$($ag[0].Id)"
    $cdp = Get-NetTCPConnection -LocalPort 9333 -ErrorAction SilentlyContinue
    Write-Log "CDP 9333: $(if($cdp){'监听中'}else{'未监听'})"
} else {
    Write-Log "❌ AG 启动失败"
}

# DLL 日志
Write-Log "`n--- DLL 日志 ---"
$dllLog = Get-ChildItem "$appDir\logs" -Filter "proxy-*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($dllLog) {
    Get-Content $dllLog.FullName -Tail 15 | ForEach-Object { Write-Log $_ }
}

# AG 日志
Write-Log "`n--- AG main.log ---"
$agLog = "$env:APPDATA\Antigravity\logs\main.log"
if (Test-Path $agLog) {
    Get-Content $agLog -Tail 10 | ForEach-Object { Write-Log $_ }
}

Write-Log "`n========== 测试完成 =========="
Write-Log "日志已保存: $logFile"
```

使用方法：
```powershell
# 测试无 DLL
.\test-dll.ps1 -Label "2.14.0-无DLL" -DisableDll

# 测试有 DLL
.\test-dll.ps1 -Label "2.14.0-有DLL" -EnableDll
```

## 三、AG 版本检查与回退

### 检查当前版本
```powershell
$exe = "$env:LOCALAPPDATA\Programs\antigravity\Antigravity.exe"
(Get-Item $exe).VersionInfo.FileVersion
```

### 禁用自动更新
```powershell
$yml = "$env:LOCALAPPDATA\Programs\antigravity\resources\app-update.yml"
Copy-Item $yml "$yml.bak" -Force
Set-Content $yml "provider: generic`nurl: http://127.0.0.1:1/manifest/`nupdaterCacheDirName: antigravity-updater" -Encoding UTF8
Write-Host "自动更新已禁用"
```

### 恢复自动更新
```powershell
$yml = "$env:LOCALAPPDATA\Programs\antigravity\resources\app-update.yml"
Copy-Item "$yml.bak" $yml -Force
Write-Host "自动更新已恢复"
```

## 四、关键日志关键词

| DLL 日志关键词 | 含义 |
|---------------|------|
| `DLL 已加载(模拟 version.dll)` | DLL 注入成功 |
| `配置加载成功` | config.json 读取成功 |
| `所有 API Hook 安装成功` | Hook 生效 |
| `SOCKS5: 隧道建立成功` | 代理连接成功 |
| `已注入目标进程: xxx` | 子进程注入成功 |
| `配置加载失败：已进入 BYPASS 模式` | config.json 缺失或损坏 |
| `非 SOCK_STREAM socket 直连` | UDP 流量未走代理 |

| AG main.log 关键词 | 含义 |
|-------------------|------|
| `Starting app (v2.x.x)` | AG 启动成功 |
| `Spawning: ... language_server.exe` | 子进程启动 |
| `Host bridge server listening` | 服务就绪 |
| `Shutting down language server` | 正常关闭 |
| (无新条目) | Electron 未启动 = DLL 冲突 |
