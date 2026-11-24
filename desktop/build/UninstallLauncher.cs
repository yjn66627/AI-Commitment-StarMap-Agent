// Chinese standalone uninstall entry for the user-facing ZIP root.
// Reads the official Windows uninstall registration and invokes it normally;
// never deletes files or registry keys by itself. Built with .NET Framework C# compiler.
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
using Microsoft.Win32;
using System.Text.RegularExpressions;

internal static class UninstallLauncher {
    [STAThread] private static void Main() {
        try {
            var registration=FindInstalled();
            if(registration==null) {
                MessageBox.Show("未发现已安装的《AI承诺审计星图-智能体》V2.0。\n请先安装程序，或从Windows‘已安装的应用’中管理其他版本。", "卸载 AI承诺审计星图-智能体",MessageBoxButtons.OK,MessageBoxIcon.Information);
                return;
            }
            var input=registration.UninstallString;
            // Accept the standard quoted NSIS executable path plus optional installer-issued arguments.
            var match=Regex.Match(input,@"^\s*""(?<exe>[A-Za-z]:\\[^""\r\n]+\.exe)""(?<args>\s[^\r\n]*)?\s*$",RegexOptions.IgnoreCase);
            if(!match.Success)throw new InvalidOperationException("卸载登记格式异常，未执行任何程序。请通过Windows系统卸载入口卸载。 ");
            var executable=match.Groups["exe"].Value;
            if(!File.Exists(executable))throw new FileNotFoundException("官方卸载程序不存在，请通过Windows已安装应用检查安装状态。",executable);
            var question=MessageBox.Show("即将打开正式Windows卸载向导。\n标准卸载默认保留个人项目；完全卸载还需在向导中另行确认。\n\n继续吗？", "卸载 AI承诺审计星图-智能体",MessageBoxButtons.YesNo,MessageBoxIcon.Question,MessageBoxDefaultButton.Button2);
            if(question!=DialogResult.Yes)return;
            var args=match.Groups["args"].Value.Trim();
            Process.Start(new ProcessStartInfo { FileName=executable,Arguments=args,UseShellExecute=true });
        }catch(Exception ex) {
            MessageBox.Show("无法启动卸载："+ex.Message,"卸载 AI承诺审计星图-智能体",MessageBoxButtons.OK,MessageBoxIcon.Error);
        }
    }
    private static bool IsProductName(string name) { return name!=null && Regex.IsMatch(name,@"^AI承诺审计星图-智能体(?:\s+\(?[vV]?2\.0(?:\.0)?\)?)?$"); }
    private sealed class Installed { public string UninstallString; public Version Version; }
    private static Installed FindInstalled() {
        Installed choice=null;
        foreach(var root in new[]{Registry.CurrentUser}) {
            using(var uninstall=root.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall")) {
                if(uninstall==null)continue;
                foreach(var key in new[]{"AI-Commitment-StarMap-Agent"}) {
                    using(var item=uninstall.OpenSubKey(key)) {
                        if(item==null)continue;
                        var name=item.GetValue("DisplayName") as string;
                        var version=item.GetValue("DisplayVersion") as string;
                        var cmd=item.GetValue("UninstallString") as string;
                        if(!IsProductName(name)||string.IsNullOrWhiteSpace(cmd))continue;
                        Version parsed;
                        if(!Version.TryParse(version,out parsed)||parsed.Major!=2||parsed.Minor!=0)continue;
                        if(choice==null||parsed.CompareTo(choice.Version)>0)choice=new Installed{UninstallString=cmd,Version=parsed};
                    }
                }
            }
        }
        return choice;
    }
}
