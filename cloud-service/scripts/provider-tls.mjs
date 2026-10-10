import tls from 'node:tls';
import { presets } from '../src/mail.js';
for (const [name,host] of Object.entries(presets)) {
  await new Promise(resolve=>{
    const socket=tls.connect({host,port:993,servername:host,rejectUnauthorized:true,minVersion:'TLSv1.2'});
    socket.setTimeout(12000);
    socket.once('secureConnect',()=>{console.log(`${name}: verified TLS ${socket.getProtocol()}`);socket.destroy();resolve();});
    socket.once('timeout',()=>{console.log(`${name}: connection timeout`);socket.destroy();resolve();});
    socket.once('error',()=>{console.log(`${name}: TLS connection unavailable`);resolve();});
  });
}
