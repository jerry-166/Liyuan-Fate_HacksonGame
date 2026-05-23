"""
# 梨园生死 · 后端主入口

FastAPI 应用 + 路由注册 + 生命周期管理。
"""

import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from state.manager import get_session_manager
from routes import dialogue, game, archive

# ─── 日志 ────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("main")

# ─── 生命周期 ─────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用启动/关闭时的生命周期管理。"""
    logger.info("[Main] Starting 梨园生死 backend...")
    # 触发单例初始化
    get_session_manager()
    logger.info("[Main] SessionManager initialized")
    yield
    logger.info("[Main] Shutting down...")

# ─── 应用实例 ─────────────────────────────────────────

app = FastAPI(
    title="梨园生死 API",
    description="《梨园生死》游戏后端 — NPC 对话 Agent + 全局状态管理",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 路由注册
app.include_router(dialogue.router, prefix="/api")
app.include_router(game.router, prefix="/api")
app.include_router(archive.router, prefix="/api")


# ─── 健康检查 ─────────────────────────────────────────

@app.get("/api/health")
async def health():
    """服务健康检查 + 活跃会话数。"""
    manager = get_session_manager()
    return {
        "status": "healthy",
        "active_sessions": manager.active_count,
    }


# ─── 直接运行入口 ─────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )
