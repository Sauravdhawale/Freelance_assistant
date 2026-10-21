import serverless from 'serverless-http';
import {withLambda} from '@netlify/aws-lambda-compat';
export function createWebHandler(app) {
  const handle=withLambda(serverless(app,{request:(req,event)=>{
    delete req.headers['x-forwarded-for'];
    delete req.headers['x-forwarded-host'];
    const ip=event.headers['x-fa-client-ip'] || '127.0.0.1';
    req.socket.remoteAddress=ip;
    req.ip=ip;
  }}));
  return (request,context)=>{
    const headers=new Headers(request.headers);
    headers.set('x-fa-client-ip',context.ip || '127.0.0.1');
    return handle(new Request(request,{headers}),context);
  };
}
