-- Owner offer management (S-04): an owner edits the fields of an own offer while it is still
-- 'draft' or 'seeking_agent', and deletes an own offer in any status.
-- Updating goes through a column-level grant: status, owner_id, id and created_at are never
-- writable, because status changes only through the invitation RPCs (invite_agent,
-- respond_to_invitation) and owner_id must stay the creator.
-- The policies read only the offers row itself, never invitations: offers_select_invited_agent
-- reads invitations, so a policy going there would risk "infinite recursion detected in policy".
-- An update of a locked offer ('invited', 'in_progress') hits no rows instead of raising, so the
-- endpoint tells a missing offer from a locked one by reading it again.
-- Deleting an offer removes its invitations through on delete cascade; the
-- invitations_restore_offer_on_delete trigger (20261028220000_account_deletion.sql) then
-- updates no rows, because the offer is already gone.

grant update (city, property_type, transaction, price, area_m2, rooms, description)
  on public.offers to authenticated;
grant delete on public.offers to authenticated;

create policy offers_update_own_editable on public.offers
  for update
  to authenticated
  using (owner_id = (select auth.uid()) and status in ('draft', 'seeking_agent'))
  with check (owner_id = (select auth.uid()) and status in ('draft', 'seeking_agent'));

create policy offers_delete_own on public.offers
  for delete
  to authenticated
  using (owner_id = (select auth.uid()));

-- down:
-- drop policy if exists offers_delete_own on public.offers;
-- drop policy if exists offers_update_own_editable on public.offers;
-- revoke update, delete on public.offers from authenticated;
