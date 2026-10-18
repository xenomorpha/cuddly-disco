-- Nodeboard schema (spec §8). Mirrors the client model in src/model/types.ts:
-- a card is the content, a placement is where it sits; boards are cards of
-- type 'board' with an extra row in `boards` holding the tree edge.
--
-- Ids are text, not uuid: the client generates UUIDs, but imported documents
-- (and link targets, which may be broken references) can carry any string.

create table users (
  id            text primary key default gen_random_uuid()::text,
  name          text not null,
  email         text not null unique,
  color         text not null default '#6c5ce7',
  created_at    timestamptz not null default now()
);

-- Bearer tokens (sha256 of the token). Stand-in for the spec's auth provider.
create table api_tokens (
  token_hash    text primary key,
  user_id       text not null references users(id) on delete cascade,
  label         text not null default '',
  created_at    timestamptz not null default now()
);

create table workspaces (
  id            text primary key default gen_random_uuid()::text,
  name          text not null,
  owner_id      text not null references users(id),
  root_board_id text,
  created_at    timestamptz not null default now()
);

create table workspace_members (
  workspace_id  text not null references workspaces(id) on delete cascade,
  user_id       text not null references users(id) on delete cascade,
  role          text not null check (role in ('owner', 'editor', 'commenter', 'viewer')),
  primary key (workspace_id, user_id)
);

create table cards (
  id            text primary key default gen_random_uuid()::text,
  workspace_id  text not null references workspaces(id) on delete cascade,
  type          text not null check (type in ('note','document','todo','board','column','image','link','file',
                                              'table','sketch','swatch','map','comment','shortcut')),
  title         text not null default '',
  text          text not null default '',
  data          jsonb not null default '{}',
  color         text,
  labels        text[] not null default '{}',
  -- derived on save by the link indexer
  display_title text not null default '',
  plain_text    text not null default '',
  search        tsvector generated always as (to_tsvector('simple', display_title || ' ' || plain_text)) stored,
  created_by    text not null references users(id),
  updated_by    text not null references users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index cards_workspace_idx on cards (workspace_id);
create index cards_search_idx on cards using gin (search);
create index cards_title_idx on cards (workspace_id, lower(display_title));

create table boards (
  id              text primary key references cards(id) on delete cascade,
  workspace_id    text not null references workspaces(id) on delete cascade,
  parent_board_id text references boards(id) on delete set null deferrable initially deferred,
  icon            text,
  cover           text
);
create index boards_parent_idx on boards (parent_board_id);
create index boards_workspace_idx on boards (workspace_id);

alter table workspaces
  add constraint workspaces_root_fk foreign key (root_board_id) references boards(id) deferrable initially deferred;

create table placements (
  id            text primary key default gen_random_uuid()::text,
  workspace_id  text not null references workspaces(id) on delete cascade,
  card_id       text not null references cards(id) on delete cascade,
  board_id      text not null references boards(id) on delete cascade,
  column_id     text references placements(id) on delete set null deferrable initially deferred,
  ord           double precision not null default 0,
  x             double precision not null default 0,
  y             double precision not null default 0,
  w             double precision not null default 240,
  h             double precision,
  z             integer not null default 0,
  locked        boolean not null default false,
  tray          boolean not null default false,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index placements_board_idx on placements (board_id);
create index placements_card_idx on placements (card_id);

create table connectors (
  id                text primary key default gen_random_uuid()::text,
  workspace_id      text not null references workspaces(id) on delete cascade,
  board_id          text not null references boards(id) on delete cascade,
  from_placement_id text not null references placements(id) on delete cascade,
  to_placement_id   text not null references placements(id) on delete cascade,
  style             jsonb not null default '{}',
  label             text not null default ''
);
create index connectors_board_idx on connectors (board_id);

create table comments (
  id            text primary key default gen_random_uuid()::text,
  workspace_id  text not null references workspaces(id) on delete cascade,
  target_id     text not null references cards(id) on delete cascade,
  author_id     text not null references users(id),
  body          text not null,
  parent_id     text references comments(id) on delete cascade,
  resolved      boolean not null default false,
  created_at    timestamptz not null default now()
);
create index comments_target_idx on comments (target_id);

-- Link index (spec §4.4), rebuilt per card on save from parseLinks().
-- Links written in a comment count as references from the commented card.
create table links (
  id              bigserial primary key,
  workspace_id    text not null references workspaces(id) on delete cascade,
  source_card_id  text not null references cards(id) on delete cascade,
  comment_id      text references comments(id) on delete cascade,
  source_field    text not null,          -- 'text' | 'item:<id>' | 'cell:<row>:<col>' | 'caption' | 'comment:<id>'
  target_id       text,                   -- resolved target (may point at a deleted/missing card: broken link)
  target_ref      text,                   -- unresolved [[Title]] as typed
  target_anchor   text,
  alias           text,
  position        integer not null,
  length          integer not null,
  field_text      text not null,          -- for snippets
  check (target_id is not null or target_ref is not null)
);
create index links_target_idx on links (target_id);
create index links_source_idx on links (source_card_id);
create index links_comment_idx on links (comment_id);

create table tags (
  id            bigserial primary key,
  workspace_id  text not null references workspaces(id) on delete cascade,
  name          text not null,
  unique (workspace_id, name)
);

create table card_tags (
  card_id       text not null references cards(id) on delete cascade,
  tag_id        bigint not null references tags(id) on delete cascade,
  primary key (card_id, tag_id)
);
create index card_tags_tag_idx on card_tags (tag_id);

-- Per-board overrides; 'none' hides a subtree from that user.
create table permissions (
  id            text primary key default gen_random_uuid()::text,
  workspace_id  text not null references workspaces(id) on delete cascade,
  board_id      text not null references boards(id) on delete cascade,
  user_id       text not null references users(id) on delete cascade,
  role          text not null check (role in ('owner', 'editor', 'commenter', 'viewer', 'none')),
  unique (board_id, user_id)
);

create table share_links (
  token           text primary key,
  workspace_id    text not null references workspaces(id) on delete cascade,
  board_id        text not null unique references boards(id) on delete cascade,
  enabled         boolean not null default true,
  password_hash   text,
  allow_duplicate boolean not null default false,
  created_at      timestamptz not null default now()
);

create table graph_views (
  id            text primary key default gen_random_uuid()::text,
  workspace_id  text not null references workspaces(id) on delete cascade,
  user_id       text not null references users(id) on delete cascade,
  name          text not null,
  settings      jsonb not null default '{}',
  created_at    timestamptz not null default now()
);

-- Blob metadata; the bytes live in object storage under storage_key (S3 is not wired up yet).
create table assets (
  id            text primary key default gen_random_uuid()::text,
  workspace_id  text not null references workspaces(id) on delete cascade,
  uploaded_by   text not null references users(id),
  mime          text not null,
  size          bigint not null,
  storage_key   text not null,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------- permission resolution
-- Same rules as src/model/permissions.ts (spec §7):
--   workspace owner -> 'owner'
--   'link:<token>'  -> 'viewer' if an enabled share link sits on the board or an ancestor, else 'none'
--   otherwise       -> nearest board override walking up the tree, else the workspace role, else 'none'
-- A non-board card gets the best role over the boards it is placed on; a card
-- with no live placement follows the root board.

create function role_rank(r text) returns integer language sql immutable as $$
  select case r when 'owner' then 4 when 'editor' then 3 when 'commenter' then 2 when 'viewer' then 1 else 0 end
$$;

create function rank_role(n integer) returns text language sql immutable as $$
  select case n when 4 then 'owner' when 3 then 'editor' when 2 then 'commenter' when 1 then 'viewer' else 'none' end
$$;

-- Ancestors of a board, itself included, with their distance. Stops at cycles.
create function board_chain(p_board text) returns table (board_id text, depth integer) language sql stable as $$
  with recursive chain (board_id, depth, path) as (
    select b.id, 0, array[b.id] from boards b where b.id = p_board
    union all
    select b.parent_board_id, c.depth + 1, c.path || b.parent_board_id
    from chain c join boards b on b.id = c.board_id
    where b.parent_board_id is not null and not (b.parent_board_id = any (c.path))
  )
  select board_id, depth from chain
$$;

-- Role of one principal on one board.
create function board_role(p_principal text, p_board text) returns text language sql stable as $$
  with ws as (
    select w.id, w.owner_id from boards b join workspaces w on w.id = b.workspace_id where b.id = p_board
  ), chain as (
    select * from board_chain(p_board)
  )
  select case
    when not exists (select 1 from ws) then 'none'
    when p_principal = (select owner_id from ws) then 'owner'
    when p_principal like 'link:%' then
      case when exists (
        select 1 from share_links s join chain c on c.board_id = s.board_id
        where s.enabled and s.token = substr(p_principal, 6)
      ) then 'viewer' else 'none' end
    else coalesce(
      (select p.role from permissions p join chain c on c.board_id = p.board_id
        where p.user_id = p_principal order by c.depth limit 1),
      (select m.role from workspace_members m join ws on m.workspace_id = ws.id where m.user_id = p_principal),
      'none')
  end
$$;

-- Roles of one principal on every board of a workspace, in one pass.
create function board_roles(p_principal text, p_workspace text) returns table (board_id text, role text) language sql stable as $$
  with recursive chain (board_id, ancestor_id, depth, path) as (
    select b.id, b.id, 0, array[b.id] from boards b where b.workspace_id = p_workspace
    union all
    select c.board_id, b.parent_board_id, c.depth + 1, c.path || b.parent_board_id
    from chain c join boards b on b.id = c.ancestor_id
    where b.parent_board_id is not null and not (b.parent_board_id = any (c.path))
  ), nearest as (
    select distinct on (c.board_id) c.board_id, p.role
    from chain c join permissions p on p.board_id = c.ancestor_id and p.user_id = p_principal
    order by c.board_id, c.depth
  ), linked as (
    select distinct c.board_id
    from chain c join share_links s on s.board_id = c.ancestor_id
    where p_principal like 'link:%' and s.enabled and s.token = substr(p_principal, 6)
  ), w as (
    select owner_id from workspaces where id = p_workspace
  ), member as (
    select role from workspace_members where workspace_id = p_workspace and user_id = p_principal
  )
  select b.id,
    case
      when p_principal = (select owner_id from w) then 'owner'
      when p_principal like 'link:%' then case when l.board_id is not null then 'viewer' else 'none' end
      else coalesce(n.role, (select role from member), 'none')
    end
  from boards b
  left join nearest n on n.board_id = b.id
  left join linked l on l.board_id = b.id
  where b.workspace_id = p_workspace
$$;

-- Role of one principal on one card.
create function card_role(p_principal text, p_card text) returns text language sql stable as $$
  select case
    when c.id is null then 'none'
    when c.type = 'board' then board_role(p_principal, c.id)
    when exists (select 1 from placements p where p.card_id = c.id and p.deleted_at is null) then (
      select rank_role(max(role_rank(board_role(p_principal, p.board_id))))
      from placements p where p.card_id = c.id and p.deleted_at is null
    )
    else board_role(p_principal, w.root_board_id)
  end
  from (select 1) as one
  left join cards c on c.id = p_card
  left join workspaces w on w.id = c.workspace_id
$$;

-- Roles of one principal on every card of a workspace, in one pass.
create function card_roles(p_principal text, p_workspace text) returns table (card_id text, role text) language sql stable as $$
  with br as (
    select * from board_roles(p_principal, p_workspace)
  ), placed as (
    select p.card_id, max(role_rank(br.role)) as r
    from placements p join br on br.board_id = p.board_id
    where p.workspace_id = p_workspace and p.deleted_at is null
    group by p.card_id
  ), root_role as (
    select br.role from br join workspaces w on w.root_board_id = br.board_id where w.id = p_workspace
  )
  select c.id,
    case
      when c.type = 'board' then coalesce(bb.role, 'none')
      when pl.card_id is not null then rank_role(pl.r)
      else coalesce((select role from root_role), 'none')
    end
  from cards c
  left join br bb on bb.board_id = c.id
  left join placed pl on pl.card_id = c.id
  where c.workspace_id = p_workspace
$$;

-- Live items, as in src/model/index.ts: a board is live when it and every
-- ancestor up to the root are not deleted; any other card is live when it is
-- not deleted and has a live placement on a live board.
create function live_cards(p_workspace text) returns table (card_id text) language sql stable as $$
  with recursive lb (id) as (
    select b.id from workspaces w
      join boards b on b.id = w.root_board_id
      join cards c on c.id = b.id
    where w.id = p_workspace and c.deleted_at is null
    union
    select b.id from lb
      join boards b on b.parent_board_id = lb.id
      join cards c on c.id = b.id
    where c.deleted_at is null
  )
  select id from lb
  union
  select p.card_id from placements p
    join lb on lb.id = p.board_id
    join cards c on c.id = p.card_id
  where p.deleted_at is null and c.deleted_at is null and c.type <> 'board'
$$;

-- Board ids in the subtree under p_root (inclusive).
create function subtree_boards(p_root text) returns table (board_id text) language sql stable as $$
  with recursive t (id) as (
    select p_root
    union
    select b.id from t join boards b on b.parent_board_id = t.id
  )
  select id from t
$$;
