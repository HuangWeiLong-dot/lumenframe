// TMDB 类型 ID 表（movie 与 tv 命名空间独立）
// 详情页点击类型字符串时反查 ID，再跳到 /genre/:kind/:id-slug 触发 discover 列表

export const MOVIE_GENRES_BY_NAME = {
  Action: 28,
  Adventure: 12,
  Animation: 16,
  Comedy: 35,
  Crime: 80,
  Documentary: 99,
  Drama: 18,
  Family: 10751,
  Fantasy: 14,
  History: 36,
  Horror: 27,
  Music: 10402,
  Mystery: 9648,
  Romance: 10749,
  'Science Fiction': 878,
  Thriller: 53,
  War: 10752,
  Western: 37,
}

// TV 类型来自 TMDB 自身的 TV genre list（也兼容 TVmaze 常见命名）
export const TV_GENRES_BY_NAME = {
  'Action & Adventure': 10759,
  Action: 10759,
  Adventure: 10759,
  Animation: 16,
  Comedy: 35,
  Crime: 80,
  Documentary: 99,
  Drama: 18,
  Family: 10751,
  Kids: 10762,
  Mystery: 9648,
  'Reality': 10764,
  'Reality-TV': 10764,
  'Sci-Fi & Fantasy': 10765,
  'Science-Fiction': 10765,
  Fantasy: 10765,
  Horror: 10765,
  Soap: 10766,
  Talk: 10767,
  'Talk-Show': 10767,
  'War & Politics': 10768,
  War: 10768,
  Western: 37,
  News: 10763,
}

export function genreIdByName(name, kind) {
  const table = kind === 'tv' ? TV_GENRES_BY_NAME : MOVIE_GENRES_BY_NAME
  return table[name] ?? null
}

// TMDB 个别类型在 zh-CN 下至今没有翻译条目（/api/genres 按语言请求后这两个
// 仍原样返回英文名），展示时按 id 用 i18n 词典覆盖；其余类型信任上游的本地化名。
// t() 缺 key 会回退成 key 本身，所以只对已知缺失的 id 查词典。
const UNTRANSLATED_GENRE_IDS = new Set([10765, 10768])

// genre 可以是 /api/genres 的 { id, name }，也可以是裸英文名（TVmaze 类型串、
// 旧链接）—— 裸名先查静态表换算成 id 再走同一套覆盖。
export function genreDisplayName(genre, t, kind) {
  if (genre && typeof genre === 'object') {
    if (UNTRANSLATED_GENRE_IDS.has(Number(genre.id))) return t(`tmdbGenre.${genre.id}`)
    return genre.name
  }
  const id = kind ? genreIdByName(genre, kind) : null
  if (id != null && UNTRANSLATED_GENRE_IDS.has(id)) return t(`tmdbGenre.${id}`)
  return genre
}
