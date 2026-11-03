import json,pathlib,urllib.request,uuid
root=pathlib.Path('/home/openclaw/media-stack');p=json.loads((root/'ps4-credentials.json').read_text());c=json.loads((root/'config.json').read_text());base=c['jellyfin']['url'].rstrip('/');device='ps4-direct-'+uuid.uuid4().hex
hdr={'Authorization':f'MediaBrowser Client="Switchfin", Device="PS4", DeviceId="{device}", Version="0.9.4"','Content-Type':'application/json'}
r=urllib.request.Request(base+'/Users/AuthenticateByName',data=json.dumps({'Username':p['username'],'Pw':p['password']}).encode(),headers=hdr)
with urllib.request.urlopen(r,timeout=15) as resp:a=json.load(resp)
config={'user_id':a['User']['Id'],'device':device,'users':[{'id':a['User']['Id'],'name':'ps4','access_token':a['AccessToken'],'server_id':a['ServerId']}],'servers':[{'id':a['ServerId'],'name':'Ubuntu Journal Media','urls':['http://10.44.44.3:8096']}],'setting':{'transcodec':'h264'},'remotes':[]}
f=root/'switchfin-config.json';f.write_text(json.dumps(config,indent=2));f.chmod(0o600);print('Private Switchfin login configuration generated; no credentials displayed')