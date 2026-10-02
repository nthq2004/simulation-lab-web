deep:sk-REDACTED_DEEPSEEK
{
  "claudeCode.environmentVariables": [
    { "name": "ANTHROPIC_AUTH_TOKEN", "value": "sk-REDACTED_ANTHROPIC" },
    { "name": "ANTHROPIC_BASE_URL", "value": "https://api.lingyaai.cn" }
  ],  
}
%USERPROFILE%\.claude\settings.json

步骤 3：配置灵芽 API
获取 API 密钥:
访问 灵芽 API 控制台 并登录。
选择 Claude Code 专用分组。
创建一个新的令牌。
复制生成的密钥。
创建配置文件:
找到或创建以下路径的配置文件：%USERPROFILE%\.claude\settings.json。
将以下内容填入 settings.json 文件中：
{  
    "env": {
    "ANTHROPIC_AUTH_TOKEN": "粘贴您从 api.lingyaai.cn 获取的密钥",
    "ANTHROPIC_BASE_URL": "https://api.lingyaai.cn",
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1",
    "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS": "1"
  }
}复制
一键配置脚本：点击下载，双击运行。