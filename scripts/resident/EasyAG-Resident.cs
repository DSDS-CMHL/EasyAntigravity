using System;
using System.IO;
using System.Threading;
using System.Runtime.InteropServices;
using System.Text;
using System.Drawing;
using System.Windows.Forms;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Effects;
using System.Windows.Shapes;
using System.Windows.Threading;
using Application = System.Windows.Application;
using Button = System.Windows.Controls.Button;
using Orientation = System.Windows.Controls.Orientation;
using Color = System.Windows.Media.Color;
using Brushes = System.Windows.Media.Brushes;
using Point = System.Windows.Point;

namespace EasyAGResident {
    public class Program {
        #region Win32 API
        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr OpenWindowStation(string lpszWinSta, bool fInherit, uint dwDesiredAccess);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetProcessWindowStation(IntPtr hWinSta);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetThreadDesktop(IntPtr hDesktop);

        [DllImport("user32.dll")]
        public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("kernel32.dll")]
        public static extern uint GetCurrentThreadId();

        [DllImport("user32.dll")]
        public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
        [DllImport("user32.dll")]
        public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr hWnd);

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        [DllImport("user32.dll")]
        public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
        #endregion

        private static Application wpfApp;
        private static Window capsuleWin;
        private static NotifyIcon trayIcon;
        private static ContextMenuStrip trayMenu;

        private static IntPtr eaHwnd = IntPtr.Zero;
        private static IntPtr agHwnd = IntPtr.Zero;
        private static int eaPid = 0;
        private static int agPid = 0;
        private static int backendPort = 8080;
        private static string currentType = "danger";

        // Capsule UI Elements
        private static Border cardBorder;
        private static DropShadowEffect cardGlow;
        private static Ellipse stateDot;
        private static TextBlock stateCatText;
        private static TextBlock stateMainText;
        private static TextBlock stateSubText;
        private static Border actionBtn;
        private static TextBlock actionBtnText;
        private static System.Windows.Shapes.Path comicTail;

        public static void LogEvent(string json) {
            try {
                Console.WriteLine(json);
                Console.Out.Flush();
            } catch { }
        }

        public static void ForceForeground(IntPtr hWnd) {
            if (hWnd == IntPtr.Zero) return;
            try {
                ShowWindowAsync(hWnd, 9); // SW_RESTORE
                IntPtr fgWnd = GetForegroundWindow();
                uint dummy = 0;
                uint fgThread = GetWindowThreadProcessId(fgWnd, out dummy);
                uint curThread = GetCurrentThreadId();
                if (fgThread != 0 && fgThread != curThread) {
                    AttachThreadInput(curThread, fgThread, true);
                    SetForegroundWindow(hWnd);
                    AttachThreadInput(curThread, fgThread, false);
                } else {
                    SetForegroundWindow(hWnd);
                }
            } catch { }
        }

        public static void RefreshWindowHandles() {
            try {
                EnumWindows((hWnd, lParam) => {
                    StringBuilder title = new StringBuilder(256);
                    GetWindowText(hWnd, title, 256);
                    StringBuilder cls = new StringBuilder(256);
                    GetClassName(hWnd, cls, 256);
                    string t = title.ToString();
                    string c = cls.ToString();

                    uint pId = 0;
                    GetWindowThreadProcessId(hWnd, out pId);

                    // Find EasyAntigravity
                    if (c == "Tauri Window" || (t == "EasyAntigravity" && (eaPid == 0 || pId == eaPid))) {
                        eaHwnd = hWnd;
                    }

                    // Find Antigravity
                    if (c.StartsWith("Chrome_WidgetWin_") && pId != eaPid) {
                        bool isAg = false;
                        if (agPid != 0 && pId == agPid) isAg = true;
                        else if (t.IndexOf("Antigravity", StringComparison.OrdinalIgnoreCase) >= 0 && t != "EasyAntigravity") isAg = true;
                        else {
                            try {
                                var proc = System.Diagnostics.Process.GetProcessById((int)pId);
                                if (proc.ProcessName.Equals("Antigravity", StringComparison.OrdinalIgnoreCase)) isAg = true;
                            } catch { }
                        }
                        if (isAg) {
                            RECT r;
                            GetWindowRect(hWnd, out r);
                            if (r.Right - r.Left > 250 && r.Bottom - r.Top > 200) {
                                agHwnd = hWnd;
                            }
                        }
                    }
                    return true;
                }, IntPtr.Zero);
            } catch { }
        }

        [STAThread]
        public static void Main(string[] args) {
            // Attach to interactive desktop station if possible
            try {
                IntPtr hWinsta = OpenWindowStation("winsta0", false, 0x037F);
                if (hWinsta != IntPtr.Zero) SetProcessWindowStation(hWinsta);
                IntPtr hDesk = OpenDesktop("default", 0, false, 0x01FF);
                if (hDesk != IntPtr.Zero) SetThreadDesktop(hDesk);
            } catch { }

            // Background thread to read commands from stdin immediately
            Thread stdinThread = new Thread(ReadCommandsLoop);
            stdinThread.IsBackground = true;
            stdinThread.Start();

            // Emit ready handshake signal immediately so caller never times out
            LogEvent("{\"event\":\"ready\"}");

            try {
                wpfApp = new Application();
                wpfApp.ShutdownMode = ShutdownMode.OnExplicitShutdown;

                InitTrayIcon();
                InitCapsuleWindow();

                wpfApp.Run();
            } catch (Exception) {
                // If GUI fails in headless or restricted CI environments, keep stdin alive
                while (true) {
                    Thread.Sleep(1000);
                }
            }
        }

        private static void InitTrayIcon() {
            try {
                trayMenu = new ContextMenuStrip();
                var itemOpen = trayMenu.Items.Add("🚀 打开控制面板");
                itemOpen.Font = new System.Drawing.Font(itemOpen.Font, System.Drawing.FontStyle.Bold);
                itemOpen.Click += (s, e) => {
                    ShowEasyAG();
                    LogEvent("{\"event\":\"tray_open\"}");
                };

                var itemWeb = trayMenu.Items.Add("🌐 浏览器控制台");
                itemWeb.Click += (s, e) => {
                    try {
                        System.Diagnostics.Process.Start(string.Format("http://127.0.0.1:{0}", backendPort));
                    } catch { }
                    LogEvent("{\"event\":\"tray_web\"}");
                };

                trayMenu.Items.Add(new ToolStripSeparator());

                var itemExit = trayMenu.Items.Add("🛑 退出 EasyAntigravity");
                itemExit.Click += (s, e) => {
                    LogEvent("{\"event\":\"tray_exit\"}");
                    ShutdownResident();
                };

                trayIcon = new NotifyIcon();
                trayIcon.Text = "EasyAntigravity (后台运行中)";
                trayIcon.ContextMenuStrip = trayMenu;

                // Load Icon
                try {
                    string exeDir = AppDomain.CurrentDomain.BaseDirectory;
                    string iconPath = System.IO.Path.Combine(exeDir, "icon.ico");
                    if (!File.Exists(iconPath)) iconPath = System.IO.Path.Combine(exeDir, "assets", "icon.ico");
                    if (!File.Exists(iconPath)) iconPath = System.IO.Path.Combine(exeDir, "..", "assets", "icon.ico");
                    if (!File.Exists(iconPath)) iconPath = System.IO.Path.Combine(exeDir, "..", "src-tauri", "icons", "icon.ico");
                    if (!File.Exists(iconPath)) iconPath = System.IO.Path.Combine(exeDir, "..", "icon.ico");
                    if (File.Exists(iconPath)) {
                        trayIcon.Icon = new Icon(iconPath);
                    } else {
                        string exePath = System.Diagnostics.Process.GetCurrentProcess().MainModule.FileName;
                        trayIcon.Icon = System.Drawing.Icon.ExtractAssociatedIcon(exePath);
                    }
                } catch {
                    try {
                        trayIcon.Icon = SystemIcons.Application;
                    } catch { }
                }

                trayIcon.Visible = true;
                trayIcon.DoubleClick += (s, e) => {
                    ShowEasyAG();
                    LogEvent("{\"event\":\"tray_open\"}");
                };
            } catch { }
        }

        private static void InitCapsuleWindow() {
            try {
                capsuleWin = new Window {
                    Title = "EasyAG_HUD_Capsule",
                    Width = 340,
                    Height = 150,
                    WindowStyle = WindowStyle.None,
                    AllowsTransparency = true,
                    Background = Brushes.Transparent,
                    Topmost = true,
                    ShowInTaskbar = false,
                    ShowActivated = false,
                    WindowStartupLocation = WindowStartupLocation.Manual
                };

                try {
                    Rect workArea = SystemParameters.WorkArea;
                    if (workArea.Width > 0 && workArea.Height > 0) {
                        capsuleWin.Left = workArea.Right - capsuleWin.Width - 18;
                        capsuleWin.Top = workArea.Bottom - capsuleWin.Height - 16;
                    } else {
                        capsuleWin.Left = 800;
                        capsuleWin.Top = 600;
                    }
                } catch {
                    capsuleWin.Left = 800;
                    capsuleWin.Top = 600;
                }

            Grid rootGrid = new Grid();
            rootGrid.ClipToBounds = false;

            cardGlow = new DropShadowEffect {
                BlurRadius = 22,
                ShadowDepth = 0,
                Opacity = 0.55
            };

            cardBorder = new Border {
                CornerRadius = new CornerRadius(16),
                Background = new SolidColorBrush(Color.FromArgb(0xF2, 0x18, 0x1A, 0x20)),
                BorderThickness = new Thickness(1.5),
                Margin = new Thickness(10, 10, 10, 16),
                Effect = cardGlow
            };

            Grid contentGrid = new Grid { Margin = new Thickness(14, 12, 14, 10) };
            contentGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            contentGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            contentGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            // Row 0: Header
            DockPanel header = new DockPanel { LastChildFill = false };
            StackPanel titleStack = new StackPanel { Orientation = Orientation.Horizontal };
            stateDot = new Ellipse {
                Width = 9,
                Height = 9,
                Margin = new Thickness(0, 0, 7, 0),
                VerticalAlignment = VerticalAlignment.Center
            };
            stateCatText = new TextBlock {
                FontWeight = FontWeights.Bold,
                FontSize = 12,
                VerticalAlignment = VerticalAlignment.Center
            };
            titleStack.Children.Add(stateDot);
            titleStack.Children.Add(stateCatText);
            DockPanel.SetDock(titleStack, Dock.Left);
            header.Children.Add(titleStack);

            Button closeBtn = new Button {
                Content = "✕",
                Foreground = new SolidColorBrush(Color.FromRgb(0x94, 0xA3, 0xB8)),
                Background = Brushes.Transparent,
                BorderThickness = new Thickness(0),
                FontSize = 12,
                Cursor = System.Windows.Input.Cursors.Hand,
                Padding = new Thickness(4, 0, 4, 0)
            };
            closeBtn.Click += (s, e) => {
                HideCapsule();
                LogEvent("{\"event\":\"capsule_close\"}");
            };
            DockPanel.SetDock(closeBtn, Dock.Right);
            header.Children.Add(closeBtn);
            Grid.SetRow(header, 0);
            contentGrid.Children.Add(header);

            // Row 1: Body
            StackPanel body = new StackPanel { Margin = new Thickness(0, 6, 0, 6) };
            stateMainText = new TextBlock {
                FontWeight = FontWeights.SemiBold,
                FontSize = 12,
                Foreground = Brushes.White,
                TextWrapping = TextWrapping.NoWrap,
                TextTrimming = TextTrimming.CharacterEllipsis
            };
            stateSubText = new TextBlock {
                FontSize = 11,
                Foreground = new SolidColorBrush(Color.FromRgb(0x94, 0xA3, 0xB8)),
                Margin = new Thickness(0, 2, 0, 0)
            };
            body.Children.Add(stateMainText);
            body.Children.Add(stateSubText);
            Grid.SetRow(body, 1);
            contentGrid.Children.Add(body);

            // Row 2: Action Button
            actionBtn = new Border {
                CornerRadius = new CornerRadius(8),
                HorizontalAlignment = System.Windows.HorizontalAlignment.Right,
                Padding = new Thickness(12, 5, 12, 5),
                Cursor = System.Windows.Input.Cursors.Hand
            };
            actionBtnText = new TextBlock {
                FontWeight = FontWeights.Bold,
                FontSize = 11.5
            };
            actionBtn.Child = actionBtnText;
            actionBtn.MouseLeftButtonUp += (s, e) => {
                HandleCapsuleAction();
            };
            Grid.SetRow(actionBtn, 2);
            contentGrid.Children.Add(actionBtn);

            cardBorder.Child = contentGrid;
            rootGrid.Children.Add(cardBorder);

            // Comic Tail
            comicTail = new System.Windows.Shapes.Path {
                Data = Geometry.Parse("M 0,0 L 8,9 L 16,0 Z"),
                Fill = new SolidColorBrush(Color.FromArgb(0xF2, 0x18, 0x1A, 0x20)),
                StrokeThickness = 1.2,
                HorizontalAlignment = System.Windows.HorizontalAlignment.Right,
                VerticalAlignment = VerticalAlignment.Bottom,
                Margin = new Thickness(0, 0, 36, 8)
            };
            rootGrid.Children.Add(comicTail);

            capsuleWin.Content = rootGrid;
            } catch { }
        }

        private static void ApplyStateVisuals(string type, string titleText, string subText) {
            currentType = type;
            if (type == "danger") {
                // 🚨 命中危险命令
                Color rose = Color.FromRgb(0xFB, 0x71, 0x85);
                cardBorder.BorderBrush = new SolidColorBrush(rose);
                cardGlow.Color = rose;
                comicTail.Stroke = new SolidColorBrush(rose);
                stateDot.Fill = new SolidColorBrush(rose);
                stateCatText.Text = "命中危险命令";
                stateCatText.Foreground = new SolidColorBrush(rose);

                stateMainText.Text = string.IsNullOrEmpty(titleText) ? "危险指令待人工审查" : ("危险指令：" + titleText);
                stateSubText.Text = string.IsNullOrEmpty(subText) ? "已阻断自动放行，需人工核查确认。" : subText;

                actionBtn.Background = new SolidColorBrush(Color.FromRgb(0xE1, 0x1D, 0x48));
                actionBtnText.Foreground = Brushes.White;
                actionBtnText.Text = "前往审查 ↵";

            } else if (type == "interaction") {
                // 💡 等待方案决策
                Color mint = Color.FromRgb(0x00, 0xF5, 0xD4);
                cardBorder.BorderBrush = new SolidColorBrush(mint);
                cardGlow.Color = mint;
                comicTail.Stroke = new SolidColorBrush(mint);
                stateDot.Fill = new SolidColorBrush(mint);
                stateCatText.Text = "等待方案决策";
                stateCatText.Foreground = new SolidColorBrush(mint);

                stateMainText.Text = string.IsNullOrEmpty(titleText) ? "方案问答：等待您选择决策方案" : titleText;
                stateSubText.Text = string.IsNullOrEmpty(subText) ? "Agent 暂缓后续操作，等待您的指引。" : subText;

                actionBtn.Background = new SolidColorBrush(mint);
                actionBtnText.Foreground = new SolidColorBrush(Color.FromRgb(0x0B, 0x0C, 0x10));
                actionBtnText.Text = "前往选择 ↵";

            } else {
                // ✅ 本轮任务完成
                Color emerald = Color.FromRgb(0x10, 0xB9, 0x81);
                cardBorder.BorderBrush = new SolidColorBrush(emerald);
                cardGlow.Color = emerald;
                comicTail.Stroke = new SolidColorBrush(emerald);
                stateDot.Fill = new SolidColorBrush(emerald);
                stateCatText.Text = "本轮任务完成";
                stateCatText.Foreground = new SolidColorBrush(emerald);

                stateMainText.Text = string.IsNullOrEmpty(titleText) ? "生成完毕，所有步骤已就绪" : titleText;
                stateSubText.Text = string.IsNullOrEmpty(subText) ? "代码已就绪，随时可检视或开启下一轮。" : subText;

                actionBtn.Background = new SolidColorBrush(emerald);
                actionBtnText.Foreground = new SolidColorBrush(Color.FromRgb(0x0B, 0x0C, 0x10));
                actionBtnText.Text = "前往查看 ↵";
            }
        }

        private static void ShowCapsule(string type, string titleText, string subText) {
            wpfApp.Dispatcher.Invoke(() => {
                ApplyStateVisuals(type, titleText, subText);
                Rect workArea = SystemParameters.WorkArea;
                capsuleWin.Left = workArea.Right - capsuleWin.Width - 18;
                capsuleWin.Top = workArea.Bottom - capsuleWin.Height - 16;
                capsuleWin.Show();
                try {
                    System.Media.SystemSounds.Asterisk.Play();
                } catch { }
            });
        }

        private static void HideCapsule() {
            wpfApp.Dispatcher.Invoke(() => {
                capsuleWin.Hide();
            });
        }

        private static void HandleCapsuleAction() {
            HideCapsule();
            // Focus Antigravity window
            RefreshWindowHandles();
            if (agHwnd != IntPtr.Zero) {
                ForceForeground(agHwnd);
            }
            LogEvent(string.Format("{{\"event\":\"capsule_action\",\"type\":\"{0}\"}}", currentType));
        }

        public static void HideEasyAG() {
            RefreshWindowHandles();
            if (eaHwnd != IntPtr.Zero) {
                ShowWindowAsync(eaHwnd, 0); // SW_HIDE
            }
        }

        public static void ShowEasyAG() {
            RefreshWindowHandles();
            if (eaHwnd != IntPtr.Zero) {
                ShowWindowAsync(eaHwnd, 9); // SW_RESTORE
                ForceForeground(eaHwnd);
            }
            // Also notify Node to trigger popup in Tauri if applicable
            LogEvent("{\"event\":\"request_popup\"}");
        }

        public static void ShutdownResident() {
            try {
                if (trayIcon != null) {
                    trayIcon.Visible = false;
                    trayIcon.Dispose();
                }
            } catch { }
            try {
                wpfApp.Dispatcher.Invoke(() => {
                    wpfApp.Shutdown();
                });
            } catch { }
            Environment.Exit(0);
        }

        private static void ReadCommandsLoop() {
            try {
                string line;
                while ((line = Console.ReadLine()) != null) {
                    line = line.Trim();
                    if (string.IsNullOrEmpty(line)) continue;

                    if (line.StartsWith("{") && line.EndsWith("}")) {
                        ProcessJsonCommand(line);
                    }
                }
            } catch { }
            ShutdownResident();
        }

        private static string ExtractJsonVal(string json, string key) {
            string pattern = "\"" + key + "\":";
            int idx = json.IndexOf(pattern);
            if (idx < 0) return "";
            idx += pattern.Length;
            while (idx < json.Length && (json[idx] == ' ' || json[idx] == '\"')) idx++;
            int end = idx;
            bool inQuotes = (idx > 0 && json[idx - 1] == '\"');
            if (inQuotes) {
                while (end < json.Length && json[end] != '\"') end++;
            } else {
                while (end < json.Length && json[end] != ',' && json[end] != '}' && json[end] != ' ') end++;
            }
            return json.Substring(idx, end - idx);
        }

        private static void ProcessJsonCommand(string json) {
            string cmd = ExtractJsonVal(json, "cmd");
            if (cmd == "init") {
                string portStr = ExtractJsonVal(json, "port");
                int.TryParse(portStr, out backendPort);
                string eaPidStr = ExtractJsonVal(json, "ea_pid");
                int.TryParse(eaPidStr, out eaPid);
                RefreshWindowHandles();
            } else if (cmd == "set_ag_pid") {
                string agPidStr = ExtractJsonVal(json, "ag_pid");
                int.TryParse(agPidStr, out agPid);
                RefreshWindowHandles();
            } else if (cmd == "hide_easyag") {
                HideEasyAG();
            } else if (cmd == "show_easyag") {
                ShowEasyAG();
            } else if (cmd == "show_capsule") {
                string type = ExtractJsonVal(json, "type");
                string title = ExtractJsonVal(json, "title");
                string detail = ExtractJsonVal(json, "detail");
                ShowCapsule(type, title, detail);
            } else if (cmd == "hide_capsule") {
                HideCapsule();
            } else if (cmd == "exit") {
                ShutdownResident();
            }
        }
    }
}
