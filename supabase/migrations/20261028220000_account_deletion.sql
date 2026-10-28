-- Account deletion (S-07): an offer goes back to 'seeking_agent' whenever its active invitation is
-- deleted, a one-off repair of offers orphaned before this migration, and delete_own_account:
-- the self-service deletion of the caller's account with all its data (through the cascades
-- auth.users -> profiles -> offers / invitations).

-- After an active (pending or accepted) invitation is deleted, its offer is seeking an agent
-- again. Works for every deletion path: delete_own_account, deleting a user in the Supabase
-- dashboard and the cascade of a deleted offer (then the update hits no rows).
-- Only 'invited' and 'in_progress' offers are moved back; a rejected invitation never changes
-- the offer, because it was not active.
create function public.restore_offer_on_invitation_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('pending', 'accepted') then
    update public.offers
      set status = 'seeking_agent'
      where id = old.offer_id
        and status in ('invited', 'in_progress');
  end if;
  return old;
end;
$$;

-- Only the trigger calls this function.
revoke execute on function public.restore_offer_on_invitation_delete() from public, anon, authenticated;

create trigger invitations_restore_offer_on_delete
  after delete on public.invitations
  for each row
  execute function public.restore_offer_on_invitation_delete();

-- One-off repair: offers left 'invited' or 'in_progress' without an active invitation (agents
-- deleted before the trigger existed) are seeking an agent again. Idempotent; the down block
-- does not undo it.
update public.offers o
  set status = 'seeking_agent'
  where o.status in ('invited', 'in_progress')
    and not exists (
      select 1 from public.invitations i
      where i.offer_id = o.id and i.status in ('pending', 'accepted')
    );

-- Deletes the caller's own account. Security definer, because authenticated has no grant on
-- auth.users; the function therefore deletes only the row of auth.uid().
-- Returns a result code instead of raising, so the endpoint maps it to a redirect:
--   not_found - no auth.uid() (no session) or no such user (already deleted);
--   ok        - the auth.users row is deleted; the cascades remove the profile, the owner's
--               offers and every invitation of the user, and the trigger above moves the
--               offers of an agent's active invitations back to 'seeking_agent'.
create function public.delete_own_account()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    return 'not_found';
  end if;

  delete from auth.users where id = v_user_id;

  if not found then
    return 'not_found';
  end if;

  return 'ok';
end;
$$;

revoke execute on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;

-- down:
-- drop function if exists public.delete_own_account();
-- drop trigger if exists invitations_restore_offer_on_delete on public.invitations;
-- drop function if exists public.restore_offer_on_invitation_delete();
-- The one-off repair of orphaned offers is not undone.
