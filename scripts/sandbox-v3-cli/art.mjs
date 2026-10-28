import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const themes=Object.freeze(['cats','jupiter']);
const text=Object.freeze({
  cats:[
    '     .         *              .              *          .',
    '                 _        .                       .',
    '       /\\_/\\             /\\_/\\              /\\_/\\       *',
    '      ( o.o )           ( ^.^ )            ( -.- )',
    '       > ^ <             > * <              > ^ <',
    '    .   | |       *      /___\\       .       | |',
    '          .                .             .',
  ],
  jupiter:[
    '     .               *             .                 *',
    '                   .-""""""""""-.           .',
    '               .-"  ___====___  "-.',
    '             ."  .==---====---==.  ".',
    '            /  --====--____--====-- \\',
    '           |  ._____========_____.  |         *',
    '           |  ~~---====~~~~====---  |',
    '            \\  ===____----____===  /       .',
    '             ".  --==========--  ."',
    '               "-.___====___.-"',
    '       *            .            .        *',
  ],
});
const titles=Object.freeze({
  cats:'   C O S M I C   C A T S    / /    S A N D B O X   V 3',
  jupiter:'        J U P I T E R    / /    S A N D B O X   V 3',
});
const C=Object.freeze({
  reset:'\x1b[0m',
  dim:'\x1b[2m',
  purple:'\x1b[38;5;141m',
  pink:'\x1b[38;5;213m',
  cyan:'\x1b[38;5;87m',
  amber:'\x1b[38;5;221m',
  grey:'\x1b[38;5;246m',
});

export function normalizeTheme(value){
  if(!themes.includes(value))throw Error('INVALID_ASCII_THEME_USE_CATS_OR_JUPITER');
  return value;
}
export function themeFile(home=os.homedir()){
  return path.join(home,'.local','share','sandbox-v3','theme.json');
}
export function readTheme(home=os.homedir()){
  const file=themeFile(home);
  try{
    const stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1500)
      throw Error('UNTRUSTED_THEME_FILE');
    const data=JSON.parse(fs.readFileSync(file,'utf8'));
    return normalizeTheme(data.theme);
  }catch(error){
    if(error.code==='ENOENT')return 'cats';
    throw error;
  }
}
export function saveTheme(theme,home=os.homedir()){
  normalizeTheme(theme);
  const folder=path.dirname(themeFile(home));
  if(!fs.existsSync(folder))fs.mkdirSync(folder,{recursive:true,mode:0o700});
  const stat=fs.lstatSync(folder);
  if(!stat.isDirectory()||stat.isSymbolicLink()||
     (typeof process.getuid==='function'&&stat.uid!==process.getuid()))
    throw Error('UNTRUSTED_THEME_DIRECTORY');
  const file=themeFile(home);
  if(fs.existsSync(file)){
    const prior=fs.lstatSync(file);
    if(!prior.isFile()||prior.isSymbolicLink()||
       (typeof process.getuid==='function'&&prior.uid!==process.getuid()))
      throw Error('UNTRUSTED_THEME_FILE');
  }
  const temp=path.join(folder,'.theme-'+process.pid+'-'+Date.now());
  try{
    fs.writeFileSync(temp,JSON.stringify({theme})+'\n',{flag:'wx',mode:0o600});
    fs.renameSync(temp,file);
  }finally{
    if(fs.existsSync(temp))fs.unlinkSync(temp);
  }
}
export function colorsEnabled({tty=process.stdout.isTTY,term=process.env.TERM,
  noColor=process.env.NO_COLOR}={}){
  return Boolean(tty)&&term!=='dumb'&&noColor===undefined;
}
export function banner(theme='cats',{color=colorsEnabled(),
  columns=process.stdout.columns||80}={}){
  normalizeTheme(theme);
  const lines=text[theme];
  const compact=columns<57;
  const headline=compact?'     [ S A N D B O X   V 3 ]':titles[theme];
  const footer=compact?'    RETRO TERMINAL / 1986':
    '        R E T R O   T E R M I N A L   /   1 9 8 6';
  const strip=compact?'     *  *  *  *  *':
    '    - - - - - - - - - - - - - - - - - - - - - -';
  const artwork=compact?
    [theme==='cats'?'      /\\_/\\    /\\_/\\':'        .-""""-.',
     theme==='cats'?'     ( o.o )  ( ^.^ )':'      ." ==--== ".',
     theme==='cats'?'      > ^ <    > * <':'      \\_==____==_/']:
    lines;
  const colored=(line,fg)=>color?fg+line+C.reset:line;
  const artColor=theme==='cats'?C.pink:C.amber;
  return [
    '',
    colored('        .          *              .        .',C.grey),
    ...artwork.map((line,i)=>colored(line,i===0?C.grey:artColor)),
    '',
    colored(headline,C.cyan),
    colored(footer,C.purple),
    colored(strip,C.grey),
    ''
  ].join('\n');
}
