const extensionOriginPattern=/^chrome-extension:\/\/[a-p]{32}$/;

export function createOriginPolicy({environment,webOrigin,extensionOrigin,bindHost,port}){
  if(!['local','staging'].includes(environment))throw new Error('V2_ENVIRONMENT_INVALID');
  let parsedWebOrigin;
  try{parsedWebOrigin=new URL(webOrigin);}catch{throw new Error('V2_WEB_ORIGIN_INVALID');}
  if(parsedWebOrigin.origin!==webOrigin)throw new Error('V2_WEB_ORIGIN_INVALID');
  if(extensionOrigin&&!extensionOriginPattern.test(extensionOrigin))throw new Error('V2_EXTENSION_ORIGIN_INVALID');
  if(environment==='staging'){
    if(parsedWebOrigin.protocol!=='https:')throw new Error('V2_WEB_ORIGIN_INVALID');
    if(!extensionOrigin)throw new Error('V2_EXTENSION_ORIGIN_REQUIRED');
  }
  if(environment==='local'&&!['127.0.0.1','::1','localhost'].includes(bindHost))throw new Error('V2_LOCAL_BIND_INVALID');
  const localOrigin=`http://localhost:${port}`;
  return {
    allows(origin){
      return origin===webOrigin||
        (environment==='local'&&origin===localOrigin)||
        (extensionOrigin ? origin===extensionOrigin : environment==='local'&&extensionOriginPattern.test(origin));
    }
  };
}
