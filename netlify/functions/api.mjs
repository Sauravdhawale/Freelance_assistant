import {createWebHandler} from '../lib/express-adapter.mjs';
import {getRuntime,failure} from '../lib/runtime.mjs';
let handler;
export default async (request,context) => {
  try {
    const runtime=await getRuntime();
    handler ||= createWebHandler(runtime.app);
    return await handler(request,context);
  } catch(error){return failure(error);}
};
export const config={path:['/api/*','/internal/workflows/*']};
