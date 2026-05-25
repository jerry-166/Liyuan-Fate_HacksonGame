"""
梨园生死 · 后端主入口 — v2 章节驱动架构。
"""

import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from state.manager import get_session_manager
from routes import dialogue, game, archive, chapter, item

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("[Main] Starting 梨园生死 backend v2...")
    get_session_manager()
    logger.info("[Main] SessionManager initialized")
    yield
    logger.info("[Main] Shutting down...")


app = FastAPI(
    title="梨园生死 API",
    description="《梨园生死》游戏后端 — 章节驱动 + AI 任务规划 + 多 NPC 共识推进",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(dialogue.router, prefix="/api")
app.include_router(game.router, prefix="/api")
app.include_router(archive.router, prefix="/api")
app.include_router(chapter.router, prefix="/api")
app.include_router(item.router, prefix="/api")


@app.get("/api/health")
async def health():
    manager = get_session_manager()
    return {
        "status": "healthy",
        "version": "2.0.0",
        "active_sessions": manager.active_count,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True, log_level="info")
