import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {banner,readTheme,saveTheme,colorsEnabled} from './art.mjs';

test('80s cosmic cats and Jupiter are pure ASCII with visible terminal headings',()=>{
  for(const theme of ['cats','jupiter']){
    const result=banner(theme,{color:false,columns:100});
    assert(result.length>180);
    assert(result.includes('S A N D B O X   V 3'));
    assert(result.includes('R E T R O   T E R M I N A L'));
    assert([...result].every(x=>x.charCodeAt(0)<128));
    assert(!result.includes('\x1b['));
  }
  assert.match(banner('cats',{color:false,columns:100}),/\( o\.o \)/);
  assert.match(banner('jupiter',{color:false,columns:100}),/======/);
});
test('narrow terminal has compact cats or Jupiter without truncated giant artwork',()=>{
  assert(banner('cats',{color:false,columns:40}).includes('[ S A N D B O X   V 3 ]'));
  assert.match(banner('jupiter',{color:false,columns:40}),/RETRO TERMINAL/);
});
test('retro palette is only emitted for interactive color-capable terminal',()=>{
  assert.equal(colorsEnabled({tty:false,term:'xterm-256color'}),false);
  assert.equal(colorsEnabled({tty:true,term:'dumb'}),false);
  assert.equal(colorsEnabled({tty:true,term:'xterm-256color',noColor:'1'}),false);
  assert.equal(colorsEnabled({tty:true,term:'xterm-256color'}),true);
  const ansi=banner('jupiter',{color:true,columns:100});
  assert(ansi.includes('\x1b[38;5;221m'));
  assert(ansi.includes('\x1b[38;5;87m'));
});
test('theme persists privately without starting Docker, default is cosmic cats',()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'sandbox-v3-art-test-'));
  try{
    assert.equal(readTheme(home),'cats');
    saveTheme('jupiter',home);
    assert.equal(readTheme(home),'jupiter');
    saveTheme('cats',home);
    assert.equal(readTheme(home),'cats');
    const st=fs.statSync(path.join(home,'.local/share/sandbox-v3/theme.json'));
    assert.equal(st.mode&0o077,0);
    assert.throws(()=>saveTheme('legacy-v2',home),/INVALID_ASCII_THEME/);
  }finally{fs.rmSync(home,{recursive:true,force:true});}
});
