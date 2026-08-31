create table account_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  token_hash text not null,
  status text not null default 'pending',
  expires_at timestamptz not null,
  invited_by uuid not null references instant_users(id),
  accepted_by uuid references instant_users(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint valid_status check (status in ('pending', 'accepted', 'revoked', 'expired'))
);

create index account_invites_email_idx on account_invites(email);
create index account_invites_token_idx on account_invites(token_hash);
create index account_invites_status_idx on account_invites(status);
