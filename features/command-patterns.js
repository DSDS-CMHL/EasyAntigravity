// Regular-language building blocks shared by stock approval profiles.
// No lookaround: these expressions are written into AG native permissions.
const TOKEN_CHARS = String.raw`[^\s'"|;&]`;
const QUOTED_PATH = String.raw`(?:"[^-"\r\n][^"\r\n]*"|'[^-'\r\n][^'\r\n]*')`;
const PATH_TOKEN = String.raw`(?:[^-\s'"|;&][^\s'"|;&]*|` + QUOTED_PATH + ')';
const BOUNDARY = String.raw`(?:\s|$|['"|;&])`;
const SEGMENT_END = String.raw`\s*(?:$|[|;&]|['"]\s*(?:$|[|;&]))`;

// All nonempty token strings except one exact word, without a negative assertion.
function exceptWord(word) {
  const choices = [];
  for (let i = 0; i < word.length; i++) {
    if (i) choices.push(word.slice(0, i));
    choices.push(word.slice(0, i) + String.raw`[^\s'"|;&` + word[i] + ']' + TOKEN_CHARS + '*');
  }
  choices.push(word + TOKEN_CHARS + '+');
  return '(?:' + choices.join('|') + ')';
}

// A standalone -- cannot be consumed before the dangerous rm option.
const RM_TOKEN = '(?:' + PATH_TOKEN + String.raw`|-[^-\s'"|;&][^\s'"|;&]*|--[^\s'"|;&]+)`;
const RM_OPTION_PATTERN = String.raw`\brm(?:\.exe)?\b(?:\s+` + RM_TOKEN
  + String.raw`)*\s+(?:--(?:recursive|force)|-[a-zA-Z]*[rf][a-zA-Z]*)` + BOUNDARY;

const GIT_VALUE = '(?:' + TOKEN_CHARS + String.raw`+|"[^"\r\n]*"|'[^'\r\n]*')`;
const GIT_PREFIX = String.raw`\bgit(?:\.exe)?\s+(?:(?:(?:-C|-c|--git-dir|--work-tree)\s+`
  + GIT_VALUE + String.raw`|--(?:git-dir|work-tree)=` + GIT_VALUE
  + String.raw`|--(?:no-pager|bare|literal-pathspecs))\s+)*`;
const CLEAN_TOKEN = '(?:' + PATH_TOKEN + String.raw`|-[a-mo-z0-9]+|--` + exceptWord('dry-run') + ')';
const GIT_CLEAN_PATTERN = GIT_PREFIX + String.raw`clean\b(?:\s+` + CLEAN_TOKEN
  + String.raw`)*\s+(?:--force|-[a-mo-z0-9]*[fxd][a-mo-z0-9]*)(?:\s+` + CLEAN_TOKEN + ')*' + SEGMENT_END;

module.exports = { RM_OPTION_PATTERN, GIT_PREFIX, GIT_CLEAN_PATTERN };
