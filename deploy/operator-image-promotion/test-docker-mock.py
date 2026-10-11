#!/usr/bin/env python3
"""Isolated mock Docker CLI for promotion integration gates; no real Docker access."""
import os,sys,json,re
from pathlib import Path
args=sys.argv[1:]
state_path=Path(os.environ['FAKE_STATE'])
state=json.loads(state_path.read_text())
old='sha256:55be5b2aa44d164a777b87f55d46f351d56fe0463a6527f6efad96918567fdcb'
new='sha256:b7d9847967ddc0d08ad665b68f8309b22b743857f176741791efbb1925d2f201'
new_tag='cloud-sandbox-mcp:deps-v2-55be5b2aa44d-d1b4b0f9afe9'
base_tag='cloud-sandbox-mcp:base-55be5b2aa44d164a'
Path(os.environ['FAKE_LOG']).open('a').write(' '.join(args[:25])+'\n')
def info(image):
    return {'Id':state['container_id'],
      'Image':old if image in (base_tag,'mock-controller:legacy') else new,
      'State':{'Running':True,'Health':{'Status':'healthy'}},
      'Config':{'Image':image,'Labels':{
        'com.docker.compose.service':'mcp',
        'com.docker.compose.project':'mock-sandbox',
        'com.docker.compose.project.working_dir':os.environ['FAKE_WORKING'],
        'com.docker.compose.project.config_files':','.join(state['compose_files'])
       }},
      'Mounts':[{'Type':'bind','Source':'/mock/shared/mcp','Destination':'/app/dist','RW':True}],
      'NetworkSettings':{'Networks':{'mock_default':{'NetworkID':'net123'}}},
      'HostConfig':{'RestartPolicy':{'Name':'unless-stopped'},
          'PortBindings':{'3000/tcp':[{'HostIp':'','HostPort':'3000'}]}}
      }
if args[:2]==['inspect','--type'] and args[2]=='container':
    name=args[3]
    if name=='cloud-sandbox-mcp':
        print(json.dumps([info(state['image_ref'])]))
    elif name=='cloud-sandbox-dev-main':
        print(json.dumps([{'Id':'f'*64,'State':{'Running':True}}]))
    else: raise SystemExit(2)
elif args[:2]==['image','inspect']:
    ref=args[-1]
    if ref==base_tag:print(old)
    elif ref==new_tag:print(new)
    else:raise SystemExit(2)
elif args[0]=='compose':
    parts=args
    if '--project-name' not in parts or parts[parts.index('--project-name')+1]!='mock-sandbox':
        print('WRONG_COMPOSE_PROJECT',file=sys.stderr);raise SystemExit(2)
    configs=[parts[i+1] for i,a in enumerate(parts[:-1]) if a=='-f']
    def current_image():
        image='mock-controller:legacy'
        for item in configs:
            if item=='-':
                data=sys.stdin.read()
            else:
                data=Path(item).read_text()
            match=re.search(r'(?m)^\s*image:\s*(\S+)',data)
            if match:image=match.group(1)
        return image
    if 'config' in parts:
        image=current_image()
        data={'name':'mock-sandbox',
            'services':{
                'mcp':{
                    'image':image,'restart':'unless-stopped',
                    'environment':{'PORT':'3000','COMPUTER_USE_ENABLED':'true'},
                    'volumes':[{'type':'bind','source':'/mock/shared/mcp','target':'/app/dist'}],
                    'ports':[{'published':'3000','target':3000}],
                    'build':{'context':'/fake/repo'}
                },
                'n8n':{'image':'n8nio/n8n:1.0'}
            },
            'networks':{'default':{'name':'mock_default'}}
        }
        if os.environ.get('FAKE_COMPOSE_DRIFT')=='1' and '-' in configs:
            data['services']['mcp']['ports'][0]['published']='9999'
        print(json.dumps(data))
    elif 'up' in parts:
        needed={'-d','--no-deps','--no-build','--pull','never','--force-recreate'}
        if not needed.issubset(set(parts)) or parts[-1]!='mcp':
            print('UNSAFE_COMPOSE_MUTATION',file=sys.stderr);raise SystemExit(2)
        image=current_image()
        if os.environ.get('FAKE_FAIL_NEW')=='1' and image==new_tag:
            print('SIMULATED_UP_FAILURE',file=sys.stderr);raise SystemExit(2)
        state['image_ref']=image
        state['container_id']='e'*64 if image==new_tag else 'd'*64
        state['compose_files']=[f for f in configs if f!='-']
        state_path.write_text(json.dumps(state))
        print('FAKE_MCP_ONLY_COMPOSE_UP_PASS')
    else: raise SystemExit(2)
elif args[0]=='exec':
    if args[1]!='cloud-sandbox-mcp' or 'node' not in args:
        raise SystemExit(2)
    snippet=args[-1]
    if 'CONTROLLER_DEPENDENCIES_8_AND_MCP_REGISTRY_23_PASS' in snippet:
        if os.environ.get('FAKE_RUNTIME_V2_CODE')=='1':
            print('V2 code has 28 tools, not the 23-tool original',file=sys.stderr)
            raise SystemExit(2)
        print('CONTROLLER_DEPENDENCIES_8_AND_MCP_REGISTRY_23_PASS')
    elif 'BASE_IMAGE_MCP_REGISTRY_23_PASS' in snippet:
        print('BASE_IMAGE_MCP_REGISTRY_23_PASS')
    elif 'HTTP_200' in snippet:
        print('HTTP_200')
    else: raise SystemExit(2)
else:
    print('UNEXPECTED_DOCKER_COMMAND',args[:5],file=sys.stderr)
    raise SystemExit(2)
