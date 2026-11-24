using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;

internal static class InstallGuardTests
{
    static void Check(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
    }

    static void Reject(string path)
    {
        try { InstallGuard.CheckedTarget(path); }
        catch (IOException) { return; }
        throw new Exception("Unsafe target accepted: " + path);
    }

    static string Digest(string file)
    {
        using (var sha = SHA256.Create())
        using (var input = File.OpenRead(file))
            return BitConverter.ToString(sha.ComputeHash(input)).Replace("-", "");
    }

    public static void Main(string[] args)
    {
        string root = Path.GetFullPath(args[0]);
        string external = Path.GetFullPath(args[1]);
        Check(InstallGuard.CheckedTarget(root) == root, "Dedicated path rejected.");
        Reject(Path.Combine(Path.GetPathRoot(root), InstallGuard.Leaf));
        Reject(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), InstallGuard.Leaf));
        Reject(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), InstallGuard.Leaf));
        Reject(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), InstallGuard.Leaf));
        Reject(Path.GetDirectoryName(root));
        string clean = Path.Combine(root, "resources", "app.asar");
        string modified = Path.Combine(root, "changed.dll");
        string extra = Path.Combine(root, "keep", "personal.txt");
        string outside = Path.Combine(external, "outside.dll");
        Directory.CreateDirectory(Path.GetDirectoryName(clean));
        Directory.CreateDirectory(Path.GetDirectoryName(extra));
        File.WriteAllText(clean, "owned");
        File.WriteAllText(modified, "original");
        File.WriteAllText(extra, "keep");
        var manifest = new Dictionary<string, string> {
            { @"resources\app.asar", Digest(clean) },
            { "changed.dll", Digest(modified) },
            { @"linked\outside.dll", Digest(outside) }
        };
        File.WriteAllText(modified, "modified");
        Check(InstallGuard.RemovePayload(root, manifest) == 2, "Expected two guarded skips.");
        Check(!File.Exists(clean) && !Directory.Exists(Path.GetDirectoryName(clean)), "Owned data remains.");
        Check(File.ReadAllText(modified) == "modified", "Modified file removed.");
        Check(File.ReadAllText(extra) == "keep", "Unknown file removed.");
        Check(File.ReadAllText(outside) == "external", "Junction target changed.");
        Check(Directory.Exists(Path.Combine(root, "linked")), "Unknown junction removed.");
        Console.WriteLine("PASS: path roots, known-file removal, modified/unknown files and junction targets.");
    }
}
