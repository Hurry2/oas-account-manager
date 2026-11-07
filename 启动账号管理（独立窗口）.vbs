Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' 以独立应用窗口静默启动账号列表管理工具：
' 不闪黑窗，页面用 Chrome/Edge 的 --app 模式打开（无地址栏/标签栏）
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
batPath = scriptDir & "\启动账号管理（独立窗口）.bat"

If Not fso.FileExists(batPath) Then
  MsgBox "找不到启动脚本：" & vbCrLf & batPath, vbCritical, "OAS 账号列表管理"
  WScript.Quit 1
End If

' 0 = 隐藏窗口, False = 不等待
shell.Run """" & batPath & """", 0, False
