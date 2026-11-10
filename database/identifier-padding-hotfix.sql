-- Preserve every digit of identifiers; no permissions or existing records change.
do $fix$
declare source text;
begin
 select pg_get_functiondef('phonefix_private.reserve_identifier(text,bigint)'::regprocedure) into source;
 if position('lpad(next_value::text,4,''0'')' in source)=0 then
  raise exception 'Expected identifier formatter missing';
 end if;
 source:=replace(source,'lpad(next_value::text,4,''0'')','lpad(next_value::text,greatest(4,length(next_value::text)),''0'')');
 execute source;
end $fix$;
