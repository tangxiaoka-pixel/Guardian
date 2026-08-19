# Guardian 云端后台开发与发布流程

`GitHub main` 是腾讯云可部署的唯一代码来源。禁止直接修改腾讯云源码；紧急修复也必须先回写到 Git。

## 分支约定

- `main`：已验证、可部署到腾讯云的稳定版本。
- `develop`：日常集成与联调分支。
- `feature/<name>`：单项功能或修复的工作分支。

## 每次开发

```bash
./scripts/start-feature.sh forge-vlm-detail
# 完成功能、完成本地验证后
git add .
git commit -m "feat: improve Forge VLM detail"
git push -u origin feature/forge-vlm-detail
```

通过审查或联调后，将功能分支合入 `develop`；验证通过后由 `develop` 合入 `main`。在当前两人协作阶段，可使用下面的受控脚本完成构建、合并和发布：

```bash
./scripts/promote-and-deploy.sh feature/forge-vlm-detail
```

## 发布腾讯云

发布只允许使用 `main`：

```bash
./scripts/deploy-cloud-main.sh
```

脚本会让腾讯云从 GitHub 拉取 `main`、执行依赖安装和前端构建、发布静态页面、重启云端 API，并检查服务状态。

## 腾讯云 GitHub 部署密钥

腾讯云使用 `/root/.ssh/guardian_github_deploy` 作为 GitHub 只读部署密钥。需要在 GitHub 仓库的 **Settings → Deploy keys → Add deploy key** 添加其公钥，名称建议为 `guardian-cloud-prod`，不要勾选写入权限。
