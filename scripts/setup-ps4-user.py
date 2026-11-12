import json,pathlib,secrets,urllib.request
root=pathlib.Path('/home/openclaw/media-stack');c=json.loads((root/'config.json').read_text());j=c['jellyfin'];base=j['url'].rstrip('/')
def api(method,path,body=None):
    req=urllib.request.Request(base+path,data=None if body is None else json.dumps(body).encode(),method=method,headers={'Authorization':'MediaBrowser Client="PS4Setup", Device="Ubuntu", DeviceId="ps4-setup", Version="1.0", Token="'+j['adminKey']+'"','Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=20) as r:
        b=r.read();return json.loads(b) if b else None
credentials=json.loads((root/'credentials.json').read_text())
auth=urllib.request.Request(base+'/Users/AuthenticateByName',data=json.dumps({'Username':'journal-admin','Pw':credentials['jellyfinAdminPassword']}).encode(),headers={'Content-Type':'application/json','Authorization':'MediaBrowser Client=PS4Setup, Device=Ubuntu, DeviceId=ps4-setup, Version=1.0'},method='POST')
with urllib.request.urlopen(auth,timeout=20) as r: j['adminKey']=json.load(r)['AccessToken']
users=api('GET','/Users');u=next((u for u in users if u['Name']=='ps4'),None)
p=root/'ps4-credentials.json'
if u is None:
    password=secrets.token_urlsafe(24)
    u=api('POST','/Users/New',{'Name':'ps4','Password':password})
    p.write_text(json.dumps({'username':'ps4','password':password,'userId':u['Id'],'server':'http://10.44.44.3:8096'},indent=2));p.chmod(0o600)
elif not p.exists(): raise SystemExit('Existing ps4 user has no managed credentials; refusing password reset')
libs=api('GET','/Library/VirtualFolders');ids=[x['ItemId'] for x in libs if x.get('CollectionType') in ['movies','tvshows']]
if not ids: raise SystemExit('No movie/TV libraries found')
policy=u.get('Policy',{});policy.update({'IsAdministrator':False,'IsHidden':True,'IsDisabled':False,'EnableAllFolders':False,'EnabledFolders':ids,'EnableContentDeletion':False,'EnableContentDeletionFromFolders':[],'EnableContentDownloading':False,'EnableSyncTranscoding':False,'EnableRemoteControlOfOtherUsers':False,'EnableSharedDeviceControl':False,'EnableMediaPlayback':True,'EnableAudioPlaybackTranscoding':True,'EnableVideoPlaybackTranscoding':True,'EnablePlaybackRemuxing':True,'EnableLiveTvAccess':False,'EnableLiveTvManagement':False,'EnablePublicSharing':False,'RemoteClientBitrateLimit':8000000})
api('POST','/Users/'+u['Id']+'/Policy',policy)
print('PS4 playback account ready; allowed library count:',len(ids));print('Credentials saved privately:',p)
print('Server version:',api('GET','/System/Info/Public')['Version'])