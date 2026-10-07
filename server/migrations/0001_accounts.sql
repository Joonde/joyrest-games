-- Вход ведущих на своём сервере (PR 3.1): аккаунты и сеансы входа.
-- id аккаунтов из Firebase сохраняются при переносе (PR 5); владелец агентства — ADMIN_UID
-- (src/data/config.ts), его пароль задаёт `sudo joyrest admin-password`.

create table if not exists users (
  id text primary key,
  email text not null,
  name text not null,
  role text not null default 'host' check (role in ('admin', 'host')),
  active boolean not null default true,
  -- scrypt (server/src/password.ts); null — входа по паролю ещё нет (перенос из Firebase).
  password_hash text,
  -- Временный пароль от администратора: при входе ведущий задаёт свой.
  must_change_password boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Почта уникальна без учёта регистра.
create unique index if not exists users_email_lower on users (lower(email));

-- Сеанс входа: в cookie — случайный токен, здесь — только его sha256.
create table if not exists auth_sessions (
  token_hash text primary key,
  user_id text not null references users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists auth_sessions_user on auth_sessions (user_id);
create index if not exists auth_sessions_expires on auth_sessions (expires_at);
