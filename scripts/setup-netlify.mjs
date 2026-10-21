import {createDb,migrate} from '../backend/src/db.js';
import {bootstrap} from '../backend/src/auth.js';
import {loadConfig} from '../backend/src/config.js';
const config=loadConfig();
const db=createDb(config.databaseUrl,{max:2});
try {
  // Run manually against the intended database, never during a public request or build.
  await migrate(db);
  await bootstrap(db,config);
  console.log('Database and administrator are ready. Remove ADMIN_PASSWORD from deployed environment variables.');
} finally {await db.close();}
