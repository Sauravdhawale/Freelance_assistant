import { createDb } from './db.js';
import { loadConfig } from './config.js';
import { createApplication } from './app.js';
const config=loadConfig();const db=createDb(config.databaseUrl);
try {
  const {app}=await createApplication({db,config});
  const server=app.listen(config.port,'0.0.0.0',()=>process.stdout.write(`Freelance Assistant listening on port ${config.port}.\n`));
  server.requestTimeout=300000;
  for(const signal of ['SIGTERM','SIGINT']) process.once(signal,()=>{server.close(async()=>{await db.close();process.exit(0);});setTimeout(()=>process.exit(1),15000).unref();});
} catch(e) {process.stderr.write(`Startup failed: ${e.message}\n`);await db.close();process.exit(1);}
