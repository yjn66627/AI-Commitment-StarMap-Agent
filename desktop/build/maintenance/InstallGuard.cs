using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

internal static class InstallGuard
{
    internal const string Leaf = "AI-Commitment-StarMap-Agent";
    internal const string Uninstaller = "Uninstall.exe";
    internal const string AppExe = "AI承诺审计星图-智能体.exe";
    const string Registration = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\AI-Commitment-StarMap-Agent";
    const string DataMarker = "AI_COMMITMENT_STARMAP_OWNED_PROFILE_V15\n";
    const uint Reparse = 0x400;
    const uint DirectoryFlag = 0x10;

    [StructLayout(LayoutKind.Sequential)]
    struct FileInfo
    {
        public uint Attributes, CreatedLow, CreatedHigh, AccessLow, AccessHigh, WriteLow, WriteHigh,
            Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security,
        uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetFileInformationByHandle(SafeFileHandle file, out FileInfo info);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetFileInformationByHandle(SafeFileHandle file, int kind, ref byte disposition, uint size);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateDirectory(string path, IntPtr security);

    static SafeFileHandle Open(string path, bool directory, bool writeDisposition)
    {
        uint access = writeDisposition ? (directory ? 0x10080u : 0x80010080u) : 0x80u;
        uint share = directory ? 3u : 1u;
        var handle = CreateFile(path, access, share, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
        FileInfo info;
        if (handle.IsInvalid || !GetFileInformationByHandle(handle, out info) ||
            (info.Attributes & Reparse) != 0 || ((info.Attributes & DirectoryFlag) != 0) != directory ||
            (!directory && info.Links != 1))
        {
            handle.Dispose();
            throw new IOException("Unsafe or unavailable filesystem entry.");
        }
        return handle;
    }

    sealed class DirectoryChain : IDisposable
    {
        readonly List<SafeFileHandle> handles = new List<SafeFileHandle>();
        public DirectoryChain(string path)
        {
            try
            {
                var stack = new Stack<string>();
                for (var directory = new DirectoryInfo(path); directory != null; directory = directory.Parent)
                    stack.Push(directory.FullName);
                foreach (string entry in stack) handles.Add(Open(entry, true, false));
            }
            catch { Dispose(); throw; }
        }
        public void Dispose()
        {
            for (int i = handles.Count - 1; i >= 0; --i) handles[i].Dispose();
        }
    }

    static bool Same(string a, string b) { return String.Equals(a, b, StringComparison.OrdinalIgnoreCase); }
    static bool Under(string path, string root)
    {
        return !String.IsNullOrEmpty(root) &&
            (Same(path, root) || path.StartsWith(root.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase));
    }

    internal static string CheckedTarget(string path)
    {
        if (path.Length < 4 || !Char.IsLetter(path[0]) || path[1] != ':' || path[2] != '\\' ||
            path.IndexOf(':', 2) >= 0 || path.IndexOf('/') >= 0 || !Same(Path.GetFullPath(path), path))
            throw new IOException("Invalid installation path.");
        if (!Same(Path.GetFileName(path), Leaf)) throw new IOException("A dedicated app directory is required.");
        var parent = Directory.GetParent(path).FullName;
        if (Same(parent, Path.GetPathRoot(parent))) throw new IOException("Volume roots are disallowed.");
        foreach (var special in new[] { Environment.SpecialFolder.Windows, Environment.SpecialFolder.ProgramFiles,
            Environment.SpecialFolder.ProgramFilesX86, Environment.SpecialFolder.CommonApplicationData,
            Environment.SpecialFolder.DesktopDirectory, Environment.SpecialFolder.MyDocuments,
            Environment.SpecialFolder.CommonDesktopDirectory, Environment.SpecialFolder.CommonDocuments })
            if (Under(parent, Environment.GetFolderPath(special))) throw new IOException("Protected parent.");
        if (Same(parent, Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)) ||
            Same(parent, Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData)) ||
            Same(parent, Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)) ||
            new DriveInfo(Path.GetPathRoot(path)).DriveType != DriveType.Fixed)
            throw new IOException("Protected or non-local parent.");
        return path;
    }

    static string Hash(Stream stream)
    {
        using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "");
    }
    static string HashPath(string path)
    {
        using (var file = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.Read)) return Hash(file);
    }

    internal static bool RemoveOwnedFile(string path, string expected)
    {
        try
        {
            using (var handle = Open(path, false, true))
            using (var stream = new FileStream(handle, FileAccess.Read))
            {
                if (expected != null && !Same(Hash(stream), expected)) return false;
                byte disposition = 1;
                if (!SetFileInformationByHandle(handle, 4, ref disposition, 1))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                return true;
            }
        }
        catch (IOException) { return false; }
        catch (UnauthorizedAccessException) { return false; }
        catch (Win32Exception) { return false; }
    }

    internal static int RemovePayload(string root, IDictionary<string, string> manifest)
    {
        var dirs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        int retained = 0;
        using (new DirectoryChain(root))
        {
            foreach (var item in manifest)
            {
                string file = Path.Combine(root, item.Key);
                string parent = Path.GetDirectoryName(file);
                for (string dir = parent; !Same(dir, root); dir = Path.GetDirectoryName(dir)) dirs.Add(dir);
                try
                {
                    using (new DirectoryChain(parent))
                    {
                        if ((File.Exists(file) || Directory.Exists(file)) &&
                            !RemoveOwnedFile(file, item.Value)) ++retained;
                    }
                }
                catch (IOException) { ++retained; }
            }
            var ordered = new List<string>(dirs);
            ordered.Sort((a, b) => b.Length.CompareTo(a.Length));
            foreach (string dir in ordered) RemoveEmpty(dir);
        }
        RemoveEmpty(root);
        return retained;
    }

    static void RemoveEmpty(string directory)
    {
        try
        {
            using (new DirectoryChain(Path.GetDirectoryName(directory)))
            using (var handle = Open(directory, true, true))
            {
                byte disposition = 1;
                SetFileInformationByHandle(handle, 4, ref disposition, 1);
            }
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    static Dictionary<string, string> Manifest()
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        using (var data = new StreamReader(typeof(InstallGuard).Assembly.GetManifestResourceStream("Payload")))
        {
            string line;
            while ((line = data.ReadLine()) != null)
            {
                string file = line.Substring(65);
                if (Path.IsPathRooted(file) || file.IndexOf(':') >= 0 || file.IndexOf('/') >= 0 ||
                    Array.Exists(file.Split('\\'), p => p == "" || p == "." || p == ".."))
                    throw new IOException("Invalid embedded manifest.");
                result.Add(file, line.Substring(0, 64));
            }
        }
        return result;
    }

    static int Install(string root, string staging)
    {
        var files = Manifest();
        files.Add(Uninstaller, HashPath(Path.Combine(staging, Uninstaller)));
        using (var existing = Registry.CurrentUser.OpenSubKey(Registration))
            if (existing != null) throw new IOException("Uninstall the registered existing instance first.");
        string parentDirectory = Path.GetDirectoryName(root);
        string programs = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs");
        if (Same(parentDirectory, programs) && !Directory.Exists(programs))
            using (new DirectoryChain(Path.GetDirectoryName(programs)))
                if (!CreateDirectory(programs, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
        using (new DirectoryChain(parentDirectory))
        {
            if (!Same(parentDirectory, programs) && Directory.GetFileSystemEntries(parentDirectory).Length != 0)
                throw new IOException("Choose an empty custom parent directory.");
            // The final leaf must be freshly created, never merged with another directory.
            if (!CreateDirectory(root, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
            using (new DirectoryChain(root))
            {
                foreach (var item in files)
                {
                    string source = Path.Combine(staging, item.Key);
                    string destination = Path.Combine(root, item.Key);
                    if (!Same(HashPath(source), item.Value)) throw new IOException("Payload hash mismatch.");
                    string parent = Path.GetDirectoryName(destination);
                    CreatePayloadDirectories(root, parent);
                    using (new DirectoryChain(parent)) File.Copy(source, destination, false);
                }
                using (var key = Registry.CurrentUser.CreateSubKey(Registration))
                {
                    key.SetValue("InstallLocation", root);
                    key.SetValue("UninstallerSHA256", files[Uninstaller]);
                    key.SetValue("DisplayName", "AI承诺审计星图-智能体");
                    key.SetValue("DisplayVersion", "2.0.0");
                    key.SetValue("DisplayIcon", Path.Combine(root, AppExe));
                    key.SetValue("UninstallString", "\"" + Path.Combine(root, Uninstaller) + "\"");
                    key.SetValue("NoModify", 1);
                    key.SetValue("NoRepair", 1);
                }
            }
        }
        return 0;
    }

    static void CreatePayloadDirectories(string root, string parent)
    {
        var pending = new Stack<string>();
        for (string path = parent; !Same(path, root); path = Path.GetDirectoryName(path)) pending.Push(path);
        foreach (string path in pending)
            using (new DirectoryChain(Path.GetDirectoryName(path)))
            {
                if (!Directory.Exists(path) && !CreateDirectory(path, IntPtr.Zero))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
            }
    }

    static bool HasLegacyRegistration()
    {
        foreach (RegistryHive hive in new[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine })
        foreach (RegistryView view in new[] { RegistryView.Registry32, RegistryView.Registry64 })

        using (var root = RegistryKey.OpenBaseKey(hive, view))
        using (var legacy = root.OpenSubKey(@"Software\" + LegacyInstaller.Guid))
        using (var entries = root.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall"))
        {
            if (legacy != null) return true;
            if (entries == null) continue;
            foreach (string name in entries.GetSubKeyNames())
            {
                if (hive == RegistryHive.CurrentUser && Same(name, Leaf)) continue;
                using (var item = entries.OpenSubKey(name))
                {
                    string display = item == null ? null : item.GetValue("DisplayName") as string;
                    if (Same(name.Trim('{','}'), LegacyInstaller.Guid) ||
                        Same(name, "AI-Commitment-StarMap-V151") ||
                        (display != null && display.StartsWith("AI承诺审计星图", StringComparison.OrdinalIgnoreCase)))
                        return true;
                }
            }
        }
        return false;
    }

    static void RemoveProfileTree(string path)
    {
        using (new DirectoryChain(path))
        {
            foreach (string file in Directory.GetFiles(path)) RemoveOwnedFile(file, null);
            foreach (string dir in Directory.GetDirectories(path))
                if ((File.GetAttributes(dir) & FileAttributes.ReparsePoint) == 0) RemoveProfileTree(dir);
        }
        RemoveEmpty(path);
    }

    static int Uninstall(string root, bool purge)
    {
        var files = Manifest();
        using (var key = Registry.CurrentUser.OpenSubKey(Registration))
        {
            if (key == null || !Same(key.GetValue("InstallLocation") as string, root))
                throw new IOException("Untrusted uninstall location.");
            string checksum = key.GetValue("UninstallerSHA256") as string;
            if (checksum == null || !System.Text.RegularExpressions.Regex.IsMatch(checksum, "^[0-9A-F]{64}$"))
                throw new IOException("Invalid uninstaller record.");
            files.Add(Uninstaller, checksum);
        }
        using (new DirectoryChain(root))
        using (var uninstaller = Open(Path.Combine(root, Uninstaller), false, false))
        {
            if (!Same(HashPath(Path.Combine(root, Uninstaller)), files[Uninstaller]))
                throw new IOException("Uninstaller hash does not match registration.");
        }
        foreach (string name in new[] { Path.GetFileNameWithoutExtension(AppExe), "AI承诺审计星图-智能体 V1.5" })
            if (Process.GetProcessesByName(name).Length != 0) throw new IOException("Close the desktop application.");
        if (purge)
        {
            if (HasLegacyRegistration()) throw new IOException("Another installation may own the shared profile.");
            string profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "AICommitmentStarMap-Production");
            using (new DirectoryChain(profile))
            {
                using (var marker = Open(Path.Combine(profile, ".starmap-owner-v15"), false, false))
                    if (File.ReadAllText(Path.Combine(profile, ".starmap-owner-v15")) != DataMarker)
                        throw new IOException("Profile ownership not established.");
                RemoveProfileTree(profile);
            }
            RemoveEmpty(profile);
            if (Directory.Exists(profile)) throw new IOException("Some profile entries were preserved.");
        }
        int retained = RemovePayload(root, files);
        Registry.CurrentUser.DeleteSubKey(Registration);
        return retained == 0 ? 0 : 2;
    }

    public static int Main(string[] args)
    {
        try
        {
            if (args.Length == 3 && args[0] == "install") return Install(CheckedTarget(args[1]), args[2]);
            if (args.Length == 2 && args[0] == "uninstall") return Uninstall(CheckedTarget(args[1]), false);
            if (args.Length == 2 && args[0] == "purge") return Uninstall(CheckedTarget(args[1]), true);
            return 1;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            return 1;
        }
    }
}
