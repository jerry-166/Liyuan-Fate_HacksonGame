-- 梨园生死 · 游戏会话数据表（v2：章节+任务+物品架构）

-- 会话表
CREATE TABLE IF NOT EXISTS sessions (
    session_id   TEXT PRIMARY KEY,
    player_name  TEXT NOT NULL DEFAULT '玩家',
    current_stage INTEGER NOT NULL DEFAULT 1,
    current_chapter_id TEXT,
    script_id TEXT DEFAULT 'liyuan_shengsi',
    active_item TEXT,
    game_ended   INTEGER NOT NULL DEFAULT 0,
    ending_type  TEXT,
    ending_data  TEXT,
    deleted      INTEGER NOT NULL DEFAULT 0,
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
    options     TEXT,
    stage       INTEGER,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);
CREATE INDEX IF NOT EXISTS idx_dialogues_session ON dialogues(session_id, npc_id);

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
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);

-- NPC 运行时状态表
CREATE TABLE IF NOT EXISTS npc_states (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL,
    npc_id      TEXT NOT NULL,
    relationship     INTEGER NOT NULL DEFAULT 0,
    is_available     INTEGER NOT NULL DEFAULT 1,
    current_greeting TEXT NOT NULL DEFAULT '',
    dialogue_round_count INTEGER NOT NULL DEFAULT 0,
    position_col INTEGER DEFAULT 0,
    position_row INTEGER DEFAULT 0,
    scene       TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id),
    UNIQUE(session_id, npc_id)
);
CREATE INDEX IF NOT EXISTS idx_npc_states_session ON npc_states(session_id);

-- 关系值变化日志表
CREATE TABLE IF NOT EXISTS relationship_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL,
    npc_id      TEXT NOT NULL,
    delta       INTEGER NOT NULL,
    old_value   INTEGER NOT NULL,
    new_value   INTEGER NOT NULL,
    reason      TEXT DEFAULT '',
    dialogue_id INTEGER,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);
CREATE INDEX IF NOT EXISTS idx_rel_log_session ON relationship_log(session_id, npc_id);

-- 玩家关键选择记录表
CREATE TABLE IF NOT EXISTS player_choices (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL,
    npc_id      TEXT NOT NULL,
    choice_text     TEXT NOT NULL,
    available_options TEXT,
    dialogue_id INTEGER,
    stage       INTEGER,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);
CREATE INDEX IF NOT EXISTS idx_choices_session ON player_choices(session_id);

-- 阶段切换历史表
CREATE TABLE IF NOT EXISTS stage_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL,
    from_stage  INTEGER NOT NULL,
    to_stage    INTEGER NOT NULL,
    reason      TEXT DEFAULT '',
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

-- ═══ v2 新增表 ═══

-- 叙事物品表
CREATE TABLE IF NOT EXISTS narrative_items (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(session_id),
    item_type TEXT NOT NULL DEFAULT 'misc',
    name TEXT NOT NULL,
    base_description TEXT DEFAULT '',
    ai_detail TEXT,
    ai_detail_locked INTEGER DEFAULT 0,
    is_key INTEGER DEFAULT 0,
    is_discovered INTEGER DEFAULT 0,
    discovery_context TEXT DEFAULT '',
    related_npcs TEXT DEFAULT '[]',
    npc_knowledge TEXT DEFAULT '{}',
    desc_source TEXT DEFAULT 'fixed',
    location_scene TEXT,
    location_pos TEXT DEFAULT '{}',
    source_npc TEXT,
    stage_relevance TEXT DEFAULT '[]',
    template_ref TEXT,
    holdable INTEGER DEFAULT 1,
    acquire_method TEXT DEFAULT '',
    UNIQUE(session_id, id)
);
CREATE INDEX IF NOT EXISTS idx_narrative_items_session ON narrative_items(session_id);

-- 任务实例表
CREATE TABLE IF NOT EXISTS task_instances (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(session_id),
    chapter_id TEXT NOT NULL,
    chapter_name TEXT,
    description TEXT,
    sub_tasks TEXT DEFAULT '[]',
    related_npc_ids TEXT DEFAULT '[]',
    npc_completion_votes TEXT DEFAULT '{}',
    is_completed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_task_instances_session ON task_instances(session_id);

-- 章节进度表
CREATE TABLE IF NOT EXISTS chapter_progress (
    session_id TEXT NOT NULL REFERENCES sessions(session_id),
    chapter_id TEXT NOT NULL,
    task_id TEXT REFERENCES task_instances(id),
    status TEXT DEFAULT 'active',
    started_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    PRIMARY KEY(session_id, chapter_id)
);
