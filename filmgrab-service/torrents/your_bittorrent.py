import asyncio
import time
import aiohttp
from bs4 import BeautifulSoup
from helper.asyncioPoliciesFix import decorator_asyncio_fix
from helper.html_scraper import Scraper, HTTP_PROXY
from constants.base_url import YOURBITTORRENT
from constants.headers import HEADER_AIO


class YourBittorrent:
    _name = "Your BitTorrent"
    def __init__(self):
        self.BASE_URL = YOURBITTORRENT
        self.LIMIT = None

    @decorator_asyncio_fix
    async def _individual_scrap(self, session, url, obj):
        try:
            async with session.get(url, headers=HEADER_AIO, proxy=HTTP_PROXY) as res:
                html = await res.text(encoding="ISO-8859-1")
                soup = BeautifulSoup(html, "html.parser")
                try:
                    download = soup.select_one('div.yb-dl a[href$=".torrent"]')
                    if download:
                        obj["torrent"] = download["href"]
                    cover = soup.find(
                        "img", src=lambda src: src and "/cover/" in src
                    )
                    if cover:
                        obj["poster"] = cover["src"]
                except:
                    ...
        except:
            return None

    async def _get_torrent(self, result, session, urls):
        tasks = []
        for idx, url in enumerate(urls):
            for obj in result["data"]:
                if obj["url"] == url:
                    task = asyncio.create_task(
                        self._individual_scrap(session, url, result["data"][idx])
                    )
                    tasks.append(task)
        await asyncio.gather(*tasks)
        return result

    def _parser(self, htmls, idx=1):
        try:
            for html in htmls:
                soup = BeautifulSoup(html, "html.parser")
                list_of_urls = []
                my_dict = {"data": []}

                for link in soup.select("a.yb-tname[href]"):
                    href = link["href"]
                    # Sponsored rows link to external domains; real rows
                    # use relative "/torrent/..." paths.
                    if not href.startswith("/torrent/"):
                        continue
                    tr = link.find_parent("tr")
                    if tr is None:
                        continue
                    size_cell = tr.select_one('td[data-label="Size"]')
                    date_cell = tr.select_one('td[data-label="Added"]')
                    seed_cell = tr.select_one('td[data-label="Seed"]')
                    peer_cell = tr.select_one('td[data-label="Peers"]')
                    if None in (size_cell, date_cell, seed_cell, peer_cell):
                        continue

                    name = link.get_text(strip=True)
                    url = self.BASE_URL + href
                    list_of_urls.append(url)
                    my_dict["data"].append(
                        {
                            "name": name,
                            "size": size_cell.get_text(strip=True),
                            "date": date_cell.get_text(strip=True),
                            "seeders": seed_cell.get_text(strip=True),
                            "leechers": peer_cell.get_text(strip=True),
                            "url": url,
                        }
                    )
                    if len(my_dict["data"]) == self.LIMIT:
                        break
                return my_dict, list_of_urls
        except:
            return None, None

    async def search(self, query, page, limit):
        async with aiohttp.ClientSession() as session:
            start_time = time.time()
            self.LIMIT = limit
            url = self.BASE_URL + "/?v=&c=&q={}".format(query)
            return await self.parser_result(start_time, url, session, idx=6)

    async def parser_result(self, start_time, url, session, idx=1):
        htmls = await Scraper().get_all_results(session, url)
        result, urls = self._parser(htmls, idx)
        if result is not None:
            results = await self._get_torrent(result, session, urls)
            results["time"] = time.time() - start_time
            results["total"] = len(results["data"])
            return results
        return result

    async def trending(self, category, page, limit):
        async with aiohttp.ClientSession() as session:
            start_time = time.time()
            self.LIMIT = limit
            idx = None
            if not category:
                url = self.BASE_URL + "/top.html"
                idx = 1
            else:
                if category == "books":
                    category = "ebooks"
                url = self.BASE_URL + f"/{category}.html"
                idx = 4
            return await self.parser_result(start_time, url, session, idx)

    async def recent(self, category, page, limit):
        async with aiohttp.ClientSession() as session:
            start_time = time.time()
            self.LIMIT = limit
            idx = None
            if not category:
                url = self.BASE_URL + "/new.html"
                idx = 1
            else:
                if category == "books":
                    category = "ebooks"
                url = self.BASE_URL + f"/{category}/latest.html"
                idx = 4
            return await self.parser_result(start_time, url, session, idx)
