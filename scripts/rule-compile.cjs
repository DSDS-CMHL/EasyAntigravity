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
function compileJsPatternToOfficialTarget(jsPattern, flags = '') {
  let p = String(jsPattern == null ? '' : jsPattern);
  if (!p) return '';
  // AG targets do not carry JS flags. Encode ASCII case folding in the pattern,
  // rather than relying on an unverified inline flag such as (?i).
  if (/[^ig]/.test(flags)) throw new Error(`无法编译权限正则 flags: ${flags}`);
  new RegExp(p, flags); // Reject invalid user expressions before emitting a grant.
  if (flags.includes('i')) p = foldAsciiCase(p);
  // 字面空白 → \s+（保留已有 \s \t \n 等转义；\ 后跟 s/t/n/ 等不动）
  p = p.replace(/([^\\]|^)\s+/g, (m, pre) => pre + '\\s+');
  // 残留的行首空白
  p = p.replace(/^\s+/, '\\s+');
  // test() 语义：允许前后有其它字符
  return 'regex:.*(?:' + p + ').*';
}

function foldAsciiCase(pattern) {
  if (/\(\?<[^=!]|\\[kp]/.test(pattern)) throw new Error('权限正则暂不支持命名引用或 Unicode 属性');
  const opposite = c => c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase();
  function atom(index) {
    if (pattern[index] !== '\\') return { text: pattern[index], value: pattern[index], end: index + 1 };
    const escape = pattern.slice(index).match(/^\\(?:x[\da-fA-F]{2}|u[\da-fA-F]{4}|c[A-Za-z]|.)/);
    if (!escape) throw new Error('权限正则存在不完整转义');
    const text = escape[0];
    const value = /^\\[xu][\da-fA-F]+$/.test(text) ? String.fromCharCode(parseInt(text.slice(2), 16))
      : /^\\[A-Za-z]$/.test(text) && !/[bBcdDfnrsStuvwWx]/.test(text[1]) ? text[1] : '';
    return { text, value, end: index + text.length };
  }
  let result = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '[') {
      let body = '', additions = '', j = i + 1;
      if (pattern[j] === '^') body += pattern[j++];
      while (j < pattern.length && pattern[j] !== ']') {
        const first = atom(j);
        if (first.value && pattern[first.end] === '-' && pattern[first.end + 1] && pattern[first.end + 1] !== ']') {
          const last = atom(first.end + 1);
          body += first.text + '-' + last.text;
          if (last.value) {
            // Also handles escaped endpoints and ranges such as [A-z].
            for (const [start, end, delta] of [[65, 90, 32], [97, 122, -32]]) {
              const lo = Math.max(start, first.value.charCodeAt(0));
              const hi = Math.min(end, last.value.charCodeAt(0));
              if (lo <= hi) additions += String.fromCharCode(lo + delta) + (lo === hi ? '' : '-' + String.fromCharCode(hi + delta));
            }
          }
          j = last.end;
        } else {
          // A trailing literal '-' must remain literal after appending letters.
          body += first.text === '-' && pattern[first.end] === ']' ? '\\-' : first.text;
          if (/^[A-Za-z]$/.test(first.value)) additions += opposite(first.value);
          j = first.end;
        }
      }
      result += '[' + body + additions + ']';
      i = j;
    } else {
      const token = atom(i);
      result += /^[A-Za-z]$/.test(token.value) ? `[${token.value.toLowerCase()}${token.value.toUpperCase()}]` : token.text;
      i = token.end - 1;
    }
  }
  return result;
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
    .map(r => toResource(compileJsPatternToOfficialTarget(r.pattern, r.flags === undefined ? 'i' : r.flags)));
}

module.exports = {
  compileJsPatternToOfficialTarget,
  toResource,
  simulateOfficialMatch,
  tokenizeCommand,
  compileRulesToResources
};
