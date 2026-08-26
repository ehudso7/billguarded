begin;

update storage.buckets
   set allowed_mime_types = array['text/csv','application/vnd.ms-excel']::text[]
 where id = 'audit-documents';

commit;
