# -*- coding: utf-8 -*-
"""
filmgrab_scraper.py — FilmGrab (https://film-grab.com) 截图抓取逻辑

页面结构（2024 年起实测，基于 WordPress + 10Web Photo Gallery 插件）：
  1. 搜索页  GET https://film-grab.com/?s=<query>
       结果入口：h2.entry-title > a（href=详情页, 文本=页面标题）
       无结果时：h2.entry-title 内没有 <a>，页面出现 "No Posts Found."
  2. 详情页
       原图（非缩略图）：a[href*="/wp-content/uploads/photo-gallery/"] 且不含 /thumb/
       缩略图仅在 img 的 src / data-original 中，路径里带 /thumb/，不可用。
       所有截图都在同一页（无分页），格式均为 jpg。

注意：
  - FilmGrab 明确表示不接受爬取，本模块仅供个人学习使用，请勿公开分发或商业化。
  - FilmGrab 的 nginx 启用了基于 TLS/JA3 指纹的反爬：普通 requests 会收到
    403 "Checking your browser" JS 挑战。实测无需 Selenium/Playwright
    （HTML 为服务端直出），使用 curl_cffi 的 impersonate="chrome" 即可通过，
    故本模块依赖 curl_cffi 而非 requests 发请求。
  - 抓取请求之间 sleep 1 秒，避免对站点造成压力。
  - 图片版权归原电影公司所有，请注意版权边界。
  - 如页面结构变化，选择器可能需要调整（页面结构变化时会打印警告）。
"""

import os
import re
import time
import difflib
import logging
from urllib.parse import urljoin, urlparse, urlunparse

from curl_cffi import requests as cffi_requests
from bs4 import BeautifulSoup

logger = logging.getLogger("filmgrab")

BASE_URL = "https://film-grab.com/"
SEARCH_URL = "https://film-grab.com/"
# 只允许代理 FilmGrab 域名下的图片
ALLOWED_HOSTS = {"film-grab.com", "www.film-grab.com"}
# 图片必须位于上传目录，防止把站内任意 URL 当图片代理
IMAGE_PATH_PREFIX = "/wp-content/uploads/"
# 相册原图与缩略图的共同前缀：缩略图是 photo-gallery/thumb/<同名文件>
_THUMB_MARKER = "/wp-content/uploads/photo-gallery/"
IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".gif")

# 伪装浏览器；Referer 用于绕过潜在防盗链（当前实测不强制，属于防御性设置）
HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}
IMAGE_HEADERS = {
    "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": BASE_URL,
}

# FilmGrab 的 nginx 反爬按 TLS/JA3 指纹拦截普通 Python 客户端（返回 403
# "Checking your browser" JS 挑战）。curl_cffi 模拟 Chrome 的 TLS 指纹即可通过。
# requests 默认读取 HTTP_PROXY / HTTPS_PROXY 环境变量（国内网络可用 7890 等本地代理）
_PROXIES = None
for _env in ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"):
    if os.environ.get(_env):
        _PROXIES = {"http": os.environ[_env], "https": os.environ[_env]}
        break

SESSION = cffi_requests.Session(impersonate="chrome", proxies=_PROXIES)

# 抓取节奏：search -> detail 之间至少间隔 1 秒
_last_request_ts = 0.0


def _polite_get(url, *, params=None, is_image=False, timeout=20, retries=2):
    """带礼貌延迟、重试、Chrome TLS 指纹/UA/Referer 伪装的 GET。"""
    global _last_request_ts
    headers = IMAGE_HEADERS if is_image else HEADERS
    last_exc = None
    for attempt in range(retries + 1):
        # 页面抓取之间 sleep，图片代理不额外 sleep（避免前端加载几十张图时过慢）
        if not is_image:
            wait = 1.0 - (time.time() - _last_request_ts)
            if wait > 0:
                time.sleep(wait)
        try:
            resp = SESSION.get(url, params=params, headers=headers, timeout=timeout)
            if resp.status_code >= 400:
                raise RuntimeError("HTTP %s" % resp.status_code)
            if not is_image:
                _last_request_ts = time.time()
            return resp
        except Exception as exc:
            last_exc = exc
            logger.warning("GET %s 失败（第 %d 次）: %s", url, attempt + 1, exc)
            if attempt < retries and not is_image:
                time.sleep(1)
    raise last_exc


# 仅把 1900-2030 视为"年份"。片名中的数字（2049 / 2001 / 300 等）不能误删：
# 2049、2077 这类未来数字不在范围内；1917 这类以年份命名的片名由 _normalize_title 兜底。
_YEAR_PAT = r"(?:19\d{2}|20[0-2]\d|2030)"


def _normalize_title(title):
    """标题归一化：小写、去年份/标点、折叠空白，用于精确匹配。"""
    t = title.lower()
    t = re.sub(r"\(" + _YEAR_PAT + r"\)", " ", t)   # 括号年份 (2017)
    t = re.sub(r"\s+" + _YEAR_PAT + r"$", " ", t)   # 结尾年份
    t = re.sub(r"[^a-z0-9\s]", " ", t)              # 标点 -> 空格
    t = re.sub(r"\s+", " ", t).strip()
    if not t:
        # 片名本身就是年份（如 "1917"），去年份后变空串，则保留原数字
        t = re.sub(r"[^a-z0-9\s]", " ", title.lower())
        t = re.sub(r"\s+", " ", t).strip()
    return t


def _extract_year(title):
    """从 FilmGrab 页面标题中提取年份，优先括号内的，如 'Movie (1999)'。"""
    m = re.search(r"\((" + _YEAR_PAT + r")\)", title)
    if not m:
        m = re.search(r"\b(" + _YEAR_PAT + r")\b", title)
    return int(m.group(1)) if m else None


def _search_results(movie):
    """请求搜索页，返回 [(title, detail_url), ...]；无结果返回 []。"""
    resp = _polite_get(SEARCH_URL, params={"s": movie}, timeout=20)
    soup = BeautifulSoup(resp.text, "html.parser")

    results = []
    for a in soup.select("h2.entry-title a[href]"):
        href = a.get("href", "").strip()
        title = a.get_text(strip=True)
        if href and title:
            results.append((title, urljoin(SEARCH_URL, href)))

    if not results and "No Posts Found" not in resp.text:
        # 页面结构变化：选择器失配且不是标准无结果页
        logger.warning("搜索页未解析到 h2.entry-title a，FilmGrab 页面结构可能已变化。")
    return results


# 模糊匹配（归一化标题不完全相等时）的相似度门槛。
# 0.72 太松：'The Runner' vs 'The Indian Runner' 有 0.74，会串到完全不同的电影。
# 收紧到 0.85，并且叠加"续集数字一致 + 词集合包含"两道硬条件。
_MATCH_THRESHOLD = 0.85

_ROMAN_RE = re.compile(r"^(?:v?i{1,3}|i[vx]|vi{0,3}|xi{0,2}|xii|ix|x)$")
_ROMAN_VALUES = {"i": 1, "v": 5, "x": 10}


def _roman_to_int(token):
    """把 ii..xii 这类罗马数字词转成阿拉伯数字字符串；不是罗马数字返回 None。"""
    if not (2 <= len(token) <= 4) or not _ROMAN_RE.match(token):
        return None
    total, prev = 0, 0
    for ch in reversed(token):
        val = _ROMAN_VALUES[ch]
        total += val if val >= prev else -val
        prev = val
    return str(total) if total else None


def _title_tokens(normalized):
    """归一化标题 -> 词元列表，罗马数字续集号（ii/iii/iv…）统一转阿拉伯数字。"""
    out = []
    for tok in normalized.split():
        out.append(_roman_to_int(tok) or tok)
    return out


def _numbers(tokens):
    """标题中的所有数字词元（'2049'、'2'、'300'…），用于续集号一致性校验。"""
    return tuple(sorted(t for t in tokens if t.isdigit()))


def _pick_detail_url(movie, results, year=None):
    """
    在搜索结果中挑选详情页（宁缺毋滥，绝不返回别的电影的剧照）：
      - 年份双方都已知但不一致：直接淘汰（同名翻拍）；
      - 归一化标题完全一致：命中（同年再加分用于多结果排序）；
      - 否则必须同时满足：相似度 >= 0.85、数字词元集合一致（防 Rush Hour 2/3、
        28 Days/Weeks Later 之类）、词元集合存在包含关系（一方只是另一方的
        加长/简写标题，如站点标题多了 '3D'/'Special Edition'）。
    返回 (title, url) 或 None。
    """
    if not results:
        return None
    target = _normalize_title(movie)
    target_tokens = _title_tokens(target)
    target_nums = _numbers(target_tokens)
    target_set = set(target_tokens)
    try:
        query_year = int(year) if year else None
    except (TypeError, ValueError):
        query_year = None

    best, best_score = None, -1.0
    rejected = []
    for title, url in results:
        cand = _normalize_title(title)
        cand_tokens = _title_tokens(cand)
        cand_set = set(cand_tokens)
        cand_year = _extract_year(title)

        # 年份双方都已知但不一致 = 同名翻拍，硬淘汰
        if query_year and cand_year and cand_year != query_year:
            rejected.append((title, "year %s != %s" % (cand_year, query_year)))
            continue

        if cand == target:
            score = 1.0
        else:
            ratio = difflib.SequenceMatcher(None, target, cand).ratio()
            same_numbers = _numbers(cand_tokens) == target_nums
            contained = target_set <= cand_set or cand_set <= target_set
            if ratio < _MATCH_THRESHOLD or not same_numbers or not contained:
                rejected.append((
                    title,
                    "ratio=%.2f numbers=%s contained=%s"
                    % (ratio, same_numbers, contained),
                ))
                continue
            score = ratio

        if query_year and cand_year == query_year:
            score += 0.15          # 同年加权，只用于多结果时的排序
        if score > best_score:
            best, best_score = (title, url), score

    if best is not None:
        if best_score < 1.0:
            logger.info("标题非精确匹配，采用得分 %.2f 的结果: %s", best_score, best[0])
        return best

    logger.info(
        "判定 FilmGrab 未收录 '%s' (year=%s)。候选及淘汰原因: %s",
        movie, query_year, rejected or "无搜索结果",
    )
    return None


def _extract_screenshot_urls(detail_html, detail_url):
    """
    从详情页解析原图 URL（去重、保序）。
    首选：bwg 画廊里指向非 /thumb/ 原图的 <a href>；
    兜底：img 的 data-original / data-src / src，把 /thumb/ 去掉推断原图。
    """
    soup = BeautifulSoup(detail_html, "html.parser")
    urls = []
    seen = set()

    def add(candidate):
        u = urljoin(detail_url, candidate.strip())
        if not u.startswith("http"):
            return
        low = u.lower()
        if not any(low.split("?")[0].endswith(ext) for ext in IMAGE_EXTS):
            return
        if u not in seen:
            seen.add(u)
            urls.append(u)

    # 1) 首选：画廊原图链接
    for a in soup.select('a[href*="/wp-content/uploads/photo-gallery/"]'):
        href = a.get("href", "")
        if "/thumb/" not in href:
            add(href)

    # 2) 兜底：懒加载缩略图 -> 推断原图（去掉路径中的 /thumb）
    if not urls:
        logger.warning("未找到画廊原图 <a>，回退到 img 属性推断。页面结构可能已变化。")
        for img in soup.select("img[src], img[data-original], img[data-src]"):
            for attr in ("data-original", "data-src", "src"):
                candidate = img.get(attr)
                if candidate and "/wp-content/uploads/" in candidate:
                    add(candidate.replace("/thumb/", "/"))
                    break

    return urls


def fetch_screenshots(movie, year=None):
    """
    主入口：按电影名（+年份，可选）抓取截图原图列表。
    返回 {"movie": str, "page_title": str|None, "count": int, "screenshots": [url, ...]}
    找不到时 count=0。
    """
    movie = (movie or "").strip()
    if not movie:
        return {"movie": movie, "page_title": None, "count": 0, "screenshots": []}

    results = _search_results(movie)
    picked = _pick_detail_url(movie, results, year=year)
    if not picked:
        logger.info("FilmGrab 搜索无结果: %s", movie)
        return {"movie": movie, "page_title": None, "count": 0, "screenshots": []}

    page_title, detail_url = picked

    # 详情页请求失败重试 2 次（_polite_get 内置）；仍失败向上抛出由接口层处理
    detail = _polite_get(detail_url, timeout=25)
    screenshots = _extract_screenshot_urls(detail.text, detail_url)

    if not screenshots:
        logger.warning("详情页 %s 未解析到任何截图。", detail_url)

    return {
        "movie": movie,
        "page_title": page_title,
        "count": len(screenshots),
        "screenshots": screenshots,
    }


def thumb_variant(url):
    """
    推导原图对应的站点缩略图 URL（保留 query，如 bwg 版本号），推导不出返回 None。

    10Web 相册为每张原图同时生成了一份 /thumb/ 变体，实测（2026-09-25）：
      原图 1023-1280px 宽 / 152-299 KB，缩略图固定 500px 宽 / 54-91 KB ≈ 原图的 40%。
    详情页网格一格的显示宽度只有 ~265px，用缩略图足够；卡片导出与灯箱仍取原图。

    非 photo-gallery 路径、路径为空、或本身就是 /thumb/ 下的一律返回 None，
    调用方据此回退原图 —— 推导不出不是错误，只是没有更小的版本可用。
    """
    parsed = urlparse(url)
    path = parsed.path
    idx = path.find(_THUMB_MARKER)
    if idx < 0:
        return None
    head = path[:idx + len(_THUMB_MARKER)]
    tail = path[idx + len(_THUMB_MARKER):]
    if not tail or tail.startswith("thumb/"):
        return None
    return urlunparse(parsed._replace(path=head + "thumb/" + tail))


def is_allowed_image_url(url):
    """代理白名单校验：仅 FilmGrab 域名 + /wp-content/uploads/ 下的图片。"""
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    if parsed.scheme not in ("http", "https"):
        return False
    if parsed.hostname not in ALLOWED_HOSTS:
        return False
    path = parsed.path.lower()
    if not path.startswith(IMAGE_PATH_PREFIX):
        return False
    return any(path.endswith(ext) for ext in IMAGE_EXTS)


def fetch_image(url, timeout=20):
    """代理下载图片，返回 (content_bytes, content_type)。"""
    resp = _polite_get(url, is_image=True, timeout=timeout, retries=1)
    content = resp.content
    content_type = resp.headers.get("Content-Type", "").split(";")[0].strip()
    # 上游 Content-Type 缺失/异常时按文件头魔数识别
    if not content_type or not content_type.startswith("image/"):
        content_type = sniff_image_type(content)
    return content, content_type


def sniff_image_type(data):
    """按文件头魔数识别常见图片类型。"""
    if len(data) >= 3 and data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if len(data) >= 8 and data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if len(data) >= 6 and data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return "image/jpeg"
