Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' 静默启动账号列表管理工具：不闪黑窗
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
batPath = scriptDir & "\启动账号管理（无窗口）.bat"

If Not fso.FileExists(batPath) Then
  MsgBox "找不到启动脚本：" & vbCrLf & batPath, vbCritical, "OAS 账号列表管理"
  WScript.Quit 1
End If

' 0 = 隐藏窗口, False = 不等待
shell.Run """" & batPath & """", 0, False
