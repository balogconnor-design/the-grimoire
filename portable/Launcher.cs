// Commander Deck portable launcher.
// Serves the built app from .\app on a fixed localhost port and opens it in an
// Edge/Chrome "app" window whose browser profile lives in .\data, so decks and
// collection data travel with the folder (e.g. on a flash drive).
// Compiled by build-portable.ps1 with the .NET Framework csc.exe that ships with Windows.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Management;
using System.Net;
using System.Threading;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("Commander Deck")]
[assembly: System.Reflection.AssemblyProduct("Commander Deck")]

static class Launcher
{
    // Fixed port: the browser keys saved data to the origin, so it must never change.
    const int Port = 47823;
    static readonly string Url = "http://localhost:" + Port + "/";
    static string root, appDir, profileDir;

    [STAThread]
    static int Main()
    {
        root = AppDomain.CurrentDomain.BaseDirectory;
        appDir = Path.Combine(root, "app");
        profileDir = Path.Combine(root, "data", "browser-profile");

        if (!File.Exists(Path.Combine(appDir, "index.html")))
            return Fail("The \"app\" folder is missing next to Commander Deck.exe.\nCopy the whole \"Commander Deck\" folder, not just the .exe.");

        bool first;
        using (var mutex = new Mutex(true, "CommanderDeckPortable-" + Port, out first))
        {
            if (!first)
            {
                // Already running: just open another window on the same profile.
                OpenBrowser();
                return 0;
            }

            HttpListener listener;
            try
            {
                listener = new HttpListener();
                listener.Prefixes.Add(Url);
                listener.Start();
            }
            catch (Exception e)
            {
                return Fail("Could not start the local server on port " + Port + ".\n\n" + e.Message);
            }
            new Thread(() => Serve(listener)) { IsBackground = true }.Start();

            Process browser = OpenBrowser();
            if (browser == null)
            {
                Process.Start(Url);
                MessageBox.Show("Microsoft Edge or Google Chrome wasn't found, so Commander Deck opened in your default browser.\n\n" +
                    "Note: in this mode your data is saved in that browser on this PC, not on the drive.\n\nClick OK to stop Commander Deck.",
                    "Commander Deck", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            else
            {
                browser.WaitForExit();
                // The browser may hand off to a sibling process; keep serving until every
                // process using our profile has closed.
                while (ProfileInUse()) Thread.Sleep(2000);
            }
            listener.Stop();
        }
        return 0;
    }

    static int Fail(string msg)
    {
        MessageBox.Show(msg, "Commander Deck", MessageBoxButtons.OK, MessageBoxIcon.Error);
        return 1;
    }

    static string FindBrowser()
    {
        var bases = new[] {
            Environment.GetEnvironmentVariable("ProgramFiles(x86)"),
            Environment.GetEnvironmentVariable("ProgramFiles"),
            Environment.GetEnvironmentVariable("LOCALAPPDATA"),
        };
        var rel = new[] { @"Microsoft\Edge\Application\msedge.exe", @"Google\Chrome\Application\chrome.exe" };
        foreach (var r in rel)
            foreach (var b in bases)
            {
                if (string.IsNullOrEmpty(b)) continue;
                var p = Path.Combine(b, r);
                if (File.Exists(p)) return p;
            }
        return null;
    }

    static Process OpenBrowser()
    {
        var exe = FindBrowser();
        if (exe == null) return null;
        Directory.CreateDirectory(profileDir);
        var args = string.Join(" ", new[] {
            "--app=" + Url,
            "--user-data-dir=\"" + profileDir + "\"",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-background-mode",
            "--window-size=1500,950",
        });
        return Process.Start(new ProcessStartInfo(exe, args) { UseShellExecute = false });
    }

    static bool ProfileInUse()
    {
        try
        {
            using (var q = new ManagementObjectSearcher(
                "SELECT CommandLine FROM Win32_Process WHERE Name='msedge.exe' OR Name='chrome.exe'"))
            {
                foreach (ManagementObject p in q.Get())
                {
                    var cmd = p["CommandLine"] as string;
                    if (cmd != null && cmd.IndexOf(profileDir, StringComparison.OrdinalIgnoreCase) >= 0) return true;
                }
            }
        }
        catch { }
        return false;
    }

    static readonly Dictionary<string, string> Mime = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
        { ".html", "text/html; charset=utf-8" }, { ".js", "text/javascript; charset=utf-8" },
        { ".css", "text/css; charset=utf-8" }, { ".json", "application/json" },
        { ".svg", "image/svg+xml" }, { ".png", "image/png" }, { ".jpg", "image/jpeg" },
        { ".ico", "image/x-icon" }, { ".webp", "image/webp" }, { ".woff2", "font/woff2" },
        { ".woff", "font/woff" }, { ".txt", "text/plain; charset=utf-8" }, { ".webmanifest", "application/manifest+json" },
    };

    static void Serve(HttpListener listener)
    {
        string full = Path.GetFullPath(appDir).TrimEnd('\\') + "\\";
        while (listener.IsListening)
        {
            HttpListenerContext ctx;
            try { ctx = listener.GetContext(); } catch { return; }
            ThreadPool.QueueUserWorkItem(_ => Handle(ctx, full));
        }
    }

    static void Handle(HttpListenerContext ctx, string full)
    {
        var res = ctx.Response;
        try
        {
            var rel = Uri.UnescapeDataString(ctx.Request.Url.AbsolutePath).TrimStart('/');
            if (rel == "") rel = "index.html";
            var path = Path.GetFullPath(Path.Combine(full, rel.Replace('/', '\\')));
            if (!path.StartsWith(full, StringComparison.OrdinalIgnoreCase) || !File.Exists(path))
                path = Path.Combine(full, "index.html"); // SPA fallback
            string type;
            res.ContentType = Mime.TryGetValue(Path.GetExtension(path), out type) ? type : "application/octet-stream";
            // Hashed assets never change; index.html must always be fresh so updates show up.
            res.Headers["Cache-Control"] = path.Contains("\\assets\\") ? "public, max-age=31536000, immutable" : "no-cache";
            var bytes = File.ReadAllBytes(path);
            res.ContentLength64 = bytes.Length;
            if (ctx.Request.HttpMethod != "HEAD") res.OutputStream.Write(bytes, 0, bytes.Length);
        }
        catch { try { res.StatusCode = 500; } catch { } }
        finally { try { res.Close(); } catch { } }
    }
}
