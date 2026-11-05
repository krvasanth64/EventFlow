'use strict';
// Offline ZIP32 backup verification and restore rehearsal for EventFlow.
// Reads only the locally supplied archive; never connects to the server.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const CRC_TABLE=Array.from({length:256},(_,i)=>{
 let crc=i;
 for(let n=0;n<8;n++)crc=(crc&1)?0xedb88320^(crc>>>1):crc>>>1;
 return crc>>>0;
});
function crc32(buffer){
 let crc=0xffffffff;
 for(const byte of buffer)crc=CRC_TABLE[(crc^byte)&255]^(crc>>>8);
 return (crc^0xffffffff)>>>0;
}
function validateName(name){
 if(!name||name.length>1024||name.startsWith('/')||name.includes('\\')||
    name.split('/').some(part=>!part||part==='.'||part==='..')||
    /[\u0000-\u001f]/.test(name)||/^[a-zA-Z]:/.test(name))
   throw Error('Unsafe archive path: '+JSON.stringify(name));
 if(!(name==='data.json'||name==='BACKUP_README.txt'||name.startsWith('media/')||name.startsWith('backups/')))
   throw Error('Unexpected archive entry: '+name);
 return name;
}
function extractEntries(buffer){
 const files=new Map();
 let offset=0;
 while(offset+30<=buffer.length && buffer.readUInt32LE(offset)===0x04034b50){
  const flags=buffer.readUInt16LE(offset+6);
  const method=buffer.readUInt16LE(offset+8);
  const checksum=buffer.readUInt32LE(offset+14);
  const size=buffer.readUInt32LE(offset+18),compressed=buffer.readUInt32LE(offset+22);
  const nameSize=buffer.readUInt16LE(offset+26),extra=buffer.readUInt16LE(offset+28);
  if(method!==0||flags&0x0009||size!==compressed)throw Error('Only stored ZIP32 entries without descriptors are supported.');
  const headerEnd=offset+30+nameSize+extra;
  const dataEnd=headerEnd+size;
  if(dataEnd>buffer.length)throw Error('Truncated ZIP entry.');
  const name=validateName(buffer.toString('utf8',offset+30,offset+30+nameSize));
  if(files.has(name))throw Error('Duplicate archive entry: '+name);
  const data=buffer.subarray(headerEnd,dataEnd);
  if(crc32(data)!==checksum)throw Error('Archive CRC mismatch: '+name);
  files.set(name,data);
  offset=dataEnd;
 }
 if(offset+46>buffer.length||buffer.readUInt32LE(offset)!==0x02014b50)throw Error('ZIP central directory missing.');
 if(buffer.length<22||buffer.readUInt32LE(buffer.length-22)!==0x06054b50)throw Error('ZIP end record missing.');
 const count=buffer.readUInt16LE(buffer.length-12);
 if(count!==files.size)throw Error('ZIP central directory entry count mismatch.');
 return files;
}
function inspectArchive(filename){
 const bytes=fs.readFileSync(filename);
 if(bytes.length>0xffffffff)throw Error('ZIP32 archive is too large for this verifier.');
 const files=extractEntries(bytes);
 if(!files.has('data.json'))throw Error('EventFlow data.json is missing.');
 let db;
 try{db=JSON.parse(files.get('data.json').toString('utf8'))}catch{throw Error('data.json is not valid JSON.')}
 for(const key of ['events','programs','awards','users'])if(!Array.isArray(db[key]))throw Error('Invalid data.json: missing '+key+' array.');
 const media=[...files.keys()].filter(x=>x.startsWith('media/'));
 const linked=new Set();
 for(const program of db.programs){
  if(program.sourceType==='file'&&program.source)linked.add(program.source);
  if(program.scriptSource)linked.add(program.scriptSource);
  for(const archived of program.sourceArchive||[])if(archived.path)linked.add(archived.path);
 }
 const missing=[...linked].filter(ref=>!files.has('media/'+ref.replaceAll('\\','/')));
 if(missing.length)throw Error('Backup is incomplete: '+missing.length+' managed media source(s) missing.');
 return {files,summary:{events:db.events.length,programs:db.programs.length,awards:db.awards.length,users:db.users.length,
  media:media.length,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}};
}
function restoreArchive(archive,destination){
 const abs=path.resolve(destination);
 if(fs.existsSync(abs))throw Error('Destination already exists. Choose a new empty path.');
 const parent=path.dirname(abs);
 if(!fs.existsSync(parent)||!fs.statSync(parent).isDirectory())throw Error('Destination parent directory does not exist.');
 const {files,summary}=inspectArchive(archive);
 const temp=fs.mkdtempSync(path.join(parent,'.eventflow-restore-'));
 try{
  for(const [name,content] of files){
   if(name==='BACKUP_README.txt')continue;
   const dest=path.join(temp,...name.split('/'));
   fs.mkdirSync(path.dirname(dest),{recursive:true});
   fs.writeFileSync(dest,content,{flag:'wx',mode:0o600});
  }
  fs.renameSync(temp,abs);
  return summary;
 }catch(error){fs.rmSync(temp,{recursive:true,force:true});throw error}
}
function main(argv){
 const [mode,archive,destination]=argv;
 if(!['--verify','--restore'].includes(mode)||!archive||(mode==='--restore'&&!destination)){
  process.stderr.write('Usage: node scripts/verify-backup.js --verify BACKUP.zip\n       node scripts/verify-backup.js --restore BACKUP.zip NEW_DIRECTORY\n');
  process.exitCode=2;return;
 }
 try{
  const summary=mode==='--verify'?inspectArchive(archive).summary:restoreArchive(archive,destination);
  console.log(JSON.stringify({ok:true,mode,summary,...(mode==='--restore'?{destination:path.resolve(destination)}:{})},null,2));
 }catch(error){console.error('Backup verification failed:',error.message);process.exitCode=1}
}
if(require.main===module)main(process.argv.slice(2));
module.exports={inspectArchive,restoreArchive};
