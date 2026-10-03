-- grant_badge y claim_vip_status son SECURITY DEFINER y estaban expuestas a anon/authenticated
-- vía /rest/v1/rpc: cualquiera podía darse badges o estado VIP. Solo el servidor (service_role) las usa.
revoke execute on function public.grant_badge(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.grant_badge(uuid, text, uuid) to service_role;

revoke execute on function public.claim_vip_status(uuid) from public, anon, authenticated;
grant execute on function public.claim_vip_status(uuid) to service_role;
