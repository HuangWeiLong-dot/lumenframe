# -*- coding: utf-8 -*-
"""
main.py — FilmGrab 截图服务端代理（FastAPI）

接口：
  GET /api/screenshots?movie=<电影名>
      返回该电影的截图列表，图片地址已包装成 /api/proxy?url=...
  GET /api/proxy?url=<FilmGrab 图片原始地址（URL 编码）>
      校验域名白名单后实时转发图片二进制，不落地存储。

特性：
  - 截图列表内存缓存（默认 6 小时），避免重复抓取
  - 图片二进制内存缓存（默认 1 小时、最多 120 张），LRU 淘汰
  - 图片代理并发限制（asyncio.Semaphore，默认 8）
  - 白名单：只允许代理 film-grab.com / www.film-grab.com 的 /wp-content/uploads/ 图片
  - 仅个人学习使用：FilmGrab 不接受爬取，请勿公开分发或商业化；图片版权归电影公司所有。

启动：
  uvicorn main:app --host 0.0.0.0 --port 8000
"""

import os
import time
import asyncio
import logging
from collections import OrderedDict
from typing import Optional
from urllib.parse import quote, urlparse

from fastapi import FastAPI, Query, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware

import filmgrab_scraper as fg

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("filmgrab")

app = FastAPI(title="FilmGrab Screenshot Proxy", version="1.0.0")

# 前端与本服务不同源时（开发期 Vite 5173）需要 CORS；同域集成时无影响
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

# ---------- 内存缓存 ----------
LIST_TTL = 6 * 60 * 60          # 截图列表缓存 6 小时
list_cache = {}                 # key: 归一化电影名 -> (timestamp, data)

IMG_TTL = 60 * 60               # 图片缓存 1 小时
IMG_CACHE_MAX = 120
img_cache = OrderedDict()       # key: 原始图片 URL -> (timestamp, bytes, content_type)

# 同时向 FilmGrab 发起的图片下载并发上限
PROXY_SEMAPHORE = asyncio.Semaphore(int(os.environ.get("PROXY_CONCURRENCY", "8")))


def _list_cache_get(key):
    item = list_cache.get(key)
    if item and time.time() - item[0] < LIST_TTL:
        return item[1]
    return None


def _list_cache_set(key, value):
    if len(list_cache) >= 200:  # 简单上限，防无限增长
        list_cache.pop(next(iter(list_cache)))
    list_cache[key] = (time.time(), value)


def _img_cache_get(key):
    item = img_cache.get(key)
    if not item:
        return None
    if time.time() - item[0] >= IMG_TTL:
        img_cache.pop(key, None)
        return None
    img_cache.move_to_end(key)  # LRU 续期
    return item[1], item[2]


def _img_cache_set(key, content, content_type):
    if key in img_cache:
        img_cache.move_to_end(key)
    img_cache[key] = (time.time(), content, content_type)
    while len(img_cache) > IMG_CACHE_MAX:
        img_cache.popitem(last=False)


@app.get("/api/screenshots")
async def screenshots(
    movie: str = Query(..., min_length=1, description="电影名称"),
    year: Optional[str] = Query(None, description="上映年份，用于区分同名翻拍版"),
):
    """获取某部电影的截图列表（图片地址为本站代理 URL）。"""
    name = movie.strip()
    # 年份参与缓存键，避免同名电影（如 Dune 1984/2021）互相串缓存
    cache_key = f"{name.lower()}|{year or ''}"

    cached = _list_cache_get(cache_key)
    if cached is not None:
        return cached

    # requests 是同步库，放到线程池执行，避免阻塞事件循环
    data = await asyncio.to_thread(fg.fetch_screenshots, name, year)

    proxied = [
        "/api/proxy?url=" + quote(u, safe="")
        for u in data["screenshots"]
    ]
    result = {
        "movie": data["movie"],
        "page_title": data["page_title"],
        "count": len(proxied),
        "screenshots": proxied,
    }
    # 空结果不缓存太久，避免站点短暂异常被长期缓存（这里干脆不缓存空结果）
    if result["count"] > 0:
        _list_cache_set(cache_key, result)
    return result


@app.get("/api/proxy")
async def proxy(url: str = Query(..., description="FilmGrab 图片原始地址（需 URL 编码）")):
    """白名单校验后实时代理转发 FilmGrab 图片，返回二进制流。"""
    # 白名单校验：拒绝非 FilmGrab 域名/非图片路径，防止被当作任意开放代理
    if not fg.is_allowed_image_url(url):
        raise HTTPException(status_code=403, detail="only FilmGrab image URLs are allowed")

    cached = _img_cache_get(url)
    if cached is not None:
        content, content_type = cached
        return Response(
            content=content,
            media_type=content_type,
            headers={"Cache-Control": "public, max-age=86400", "X-Cache": "HIT"},
        )

    async with PROXY_SEMAPHORE:
        try:
            content, content_type = await asyncio.to_thread(fg.fetch_image, url)
        except Exception as exc:
            logger.warning("图片代理失败 %s: %s", url, exc)
            raise HTTPException(status_code=502, detail="failed to fetch upstream image")

    _img_cache_set(url, content, content_type)
    return Response(
        content=content,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=86400", "X-Cache": "MISS"},
    )


@app.get("/")
async def health():
    return {"service": "filmgrab-proxy", "status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.environ.get("PORT", "8000")), reload=False)
