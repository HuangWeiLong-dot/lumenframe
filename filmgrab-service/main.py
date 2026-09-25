# -*- coding: utf-8 -*-
"""
main.py — FilmGrab 截图服务端代理（FastAPI）

接口：
  GET /api/screenshots?movie=<电影名>
      返回该电影的截图列表，图片地址已包装成 /api/proxy?url=...
  GET /api/proxy?url=<FilmGrab 图片原始地址（URL 编码）>
      校验域名白名单后实时转发图片二进制，不落地存储。
  GET /api/trailer?movie=<电影名>&year=<年份，可选>
      经 YouTube Data API v3 搜索官方预告片（结果缓存 7 天）。
  GET /api/comments?videoId=<YouTube 视频 ID>&max=<条数>
      获取预告片热门评论（缓存 1 天）；关闭评论时返回空列表。

Torrent-Api-py 整合路由（前缀 /api/torrent/v1）：
  GET /api/torrent/v1/search?site=<站点>&query=<关键词>&limit=&page=
  GET /api/torrent/v1/trending?site=<站点>&category=&limit=&page=
  GET /api/torrent/v1/category?site=<站点>&query=<关键词>&category=<分类>
  GET /api/torrent/v1/recent?site=<站点>&category=&limit=&page=
  GET /api/torrent/v1/all/search|trending|recent   （并发聚合全部站点）
  GET /api/torrent/v1/sites[ /config]               （支持的站点列表）
  GET /api/torrent/v1/search_url?site=1337x&url=<详情页 URL>
  可选鉴权：设置环境变量 PYTORRENT_API_KEY 后，请求需带 X-API-Key 头。
  对外经 Nginx /filmgrab/ -> /api/ 反代，即 /filmgrab/torrent/v1/...。

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

# 轻量 .env 引导（不引入 python-dotenv 依赖）：
# 在导入业务模块前读取同目录 .env，已存在的环境变量不覆盖。
def _load_dotenv():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if not os.path.exists(path):
        return
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k, v = k.strip(), v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v
    except OSError:
        pass


_load_dotenv()

from fastapi import FastAPI, Query, HTTPException, Response, Depends
from fastapi.middleware.cors import CORSMiddleware

import filmgrab_scraper as fg
import youtube_service as yt

# Torrent-Api-py 整合：必须在 _load_dotenv() 之后导入，
# helper.html_scraper 在导入时读取 HTTP_PROXY 环境变量
from routers.v1.search_router import router as torrent_search_router
from routers.v1.trending_router import router as torrent_trending_router
from routers.v1.catergory_router import router as torrent_category_router
from routers.v1.recent_router import router as torrent_recent_router
from routers.v1.combo_routers import router as torrent_combo_router
from routers.v1.sites_list_router import router as torrent_sites_router
from routers.v1.search_url_router import router as torrent_search_url_router
from helper.dependencies import authenticate_request

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

# 同时向 FilmGrab 发起的图片下载并发上限。
# 取值用容错解析：PROXY_CONCURRENCY 被设成空串时 int("") 会在导入期抛 ValueError，
# 整个服务起不来 —— 而这个变量在文档里是「可配置」的，值得挡一下。
def _int_env(name, default):
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        logger.warning("环境变量 %s 不是整数，回退默认值 %s", name, default)
        return default


PROXY_SEMAPHORE = asyncio.Semaphore(max(1, _int_env("PROXY_CONCURRENCY", 8)))

# ---------- Torrent-Api-py 路由挂载 ----------
# 统一挂在 /api/torrent/v1 下，与既有 /api/* 接口隔离；
# Nginx 已将 /filmgrab/ 反代到 /api/，外部路径为 /filmgrab/torrent/v1/...
_TORRENT_PREFIX = "/api/torrent/v1"
_TORRENT_AUTH = [Depends(authenticate_request)]  # 仅在设置 PYTORRENT_API_KEY 时强制校验

app.include_router(torrent_search_router, prefix=f"{_TORRENT_PREFIX}/search", dependencies=_TORRENT_AUTH)
app.include_router(torrent_trending_router, prefix=f"{_TORRENT_PREFIX}/trending", dependencies=_TORRENT_AUTH)
app.include_router(torrent_category_router, prefix=f"{_TORRENT_PREFIX}/category", dependencies=_TORRENT_AUTH)
app.include_router(torrent_recent_router, prefix=f"{_TORRENT_PREFIX}/recent", dependencies=_TORRENT_AUTH)
app.include_router(torrent_combo_router, prefix=f"{_TORRENT_PREFIX}/all", dependencies=_TORRENT_AUTH)
app.include_router(torrent_sites_router, prefix=f"{_TORRENT_PREFIX}/sites", dependencies=_TORRENT_AUTH)
app.include_router(torrent_search_url_router, prefix=f"{_TORRENT_PREFIX}/search_url", dependencies=_TORRENT_AUTH)


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
async def proxy(
    url: str = Query(..., description="FilmGrab 图片原始地址（需 URL 编码）"),
    s: str = Query("full", description="thumb = 取站点缩略图（列表网格用），full = 原图"),
):
    """
    白名单校验后实时代理转发 FilmGrab 图片，返回二进制流。

    s=thumb 时改抓站点的 /thumb/ 变体（500px / 54-91 KB，原图是 1023-1280px / 152-299 KB）：
    详情页的剧照网格一格只有 ~265px 宽，65 张原图约 8.5 MB，换成缩略图后约 4.5 MB，
    这是那一片格子加载慢、加载不完的直接原因。
    抓不到缩略图就回退原图并照常返回 —— 少一张缩略图不该让一格留空。
    """
    # 白名单校验：拒绝非 FilmGrab 域名/非图片路径，防止被当作任意开放代理
    if not fg.is_allowed_image_url(url):
        raise HTTPException(status_code=403, detail="only FilmGrab image URLs are allowed")

    # 实际抓取的地址（缩略图推导不出版本就是原图），它同时是缓存的键：
    # 同一张图的两种尺寸各存一份，互不覆盖。
    fetch_url = (fg.thumb_variant(url) if s == "thumb" else None) or url

    cached = _img_cache_get(fetch_url)
    if cached is not None:
        content, content_type = cached
        return Response(
            content=content,
            media_type=content_type,
            headers={"Cache-Control": "public, max-age=86400", "X-Cache": "HIT"},
        )

    async with PROXY_SEMAPHORE:
        try:
            content, content_type = await asyncio.to_thread(fg.fetch_image, fetch_url)
        except Exception as exc:
            if fetch_url == url:
                logger.warning("图片代理失败 %s: %s", url, exc)
                raise HTTPException(status_code=502, detail="failed to fetch upstream image")
            logger.warning("缩略图不可用，回退原图 %s: %s", fetch_url, exc)
            try:
                content, content_type = await asyncio.to_thread(fg.fetch_image, url)
            except Exception as exc2:
                logger.warning("图片代理失败 %s: %s", url, exc2)
                raise HTTPException(status_code=502, detail="failed to fetch upstream image")
            fetch_url = url

    _img_cache_set(fetch_url, content, content_type)
    return Response(
        content=content,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=86400", "X-Cache": "MISS"},
    )


@app.get("/api/trailer")
async def trailer(
    movie: str = Query(..., min_length=1, description="电影名称"),
    year: Optional[str] = Query(None, description="上映年份，帮助定位正确的预告片"),
):
    """搜索电影官方预告片。找不到时返回 {"videoId": null}，前端隐藏模块。"""
    result = await asyncio.to_thread(yt.search_trailer, movie.strip(), year)
    return result if result else {"videoId": None}


@app.get("/api/comments")
async def comments(
    videoId: str = Query(..., min_length=1, description="YouTube 视频 ID"),
    max: int = Query(20, ge=1, le=30, description="返回评论条数上限"),
):
    """获取预告片热门评论。评论关闭/不可用时返回 {"comments": []}。"""
    items = await asyncio.to_thread(yt.get_comments, videoId, max)
    return {"comments": items}


@app.get("/")
async def health():
    return {"service": "filmgrab-proxy", "status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.environ.get("PORT", "8000")), reload=False)
