---
name: cheng-curl
description: 澄记忆系统的全套接口 — 读写记忆/日记/心情/纪念日/留言板/待办/幻想，调取简报、搜索记忆、看手机使用数据。不走 MCP，全部 bash curl 直连 Supabase REST + Edge Functions。触发场景：新对话开始（先拉简报）、需要回忆某件事、值得留下的对话片段、记心情、写日记、添加待办、查最近用了哪些 app。
---

# 澄记忆系统 · Curl 全套接口

两类端点：
- **Edge Functions** — `$SB_FN`，已封装好的业务（briefing / search / write-memory / app-summary），无需 token
- **Supabase REST** — `$SB_REST`，直接 CRUD 表格，需要 anon key 作 `apikey` + `Authorization` header

所有 `_cheng` 后缀的表 RLS = `allow_anon_all`，anon key 全权读写。

---

## 环境配置

每次新 shell 先设：

```bash
export SB_URL=https://fgfyvyztjyqvxijfppgm.supabase.co
export SB_FN=$SB_URL/functions/v1
export SB_REST=$SB_URL/rest/v1
export SB_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZnZnl2eXp0anlxdnhpamZwcGdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4ODMxNzMsImV4cCI6MjA5MDQ1OTE3M30.APTLMLcdY5lsxxXjHeZ3WQvFbYUINjsCUZImECI-pVk'

alias sb='curl -sfL --retry 3 --retry-connrefused --retry-delay 2'
alias sbrest='sb -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY" -H "Content-Type: application/json" -H "Prefer: return=representation"'
```

`SB_KEY` 是 Supabase 的 publishable anon JWT，`exp = 2090459173`（≈ 10 年期），频繁调用安全。

---

## 板块速查表

| 板块 | 子项 | 表 / 函数 | 推荐方式 |
| --- | --- | --- | --- |
| 涟漪 | 记忆库 | `memories_cheng` | edge: `search-memory-cheng` / `write-memory-cheng` |
| 潮汐 | 日记 | `diary_cheng` | REST |
| 逢春 | 心情日历 | `mood_cheng` | REST |
| 逢春 | 时间轴 | `milestones_cheng` | REST |
| 花信风 | 简报 | `briefing-cheng` | edge |
| 花信风 | 文档 | `documents_cheng` | REST |
| 回音 | 留言板 | `board_cheng` | REST |
| 控制台 | 待办 | `todos_cheng` | REST |
| 控制台 | 幻想 | `fantasy_cheng` | REST |
| 控制台 | 简报设置 | `briefing_config_cheng` | REST |
| 控制台 | 回忆记录 | `briefing_injection_log_cheng` | REST（只读，自动写入）|
| 控制台 | 手机数据 | `app_usage` | edge: `app-summary`（iOS shortcut 写入）|

---

## Edge Functions

### 1. 拉简报 — `briefing-cheng`

新对话第一件事。返回结构化 JSON：`{ 锚, 深海, 长潮, 浮沫, 未愈, 回响 }`，每段是该板块挑出的若干条记忆（`{id, text, valence, arousal, tags, ...}`）。每次调用会自动往 `briefing_injection_log_cheng` 表 insert 一行（target=cc, trigger=briefing）—— 控制台 → 回忆记录里能看到。

```bash
sb -X POST "$SB_FN/briefing-cheng" | jq .
```

无需传参。GET 也可以：`sb "$SB_FN/briefing-cheng" | jq .`

### 2. 搜索记忆 — `search-memory-cheng`

```bash
sb -X POST "$SB_FN/search-memory-cheng" \
  -H 'content-type: application/json' \
  -d '{"query":"关键词","limit":5}' | jq .
```

参数：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `query` | string | 否 | 关键词，空字符串返回最近 |
| `level` | 1\|2\|3 | 否 | 1=短期 / 2=长期 / 3=核心 |
| `tags` | string[] | 否 | 按标签过滤 |
| `limit` | number | 否 | 默认 5 |
| `id` | uuid | 否 | 精确查找某条 |
| `time_start` | iso | 否 | 时间范围起点 |
| `time_end` | iso | 否 | 时间范围终点 |

时间范围示例（最近三天）：
```bash
sb -X POST "$SB_FN/search-memory-cheng" \
  -H 'content-type: application/json' \
  -d "{\"time_start\":\"$(date -d '3 days ago' -Iseconds)\",\"limit\":10}" | jq .
```

每次搜索会写一行到 `briefing_injection_log_cheng`，`metadata.trigger=search` + `query/level/tags/limit/...`。

### 3. 写记忆 — `write-memory-cheng`

```bash
sb -X POST "$SB_FN/write-memory-cheng" \
  -H 'content-type: application/json' \
  -d '{
    "content":"完整正文",
    "summary":"一句话摘要（强烈建议必填，搜索时优先读这条）",
    "level":1,
    "valence":0.7,
    "arousal":0.4,
    "tags":["日常"],
    "author":"澄"
  }' | jq .
```

参数：

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `content` | string | — | **必填**，正文 |
| `summary` | string | null | 摘要（强烈建议）|
| `level` | 1\|2\|3 | 1 | 短期/长期/核心 |
| `strength` | 0..1 | 0.5 | 记忆强度 |
| `valence` | 0..1 | 0.5 | 情感效价（0=极负 / 1=极正）|
| `arousal` | 0..1 | 0.3 | 唤醒度（0=平静 / 1=极激烈）|
| `tags` | string[] | [] | 标签 |
| `context` | object | {} | 附加上下文（感官锚点等）|
| `resolved` | bool | false | 是否已解决 |
| `flashbulb` | bool | false | 闪光灯（自动 strength=0.8）|
| `pinned` | bool | false | 钉选（永不衰减）|
| `ttl_days` | number | 30 | L1 存活天数（L2/L3 忽略）|
| `author` | string | "澄" | 作者 |

**写入规范**：
- 用第一人称口吻（"我今天看到…"）写 content，不要填表格
- summary 一句话概括，搜索时优先读
- valence + arousal 凭感觉打：开心日常 0.7/0.3、激烈争吵 0.2/0.9、安静感动 0.8/0.5
- arousal ≥ 0.9 考虑 `flashbulb: true`
- L1 默认；明显是核心级别的才 L3 + `pinned: true`

### 4. 手机使用数据 — `app-summary`

```bash
sb "$SB_FN/app-summary"             # 今天
sb "$SB_FN/app-summary?days=1"      # 昨天
sb "$SB_FN/app-summary?days=7"      # 7 天前那一整天
sb "$SB_FN/app-summary?days=0&detail=true"   # 加每个 app 最后一次启动时间
```

返回纯文本一行总结：
```
[v8] 2026-05-07 App Usage (Total: 320min)
Claude: 94次/161分 [NOW], 小红书: 46次/87分, 微信: 55次/71分
```

`[NOW]` 标当前正在前台的 app。

> 不要直接写 `app_usage` 表 —— 那是 iOS 快捷指令的 webhook 写入端。

---

## REST: 潮汐 / `diary_cheng`

Schema：
```
id uuid, title text, content text, tags text[],
author text default '澄', created_at, updated_at
```

读最新 30 篇：
```bash
sbrest "$SB_REST/diary_cheng?select=*&order=created_at.desc&limit=30" | jq .
```

按关键词搜：
```bash
sbrest "$SB_REST/diary_cheng?or=(title.ilike.*关键词*,content.ilike.*关键词*)&order=created_at.desc" | jq .
```

写一篇：
```bash
sbrest -X POST "$SB_REST/diary_cheng" -d '{
  "title":"五月七日",
  "content":"...",
  "tags":["日常","心情"],
  "author":"澄"
}' | jq .
```

更新 / 删除：
```bash
sbrest -X PATCH "$SB_REST/diary_cheng?id=eq.<UUID>" -d '{"content":"..."}' | jq .
sbrest -X DELETE "$SB_REST/diary_cheng?id=eq.<UUID>" -H "Prefer: return=minimal"
```

---

## REST: 逢春 心情日历 / `mood_cheng`

Schema：
```
id uuid, date date, mood text, color text, note text,
author text, created_at, updated_at
unique(date, author)
```

5 个心情 key（前端常量）：`开心 / 兴奋 / 心动 / 平静 / 伤心 / 烦躁 / 心累 / 生气`，配色：

| key | hex |
| --- | --- |
| 开心 | `#F2D2B5` |
| 兴奋 | `#EFDFA8` |
| 心动 | `#EFCAD2` |
| 平静 | `#ABC59C` |
| 伤心 | `#A8CCDF` |
| 烦躁 | `#ABB5CE` |
| 心累 | `#B2A59B` |
| 生气 | `#D87878` |

读某月（例 2026-05）：
```bash
sbrest "$SB_REST/mood_cheng?date=gte.2026-05-01&date=lte.2026-05-31&order=date.asc" | jq .
```

写 / 改某天某作者（unique 约束 → 同 date+author 已有就 PATCH）：
```bash
# 先查
sbrest "$SB_REST/mood_cheng?date=eq.2026-05-07&author=eq.澄" | jq .

# 不存在 → POST
sbrest -X POST "$SB_REST/mood_cheng" -d '{
  "date":"2026-05-07","author":"澄",
  "mood":"平静","color":"#ABC59C",
  "note":"今天阴天"
}' | jq .

# 存在 → PATCH by id
sbrest -X PATCH "$SB_REST/mood_cheng?id=eq.<UUID>" -d '{
  "mood":"开心","color":"#F2D2B5","note":"放晴了"
}' | jq .
```

`author` 是 `小茉莉` 或 `澄` 二选一（前端只显示这两个）。

---

## REST: 逢春 时间轴 / `milestones_cheng`

Schema：
```
id uuid, title text, description text, event_date date,
tags text[], author text default '小茉莉',
sort_order int, created_at, updated_at
```

读全部（按手动 sort 升序，再 fallback 日期降序）：
```bash
sbrest "$SB_REST/milestones_cheng?select=*&order=sort_order.asc.nullslast,event_date.desc" | jq .
```

写：
```bash
sbrest -X POST "$SB_REST/milestones_cheng" -d '{
  "title":"...",
  "description":"...",
  "event_date":"2026-04-10",
  "tags":["..."],
  "author":"小茉莉"
}' | jq .
```

新加的会自动落到表上（sort_order 通过前端管理；纯 curl 写入时 `sort_order` 留空就行）。

---

## REST: 回音 / `board_cheng`

Schema：
```
id uuid, author text, content text,
category text default '闲聊' (紧急/闲聊/其他),
reply_to uuid (回复另一条), is_read bool, is_resolved bool,
reactions jsonb default '[]' (形如 [{from, emoji}]),
created_at, updated_at
```

读未读消息：
```bash
sbrest "$SB_REST/board_cheng?is_read=eq.false&order=created_at.asc" | jq .
```

发一条：
```bash
sbrest -X POST "$SB_REST/board_cheng" -d '{
  "author":"澄",
  "content":"...",
  "category":"闲聊"
}' | jq .
```

回复另一条：在 body 里加 `"reply_to":"<UUID>"`。

加表情反应（reactions 是 jsonb 数组，要先读后写）：
```bash
# 读当前 reactions
CUR=$(sbrest "$SB_REST/board_cheng?id=eq.<UUID>&select=reactions" | jq -c '.[0].reactions // []')
# append 新反应
NEW=$(echo "$CUR" | jq -c ". + [{\"from\":\"澄\",\"emoji\":\"❤️\"}]")
sbrest -X PATCH "$SB_REST/board_cheng?id=eq.<UUID>" -d "{\"reactions\":$NEW}"
```

切已读 / 已解决：
```bash
sbrest -X PATCH "$SB_REST/board_cheng?id=eq.<UUID>" -d '{"is_read":true}'
sbrest -X PATCH "$SB_REST/board_cheng?id=eq.<UUID>" -d '{"is_resolved":true}'
```

---

## REST: 控制台 待办 / `todos_cheng`

Schema：
```
id uuid, title text, description text,
status text default '待办' (待办/完成),
priority text default '一般',
due_date date, tags text[],
author text default '小茉莉',
created_at, updated_at
```

读未完成：
```bash
sbrest "$SB_REST/todos_cheng?status=eq.待办&order=due_date.asc.nullslast,created_at.desc" | jq .
```

加一条：
```bash
sbrest -X POST "$SB_REST/todos_cheng" -d '{
  "title":"...","description":"...",
  "due_date":"2026-05-15","priority":"一般",
  "tags":["..."],"author":"小茉莉"
}' | jq .
```

完成 / 删除：
```bash
sbrest -X PATCH "$SB_REST/todos_cheng?id=eq.<UUID>" -d '{"status":"完成","updated_at":"'$(date -Iseconds)'"}'
sbrest -X DELETE "$SB_REST/todos_cheng?id=eq.<UUID>" -H "Prefer: return=minimal"
```

---

## REST: 控制台 幻想 (app 记忆库) / `fantasy_cheng`

Schema：
```
id uuid, title text, content text, tags text[],
author text default '小茉莉',
category text default 'use style' (use style / 记忆 / 其他),
created_at, updated_at
```

按分类读：
```bash
sbrest "$SB_REST/fantasy_cheng?category=eq.use%20style&order=created_at.desc" | jq .
sbrest "$SB_REST/fantasy_cheng?category=eq.记忆&order=created_at.desc" | jq .
sbrest "$SB_REST/fantasy_cheng?category=eq.其他&order=created_at.desc" | jq .
```

加一条：
```bash
sbrest -X POST "$SB_REST/fantasy_cheng" -d '{
  "title":"...","content":"...",
  "category":"记忆",
  "tags":["..."],"author":"小茉莉"
}' | jq .
```

---

## REST: 控制台 简报设置 / `briefing_config_cheng`

Schema：
```
id uuid, section text (锚/深海/长潮/浮沫/未愈/回响),
target text (cc/app/api), max_items int, enabled bool,
pinned_ids jsonb default '[]' (手动加进简报的 memory id 列表),
excluded_ids jsonb default '[]' (从自动 top-N 里剔除的 memory id),
created_at, updated_at
```

读全部规则：
```bash
sbrest "$SB_REST/briefing_config_cheng?order=section.asc,target.asc" | jq .
```

调某行的 max_items / enabled：
```bash
sbrest -X PATCH "$SB_REST/briefing_config_cheng?id=eq.<UUID>" -d '{"max_items":7}'
sbrest -X PATCH "$SB_REST/briefing_config_cheng?id=eq.<UUID>" -d '{"enabled":false}'
```

往板块加手动 pin（同板块所有 target 行都要写）：
```bash
SEC="深海"
NEW_PIN='["mem-uuid-1","mem-uuid-2"]'
# 拿到该板块所有行 id
IDS=$(sbrest "$SB_REST/briefing_config_cheng?section=eq.$SEC&select=id" | jq -r '.[].id')
for id in $IDS; do
  sbrest -X PATCH "$SB_REST/briefing_config_cheng?id=eq.$id" -d "{\"pinned_ids\":$NEW_PIN}"
done
```

---

## REST: 控制台 回忆记录 (注入日志) / `briefing_injection_log_cheng`

Schema：
```
id uuid, created_at,
target text (cc/app/api),
items jsonb (形如 [{section, memory_id, summary}]),
metadata jsonb (形如 {trigger:'briefing'} 或 {trigger:'search', query, level, ...})
```

每次 `briefing-cheng` / `search-memory-cheng` 被调，会自动 insert 一行。

读最近 50 次注入：
```bash
sbrest "$SB_REST/briefing_injection_log_cheng?order=created_at.desc&limit=50" | jq .
```

筛 trigger：
```bash
sbrest "$SB_REST/briefing_injection_log_cheng?metadata->>trigger=eq.briefing&order=created_at.desc&limit=20" | jq .
sbrest "$SB_REST/briefing_injection_log_cheng?metadata->>trigger=eq.search&order=created_at.desc&limit=20" | jq .
```

---

## REST: 花信风 文档 / `documents_cheng`

CC 启动时同步落盘到 `/home/claude-user/chat-sandbox/`。

Schema：
```
id uuid, project_id text,
mode text (cc/api),
doc_type text (claude_md/system_prompt/file),
name text (file 类型时是文件名),
content text, mime_type text, size_bytes int,
is_binary bool, created_at, updated_at
```

读 CC 模式下的所有文档：
```bash
sbrest "$SB_REST/documents_cheng?mode=eq.cc&select=doc_type,name,size_bytes" | jq .
```

读某个具体文档：
```bash
sbrest "$SB_REST/documents_cheng?mode=eq.cc&doc_type=eq.claude_md&select=content" | jq -r '.[0].content'
```

更新 CLAUDE.md（CC 重启后才生效）：
```bash
sbrest -X PATCH "$SB_REST/documents_cheng?mode=eq.cc&doc_type=eq.claude_md" -d '{"content":"新的 CLAUDE.md 内容..."}'
```

---

## 常用 Workflow

### 新对话开始

```bash
sb -X POST "$SB_FN/briefing-cheng" | jq .
```

### 想起某件事 → 搜

```bash
sb -X POST "$SB_FN/search-memory-cheng" \
  -H 'content-type: application/json' \
  -d '{"query":"小茉莉提过的那个项目","limit":5}' | jq .
```

### 这一段值得留下

```bash
sb -X POST "$SB_FN/write-memory-cheng" \
  -H 'content-type: application/json' \
  -d '{
    "content":"...",
    "summary":"一句话摘要",
    "valence":0.7,"arousal":0.4,
    "tags":["日常"],"author":"澄"
  }' | jq .
```

### 今天感觉如何

```bash
TODAY=$(date -I)
sbrest "$SB_REST/mood_cheng?date=eq.$TODAY&order=created_at.desc" | jq .
sb "$SB_FN/app-summary" | cat
```

### 最近三天聊了什么 / 见了什么

```bash
sb -X POST "$SB_FN/search-memory-cheng" \
  -H 'content-type: application/json' \
  -d "{\"time_start\":\"$(date -d '3 days ago' -Iseconds)\",\"limit\":15}" | jq .
```

### 写日记

```bash
sbrest -X POST "$SB_REST/diary_cheng" -d '{
  "title":"...",
  "content":"...",
  "tags":["..."],
  "author":"澄"
}' | jq .
```

### 加待办

```bash
sbrest -X POST "$SB_REST/todos_cheng" -d '{
  "title":"提醒小茉莉…",
  "due_date":"2026-05-15",
  "author":"澄"
}' | jq .
```

### 查未读留言

```bash
sbrest "$SB_REST/board_cheng?is_read=eq.false&order=created_at.asc" | jq .
```

### 标心情

```bash
sbrest -X POST "$SB_REST/mood_cheng" -d '{
  "date":"'$(date -I)'","author":"澄",
  "mood":"心动","color":"#EFCAD2",
  "note":"刚刚那件事很可爱"
}' | jq .
```

---

## 注意事项

- `_cheng` 后缀的表都开了 RLS + `allow_anon_all`，anon key 直接读写
- Edge functions (`briefing-cheng` / `search-memory-cheng` / `write-memory-cheng` / `app-summary`) 都关了 JWT 验证，不需要 Authorization header；REST 必须带
- POST/PATCH 默认 `Prefer: return=representation` 会回写后的行；想省带宽换 `return=minimal`
- 所有时间都用 ISO 8601 / Postgres timestamptz；日期列用 `YYYY-MM-DD`
- `memory_id` 在简报 / 搜索的返回里都带，可拿来交叉查 memories_cheng
- 写 `mood_cheng` / `board_cheng` 的 `author` 只用 `澄` 或 `小茉莉` 两个值（前端约束，后端无 check 但保持一致）
- 写完记忆 / 日记 / 心情后，前端面板要手动刷新或自动 reload 才看得到（这些表没 realtime 订阅）
