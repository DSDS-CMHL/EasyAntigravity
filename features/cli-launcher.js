const fs = require('node:fs');
const path = require('node:path');
const { spawn, execSync } = require('node:child_process');
const crypto = require('node:crypto');

function getProjectsDir() {
  if (process.env.EASYAG_PROJECTS_DIR) {
    return process.env.EASYAG_PROJECTS_DIR;
  }
  const userProfile = process.env.USERPROFILE || process.env.HOME || '';
  return path.join(userProfile, '.gemini', 'config', 'projects');
}

function findAgyExe() {
  const localAppData = process.env.LOCALAPPDATA || '';
  const standardPath = path.join(localAppData, 'agy', 'bin', 'agy.exe');
  if (fs.existsSync(standardPath)) {
    return { installed: true, path: standardPath };
  }
  try {
    const stdout = execSync('where.exe agy.exe', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const firstLine = stdout.split(/\r?\n/)[0];
    if (firstLine && fs.existsSync(firstLine)) {
      return { installed: true, path: firstLine };
    }
  } catch {}
  return { installed: false, path: '' };
}

function uriToLocalPath(uri) {
  if (!uri || typeof uri !== 'string') return '';
  if (uri.startsWith('file:///')) {
    let p = decodeURIComponent(uri.slice(8));
    if (/^[a-zA-Z]:/.test(p)) {
      return path.normalize(p);
    }
    return path.normalize('/' + p);
  }
  return uri;
}

function localPathToUri(p) {
  const normalized = path.resolve(p).replace(/\\/g, '/');
  return `file:///${encodeURIComponent(normalized).replace(/%2F/g, '/')}`;
}

function getProjectsAndConversations() {
  const userProfile = process.env.USERPROFILE || process.env.HOME || '';
  const projectsDir = getProjectsDir();
  const metadataFile = path.join(userProfile, '.gemini', 'antigravity-cli', 'cache', 'conversation_metadata.json');
  const lastConvsFile = path.join(userProfile, '.gemini', 'antigravity-cli', 'cache', 'last_conversations.json');
  const trustedFile = path.join(userProfile, '.gemini', 'antigravity-cli', 'settings.json');

  // 1. Read conversations metadata
  const convMapByProject = new Map();
  const convMapByWorkspace = new Map();

  if (fs.existsSync(metadataFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
      const convs = data.conversations || {};
      for (const [id, item] of Object.entries(convs)) {
        const sum = item.summary || {};
        const title = sum.Title || '未命名会话';
        const numSteps = sum.NumSteps || 0;
        const updatedAt = sum.UpdatedAt || '';
        const projId = sum.ProjectID || '';
        const uris = sum.WorkspaceURIs || [];
        const entry = { id, title, numSteps, updatedAt };

        if (projId) {
          if (!convMapByProject.has(projId)) convMapByProject.set(projId, []);
          convMapByProject.get(projId).push(entry);
        }
        for (const uri of uris) {
          const wsPath = uriToLocalPath(uri);
          if (wsPath) {
            const key = wsPath.toLowerCase();
            if (!convMapByWorkspace.has(key)) convMapByWorkspace.set(key, []);
            convMapByWorkspace.get(key).push(entry);
          }
        }
      }
    } catch {}
  }

  // 2. Discover defined projects in projectsDir
  const projects = [];
  const registeredPaths = new Set();

  if (fs.existsSync(projectsDir)) {
    try {
      const files = fs.readdirSync(projectsDir);
      for (const f of files) {
        if (!f.endsWith('.json') || f === 'default-cli-project.json') continue;
        try {
          const content = JSON.parse(fs.readFileSync(path.join(projectsDir, f), 'utf8'));
          const id = content.id || path.basename(f, '.json');
          const name = content.name || id;
          const folderUri = content.projectResources?.resources?.[0]?.folderUri || '';
          const folderPath = uriToLocalPath(folderUri);

          if (folderPath && fs.existsSync(folderPath)) {
            registeredPaths.add(folderPath.toLowerCase());
            // Combine conversations associated by Project ID and by Workspace Path
            const set = new Map();
            for (const c of convMapByProject.get(id) || []) set.set(c.id, c);
            for (const c of convMapByWorkspace.get(folderPath.toLowerCase()) || []) set.set(c.id, c);
            const convs = Array.from(set.values());
            convs.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));

            projects.push({
              id,
              name,
              path: folderPath,
              exists: true,
              conversations: convs
            });
          }
        } catch {}
      }
    } catch {}
  }

  // 3. Discover any additional workspaces from last_conversations.json or trustedWorkspaces
  const extraWorkspaces = [];
  if (fs.existsSync(lastConvsFile)) {
    try {
      const lastData = JSON.parse(fs.readFileSync(lastConvsFile, 'utf8'));
      for (const ws of Object.keys(lastData)) {
        if (ws && fs.existsSync(ws) && !registeredPaths.has(ws.toLowerCase())) {
          extraWorkspaces.push(ws);
        }
      }
    } catch {}
  }
  if (fs.existsSync(trustedFile)) {
    try {
      const tData = JSON.parse(fs.readFileSync(trustedFile, 'utf8'));
      for (const ws of tData.trustedWorkspaces || []) {
        if (ws && fs.existsSync(ws) && !registeredPaths.has(ws.toLowerCase()) && !extraWorkspaces.includes(ws)) {
          extraWorkspaces.push(ws);
        }
      }
    } catch {}
  }

  for (const ws of extraWorkspaces) {
    const convs = convMapByWorkspace.get(ws.toLowerCase()) || [];
    convs.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    projects.push({
      id: `custom-${crypto.createHash('md5').update(ws).digest('hex').slice(0, 8)}`,
      name: path.basename(ws) || ws,
      path: ws,
      exists: true,
      conversations: convs
    });
  }

  return projects;
}

function createProject({ name, folderPath }) {
  if (!folderPath || typeof folderPath !== 'string') {
    return { ok: false, error: '请提供有效的项目目录路径' };
  }
  const targetDir = path.resolve(folderPath.trim());
  if (!fs.existsSync(targetDir)) {
    try {
      fs.mkdirSync(targetDir, { recursive: true });
    } catch (e) {
      return { ok: false, error: `无法创建目录: ${e.message}` };
    }
  }
  const id = crypto.randomUUID();
  const projectName = name?.trim() || path.basename(targetDir);
  const projectsDir = getProjectsDir();
  fs.mkdirSync(projectsDir, { recursive: true });

  const projectJson = {
    id,
    name: projectName,
    projectResources: {
      resources: [
        {
          folderUri: localPathToUri(targetDir)
        }
      ]
    },
    settings: {},
    isWorkspaceOnly: false
  };

  const projectFile = path.join(projectsDir, `${id}.json`);
  fs.writeFileSync(projectFile, JSON.stringify(projectJson, null, 2), 'utf8');

  return {
    ok: true,
    project: {
      id,
      name: projectName,
      path: targetDir,
      exists: true,
      conversations: []
    }
  };
}

function checkTerminalType() {
  const localAppData = process.env.LOCALAPPDATA || '';
  const wtPath = path.join(localAppData, 'Microsoft', 'WindowsApps', 'wt.exe');
  if (fs.existsSync(wtPath)) {
    return { type: 'wt', path: wtPath };
  }
  try {
    const stdout = execSync('where.exe wt.exe', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (stdout) return { type: 'wt', path: 'wt.exe' };
  } catch {}
  return { type: 'powershell', path: 'powershell.exe' };
}

function openFolder(folderPath) {
  if (!folderPath) return { ok: false, error: '路径为空' };
  const target = path.resolve(folderPath);
  if (!fs.existsSync(target)) return { ok: false, error: `目录不存在: ${target}` };
  try {
    const child = spawn('explorer.exe', [target], { detached: true, stdio: 'ignore' });
    child.unref();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function launchCliTerminal({
  workspace,
  conversationId,
  continueLast = false,
  skipPermissions = false,
  port = 7890,
  enableProxy = true
}) {
  const agy = findAgyExe();
  if (!agy.installed) {
    return { ok: false, error: '未检测到 Antigravity CLI (agy.exe)，请确认已安装。' };
  }

  const targetDir = path.resolve(workspace || process.cwd());
  if (!fs.existsSync(targetDir)) {
    return { ok: false, error: `工作目录不存在: ${targetDir}` };
  }

  const psStatements = [];
  const escapedDir = targetDir.replace(/'/g, "''");
  psStatements.push(`Set-Location '${escapedDir}'`);

  if (enableProxy && port > 0) {
    const proxyUrl = `http://127.0.0.1:${port}`;
    const bypass = 'localhost,127.0.0.1,::1,[::1]';
    psStatements.push(
      `$env:HTTP_PROXY='${proxyUrl}'; ` +
      `$env:HTTPS_PROXY='${proxyUrl}'; ` +
      `$env:ALL_PROXY='${proxyUrl}'; ` +
      `$env:http_proxy='${proxyUrl}'; ` +
      `$env:https_proxy='${proxyUrl}'; ` +
      `$env:all_proxy='${proxyUrl}'; ` +
      `$env:NO_PROXY='${bypass}'; ` +
      `$env:no_proxy='${bypass}'`
    );
    psStatements.push(`Write-Host '[EasyAG CLI] 已注入免 TUN 代理: ${proxyUrl}' -ForegroundColor Green`);
  } else {
    psStatements.push(`Write-Host '[EasyAG CLI] 直连模式（未注入代理）' -ForegroundColor Yellow`);
  }

  const agyArgs = [];
  if (conversationId) {
    agyArgs.push('--conversation', conversationId);
  } else if (continueLast) {
    agyArgs.push('-c');
  }
  if (skipPermissions) {
    agyArgs.push('--dangerously-skip-permissions');
  }

  const argsStr = agyArgs.length > 0 ? ' ' + agyArgs.join(' ') : '';
  psStatements.push(`& "${agy.path}"${argsStr}`);

  const fullPsCommand = psStatements.join('; ');
  const term = checkTerminalType();
  let child;

  try {
    if (term.type === 'wt') {
      child = spawn('cmd.exe', [
        '/c', 'start', '""', 'wt.exe',
        '-d', targetDir,
        'powershell.exe', '-NoExit', '-Command', fullPsCommand
      ], {
        detached: true,
        stdio: 'ignore',
        cwd: targetDir
      });
    } else {
      child = spawn('cmd.exe', [
        '/c', 'start', '"Antigravity CLI"',
        'powershell.exe', '-NoExit', '-Command', fullPsCommand
      ], {
        detached: true,
        stdio: 'ignore',
        cwd: targetDir
      });
    }
    child.unref();

    return {
      ok: true,
      pid: child.pid,
      workspace: targetDir,
      conversationId: conversationId || null,
      terminal: term.type,
      proxied: Boolean(enableProxy)
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  findAgyExe,
  uriToLocalPath,
  localPathToUri,
  getProjectsAndConversations,
  createProject,
  checkTerminalType,
  openFolder,
  launchCliTerminal
};
