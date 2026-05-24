-- 梨园生死 · 游戏会话数据表

-- 会话表
CREATE TABLE IF NOT EXISTS sessions (
    session_id   TEXT PRIMARY KEY,
    player_name  TEXT NOT NULL DEFAULT '玩家',
    current_stage INTEGER NOT NULL DEFAULT 1,
    game_ended   INTEGER NOT NULL DEFAULT 0,  -- 0/1
    ending_type  TEXT,
    ending_data  TEXT,                         -- JSON: 缓存的结局评价
    deleted      INTEGER NOT NULL DEFAULT 0,   -- 0/1: 软删除标记
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 对话记录表
CREATE TABLE IF NOT EXISTS dialogues (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL,
    npc_id      TEXT NOT NULL,
    role        TEXT NOT NULL CHECK(role IN ('player', 'npc')),
    content     TEXT NOT NULL,
    options     TEXT,                           -- JSON: NPC 回复附带的对话选项
    stage       INTEGER,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

CREATE INDEX IF NOT EXISTS idx_dialogues_session
    ON dialogues(session_id, npc_id);

-- 事件日志表
CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL,
    event_id    TEXT NOT NULL,
    description TEXT,
    triggered_by_npc TEXT,
    stage       INTEGER,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

CREATE INDEX IF NOT EXISTS idx_events_session
    ON events(session_id);

-- NPC 运行时状态表（每个 Session 下每个 NPC 一行）
CREATE TABLE IF NOT EXISTS npc_states (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL,
    npc_id      TEXT NOT NULL,
    relationship     INTEGER NOT NULL DEFAULT 0,
    is_available     INTEGER NOT NULL DEFAULT 1,   -- 0/1
    current_greeting TEXT NOT NULL DEFAULT '',
    dialogue_round_count INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id),
    UNIQUE(session_id, npc_id)
);

CREATE INDEX IF NOT EXISTS idx_npc_states_session
    ON npc_states(session_id);

-- 关系值变化日志表
CREATE TABLE IF NOT EXISTS relationship_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL,
    npc_id      TEXT NOT NULL,
    delta       INTEGER NOT NULL,          -- 本轮变化量（如 +5）
    old_value   INTEGER NOT NULL,          -- 变化前值
    new_value   INTEGER NOT NULL,          -- 变化后值
    reason      TEXT DEFAULT '',           -- 变化原因
    dialogue_id INTEGER,                   -- 关联的对话记录ID（可选）
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

CREATE INDEX IF NOT EXISTS idx_rel_log_session
    ON relationship_log(session_id, npc_id);

-- 玩家关键选择记录表
CREATE TABLE IF NOT EXISTS player_choices (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL,
    npc_id      TEXT NOT NULL,
    choice_text     TEXT NOT NULL,         -- 玩家选择的选项文本
    available_options TEXT,                 -- JSON: 当时所有可选选项
    dialogue_id INTEGER,                   -- 关联的对话记录ID
    stage       INTEGER,                   -- 选择时所在阶段
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

CREATE INDEX IF NOT EXISTS idx_choices_session
    ON player_choices(session_id);

-- 阶段切换历史表
CREATE TABLE IF NOT EXISTS stage_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL,
    from_stage  INTEGER NOT NULL,
    to_stage    INTEGER NOT NULL,
    reason      TEXT DEFAULT '',           -- "rule: xxx" 或 "llm: 连续N轮推进"
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);
