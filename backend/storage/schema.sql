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
