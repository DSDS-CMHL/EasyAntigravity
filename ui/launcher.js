import { api } from './api.js';

const state = {
  settings: {},
  cli: {},
  terminal: {},
  projects: []
};

// DOM 元素引用
const cliStatusBadge = document.getElementById('cliStatusBadge');
const cliStatusText = document.getElementById('cliStatusText');
const terminalBadge = document.getElementById('terminalBadge');
const terminalText = document.getElementById('terminalText');
const themeToggleBtn = document.getElementById('themeToggleBtn');
const themeToggleText = document.getElementById('themeToggleText');

const proxyToggle = document.getElementById('proxyToggle');
const proxyStatusBadge = document.getElementById('proxyStatusBadge');
const proxyPortInput = document.getElementById('proxyPortInput');
const quickPortTags = document.querySelectorAll('.quick-tag');
const skipPermissionsToggle = document.getElementById('skipPermissionsToggle');

const projectCountBadge = document.getElementById('projectCountBadge');
const toggleNewProjectBtn = document.getElementById('toggleNewProjectBtn');
const refreshProjectsBtn = document.getElementById('refreshProjectsBtn');
const newProjectPanel = document.getElementById('newProjectPanel');
const newProjectName = document.getElementById('newProjectName');
const newProjectPath = document.getElementById('newProjectPath');
const cancelNewProjectBtn = document.getElementById('cancelNewProjectBtn');
const confirmNewProjectBtn = document.getElementById('confirmNewProjectBtn');
const projectsContainer = document.getElementById('projectsContainer');

const consoleBox = document.getElementById('consoleBox');

// 格式化时间戳
function formatTime(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return '';
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins} 分钟前`;
    if (diffHours < 24) return `${diffHours} 小时前`;
    if (diffDays < 7) return `${diffDays} 天前`;

    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    const hr = d.getHours().toString().padStart(2, '0');
    const min = d.getMinutes().toString().padStart(2, '0');
    return `${m}-${day} ${hr}:${min}`;
  } catch {
    return '';
  }
}

// 追加日志
function appendLog(category, message, cls = '') {
  if (!consoleBox) return;
  const line = document.createElement('div');
  line.className = `log-line ${cls}`;
  const now = new Date().toLocaleTimeString();
  line.textContent = `[${now}] [${category}] ${message}`;
  consoleBox.appendChild(line);
  consoleBox.scrollTop = consoleBox.scrollHeight;
}

// 刷新状态与 UI 展现
function applyStatus(status) {
  state.settings = status;
  state.cli = status.cli || {};
  state.terminal = status.terminal || {};

  // CLI 状态
  if (state.cli.installed) {
    cliStatusBadge.className = 'status-capsule active';
    cliStatusText.textContent = 'CLI 已就绪';
    cliStatusBadge.title = `已检测到 Antigravity CLI:\n${state.cli.path}`;
  } else {
    cliStatusBadge.className = 'status-capsule error';
    cliStatusText.textContent = '未检测到 CLI';
    cliStatusBadge.title = '未找到 agy.exe，请确认 Antigravity CLI 已安装';
  }

  // 终端环境
  if (terminalText) {
    terminalText.textContent = state.terminal.type === 'wt' ? 'Windows Terminal' : 'PowerShell';
    terminalBadge.title = `默认呼出终端: ${state.terminal.path || state.terminal.type}`;
  }

  // 免 TUN 代理
  proxyToggle.checked = Boolean(status.enableProxy);
  proxyPortInput.value = status.port || 7890;
  skipPermissionsToggle.checked = Boolean(status.skipPermissions);

  updatePortHighlight(status.port);
  updateProxyBadge(status.enableProxy, status.port);
}

function updatePortHighlight(port) {
  const current = Number(port);
  for (const tag of quickPortTags) {
    if (Number(tag.dataset.port) === current) {
      tag.classList.add('active');
    } else {
      tag.classList.remove('active');
    }
  }
}

function updateProxyBadge(enabled, port) {
  if (enabled) {
    proxyStatusBadge.textContent = `· 127.0.0.1:${port}`;
    proxyStatusBadge.style.color = 'var(--green)';
  } else {
    proxyStatusBadge.textContent = '· 直连模式 (未注入)';
    proxyStatusBadge.style.color = 'var(--yellow)';
  }
}

// 加载项目列表
async function loadProjects() {
  try {
    const res = await api.getProjects();
    state.projects = res.projects || [];
    renderProjects(state.projects);
  } catch (err) {
    projectsContainer.innerHTML = `<div class="empty-hint" style="color:var(--red);">读取项目列表失败: ${err.message}</div>`;
  }
}

// 渲染项目卡片
function renderProjects(projects) {
  if (!projectsContainer) return;
  projectCountBadge.textContent = `${projects.length} 个项目`;

  if (projects.length === 0) {
    projectsContainer.innerHTML = '<div class="empty-hint">暂无已登记项目，点击上方 "+ 新建项目" 添加或导入本地工作区</div>';
    return;
  }

  projectsContainer.innerHTML = '';

  for (const proj of projects) {
    const card = document.createElement('div');
    card.className = 'project-card';

    const convCount = proj.conversations?.length || 0;

    // 头部区域
    const header = document.createElement('div');
    header.className = 'project-header';

    const meta = document.createElement('div');
    meta.className = 'project-meta';

    const nameRow = document.createElement('div');
    nameRow.className = 'project-name-row';

    const icon = document.createElement('span');
    icon.textContent = '📁';
    icon.style.fontSize = '14px';

    const name = document.createElement('span');
    name.className = 'project-name';
    name.textContent = proj.name;

    const countTag = document.createElement('span');
    countTag.className = 'project-conv-count';
    countTag.textContent = `${convCount} 会话`;

    nameRow.appendChild(icon);
    nameRow.appendChild(name);
    nameRow.appendChild(countTag);

    const pathSpan = document.createElement('div');
    pathSpan.className = 'project-path';
    pathSpan.textContent = proj.path;
    pathSpan.title = '点击在资源管理器中打开此目录';
    pathSpan.addEventListener('click', () => {
      api.openFolder(proj.path);
    });

    meta.appendChild(nameRow);
    meta.appendChild(pathSpan);

    // 操作按钮区域
    const actions = document.createElement('div');
    actions.className = 'project-actions';

    const openDirBtn = document.createElement('button');
    openDirBtn.type = 'button';
    openDirBtn.className = 'btn-sm btn-ghost';
    openDirBtn.title = '在 Windows 文件资源管理器中打开';
    openDirBtn.textContent = '📂 浏览';
    openDirBtn.addEventListener('click', () => {
      api.openFolder(proj.path);
    });

    const newConvBtn = document.createElement('button');
    newConvBtn.type = 'button';
    newConvBtn.className = 'btn-launch-new';
    newConvBtn.title = '在此项目目录打开 CLI 终端开启全新会话';
    newConvBtn.innerHTML = '🚀 开启新会话';
    newConvBtn.addEventListener('click', async () => {
      try {
        await api.launchCli({ workspace: proj.path });
      } catch (e) {
        appendLog('ERROR', `启动失败: ${e.message}`, 'tag-alert');
      }
    });

    actions.appendChild(openDirBtn);
    actions.appendChild(newConvBtn);

    header.appendChild(meta);
    header.appendChild(actions);
    card.appendChild(header);

    // 历史会话区域
    if (convCount > 0) {
      const convSection = document.createElement('div');
      convSection.className = 'conv-section';

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'conv-toggle-btn';
      toggleBtn.innerHTML = `📜 历史会话 (${convCount}) <span style="font-size: 10px;">▾</span>`;

      const convList = document.createElement('div');
      convList.className = 'conv-list';

      for (const conv of proj.conversations) {
        const item = document.createElement('div');
        item.className = 'conv-item';

        const info = document.createElement('div');
        info.className = 'conv-info';

        const title = document.createElement('div');
        title.className = 'conv-title';
        title.textContent = conv.title || '未命名会话';
        title.title = conv.title || '';

        const metaRow = document.createElement('div');
        metaRow.className = 'conv-meta';

        const steps = document.createElement('span');
        steps.className = 'conv-steps-badge';
        steps.textContent = `${conv.numSteps || 0} 步`;

        const time = document.createElement('span');
        time.textContent = formatTime(conv.updatedAt);

        metaRow.appendChild(steps);
        if (time.textContent) metaRow.appendChild(time);

        info.appendChild(title);
        info.appendChild(metaRow);

        const resumeBtn = document.createElement('button');
        resumeBtn.type = 'button';
        resumeBtn.className = 'btn-resume';
        resumeBtn.title = `续接此会话 [${conv.id.slice(0, 8)}]`;
        resumeBtn.textContent = '⚡ 续接';
        resumeBtn.addEventListener('click', async () => {
          try {
            await api.launchCli({ workspace: proj.path, conversationId: conv.id });
          } catch (e) {
            appendLog('ERROR', `续接失败: ${e.message}`, 'tag-alert');
          }
        });

        item.appendChild(info);
        item.appendChild(resumeBtn);
        convList.appendChild(item);
      }

      let expanded = true;
      toggleBtn.addEventListener('click', () => {
        expanded = !expanded;
        convList.style.display = expanded ? 'flex' : 'none';
        toggleBtn.innerHTML = `📜 历史会话 (${convCount}) <span style="font-size: 10px;">${expanded ? '▾' : '▸'}</span>`;
      });

      convSection.appendChild(toggleBtn);
      convSection.appendChild(convList);
      card.appendChild(convSection);
    }

    projectsContainer.appendChild(card);
  }
}

// 事件绑定
function initEvents() {
  // 代理开关
  proxyToggle.addEventListener('change', async () => {
    try {
      const res = await api.configure({ enableProxy: proxyToggle.checked });
      updateProxyBadge(res.settings.enableProxy, res.settings.port);
    } catch (e) {
      proxyToggle.checked = !proxyToggle.checked;
      appendLog('ERROR', e.message, 'tag-alert');
    }
  });

  // 端口输入
  proxyPortInput.addEventListener('change', async () => {
    const port = Number(proxyPortInput.value.trim());
    if (!port || port < 1 || port > 65535) {
      appendLog('WARN', '端口格式不正确，请输入 1–65535 的整数', 'tag-warn');
      proxyPortInput.value = state.settings.port || 7890;
      return;
    }
    try {
      const res = await api.configure({ port });
      state.settings.port = res.settings.port;
      updatePortHighlight(res.settings.port);
      updateProxyBadge(state.settings.enableProxy, res.settings.port);
    } catch (e) {
      appendLog('ERROR', e.message, 'tag-alert');
    }
  });

  // 快速端口选择
  for (const tag of quickPortTags) {
    tag.addEventListener('click', async () => {
      const port = Number(tag.dataset.port);
      proxyPortInput.value = port;
      try {
        const res = await api.configure({ port });
        state.settings.port = res.settings.port;
        updatePortHighlight(res.settings.port);
        updateProxyBadge(state.settings.enableProxy, res.settings.port);
      } catch (e) {
        appendLog('ERROR', e.message, 'tag-alert');
      }
    });
  }

  // 跳过权限确认开关
  skipPermissionsToggle.addEventListener('change', async () => {
    try {
      await api.configure({ skipPermissions: skipPermissionsToggle.checked });
    } catch (e) {
      skipPermissionsToggle.checked = !skipPermissionsToggle.checked;
      appendLog('ERROR', e.message, 'tag-alert');
    }
  });

  // 新建项目抽屉展开与取消
  toggleNewProjectBtn.addEventListener('click', () => {
    const isHidden = newProjectPanel.style.display === 'none';
    newProjectPanel.style.display = isHidden ? 'block' : 'none';
    if (isHidden) {
      newProjectPath.focus();
    }
  });

  cancelNewProjectBtn.addEventListener('click', () => {
    newProjectPanel.style.display = 'none';
    newProjectName.value = '';
    newProjectPath.value = '';
  });

  // 确认创建项目
  confirmNewProjectBtn.addEventListener('click', async () => {
    const folderPath = newProjectPath.value.trim();
    const name = newProjectName.value.trim();
    if (!folderPath) {
      appendLog('WARN', '请输入文件夹完整路径', 'tag-warn');
      newProjectPath.focus();
      return;
    }
    try {
      confirmNewProjectBtn.disabled = true;
      confirmNewProjectBtn.textContent = '创建中...';
      const res = await api.createProject({ name, folderPath });
      if (res.ok) {
        appendLog('CLI', `项目已就绪: ${res.project.name} (${res.project.path})`, 'tag-proxy');
        newProjectPanel.style.display = 'none';
        newProjectName.value = '';
        newProjectPath.value = '';
        await loadProjects();
      }
    } catch (e) {
      appendLog('ERROR', `新建项目失败: ${e.message}`, 'tag-alert');
    } finally {
      confirmNewProjectBtn.disabled = false;
      confirmNewProjectBtn.textContent = '立即创建并登记';
    }
  });

  // 刷新按钮
  refreshProjectsBtn.addEventListener('click', async () => {
    refreshProjectsBtn.disabled = true;
    refreshProjectsBtn.textContent = '刷新中...';
    try {
      await loadProjects();
      appendLog('CLI', '已刷新项目与会话列表', 'tag-proxy');
    } finally {
      refreshProjectsBtn.disabled = false;
      refreshProjectsBtn.textContent = '↻ 刷新';
    }
  });

  // 复制与清空日志
  document.querySelector('[data-action="copy-logs"]')?.addEventListener('click', () => {
    const text = consoleBox?.innerText || '';
    navigator.clipboard.writeText(text).then(() => {
      appendLog('SYSTEM', '日志已复制到剪贴板', 'tag-proxy');
    }).catch(() => {
      appendLog('WARN', '复制失败，请手动选择复制', 'tag-warn');
    });
  });

  document.querySelector('[data-action="clear-logs"]')?.addEventListener('click', () => {
    if (consoleBox) consoleBox.innerHTML = '';
  });

  // 主题切换
  themeToggleBtn?.addEventListener('click', async () => {
    const current = document.documentElement.dataset.theme;
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('easyag-theme', next);
    } catch {}
    themeToggleText.textContent = next === 'dark' ? '🌙' : '☀️';
    try {
      await api.setTheme(next);
    } catch {}
  });

  // 初始化主题图标
  const currentTheme = document.documentElement.dataset.theme || 'light';
  if (themeToggleText) {
    themeToggleText.textContent = currentTheme === 'dark' ? '🌙' : '☀️';
  }
}

// 建立 SSE 实时监听
function initSse() {
  const events = new EventSource('/api/events');
  events.onmessage = e => {
    try {
      const data = JSON.parse(e.data);
      if (data.category && data.message) {
        appendLog(data.category, data.message, data.cls || '');
      }
      if (data.port !== undefined && data.enableProxy !== undefined) {
        state.settings = { ...state.settings, ...data };
        proxyToggle.checked = Boolean(data.enableProxy);
        proxyPortInput.value = data.port;
        updatePortHighlight(data.port);
        updateProxyBadge(data.enableProxy, data.port);
      }
    } catch {}
  };
  events.onerror = () => {
    // 自动重连由 EventSource 原生支持
  };
}

// 主入口初始化
async function init() {
  initEvents();
  initSse();

  try {
    const status = await api.status();
    applyStatus(status);
  } catch (e) {
    appendLog('ERROR', `加载状态失败: ${e.message}`, 'tag-alert');
  }

  await loadProjects();
}

init();
