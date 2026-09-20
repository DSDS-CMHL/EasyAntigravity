# EasyAG / version.dll 全量诊断脚本
# 用法: 右键 → 使用 PowerShell 运行
# 输出: dll-diagnostic-<版本号>-<时间戳>.log

param(
    [string]$OutputDir = "$env:USERPROFILE\Desktop"
)

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$appDir = "$env:LOCALAPPDATA\Programs\antigravity"
$agDataDir = "$env:APPDATA\Antigravity"
$agLogDir = "$agDataDir\logs"
$proxyLogDir = "$appDir\logs"

# 获取 AG 版本
$agExe = "$appDir\Antigravity.exe"
$agVersion = "unknown"
if (Test-Path $agExe) {
    $agVersion = (Get-Item $agExe).VersionInfo.FileVersion
}

$logFile = Join-Path $OutputDir "dll-diagnostic-v$agVersion-$timestamp.log"

function Write-Log($msg) {
    $line = "[$(Get-Date -Format 'HH:mm:ss.fff')] $msg"
    Write-Host $line
    Add-Content -Path $logFile -Value $line -Encoding UTF8
}

function Write-Section($title) {
    $separator = "`n" + ("=" * 60)
    Add-Content -Path $logFile -Value $separator -Encoding UTF8
    Add-Content -Path $logFile -Value "  $title" -Encoding UTF8
    Add-Content -Path $logFile -Value $separator -Encoding UTF8
    Write-Host "`n===== $title ====="
}

# 开始采集
Write-Host "EasyAG DLL 全量诊断" -ForegroundColor Cyan
Write-Host "输出文件: $logFile" -ForegroundColor Yellow
Write-Host ""

Add-Content -Path $logFile -Value "EasyAG DLL Diagnostic Report" -Encoding UTF8
Add-Content -Path $logFile -Value "Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -Encoding UTF8
Add-Content -Path $logFile -Value "Machine: $env:COMPUTERNAME" -Encoding UTF8
Add-Content -Path $logFile -Value "User: $env:USERNAME" -Encoding UTF8

# ==================== 1. 系统环境 ====================
Write-Section "1. 系统环境"

Write-Log "Windows 版本: $([System.Environment]::OSVersion.VersionString)"
Write-Log "PowerShell: $($PSVersionTable.PSVersion)"

# VC++ 运行库
Write-Log "`n--- VC++ 运行库 ---"
$vcKeys = @(
    "HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x64"
)
foreach ($k in $vcKeys) {
    if (Test-Path $k) {
        $ver = Get-ItemProperty $k -ErrorAction SilentlyContinue
        Write-Log "VC++ x64: Version=$($ver.Version) Installed=$($ver.Installed)"
    }
}

# 安全软件
Write-Log "`n--- 安全软件进程 ---"
$secProcs = Get-Process | Where-Object { $_.ProcessName -match "360|huorong|qqpc|qqPCRTP|knsd|kav|eset|avast|avg|norton|mcafee|hips|wsctrl|usysdiag" } -ErrorAction SilentlyContinue
if ($secProcs) {
    $secProcs | ForEach-Object { Write-Log "  $($_.ProcessName) (PID: $($_.Id))" }
} else {
    Write-Log "  (未检测到常见安全软件)"
}

# Winsock LSP
Write-Log "`n--- Winsock LSP ---"
try {
    $lspOutput = netsh winsock show 2>&1 | Out-String
    Write-Log $lspOutput.Trim()
} catch {
    Write-Log "  (无法获取)"
}

# ==================== 2. AG 版本信息 ====================
Write-Section "2. Antigravity 版本信息"

Write-Log "安装目录: $appDir"
Write-Log "AG 版本: $agVersion"

if (Test-Path $agExe) {
    $exeItem = Get-Item $agExe
    Write-Log "AG exe 大小: $([math]::Round($exeItem.Length/1MB,1)) MB"
    Write-Log "AG exe 修改时间: $($exeItem.LastWriteTime)"
    
    # PE 位数
    $bytes = [System.IO.File]::ReadAllBytes($agExe)
    $peOffset = [BitConverter]::ToInt32($bytes, 60)
    $machine = [BitConverter]::ToUInt16($bytes, $peOffset + 4)
    $arch = if ($machine -eq 0x8664) { "x64" } elseif ($machine -eq 0x14c) { "x86" } else { "unknown" }
    Write-Log "AG exe 架构: $arch"
} else {
    Write-Log "AG exe: 不存在!"
}

# 更新配置
Write-Log "`n--- 更新配置 ---"
$yml = "$appDir\resources\app-update.yml"
if (Test-Path $yml) {
    Write-Log "app-update.yml:"
    Get-Content $yml | ForEach-Object { Write-Log "  $_" }
}

# ==================== 3. DLL 与配置状态 ====================
Write-Section "3. version.dll 与配置状态"

$dllPath = "$appDir\version.dll"
$cfgPath = "$appDir\config.json"

# DLL 状态
Write-Log "--- version.dll ---"
if (Test-Path $dllPath) {
    $dllItem = Get-Item $dllPath
    Write-Log "  状态: 存在"
    Write-Log "  大小: $([math]::Round($dllItem.Length/1KB,1)) KB"
    Write-Log "  修改时间: $($dllItem.LastWriteTime)"
    
    # DLL 位数
    $dllBytes = [System.IO.File]::ReadAllBytes($dllPath)
    $dllPeOffset = [BitConverter]::ToInt32($dllBytes, 60)
    $dllMachine = [BitConverter]::ToUInt16($dllBytes, $dllPeOffset + 4)
    $dllArch = if ($dllMachine -eq 0x8664) { "x64" } elseif ($dllMachine -eq 0x14c) { "x86" } else { "unknown" }
    Write-Log "  架构: $dllArch"
    Write-Log "  与 AG 匹配: $(if($dllArch -eq $arch){'是'}else{'否'})"
} else {
    Write-Log "  状态: 不存在"
    # 检查 .disabled
    if (Test-Path "$dllPath.disabled") {
        Write-Log "  (发现 .disabled 文件)"
    }
}

# config.json
Write-Log "`n--- config.json ---"
if (Test-Path $cfgPath) {
    $cfgRaw = Get-Content $cfgPath -Raw
    Write-Log "  状态: 存在"
    Write-Log "  内容:"
    $cfgRaw -split "`n" | ForEach-Object { Write-Log "    $_" }
    
    try {
        $cfg = $cfgRaw | ConvertFrom-Json
        Write-Log "`n  解析结果:"
        Write-Log "    proxy: $($cfg.proxy.host):$($cfg.proxy.port) type=$($cfg.proxy.type)"
        Write-Log "    target_processes: $($cfg.target_processes -join ', ')"
        Write-Log "    child_injection: $($cfg.child_injection)"
        Write-Log "    child_injection_mode: $($cfg.child_injection_mode)"
        Write-Log "    fake_ip.enabled: $($cfg.fake_ip.enabled)"
        Write-Log "    log_level: $($cfg.log_level)"
    } catch {
        Write-Log "  JSON 解析失败: $($_.Exception.Message)"
    }
} else {
    Write-Log "  状态: 不存在"
}

# ==================== 4. 代理软件状态 ====================
Write-Section "4. 代理软件状态"

Write-Log "--- 代理端口检测 ---"
$proxyPorts = @(7890, 7891, 7897, 10808, 10809, 20170)
foreach ($p in $proxyPorts) {
    $conn = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    if ($conn) {
        $proc = Get-Process -Id $conn[0].OwningProcess -ErrorAction SilentlyContinue
        Write-Log "  端口 $p : 监听中  进程=$($proc.ProcessName) PID=$($conn[0].OwningProcess)"
    } else {
        Write-Log "  端口 $p : 未监听"
    }
}

# ==================== 5. 当前进程状态 ====================
Write-Section "5. 当前进程状态"

Write-Log "--- Antigravity 进程 ---"
$agProcs = Get-Process -Name "Antigravity" -ErrorAction SilentlyContinue
if ($agProcs) {
    $agProcs | ForEach-Object {
        Write-Log "  PID=$($_.Id)  启动时间=$($_.StartTime)  内存=$([math]::Round($_.WorkingSet64/1MB,1))MB"
    }
} else {
    Write-Log "  (无 Antigravity 进程)"
}

Write-Log "`n--- EasyAG 相关进程 ---"
$easyProcs = Get-Process -Name "node","WebView2Host","EasyAntigravity" -ErrorAction SilentlyContinue
if ($easyProcs) {
    $easyProcs | ForEach-Object {
        Write-Log "  $($_.ProcessName) PID=$($_.Id) 启动时间=$($_.StartTime)"
    }
} else {
    Write-Log "  (无 EasyAG 进程)"
}

# ==================== 6. 启动 AG 并捕获 ====================
Write-Section "6. 启动 AG 并捕获日志"

# 记录日志文件当前状态
Write-Log "`n--- 启动前日志文件状态 ---"
if (Test-Path $proxyLogDir) {
    $proxyLogs = Get-ChildItem $proxyLogDir -Filter "proxy-*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 3
    $proxyLogs | ForEach-Object { Write-Log "  DLL日志: $($_.Name)  大小=$([math]::Round($_.Length/1KB,1))KB  修改=$($_.LastWriteTime)" }
} else {
    Write-Log "  DLL 日志目录不存在: $proxyLogDir"
}

if (Test-Path "$agLogDir\main.log") {
    $mainLogItem = Get-Item "$agLogDir\main.log"
    Write-Log "  AG主日志: main.log  大小=$([math]::Round($mainLogItem.Length/1KB,1))KB  修改=$($mainLogItem.LastWriteTime)"
} else {
    Write-Log "  AG主日志不存在"
}

# 启动 AG
Write-Log "`n--- 启动 Antigravity ---"
Write-Log "命令: $agExe --remote-debugging-port=9333"
$startTime = Get-Date
$stdoutFile = Join-Path $env:TEMP "ag_stdout_$timestamp.log"
$stderrFile = Join-Path $env:TEMP "ag_stderr_$timestamp.log"

$proc = Start-Process -FilePath $agExe `
    -ArgumentList "--remote-debugging-port=9333" `
    -PassThru `
    -RedirectStandardOutput $stdoutFile `
    -RedirectStandardError $stderrFile `
    -WindowStyle Normal

Write-Log "进程已创建 PID=$($proc.Id)"
Write-Log "等待 10 秒..."
Start-Sleep -Seconds 10

# 检查进程状态
if ($proc.HasExited) {
    Write-Log "⚠️ 进程已退出 ExitCode=$($proc.ExitCode) 运行时间=$((Get-Date) - $startTime)"
} else {
    Write-Log "✅ 进程仍在运行 PID=$($proc.Id) 运行时间=$((Get-Date) - $startTime)"
}

# 检查 CDP
$cdp = Get-NetTCPConnection -LocalPort 9333 -ErrorAction SilentlyContinue
Write-Log "CDP 9333: $(if($cdp){'监听中'}else{'未监听'})"

# 检查 AG 进程
$agProcsAfter = Get-Process -Name "Antigravity" -ErrorAction SilentlyContinue
if ($agProcsAfter) {
    Write-Log "AG 进程数: $($agProcsAfter.Count)"
    $agProcsAfter | ForEach-Object { Write-Log "  PID=$($_.Id) 内存=$([math]::Round($_.WorkingSet64/1MB,1))MB" }
} else {
    Write-Log "AG 进程: 无"
}

# stdout/stderr
Write-Log "`n--- AG stdout ---"
if (Test-Path $stdoutFile) {
    $stdout = Get-Content $stdoutFile -Raw -ErrorAction SilentlyContinue
    if ($stdout) { Write-Log $stdout } else { Write-Log "  (空)" }
} else {
    Write-Log "  (文件不存在)"
}

Write-Log "`n--- AG stderr ---"
if (Test-Path $stderrFile) {
    $stderr = Get-Content $stderrFile -Raw -ErrorAction SilentlyContinue
    if ($stderr) { Write-Log $stderr } else { Write-Log "  (空)" }
} else {
    Write-Log "  (文件不存在)"
}

# ==================== 7. DLL 日志（启动后） ====================
Write-Section "7. DLL 日志 (启动后)"

if (Test-Path $proxyLogDir) {
    $latestProxyLog = Get-ChildItem $proxyLogDir -Filter "proxy-*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latestProxyLog) {
        Write-Log "日志文件: $($latestProxyLog.FullName)"
        Write-Log "文件大小: $([math]::Round($latestProxyLog.Length/1KB,1)) KB"
        Write-Log "修改时间: $($latestProxyLog.LastWriteTime)"
        Write-Log "`n--- 内容 (最后 40 行) ---"
        Get-Content $latestProxyLog.FullName -Tail 40 -ErrorAction SilentlyContinue | ForEach-Object { Write-Log $_ }
    } else {
        Write-Log "未找到 DLL 日志文件"
    }
} else {
    Write-Log "DLL 日志目录不存在: $proxyLogDir"
}

# 检查 TEMP 目录
$tempProxyLogDir = "$env:TEMP\antigravity-proxy-logs"
if (Test-Path $tempProxyLogDir) {
    Write-Log "`n--- TEMP DLL 日志 ---"
    $tempLogs = Get-ChildItem $tempProxyLogDir -Filter "proxy-*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($tempLogs) {
        Write-Log "文件: $($tempLogs.FullName)"
        Get-Content $tempLogs.FullName -Tail 20 -ErrorAction SilentlyContinue | ForEach-Object { Write-Log $_ }
    }
}

# ==================== 8. AG 主日志（启动后） ====================
Write-Section "8. AG 主日志 (启动后)"

$mainLogPath = "$agLogDir\main.log"
if (Test-Path $mainLogPath) {
    Write-Log "文件: $mainLogPath"
    $mainLogItem = Get-Item $mainLogPath
    Write-Log "修改时间: $($mainLogItem.LastWriteTime)"
    Write-Log "`n--- 内容 (最后 30 行) ---"
    Get-Content $mainLogPath -Tail 30 -ErrorAction SilentlyContinue | ForEach-Object { Write-Log $_ }
} else {
    Write-Log "AG 主日志不存在: $mainLogPath"
}

# language_server 日志
$lsLogPath = "$agLogDir\language_server.log"
if (Test-Path $lsLogPath) {
    Write-Log "`n--- language_server.log (最后 20 行) ---"
    Get-Content $lsLogPath -Tail 20 -ErrorAction SilentlyContinue | ForEach-Object { Write-Log $_ }
}

# ==================== 9. Windows 事件日志 ====================
Write-Section "9. Windows 事件日志"

Write-Log "--- 应用错误 (最近5分钟) ---"
try {
    $events = Get-WinEvent -FilterHashtable @{
        LogName = 'Application'
        Level = 2
        StartTime = $startTime.AddMinutes(-1)
    } -MaxEvents 10 -ErrorAction SilentlyContinue
    if ($events) {
        $events | ForEach-Object {
            Write-Log "[$($_.TimeCreated)] [$($_.ProviderName)]"
            $msg = $_.Message
            if ($msg.Length -gt 300) { $msg = $msg.Substring(0, 300) + "..." }
            Write-Log "  $msg"
        }
    } else {
        Write-Log "  (无错误事件)"
    }
} catch {
    Write-Log "  查询失败: $($_.Exception.Message)"
}

# ==================== 10. 清理与总结 ====================
Write-Section "10. 诊断总结"

Write-Log "AG 版本: $agVersion"
Write-Log "DLL 状态: $(if(Test-Path $dllPath){'存在'}else{'不存在'})"
Write-Log "AG 进程: $(if($agProcsAfter){'运行中'}else{'未运行'})"
Write-Log "CDP 9333: $(if($cdp){'监听中'}else{'未监听'})"

# 判断结果
if ($agProcsAfter -and $cdp) {
    Write-Log "`n✅ 结论: DLL 工作正常，AG 启动成功"
} elseif ($agProcsAfter -and !$cdp) {
    Write-Log "`n⚠️ 结论: AG 运行中但 CDP 未就绪"
} else {
    Write-Log "`n❌ 结论: AG 启动失败"
    Write-Log "  可能原因:"
    Write-Log "  1. version.dll Hook 与 AG 版本不兼容"
    Write-Log "  2. 安全软件拦截"
    Write-Log "  3. 配置文件错误"
}

Write-Log "`n--- 附加上下文 ---"
Write-Log "stdout 日志: $stdoutFile"
Write-Log "stderr 日志: $stderrFile"

# 完成
Write-Host "`n" -NoNewline
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  诊断完成!" -ForegroundColor Green
Write-Host "  日志文件: $logFile" -ForegroundColor Yellow
Write-Host "  请将此文件发给 MiMo 进行分析" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Green

# 自动打开日志文件
Start-Process notepad.exe $logFile
