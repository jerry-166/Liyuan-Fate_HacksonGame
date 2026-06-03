# 梨园生死 · 后端 Dockerfile
# Python FastAPI + Uvicorn，部署到 CloudBase CloudRun

FROM python:3.10-slim

WORKDIR /app

# 安装系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# 复制依赖文件并安装
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制后端代码到 /app/
COPY backend/ .

# 复制剧本数据到 /data/scripts/（匹配 script_loader.py 的相对路径解析）
COPY data/ /data/

# 创建数据目录
RUN mkdir -p /app/saves

# CloudBase CloudRun 通过 PORT 环境变量注入端口
EXPOSE 8000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --log-level info"]
