-- LUMENFRAME 云端同步：个人观影库
--
-- 用法：Supabase Dashboard → SQL Editor，整段粘贴执行。幂等，可重复执行。
--
-- 安全边界**全部**依赖 RLS：前端只持有 publishable key（可公开），直接读写本表。
--   · 切勿把 service_role / secret key 放进前端仓库或 Pages 构建变量
--   · 忘掉 enable row level security = 全互联网可读他人观影库
--   · 只 revoke anon 不够，必须同时有 policy，否则 authenticated 也会 permission denied

create table if not exists public.library_items (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  list_name  text        not null check (list_name in ('watched','watchlater','likes','notes','pinned')),
  kind       text        not null check (kind in ('movie','tv','genre','person')),
  item_id    text        not null,   -- 数字 id 一律 String() 存（TMDB 与 TVmaze 数字空间重叠，靠 kind 区分）
  payload    jsonb       not null default '{}'::jsonb,

  -- 由**客户端**写入（本地事件时间）。不要加触发器改成 now()：
  -- 冲突解决靠比较两端时间戳，服务端覆盖会让「谁更新」永远判定成服务端，
  -- 离线设备攒下的新改动会被静默丢弃。
  updated_at timestamptz not null default now(),

  -- 墓碑：非空 = 已删除。没有它，「远端不存在」就无法区分
  -- 「本设备从没同步过」与「别的设备删掉了」，结果是 A 删掉的条目被 B 的旧快照复活。
  deleted_at timestamptz,

  primary key (user_id, list_name, kind, item_id)
);

comment on table public.library_items is
  'LUMENFRAME 个人观影库同步表：一行 = 一个条目在一个列表中的状态（deleted_at 非空为墓碑）';

-- 主键索引已能服务 user_id 前缀查询；此索引供按 updated_at 排序 / 增量拉取
create index if not exists library_items_user_updated_idx
  on public.library_items (user_id, updated_at desc);

alter table public.library_items enable row level security;

drop policy if exists "library_items_owner_all" on public.library_items;
create policy "library_items_owner_all"
  on public.library_items
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 未登录请求不应看到任何行，也不应持有表权限（默认权限会给 anon 授予 ALL）
revoke all on public.library_items from anon;
grant select, insert, update, delete on public.library_items to authenticated;


-- ---------------------------------------------------------------------------
-- 可选：墓碑清理（**默认不要执行**）
--
-- 自动清理会让离线超过保留期的设备复活已删条目。本表是个人量级（几千行以内），
-- 没有清理的必要。若确实要清，务必先确认没有任何设备离线超过下面的窗口：
--
-- delete from public.library_items
--  where deleted_at is not null and deleted_at < now() - interval '180 days';
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 可选：实时推送（**默认不启用**）
--
-- 当前客户端用「窗口重新获得焦点时拉取」代替实时订阅，省一次配置。
-- 若以后要改成推送式，执行下面两行并在 engine.js 里加 channel 订阅：
--
-- alter table public.library_items replica identity full;
-- alter publication supabase_realtime add table public.library_items;
-- ---------------------------------------------------------------------------
