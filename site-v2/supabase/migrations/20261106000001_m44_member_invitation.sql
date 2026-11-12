-- M44 — each organization member carries their latest invitation (D-30).
--
-- At the product owner's request: an administrator can resend every expired
-- invitation in an organization at once. The resend itself is the existing
-- resend_invitation, one per person, which also sends the email; what was
-- missing is which invitation to resend. list_organization_members now says,
-- for each person, their latest invitation to that organization: its id,
-- status and expiry, or null if they were never invited (a test account).
--
-- Exactly as M30 left the handler, with one field added.

CREATE OR REPLACE FUNCTION app.handle_list_organization_members(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE org uuid; items jsonb;
BEGIN
  PERFORM app.assert_admin(actor);
  org := (payload ->> 'organization_id')::uuid;
  IF NOT EXISTS (SELECT 1 FROM app.organizations o WHERE o.id = org) THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'user_id', p.id,
           'display_name', p.display_name,
           'email', p.email,
           'role', m.role,
           'status', m.status,
           'onboarded', p.onboarded_at IS NOT NULL,
           'invitation', (SELECT jsonb_build_object('id', i.id, 'status', i.status,
                                                    'expires_at', i.expires_at)
                            FROM app.invitations i
                           WHERE i.user_id = p.id AND i.organization_id = org
                           ORDER BY i.created_at DESC, i.id
                           LIMIT 1))
         -- Managers first, then by name, so the people an admin edits most
         -- often are at the top.
         ORDER BY (m.role = 'manager') DESC, lower(p.display_name), p.id), '[]'::jsonb)
    INTO items
  FROM app.memberships m
  JOIN app.profiles p ON p.id = m.user_id
  WHERE m.organization_id = org;

  RETURN jsonb_build_object('items', items, 'next_cursor', NULL);
END $$;
