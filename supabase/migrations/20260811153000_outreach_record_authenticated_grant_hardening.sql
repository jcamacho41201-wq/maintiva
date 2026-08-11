REVOKE ALL ON TABLE public."OutreachRecord" FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public."OutreachRecord"
TO authenticated;
