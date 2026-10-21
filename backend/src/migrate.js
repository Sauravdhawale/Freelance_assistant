import { createDb,migrate } from './db.js';
const db=createDb(process.env.DATABASE_URL);
try {await migrate(db);process.stdout.write('Database migrations applied.\n');}finally{await db.close();}
