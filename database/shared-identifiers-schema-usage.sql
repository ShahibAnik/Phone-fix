-- RPC wrappers execute as the caller. Schema usage is required to reach the
-- specifically granted private functions; tables remain fully revoked/RLS locked.
begin;
grant usage on schema phonefix_private to anon, authenticated;
commit;
