<#
    创建「账号列表管理工具」的桌面快捷方式。

    用法（任选其一）：
      1. 右键本文件 → 使用 PowerShell 运行
      2. 在 PowerShell 里执行：
         powershell -ExecutionPolicy Bypass -File install-shortcut.ps1

    参数：
      -StartMenu      同时创建开始菜单快捷方式
      -TargetDir <路径>  指定快捷方式放在哪个目录（默认桌面），用于测试/自定义
      -BrowserMode    用普通浏览器打开（不加 --app 独立窗口），默认是独立窗口

    快捷方式指向 <解释器> + server.py --app，双击不会弹黑色控制台窗口，
    页面用 Chrome/Edge 的应用窗口打开（无地址栏、无标签栏，像桌面应用）。
    关闭工具用页面右下角「退出工具」，或目录里的「关闭账号管理.bat」。

    解释器按以下顺序找（和 _find_python.bat 一致，工具可独立部署）：
      1. ACCOUNT_MANAGER_PYTHONW / ACCOUNT_MANAGER_PYTHON 环境变量
      2. 工具目录下的 python\pythonw.exe（便携部署）
      3. 工具目录下的 toolkit\pythonw.exe（OAS 旧布局）
      4. 向上找 toolkit\pythonw.exe
      5. PATH 上的 pythonw.exe / python.exe
#>
[CmdletBinding()]
param(
    [switch]$StartMenu,
    [string]$TargetDir,
    [switch]$BrowserMode
)

$ErrorActionPreference = 'Stop'

# ------------------------------------------------------------------ 定位工具目录
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = Join-Path $scriptDir 'server.py'

# 解释器：便携 python/ → toolkit/ → 向上找 → PATH
function Find-PythonW {
    param([string]$ToolDir)

    $envCandidates = @($env:ACCOUNT_MANAGER_PYTHONW, $env:ACCOUNT_MANAGER_PYTHON)
    foreach ($c in $envCandidates) {
        if ($c -and (Test-Path -LiteralPath $c)) { return $c }
    }

    $direct = @(
        (Join-Path $ToolDir 'python\pythonw.exe'),
        (Join-Path $ToolDir 'python\python.exe'),
        (Join-Path $ToolDir 'toolkit\pythonw.exe'),
        (Join-Path $ToolDir 'toolkit\python.exe')
    )
    foreach ($c in $direct) {
        if (Test-Path -LiteralPath $c) { return $c }
    }

    # 向上找 toolkit/
    $dir = $ToolDir
    for ($i = 0; $i -lt 8; $i++) {
        $parent = Split-Path -Parent $dir
        if (-not $parent -or $parent -eq $dir) { break }
        $dir = $parent
        foreach ($name in @('pythonw.exe', 'python.exe')) {
            $c = Join-Path $dir ('toolkit\' + $name)
            if (Test-Path -LiteralPath $c) { return $c }
        }
    }

    # PATH
    foreach ($name in @('pythonw.exe', 'python.exe')) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        if ($cmd) { return $cmd.Source }
    }
    return $null
}

$pythonw = Find-PythonW -ToolDir $scriptDir

Write-Host '账号列表管理工具 — 创建快捷方式'
Write-Host ('  工具目录: ' + $scriptDir)
Write-Host ('  解释器  : ' + $(if ($pythonw) { $pythonw } else { '（未找到）' }))
Write-Host ('  启动脚本: ' + $server)
Write-Host ''

if (-not $pythonw) {
    $msg = '找不到 Python 解释器。请设置 ACCOUNT_MANAGER_PYTHONW 环境变量，' +
           '或在工具目录放一份 python\pythonw.exe'
    Write-Error $msg
}
foreach ($path in @($pythonw, $server)) {
    if (-not (Test-Path -LiteralPath $path)) {
        Write-Error ('缺少文件: ' + $path)
    }
}

# ------------------------------------------------------------------ 选图标
$iconCandidates = @(
    $pythonw,
    (Join-Path $env:SystemRoot 'System32\shell32.dll')
)
$iconLocation = $null
foreach ($candidate in $iconCandidates) {
    if (Test-Path -LiteralPath $candidate) {
        $iconLocation = $candidate + ',0'
        break
    }
}

# ------------------------------------------------------------------ 建快捷方式
function New-ToolShortcut {
    param(
        [Parameter(Mandatory)][string]$Directory,
        [Parameter(Mandatory)][string]$FileName
    )

    if (-not (Test-Path -LiteralPath $Directory)) {
        New-Item -ItemType Directory -Path $Directory -Force | Out-Null
    }

    $linkPath = Join-Path $Directory $FileName
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($linkPath)
    $shortcut.TargetPath = $pythonw
    $appArg = if ($BrowserMode) { '' } else { ' --app' }
    $shortcut.Arguments = '-B "' + $server + '"' + $appArg
    $shortcut.WorkingDirectory = $scriptDir
    $shortcut.Description = 'OAS 账号列表管理：排序 / 插队 / 删除多账号'
    $shortcut.WindowStyle = 7   # 7 = 最小化，万一有窗口也不挡视线
    if ($iconLocation) {
        $shortcut.IconLocation = $iconLocation
    }
    $shortcut.Save()
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)

    if (-not (Test-Path -LiteralPath $linkPath)) {
        throw ('创建失败: ' + $linkPath)
    }
    return $linkPath
}

$created = @()

if ($TargetDir) {
    $created += New-ToolShortcut -Directory $TargetDir -FileName 'OAS 账号列表管理.lnk'
} else {
    $desktop = [Environment]::GetFolderPath('Desktop')
    if (-not $desktop) {
        throw '找不到桌面目录，请用 -TargetDir 手动指定'
    }
    $created += New-ToolShortcut -Directory $desktop -FileName 'OAS 账号列表管理.lnk'
}

if ($StartMenu) {
    $startMenuDir = Join-Path ([Environment]::GetFolderPath('Programs')) 'OAS 账号列表管理'
    $created += New-ToolShortcut -Directory $startMenuDir -FileName '账号列表管理.lnk'
}

Write-Host '已创建：'
foreach ($item in $created) {
    Write-Host ('  ' + $item)
}
Write-Host ''
Write-Host '双击即可启动（不会弹控制台窗口）。'
Write-Host '退出方式：页面右下角「退出工具」按钮，或双击目录里的 关闭账号管理.bat'
Write-Host '注意：修改账号表前请先停止运行中的 OAS 实例，否则配置会被脚本进程回写覆盖。'
