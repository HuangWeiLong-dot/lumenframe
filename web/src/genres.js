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
