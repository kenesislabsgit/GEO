# Local database backups

`20260826-before-plus-monitoring.dump` is the complete database state captured
before increasing Plus to two websites and 700 monthly provider checks.

It is a PostgreSQL custom-format archive. Restore it into an empty database:

```powershell
& 'C:\Program Files\PostgreSQL\17\bin\pg_restore.exe' `
  --dbname='YOUR_DATABASE_URL' `
  --clean --if-exists --no-owner --no-privileges `
  'C:\Users\Dhiya\Desktop\PROJECTS\GEO\backups\20260826-before-plus-monitoring.dump'
```

Restoring with `--clean` replaces matching data in the target database. Always
confirm the target database URL before running it.
