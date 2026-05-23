# 🚀 GitHub 协作实战指南

> 三人黑客松团队 Git 协作流程，只讲实际会用到的命令。

---

## 前置条件（只需做一次）

### 1. 仓库所有者添加协作者

```
GitHub 仓库页面 → Settings → Collaborators → Add people
输入队友的 GitHub 用户名，发送邀请
```

队友收到邮件后，**点击接受邀请**才能 push。

### 2. 队友克隆仓库到本地

```bash
git clone https://github.com/你的用户名/仓库名.git
cd 仓库名
```

三人现在都有同一份代码在本地了。

---

## 🔄 每日工作流（核心四步）

```bash
# 1. 开工前：拉取最新代码
git pull origin main

# 2. 干活... 改自己的文件...

# 3. 提交到本地
git add .
git commit -m "人X：做了什么（一句话）"

# 4. 推送到 GitHub
git push origin main
```

> 💡 **关键规则**：每个人只改自己的目录。A 只动 `frontend/`，B 只动 `backend/`，C 只动 `assets/`。这样几乎不会产生冲突。

---

![alt text](images/dda84931-26a9-48dd-b419-7d874dc80a75.png)

## 🔀 分支协作（更安全，推荐）

```bash
# 开工：从最新的 main 开分支
git checkout main
git pull origin main
git checkout -b feature/人X-功能名

# 干完活推送
git add .
git commit -m "功能描述"
git push origin feature/人X-功能名

# 去 GitHub 网页上点 "Create Pull Request" → 合并到 main
```

> 黑客松时间紧，目录不冲突的话直接 push main 也完全够用。

---

## ⚠️ 冲突了怎么办？

万一两个人改了同一个文件：

```bash
# 当 push 被拒时
git pull origin main        # 先拉取
# 如果有冲突，VSCode 会标出来
# 手动解决冲突 → 保存
git add .
git commit -m "解决冲突"
git push origin main
```

---

## 📋 常用命令速查

| 目标 | 命令 |
|------|------|
| 拉最新代码 | `git pull origin main` |
| 看改了啥 | `git status` |
| 提交所有改动 | `git add .` → `git commit -m "xxx"` |
| 推送到远程 | `git push origin main` |
| 看提交历史 | `git log --oneline -10` |
| 临时保存改动 | `git stash` → 恢复用 `git stash pop` |
| 放弃本地改动 | `git checkout -- 文件名` |

---

## 🎯 本项目目录协作策略

```
仓库/
├── frontend/    ← 只有 A 改
├── backend/     ← 只有 B 改
├── assets/      ← 只有 C 改
├── docs/        ← 共享文件（谁都可以改）
├── knowledge/   ← 共享知识文件
└── 分工.md      ← 共享文件
```

### 范例：典型的一天

```
上午 9:00  → 三人各自 git pull origin main （同步起点）

下午 3:00  → 人B 完成了 NPC 对话 API
            git add backend/
            git commit -m "B: 完成 NPC 对话 API 接口"
            git push origin main

下午 3:05  → 人A 要联调了
            git pull origin main   ← 拿到 B 刚推的代码

下午 5:00  → 人C 画好了两个 NPC 的 tile
            git add assets/
            git commit -m "C: 更新老票友+茶楼老板娘 tile"
            git push origin main

下午 5:10  → 人A 拉取
            git pull origin main   ← 拿到新的 tile 资源
```

---

## 🤖 进阶：GitHub Issues 跟踪进度

在 GitHub 仓库网页上 → Issues → New Issue：

- A 提：`「前端」对话 UI 流式输出`
- B 提：`「后端」Agent 对话 API 返回 options`
- 做完后在 commit 里写 `fixes #1`，自动关闭 Issue

---

## 🌐 配置 Git 代理（国内必备）

如果 `git push`/`git pull` 报 `Failed to connect to github.com port 443`，说明网络不通，需要走代理。

### Clash / Clash Verge

```bash
git config --global http.proxy http://127.0.0.1:7890
git config --global https.proxy http://127.0.0.1:7890
```

### V2Ray / v2rayN

```bash
git config --global http.proxy http://127.0.0.1:10809
git config --global https.proxy http://127.0.0.1:10809
```

### 验证代理是否生效

```bash
git config --global --get http.proxy
```

### 取消代理

```bash
git config --global --unset http.proxy
git config --global --unset https.proxy
```

---

## 🛡️ 只提交自己的目录，不误改队友文件

场景：你只负责 `frontend/`，但有时会不小心 `git add .` 把整个仓库都提交了。

### 方案一：.gitignore 忽略非己目录（推荐）

创建 `.gitignore`，只关注自己负责的目录：

```gitignore
# 忽略所有
*

# 但不忽略 frontend 目录
!frontend/
!frontend/**

# 不忽略 .gitignore 本身
!.gitignore
```

> ⚠️ `.gitignore` 只对**新文件**生效。已经在 git 里的旧文件（`backend/`、根目录 `.md` 等）如果被修改，`git status` 仍然会显示。

### 方案二：skip-worktree 彻底锁定（更安全）

把非自己目录的所有已跟踪文件标记为"跳过工作区"，这样无论怎么操作都不会误改：

```bash
# 对 frontend 之外的所有已跟踪文件设置保护
git ls-files -z | ForEach-Object { 
    $files = $_ -split "`0" 
    foreach ($f in $files) { 
        if ($f -and $f -notlike 'frontend/*' -and $f -ne '.gitignore') { 
            git update-index --skip-worktree $f 2>$null 
        }
    }
}

# 验证：查看被保护的文件（以 S 开头）
git ls-files -v | Select-String '^S'
```

效果：
- `git status` — 只看得到自己的目录
- `git add .` — 不会误加队友文件
- `git commit -a` — 不会误改队友文件

取消保护：
```bash
git ls-files -v | Select-String '^S' | ForEach-Object { 
    git update-index --no-skip-worktree ($_.Line -replace '^S ', '') 
}
```

### 提交时的正确姿势

```bash
# 只看自己目录的变更
git status frontend/

# 只暂存自己目录
git add frontend/

# 提交
git commit -m "A: 更新了 xxx"

# 推送
git push origin main
```

---

## 🕐 回退到指定版本

### 本地 + 远程都回退

```bash
# 回退到指定 commit（丢弃之后所有更改）
git reset --hard <commit-hash>

# 强制推送到远程，覆盖远程仓库
git push origin main --force
```

> ⚠️ `--force` 会覆盖远程，确保队友们也都同步回退，否则会混乱。

### 查看提交历史找 hash

```bash
git log --oneline -20
```

---

## ❌ push 被拒绝：remote contains work that you do not have

```bash
# 错误信息
! [rejected]  main -> main (fetch first)
hint: Updates were rejected because the remote contains work that you do not have locally.
```

原因是队友在你之前 push 了新代码。解决：

```bash
# 1. 先拉取远程最新代码并自动合并
git pull origin main --no-edit

# 2. 如果有冲突，解决后 add + commit
# 3. 再次推送
git push origin main
```

---

## 📌 总结

- **每天开工先 `pull`，收工记得 `push`**
- **各改各的目录，冲突几乎不会发生**
- **commit message 写清楚谁做了什么**
- **配置代理走 VPN，告别 `port 443` 超时**
- **用 `.gitignore` + 选择性 `git add` 保护队友的目录**
- **push 被拒先 pull，解决冲突再 push**
