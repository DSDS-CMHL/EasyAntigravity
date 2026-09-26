/**
 * danger-rules JS 正则 → Antigravity 官方 permission target
 *
 * 实测语义（Windows, 2026-09-25）:
 *   非 regex:     command(X) ≡ 整行 == X（全等）
 *   regex: 单token → ^(?:token)$  整行匹配
 *   regex: 多token → 逐词对齐，末尾 .* 吞余下多词
 *   引号串算 1 词
 *
 * EasyAG danger-rules 是 JS RegExp.test() 部分匹配，且常带 (?=\s|$)，
 * 直接塞进 regex: 会被 ^…$ 锁死导致 rm -rf /path 永不命中。
 * 因此编译为: regex:.*(?:<pattern>).*   （字面空白转为 \s+ 以保持单 token）
 */

/** 将 JS pattern 规范为可放进单个官方 regex token 的形式 */
function compileJsPatternToOfficialTarget(jsPattern) {
  let p = String(jsPattern == null ? '' : jsPattern);
  if (!p) return '';
  // 字面空白 → \s+（保留已有 \s \t \n 等转义；\ 后跟 s/t/n/ 等不动）
  p = p.replace(/([^\\]|^)\s+/g, (m, pre) => pre + '\\s+');
  // 残留的行首空白
  p = p.replace(/^\s+/, '\\s+');
  // test() 语义：允许前后有其它字符
  return 'regex:.*(?:' + p + ').*';
}

/** 官方 target → 落盘 resource（禁止双重包裹） */
function toResource(target) {
  let t = String(target || '').trim();
  if (t.startsWith('command(') && t.endsWith(')')) {
    t = t.slice('command('.length, -1);
    if (t.startsWith('command(') && t.endsWith(')')) {
      t = t.slice('command('.length, -1);
    }
  }
  return 'command(' + t + ')';
}

/** 按实测语义做本地匹配（用于编译自检；与官方一致时应 100% 对齐） */
function simulateOfficialMatch(resource, commandLine) {
  const m = String(resource).match(/^command\((.*)\)$/s);
  const body = m ? m[1] : String(resource);
  const cmd = String(commandLine || '').trim();
  if (body.startsWith('regex:')) {
    const rest = body.slice('regex:'.length);
    const tokens = rest.split(/\s+/).filter(Boolean);
    if (!tokens.length) return false;
    if (tokens.length === 1) {
      // 单 token：整行 ^(?:token)$
      try {
        return new RegExp('^(?:' + tokens[0] + ')$').test(cmd);
      } catch (e) {
        return false;
      }
    }
    // 多 token：引号串合成词；末尾 .* 吞余下
    const words = tokenizeCommand(cmd);
    if (tokens[tokens.length - 1] === '.*') {
      if (words.length < tokens.length - 1) return false;
      for (let i = 0; i < tokens.length - 1; i++) {
        try {
          if (!new RegExp('^(?:' + tokens[i] + ')$').test(words[i])) return false;
        } catch (e) {
          return false;
        }
      }
      return true;
    }
    if (words.length !== tokens.length) return false;
    for (let i = 0; i < tokens.length; i++) {
      try {
        if (!new RegExp('^(?:' + tokens[i] + ')$').test(words[i])) return false;
      } catch (e) {
        return false;
      }
    }
    return true;
  }
  // 非 regex：整行全等
  return body === cmd;
}

function tokenizeCommand(cmd) {
  const out = [];
  const re = /"[^"]*"|'[^']*'|\S+/g;
  let m;
  while ((m = re.exec(cmd)) !== null) out.push(m[0]);
  return out;
}

function compileRulesToResources(rules) {
  return (rules || [])
    .filter(r => r && r.pattern && r.enabled !== false)
    .map(r => toResource(compileJsPatternToOfficialTarget(r.pattern)));
}

module.exports = {
  compileJsPatternToOfficialTarget,
  toResource,
  simulateOfficialMatch,
  tokenizeCommand,
  compileRulesToResources
};
