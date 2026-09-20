using System;
using System.Drawing;
using System.Net;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;

namespace EasyAGHost
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            string url = args.Length > 0 ? args[0] : "http://127.0.0.1:19823";
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm(url));
        }
    }

    class MainForm : Form
    {
        WebView2 webView;
        string apiUrl;
        const int WM_NCLBUTTONDOWN = 0xA1;
        const int HTCAPTION = 0x2;

        [DllImport("user32.dll")]
        public static extern int SendMessage(IntPtr hWnd, int Msg, int wParam, int lParam);
        [DllImport("user32.dll")]
        public static extern bool ReleaseCapture();

        public MainForm(string url)
        {
            apiUrl = url.Split('?')[0];
            Text = "EasyAntigravity";
            ShowIcon = true;
            Size = new Size(490, 740);
            MinimumSize = new Size(400, 560);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.Sizable;
            BackColor = Color.FromArgb(18, 19, 25);
            Icon = LoadIcon();

            webView = new WebView2();
            webView.Dock = DockStyle.Fill;
            webView.DefaultBackgroundColor = Color.FromArgb(18, 19, 25);
            Controls.Add(webView);

            webView.NavigationCompleted += async (s, e) =>
            {
                try
                {
                    await webView.ExecuteScriptAsync(@"
                        document.addEventListener('mousedown', (e) => {
                            const t = e.target;
                            if (t.closest('.nav-header') || t.closest('.drag-region')) {
                                window.chrome.webview.postMessage('drag');
                            }
                        });
                    ");
                }
                catch { }
            };

            webView.WebMessageReceived += (s, e) =>
            {
                if (e.WebMessageAsJson.Contains("drag"))
                {
                    ReleaseCapture();
                    SendMessage(Handle, WM_NCLBUTTONDOWN, HTCAPTION, 0);
                }
            };

            // 关闭窗口时同步通知后端退出
            this.FormClosing += (s, e) =>
            {
                try
                {
                    using (var client = new WebClient())
                    {
                        client.Headers[HttpRequestHeader.ContentType] = "application/x-www-form-urlencoded";
                        client.UploadString(apiUrl + "/api/quit", "");
                    }
                }
                catch { }
            };

            this.Shown += async (s, e) =>
            {
                try
                {
                    await webView.EnsureCoreWebView2Async();
                    webView.CoreWebView2.Navigate(url);
                }
                catch (Exception ex)
                {
                    MessageBox.Show("WebView2 初始化失败: " + ex.Message +
                        "\n\n请确保已安装 Microsoft Edge WebView2 Runtime。",
                        "EasyAntigravity", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    Application.Exit();
                }
            };
        }

        Icon LoadIcon()
        {
            try
            {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                string icoPath = System.IO.Path.Combine(baseDir, "logo.ico");
                if (System.IO.File.Exists(icoPath))
                    return new Icon(icoPath);
            }
            catch { }
            return null;
        }
    }
}
