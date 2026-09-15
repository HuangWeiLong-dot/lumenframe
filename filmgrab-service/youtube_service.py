# -*- coding: utf-8 -*-
"""
youtube_service.py — YouTube Data API v3 封装（预告片搜索 + 预告片评论）

设计要点：
  - 直接调用 YouTube REST 接口（requests），不依赖 google-api-python-client；
    requests 默认 trust_env，自动读取 HTTP_PROXY / HTTPS_PROXY：
    本地开发走代理（start.ps1 探测 7890），生产服务器无代理变量则直连。
  - API Key 从环境变量 YOUTUBE_API_KEY 读取（main.py 启动时会先加载同目录 .env）。
  - 配额意识（每日默认 10,000 units）：
      search.list        100 units/次 → 结果缓存 7 天
      videos.list          1 units/次 → 与搜索结果一起缓存
      commentThreads.list  1 units/次 → 评论缓存 1 天
    失败/空结果只做短 TTL 缓存（1 小时），既防短时间打爆配额，又允许稍后恢复。
"""

import os
import re
import time
import logging

import requests

logger = logging.getLogger("youtube")

API_BASE = "https://www.googleapis.com/youtube/v3"

TRAILER_TTL = 7 * 24 * 60 * 60     # 预告片命中：7 天
COMMENTS_TTL = 24 * 60 * 60        # 评论命中：1 天
NEG_TTL = 60 * 60                  # 空结果/失败：1 小时
CACHE_MAX = 500

# key -> (expire_ts, payload)
_trailer_cache = {}
_comments_cache = {}

_session = requests.Session()
_session.headers.update({
    "Accept": "application/json",
    "User-Agent": "lumenframe-youtube-service/1.0",
})

# 片方官方频道 / 授权预告片频道关键词（只匹配频道名，不看标题）
_OFFICIAL_HINTS = (
    # 制片厂 / 发行方
    "warner bros", "warner bros.", "universal pictures", "paramount pictures",
    "sony pictures", "screen gems", "lionsgate", "walt disney", "20th century",
    "searchlight", "focus features", "a24", "netflix", "amazon mgm", "mgm",
    "neon", "marvel", "pixar", "illumination", "dreamworks", "legendary",
    "blumhouse", "new line", "columbia pictures", "tri-star", "summit entertainment",
    "studio canal", "studiocanal", "pathe", "toho",
    # 授权/聚合预告片频道（版权方上传，非搬运）
    "movieclips", "rotten tomatoes", "kinocheck", "one media",
)
# 明显不是正片预告片的内容
_JUNK_RE = re.compile(
    r"reaction|react|review|breakdown|explained|recap|ending explained|"
    r"fan[\s-]?made|fanmade|compilation|all trailers?|every trailer|"
    r"\bost\b|soundtrack|song|music video|interview|featurette|behind|"
    r"bloopers|gag reel|\bedit\b|mashup|\bcrack\b|\btheory\b",
    re.IGNORECASE,
)
_OFFICIAL_TRAILER_RE = re.compile(r"official\s*trailer|official\s*teaser", re.IGNORECASE)
_TRAILER_RE = re.compile(r"trailer|teaser", re.IGNORECASE)


class YouTubeError(RuntimeError):
    pass


def _api_key():
    key = os.environ.get("YOUTUBE_API_KEY", "").strip()
    if not key:
        raise YouTubeError("YOUTUBE_API_KEY is not configured")
    return key


def _cache_get(cache, key):
    item = cache.get(key)
    if item and time.time() < item[0]:
        return item[1]
    return None


def _cache_set(cache, key, payload, ttl):
    if len(cache) >= CACHE_MAX:
        cache.pop(next(iter(cache)))
    cache[key] = (time.time() + ttl, payload)


def _get(path, params, timeout=12):
    params = {**params, "key": _api_key()}
    r = _session.get(f"{API_BASE}/{path}", params=params, timeout=timeout)
    if r.status_code == 403:
        # 评论关闭、配额耗尽等都可能是 403；交由上层按场景降级
        raise YouTubeError(f"403 {r.text[:200]}")
    if r.status_code == 404:
        raise YouTubeError("404 not found")
    if r.status_code != 200:
        raise YouTubeError(f"HTTP {r.status_code}: {r.text[:200]}")
    return r.json()


def _iso_duration_seconds(iso):
    """PT2M30S -> 150；解析失败返回 None。"""
    if not iso:
        return None
    m = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", iso)
    if not m:
        return None
    h, mn, s = (int(g) if g else 0 for g in m.groups())
    return h * 3600 + mn * 60 + s


def _pick_best(items, year):
    """
    给候选视频打分选最佳预告片：
      +8 标题含 Official Trailer/Teaser
      +4 标题含 Trailer/Teaser
      +10 频道为片方/授权预告片频道（只看频道名）
      +2 发布时间与上映年份一致（预告片多在当年或前一年发布）
      -99 垃圾关键词（reaction/review/解说/混剪等）
    时长 20s~12min 之外的直接淘汰（防止拿正片/长视频）。
    """
    best, best_score = None, -10**9
    for it in items:
        sn = it.get("snippet", {})
        title = sn.get("title", "") or ""
        channel = sn.get("channelTitle", "") or ""
        dur = _iso_duration_seconds(
            (it.get("contentDetails") or {}).get("duration")
        )
        if dur is not None and not (20 <= dur <= 12 * 60):
            continue
        if _JUNK_RE.search(title):
            continue
        score = 0
        if _OFFICIAL_TRAILER_RE.search(title):
            score += 8
        elif _TRAILER_RE.search(title):
            score += 4
        else:
            continue  # 标题完全不含 trailer/teaser 的不要
        # 权威分只看频道名：搬运号标题里也常写 "Official Trailer"
        if any(h in channel.lower() for h in _OFFICIAL_HINTS):
            score += 10
        pub = (sn.get("publishedAt") or "")[:4]
        if year and pub and pub.isdigit() and abs(int(pub) - int(year)) <= 1:
            score += 2
        if score > best_score:
            best, best_score = it, score
    return best


def search_trailer(movie_name, year=None):
    """
    搜索官方预告片。
    返回 {videoId,title,channelTitle,thumbnail,publishedAt,durationSeconds,viewCount}
    找不到/出错返回 None（不抛异常给接口层）。
    """
    name = (movie_name or "").strip()
    if not name:
        return None

    cache_key = f"{name.lower()}|{year or ''}"
    cached = _cache_get(_trailer_cache, cache_key)
    if cached is not None:
        return cached or None  # 空字符串占位表示“无结果”

    try:
        q = f"{name} {year} official trailer".strip() if year else f"{name} official trailer"
        data = _get("search", {
            "part": "snippet",
            "q": q,
            "type": "video",
            "videoEmbeddable": "true",
            "maxResults": 8,
            "safeSearch": "none",
        })
        items = data.get("items", [])
        if not items:
            _cache_set(_trailer_cache, cache_key, "", NEG_TTL)
            return None

        # 用 1 次 videos.list（1 unit）批量补全时长/统计，用于过滤与展示
        ids = ",".join(i["id"]["videoId"] for i in items if i.get("id", {}).get("videoId"))
        details = {}
        if ids:
            vd = _get("videos", {
                "part": "contentDetails,statistics",
                "id": ids,
                "maxResults": 8,
            })
            for v in vd.get("items", []):
                details[v["id"]] = v
        for i in items:
            vid = i.get("id", {}).get("videoId")
            if vid and vid in details:
                i["contentDetails"] = details[vid].get("contentDetails", {})
                i["statistics"] = details[vid].get("statistics", {})

        best = _pick_best(items, year)
        if not best:
            _cache_set(_trailer_cache, cache_key, "", NEG_TTL)
            return None

        sn = best["snippet"]
        thumbs = sn.get("thumbnails", {})
        thumb = (thumbs.get("high") or thumbs.get("medium") or thumbs.get("default") or {}).get("url")
        result = {
            "videoId": best["id"]["videoId"],
            "title": sn.get("title", ""),
            "channelTitle": sn.get("channelTitle", ""),
            "thumbnail": thumb or "",
            "publishedAt": sn.get("publishedAt", ""),
            "durationSeconds": _iso_duration_seconds(
                (best.get("contentDetails") or {}).get("duration")
            ),
            "viewCount": int((best.get("statistics") or {}).get("viewCount") or 0) or None,
        }
        _cache_set(_trailer_cache, cache_key, result, TRAILER_TTL)
        return result
    except YouTubeError as e:
        logger.warning("trailer search failed for %s: %s", name, e)
        # 403 配额耗尽之类不写长缓存；仅短缓存防抖
        _cache_set(_trailer_cache, cache_key, "", NEG_TTL)
        return None
    except requests.RequestException as e:
        logger.warning("trailer search network error for %s: %s", name, e)
        return None


def get_comments(video_id, max_results=20):
    """
    获取预告片下的热门评论，按点赞降序。
    返回 [{videoId? no}...] 每条：author, authorChannelUrl, avatar, text, likes, publishedAt]
    评论关闭/出错返回 []。
    """
    vid = (video_id or "").strip()
    if not vid:
        return []

    max_results = max(1, min(int(max_results or 20), 30))
    cache_key = f"{vid}|{max_results}"
    cached = _cache_get(_comments_cache, cache_key)
    if cached is not None:
        return cached

    try:
        data = _get("commentThreads", {
            "part": "snippet",
            "videoId": vid,
            "maxResults": max_results,
            "order": "relevance",
            "textFormat": "plainText",
        })
        comments = []
        for item in data.get("items", []):
            top = item.get("snippet", {}).get("topLevelComment", {}).get("snippet", {})
            text = (top.get("textOriginal") or top.get("textDisplay") or "").strip()
            if not text:
                continue
            comments.append({
                "author": top.get("authorDisplayName", "") or "YouTube user",
                "authorChannelUrl": top.get("authorChannelUrl", ""),
                "avatar": top.get("authorProfileImageUrl", ""),
                "text": text,
                "likes": int(top.get("likeCount") or 0),
                "publishedAt": top.get("publishedAt", ""),
            })
        comments.sort(key=lambda c: c["likes"], reverse=True)
        comments = comments[:max_results]
        _cache_set(_comments_cache, cache_key, comments, COMMENTS_TTL if comments else NEG_TTL)
        return comments
    except YouTubeError as e:
        # 403 commentsDisabled 是正常业务情况（关闭评论），降级为空列表
        logger.info("comments unavailable for %s: %s", vid, e)
        _cache_set(_comments_cache, cache_key, [], NEG_TTL)
        return []
    except requests.RequestException as e:
        logger.warning("comments network error for %s: %s", vid, e)
        return []


def get_video_details(video_id):
    """可选：单条视频详情（时长/播放量/点赞/评论数）。失败返回 None。"""
    vid = (video_id or "").strip()
    if not vid:
        return None
    try:
        data = _get("videos", {
            "part": "snippet,contentDetails,statistics",
            "id": vid,
        })
        items = data.get("items", [])
        return items[0] if items else None
    except (YouTubeError, requests.RequestException) as e:
        logger.warning("video details failed for %s: %s", vid, e)
        return None
