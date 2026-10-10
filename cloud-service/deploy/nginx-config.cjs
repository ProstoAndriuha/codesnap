const fs=require('node:fs');
const file='/etc/nginx/sites-available/codesnap';
let text=fs.readFileSync(file,'utf8');
if (!text.includes('location ^~ /api/mail')) {
  const marker='    location / {\n        root /home/vps/projects/codesnap-site;';
  if (!text.includes(marker)) throw new Error('Unexpected CodeSnap nginx configuration');
  const location=`    location ^~ /api/mail {
        client_max_body_size 8k;
        access_log off;
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_connect_timeout 5s;
        proxy_read_timeout 35s;
        proxy_send_timeout 10s;
        proxy_buffering off;
    }

`;
  text=text.replace(marker,location+marker); fs.writeFileSync(file,text);
}
if (!text.includes('location = /codesnap-friends-beta.zip')) {
  const marker='    location ^~ /api/mail';
  text=text.replace(marker,'    location = /codesnap-friends-beta.zip {\n        return 302 https://github.com/ProstoAndriuha/codesnap/releases/latest/download/CodeSnap-Chrome.zip;\n    }\n\n'+marker);
  fs.writeFileSync(file,text);
}
